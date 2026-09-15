import logging
from dataclasses import dataclass
from typing import List, Optional, Tuple

import numpy as np

logger = logging.getLogger("fakemark.video_utils")

try:
    from decord import VideoReader, cpu

    _HAS_DECORD = True
except ImportError:
    _HAS_DECORD = False
    import cv2


class VideoHandle:

    def __init__(self, path: str):
        self.path = path
        if _HAS_DECORD:
            self._vr = VideoReader(path, ctx=cpu(0))
            self.num_frames = len(self._vr)
            self.fps = self._vr.get_avg_fps()
        else:
            cap = cv2.VideoCapture(path)
            self.num_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            self.fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
            cap.release()

    def get_frames(self, indices: List[int]) -> List[np.ndarray]:
        indices = [min(max(i, 0), self.num_frames - 1) for i in indices]
        if _HAS_DECORD:
            batch = self._vr.get_batch(indices).asnumpy()
            return [batch[i] for i in range(batch.shape[0])]
        else:
            cap = cv2.VideoCapture(self.path)
            frames = []
            for idx in indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
                ok, frame = cap.read()
                if ok:
                    frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                else:
                    frames.append(frames[-1] if frames else np.zeros((224, 224, 3), dtype=np.uint8))
            cap.release()
            return frames

    def duration_seconds(self) -> float:
        return self.num_frames / max(self.fps, 1e-6)


def uniform_sample_frames(total_frames: int, n: int, start: int = 0, end: Optional[int] = None) -> List[int]:
    end = total_frames if end is None else min(end, total_frames)
    start = max(0, min(start, end - 1))
    if end - start <= 0:
        return [start] * n
    if end - start <= n:
        idxs = list(range(start, end))
        while len(idxs) < n:
            idxs.append(idxs[-1])
        return idxs[:n]
    step = (end - start) / n
    return [int(start + step * i + step / 2) for i in range(n)]


@dataclass
class Scene:
    scene_id: int
    start_frame: int
    end_frame: int


class SceneSegmenter:

    def __init__(self, use_transnet: bool = True):
        self.model = None
        if use_transnet:
            try:
                from transnetv2 import TransNetV2

                self.model = TransNetV2()
                logger.info("Loaded TransNetV2 for scene segmentation.")
            except Exception as e:
                logger.warning("TransNetV2 unavailable (%s); falling back to uniform time-window segmentation.", e)
                self.model = None

    def segment(self, video: VideoHandle, video_path: str, max_scenes: int = 6) -> Tuple[List[Scene], List[int]]:
        if self.model is not None:
            try:
                _, single_frame_pred, _ = self.model.predict_video(video_path)
                scene_list = self.model.predictions_to_scenes(single_frame_pred)
                scenes = [
                    Scene(scene_id=i, start_frame=int(s), end_frame=int(e) + 1)
                    for i, (s, e) in enumerate(scene_list)
                ]
                transitions = [sc.end_frame for sc in scenes[:-1]]
                return scenes, transitions
            except Exception as e:
                logger.warning("TransNetV2 inference failed (%s); falling back.", e)

        n = max(1, min(max_scenes, 3))
        total = video.num_frames
        bounds = uniform_sample_frames_bounds(total, n)
        scenes = [Scene(scene_id=i, start_frame=b[0], end_frame=b[1]) for i, b in enumerate(bounds)]
        transitions = [sc.end_frame for sc in scenes[:-1]]
        return scenes, transitions


def uniform_sample_frames_bounds(total_frames: int, n: int) -> List[Tuple[int, int]]:
    step = max(1, total_frames // n)
    bounds = []
    for i in range(n):
        s = i * step
        e = (i + 1) * step if i < n - 1 else total_frames
        bounds.append((s, e))
    return bounds
