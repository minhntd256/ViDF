import logging
from typing import List

from clients import InternVLClient, try_parse_json

from .types import DomainResult

logger = logging.getLogger("fakemark.domains.speech_video")

SPEECH_VIDEO_PROMPT = """You are a misinformation-detection assistant. You are given a video's spoken \
transcript and a uniformly-sampled sequence of frames from that video, in temporal order.

Transcript: {transcript}

Evaluate the consistency between what is said in the transcript and the video content: does the video \
visually support what the speaker is describing/claiming, or does it show something more limited/different \
(contradictory), or does it simply lack visual evidence for what is said (unsupported)?

Decide:
- contradictory_content: does the video content CONTRADICT what is said in the transcript?
- unsupported_content: does the transcript make a claim the video footage simply does NOT support (without \
necessarily contradicting it)?

First finalize "analysis", "contradictory_content", "unsupported_content", and "reasoning" based purely on \
the evidence above. Only AFTER that, separately rate how confident you are in that finalized assessment — \
this confidence rating must NOT change or soften the values you already decided on.

Respond ONLY with JSON: {{"analysis": "<2-4 sentences>", "contradictory_content": true or false, \
"unsupported_content": true or false, "reasoning": "<one or two sentences>", "confidence": <int 0-100, \
your confidence in the assessment above — does not affect the assessment itself>}}"""


def run_speech_video_domain(vlm: InternVLClient, transcript: str, frames: List) -> DomainResult:
    result = DomainResult(domain="speech_video")

    if not (transcript or "").strip():
        result.analysis_text = "No transcript available — skipped (nothing to cross-check against the video)."
        result.reasoning = "No transcript available."
        result.fake_types = []
        logger.info("[speech_video] skipped — no transcript available")
        return result

    prompt = SPEECH_VIDEO_PROMPT.format(transcript=transcript)
    raw = vlm.generate(prompt, frames=frames, json_mode=True)
    parsed = try_parse_json(raw) or {}

    result.analysis_text = parsed.get("analysis", "")
    result.reasoning = parsed.get("reasoning", "")

    confidence = parsed.get("confidence")
    if isinstance(confidence, (int, float)):
        result.confidence = max(0.0, min(100.0, float(confidence)))

    fake_types = []
    if parsed.get("contradictory_content"):
        fake_types.append("speech_video_contradictory")
    if parsed.get("unsupported_content"):
        fake_types.append("speech_video_unsupported")
    result.fake_types = fake_types

    if fake_types:
        logger.info("[speech_video] FAKE — types=%s reasoning=%r", fake_types, result.reasoning)
    else:
        logger.info("[speech_video] real — reasoning=%r", result.reasoning)

    return result
