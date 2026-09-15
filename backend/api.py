import logging
import shutil
import tempfile
import time
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import config as config
import decision as decision
from clients import InternVLClient, QwenClient, TavilyClient, get_claims_client, get_tavily_client
from domains.cgi import run_cgi_domain
from domains.claims import extract_speech_claims, extract_title_claims
from domains.cross_modal import run_cross_modal_domain
from domains.speech import run_speech_domain
from domains.speech_video import run_speech_video_domain
from domains.temporal import run_temporal_domain
from domains.title import run_title_domain
from pipeline import FakeMark
from ui_mapping import map_result_to_ui
from utils.session_store import SessionState, SessionStore
from utils.video_utils import SceneSegmenter, VideoHandle, uniform_sample_frames

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
logger = logging.getLogger("fakemark.api")

app = FastAPI(title="FakeMark / VidCred API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_WEBAPP_DIR = Path(__file__).parent / "webapp"
app.mount("/css", StaticFiles(directory=_WEBAPP_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=_WEBAPP_DIR / "js"), name="js")
app.mount("/demos", StaticFiles(directory=_WEBAPP_DIR / "demos"), name="demos")


@app.get("/")
def serve_frontend():
    return FileResponse(_WEBAPP_DIR / "vidcred_app.html")

_llm: Optional[QwenClient] = None
_vlm: Optional[InternVLClient] = None
_claims_client: Optional[object] = None
_tavily: Optional[TavilyClient] = None
_scene_segmenter: Optional[SceneSegmenter] = None
_fakemark: Optional[FakeMark] = None
_asr = None
_sessions = SessionStore()


@app.on_event("startup")
def _load_pipeline():
    global _llm, _vlm, _claims_client, _tavily, _scene_segmenter, _fakemark, _asr
    logger.info("Initializing FakeMark model clients...")
    _llm = QwenClient(base_url=config.QWEN_BASE_URL, model=config.QWEN_MODEL)
    _vlm = InternVLClient(base_url=config.INTERNVL_BASE_URL, model=config.INTERNVL_MODEL)
    _claims_client = get_claims_client(_llm)
    _tavily = get_tavily_client()
    _scene_segmenter = SceneSegmenter(use_transnet=config.USE_TRANSNETV2)
    _fakemark = FakeMark()
    logger.info("FakeMark ready.")

    if config.ASR_ENABLED:
        try:
            from utils.asr import WhisperASR

            logger.info("Initializing ASR (faster-whisper, %s)...", config.ASR_MODEL_ID)
            _asr = WhisperASR()
            logger.info("ASR ready.")
        except Exception:
            _asr = None
            logger.exception("ASR init failed; continuing without transcript support")
    else:
        logger.info("ASR_ENABLED=False — transcript will stay empty.")

    if config.ASR_ENABLED and config.MT_ENABLED:
        try:
            from utils.translate import get_translator

            logger.info("Warming up NLLB translator...")
            get_translator()
            logger.info("NLLB translator ready.")
        except Exception:
            logger.exception("NLLB translator warm-up failed; will fall back to untranslated transcript")

    _sessions.start_background_sweeper()


@app.get("/health")
def health():
    return {"status": "ok"}


def _require_pipeline():
    if _llm is None or _vlm is None:
        raise HTTPException(status_code=503, detail="Pipeline not initialized yet.")


def _require_session(session_id: str) -> SessionState:
    session = _sessions.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"Unknown or expired session_id: {session_id}")
    return session


def _record_timing(session: SessionState, step: str, started_at: float) -> None:
    session.timing[step] = session.timing.get(step, 0.0) + (time.time() - started_at)


def _ensure_scenes(session: SessionState):
    if session.scenes is None:
        scenes, transitions = _scene_segmenter.segment(session.video, session.video_path)
        scene_frames_by_scene = {}
        for sc in scenes:
            idxs = uniform_sample_frames(
                session.video.num_frames, config.VIDEO_SCENE_SAMPLE_FRAMES, start=sc.start_frame, end=sc.end_frame
            )
            scene_frames_by_scene[sc.scene_id] = session.video.get_frames(idxs)
        session.scenes = scenes
        session.transitions = transitions
        session.scene_frames_by_scene = scene_frames_by_scene
    return session.scenes, session.transitions, session.scene_frames_by_scene


def _domain_result_json(result) -> dict:
    d = asdict(result)
    if not d.get("claims"):
        d.pop("claims", None)
    return d


def _reject_if_too_long(duration_seconds: float) -> None:
    if duration_seconds > config.MAX_VIDEO_DURATION_SECONDS:
        raise HTTPException(
            status_code=400,
            detail={
                "error_code": "VIDEO_TOO_LONG",
                "message": f"Video exceeds the {config.MAX_VIDEO_DURATION_SECONDS}s limit.",
                "max_duration_seconds": config.MAX_VIDEO_DURATION_SECONDS,
                "video_duration": duration_seconds,
            },
        )


@app.post("/upload")
async def upload(video: UploadFile = File(...), caption: str = Form("")):
    _require_pipeline()

    suffix = Path(video.filename or "upload.mp4").suffix or ".mp4"
    tmp_dir = Path(tempfile.gettempdir()) / "fakemark_uploads"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = tmp_dir / f"{uuid.uuid4().hex}{suffix}"

    try:
        with tmp_path.open("wb") as f:
            shutil.copyfileobj(video.file, f)
        logger.info("Saved upload to %s (%.1f KB)", tmp_path, tmp_path.stat().st_size / 1024)

        video_handle = VideoHandle(str(tmp_path))
        _reject_if_too_long(video_handle.duration_seconds())

        scenes, transitions = _scene_segmenter.segment(video_handle, str(tmp_path))
        scene_frames_by_scene = {}
        for sc in scenes:
            idxs = uniform_sample_frames(
                video_handle.num_frames, config.VIDEO_SCENE_SAMPLE_FRAMES, start=sc.start_frame, end=sc.end_frame
            )
            scene_frames_by_scene[sc.scene_id] = video_handle.get_frames(idxs)

        n_full = config.compute_full_sample_frames(len(scenes), video_handle.duration_seconds())
        full_idxs = uniform_sample_frames(video_handle.num_frames, n_full)
        full_frames = video_handle.get_frames(full_idxs)

        session = _sessions.create(video_path=str(tmp_path), title=caption)
        session.video = video_handle
        session.full_frames = full_frames
        session.full_idxs = full_idxs
        session.scenes = scenes
        session.transitions = transitions
        session.scene_frames_by_scene = scene_frames_by_scene

        return {
            "session_id": session.session_id,
            "video_duration": video_handle.duration_seconds(),
            "video_fps": video_handle.fps,
            "video_num_frames": video_handle.num_frames,
            "scenes": [
                {"start": sc.start_frame / video_handle.fps, "end": sc.end_frame / video_handle.fps}
                for sc in scenes
            ],
        }
    except HTTPException:
        tmp_path.unlink(missing_ok=True)
        raise
    except Exception as e:
        tmp_path.unlink(missing_ok=True)
        logger.exception("Upload failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/asr")
async def run_asr(session_id: str):
    session = _require_session(session_id)
    t0 = time.time()

    if _asr is None:
        session.asr_done = True
        return {"transcript": "", "segments": []}

    try:
        asr_result = _asr.transcribe(session.video_path)
        session.transcript = asr_result.text
        session.transcript_segments = asr_result.segments
    except Exception:
        logger.exception("ASR failed, continuing with empty transcript")
        session.transcript = ""
        session.transcript_segments = []
    finally:
        session.asr_done = True
        _record_timing(session, "asr", t0)

    return {
        "transcript": session.transcript,
        "segments": [asdict(s) for s in session.transcript_segments],
    }


@app.post("/claims/title")
async def claims_title(session_id: str, title: Optional[str] = Form(None)):
    session = _require_session(session_id)
    if title is not None:
        session.title = title
    t0 = time.time()
    claims = extract_title_claims(_claims_client, session.title)
    session.title_claims = claims
    session.title_claims_done = True
    _record_timing(session, "claims_title", t0)
    return {"claims": claims}


@app.post("/claims/speech")
async def claims_speech(session_id: str):
    session = _require_session(session_id)
    t0 = time.time()
    claims = extract_speech_claims(_claims_client, session.transcript)
    session.speech_claims = claims
    session.speech_claims_done = True
    _record_timing(session, "claims_speech", t0)
    return {"claims": claims}


@app.post("/domain/title")
async def domain_title(session_id: str):
    session = _require_session(session_id)
    if not session.title_claims_done:
        raise HTTPException(status_code=400, detail="Call /claims/title first.")
    t0 = time.time()
    result = run_title_domain(_llm, session.title, session.title_claims, _tavily)
    session.title_result = result
    _record_timing(session, "domain_title", t0)
    return _domain_result_json(result)


@app.post("/domain/speech")
async def domain_speech(session_id: str):
    session = _require_session(session_id)
    if not session.speech_claims_done:
        raise HTTPException(status_code=400, detail="Call /claims/speech first.")
    t0 = time.time()
    result = run_speech_domain(_llm, session.transcript, session.speech_claims, _tavily)
    session.speech_result = result
    _record_timing(session, "domain_speech", t0)
    return _domain_result_json(result)


@app.post("/domain/temporal")
async def domain_temporal(session_id: str):
    session = _require_session(session_id)
    t0 = time.time()
    scenes, transitions, _scene_frames_by_scene = _ensure_scenes(session)
    result = run_temporal_domain(_vlm, session.full_frames, scenes, transitions, session.video.fps)
    session.temporal_result = result
    _record_timing(session, "domain_temporal", t0)
    return _domain_result_json(result)


@app.post("/domain/cgi")
async def domain_cgi(session_id: str):
    session = _require_session(session_id)
    t0 = time.time()
    scenes, _transitions, _scene_frames_by_scene = _ensure_scenes(session)
    result = run_cgi_domain(_vlm, session.full_frames, session.full_idxs, scenes)
    session.cgi_result = result
    _record_timing(session, "domain_cgi", t0)
    return _domain_result_json(result)


@app.post("/domain/cross_modal")
async def domain_cross_modal(session_id: str):
    session = _require_session(session_id)
    t0 = time.time()
    result = run_cross_modal_domain(_vlm, session.title, session.full_frames)
    session.cross_modal_result = result
    _record_timing(session, "domain_cross_modal", t0)
    return _domain_result_json(result)


@app.post("/domain/speech_video")
async def domain_speech_video(session_id: str):
    session = _require_session(session_id)
    t0 = time.time()
    result = run_speech_video_domain(_vlm, session.transcript, session.full_frames)
    session.speech_video_result = result
    _record_timing(session, "domain_speech_video", t0)
    return _domain_result_json(result)


@app.get("/result")
async def get_result(session_id: str):
    session = _require_session(session_id)

    result = decision.aggregate(
        title_result=session.domain_result("title"),
        speech_result=session.domain_result("speech"),
        temporal_result=session.domain_result("temporal"),
        cgi_result=session.domain_result("cgi"),
        cross_modal_result=session.domain_result("cross_modal"),
        speech_video_result=session.domain_result("speech_video"),
        video_duration=session.video.duration_seconds() if session.video else 0.0,
        video_fps=session.video.fps if session.video else 0.0,
        video_num_frames=session.video.num_frames if session.video else 0,
    )
    result.timing = session.timing
    ui = map_result_to_ui(result.to_dict(), title=session.title, transcript_segments=session.transcript_segments)
    ui["tavily_enabled"] = _tavily is not None
    return ui


@app.delete("/session/{session_id}")
async def delete_session(session_id: str):
    _sessions.delete(session_id)
    return {"deleted": True}


@app.post("/analyze")
async def analyze(video: UploadFile = File(...), caption: str = Form("")):
    _require_pipeline()

    suffix = Path(video.filename or "upload.mp4").suffix or ".mp4"
    tmp_dir = Path(tempfile.gettempdir()) / "fakemark_uploads"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = tmp_dir / f"{uuid.uuid4().hex}{suffix}"

    try:
        with tmp_path.open("wb") as f:
            shutil.copyfileobj(video.file, f)
        logger.info("Saved upload to %s (%.1f KB)", tmp_path, tmp_path.stat().st_size / 1024)

        video_handle = VideoHandle(str(tmp_path))
        _reject_if_too_long(video_handle.duration_seconds())

        transcript_text = ""
        transcript_segments = []
        if _asr is not None:
            try:
                asr_result = _asr.transcribe(str(tmp_path))
                transcript_text = asr_result.text
                transcript_segments = asr_result.segments
            except Exception:
                logger.exception("ASR failed, continuing with empty transcript")

        result = _fakemark.run(video_path=str(tmp_path), title=caption, transcript=transcript_text)
        ui_json = map_result_to_ui(result.to_dict(), title=caption, transcript_segments=transcript_segments)
        return ui_json

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Analysis failed")
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        tmp_path.unlink(missing_ok=True)
