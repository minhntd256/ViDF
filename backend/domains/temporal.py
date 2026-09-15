import logging
from typing import List

from clients import InternVLClient, try_parse_json
from utils.video_utils import Scene

from .types import DomainResult

logger = logging.getLogger("fakemark.domains.temporal")

VIDEO_TEMPORAL_PROMPT = """You are a video forensics assistant. You are given a uniformly-sampled sequence of \
frames spanning the entire video, in temporal order.

Evaluate the temporal consistency and completeness of the video: does the sequence of scenes form a coherent, \
uninterrupted narrative, or are there abrupt jumps, missing context, suspicious cuts, or scenes stitched \
together in a way that could distort the chronology or omit important context?

The video contains {n_scenes} scenes and {n_transitions} transition(s) between them, at approximately these \
times (seconds): {transition_times}.

Decide whether any transition(s) were included for deceptive purposes (this is the "temporal_edit" \
misinformation type — e.g. to hide missing context, fabricate continuity, or distort chronology). Reference \
transitions by their 1-indexed position (Transition 1 is between scene 1 and scene 2, etc). If none are \
deceptive, return an empty list.

First finalize "analysis", "malicious_transitions", and "reasoning" based purely on the forensic evidence \
above. Only AFTER that, separately rate how confident you are in that finalized assessment — this confidence \
rating must NOT change or soften the "malicious_transitions" list you already decided on.

Respond ONLY with JSON: {{"analysis": "<2-4 sentences, explicitly noting any suspicious transition or \
discontinuity you observe>", "malicious_transitions": [<int>, ...], "reasoning": "<one sentence>", \
"confidence": <int 0-100, your confidence in the assessment above — does not affect the assessment itself>}}"""


def run_temporal_domain(
    vlm: InternVLClient,
    full_frames: List,
    scenes: List[Scene],
    transitions: List[int],
    fps: float,
) -> DomainResult:
    result = DomainResult(domain="temporal")

    if not transitions:
        result.analysis_text = vlm.generate(
            "You are a video forensics assistant. You are given a uniformly-sampled sequence of frames "
            "spanning the entire video, in temporal order. Evaluate the temporal consistency and "
            "completeness of the video in 2-4 sentences.",
            frames=full_frames,
        )
        result.reasoning = "Only one scene detected — no transitions to evaluate."
        return result

    transition_times = [f"{t / max(fps, 1e-6):.1f}s" for t in transitions]
    prompt = VIDEO_TEMPORAL_PROMPT.format(
        n_scenes=len(scenes),
        n_transitions=len(transitions),
        transition_times=", ".join(transition_times),
    )
    raw = vlm.generate(prompt, frames=full_frames, json_mode=True)
    parsed = try_parse_json(raw) or {}

    result.analysis_text = parsed.get("analysis", "")
    result.reasoning = parsed.get("reasoning", "")
    idxs = [i for i in parsed.get("malicious_transitions", []) if isinstance(i, int) and 1 <= i <= len(transitions)]

    confidence = parsed.get("confidence")
    if isinstance(confidence, (int, float)):
        result.confidence = max(0.0, min(100.0, float(confidence)))

    if idxs:
        frames_hat = [transitions[i - 1] for i in idxs]
        result.fake_types = ["temporal_edit"]
        result.temporal_grounding = {
            "transition_indices": idxs,
            "transition_frames": frames_hat,
            "reasoning": result.reasoning,
        }
        logger.info("[temporal] FAKE — transitions=%s reasoning=%r", idxs, result.reasoning)
    else:
        logger.info("[temporal] real — reasoning=%r", result.reasoning)

    return result
