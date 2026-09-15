import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

import config as config
import decision as decision
from clients import InternVLClient, QwenClient, get_claims_client, get_tavily_client
from domains.cgi import run_cgi_domain
from domains.claims import extract_speech_claims, extract_title_claims
from domains.cross_modal import run_cross_modal_domain
from domains.speech import run_speech_domain
from domains.speech_video import run_speech_video_domain
from domains.temporal import run_temporal_domain
from domains.title import run_title_domain
from result import FakeMarkResult
from utils.timing import Timer
from utils.video_utils import SceneSegmenter, VideoHandle, uniform_sample_frames

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
logger = logging.getLogger("fakemark.pipeline")


class FakeMark:
    def __init__(
        self,
        qwen_base_url: Optional[str] = None,
        qwen_model: Optional[str] = None,
        internvl_base_url: Optional[str] = None,
        internvl_model: Optional[str] = None,
    ):
        qwen_base_url = qwen_base_url or config.QWEN_BASE_URL
        qwen_model = qwen_model or config.QWEN_MODEL
        internvl_base_url = internvl_base_url or config.INTERNVL_BASE_URL
        internvl_model = internvl_model or config.INTERNVL_MODEL

        self.llm = QwenClient(base_url=qwen_base_url, model=qwen_model)
        self.vlm = InternVLClient(base_url=internvl_base_url, model=internvl_model)

        self.claims_client = get_claims_client(self.llm)
        self.tavily = get_tavily_client()

        self.scene_segmenter = SceneSegmenter(use_transnet=config.USE_TRANSNETV2)

    def run(self, video_path: str, title: str, transcript: str = "") -> FakeMarkResult:
        logger.info("=== FakeMark: processing '%s' ===", video_path)
        timer = Timer()

        with timer.measure("video_load"):
            video = VideoHandle(video_path)

        def _segment_and_sample():
            with timer.measure("scene_segmentation"):
                scenes, transitions = self.scene_segmenter.segment(video, video_path)
                scene_frames_by_scene = {}
                for sc in scenes:
                    idxs = uniform_sample_frames(
                        video.num_frames, config.VIDEO_SCENE_SAMPLE_FRAMES, start=sc.start_frame, end=sc.end_frame
                    )
                    scene_frames_by_scene[sc.scene_id] = video.get_frames(idxs)
            logger.info("Segmented into %d scenes, %d transitions.", len(scenes), len(transitions))

            with timer.measure("full_frame_sample"):
                n_full = config.compute_full_sample_frames(len(scenes), video.duration_seconds())
                full_idxs = uniform_sample_frames(video.num_frames, n_full)
                full_frames = video.get_frames(full_idxs)
            logger.info("Sampled %d full-video frames (of max %d).", n_full, config.VIDEO_FULL_SAMPLE_FRAMES_MAX)

            return scenes, transitions, scene_frames_by_scene, full_frames, full_idxs

        with timer.measure("video_and_claims_parallel"):
            with ThreadPoolExecutor(max_workers=3) as ex:
                video_fut = ex.submit(_segment_and_sample)
                title_claims_fut = ex.submit(extract_title_claims, self.claims_client, title)
                speech_claims_fut = ex.submit(extract_speech_claims, self.claims_client, transcript)

                scenes, transitions, scene_frames_by_scene, full_frames, full_idxs = video_fut.result()
                title_claims = title_claims_fut.result()
                speech_claims = speech_claims_fut.result()
        logger.info("Title claims: %s", title_claims)
        logger.info("Speech claims: %s", speech_claims)

        with timer.measure("domains"):
            with ThreadPoolExecutor(max_workers=2) as ex:
                title_fut = ex.submit(run_title_domain, self.llm, title, title_claims, self.tavily)
                speech_fut = ex.submit(run_speech_domain, self.llm, transcript, speech_claims, self.tavily)

                temporal_result = run_temporal_domain(
                    self.vlm,
                    full_frames,
                    scenes,
                    transitions,
                    video.fps,
                )
                cgi_result = run_cgi_domain(
                    self.vlm,
                    full_frames,
                    full_idxs,
                    scenes,
                )
                cross_modal_result = run_cross_modal_domain(self.vlm, title, full_frames)
                speech_video_result = run_speech_video_domain(self.vlm, transcript, full_frames)

                title_result = title_fut.result()
                speech_result = speech_fut.result()

        logger.info("[title] fake_types=%s", title_result.fake_types)
        logger.info("[speech] fake_types=%s", speech_result.fake_types)
        logger.info("[temporal] fake_types=%s", temporal_result.fake_types)
        logger.info("[cgi] fake_types=%s", cgi_result.fake_types)
        logger.info("[cross_modal] fake_types=%s", cross_modal_result.fake_types)
        logger.info("[speech_video] fake_types=%s", speech_video_result.fake_types)

        result = decision.aggregate(
            title_result=title_result,
            speech_result=speech_result,
            temporal_result=temporal_result,
            cgi_result=cgi_result,
            cross_modal_result=cross_modal_result,
            speech_video_result=speech_video_result,
            video_duration=video.duration_seconds(),
            video_fps=video.fps,
            video_num_frames=video.num_frames,
        )
        result.timing = timer.as_dict()
        logger.info("\n%s", timer.report())
        return result
