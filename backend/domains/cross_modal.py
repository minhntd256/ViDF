import logging
from typing import List

from clients import InternVLClient, try_parse_json

from .types import DomainResult

logger = logging.getLogger("fakemark.domains.cross_modal")

CROSS_MODAL_PROMPT = """You are a misinformation-detection assistant. You are given a video's title and a \
uniformly-sampled sequence of frames from that video, in temporal order.

Title: {title}

Evaluate the consistency between the title and the video content: does the video visually support the \
specific claim(s) made in the title, or does it show something more limited/different (contradictory), or \
does it simply lack visual evidence for what the title claims (unsupported)?

Decide:
- contradictory_content: does the video content CONTRADICT what the title claims?
- unsupported_content: does the title make a claim the video footage simply does NOT support (without \
necessarily contradicting it)?

First finalize "analysis", "contradictory_content", "unsupported_content", and "reasoning" based purely on \
the evidence above. Only AFTER that, separately rate how confident you are in that finalized assessment — \
this confidence rating must NOT change or soften the values you already decided on.

Respond ONLY with JSON: {{"analysis": "<2-4 sentences>", "contradictory_content": true or false, \
"unsupported_content": true or false, "reasoning": "<one or two sentences>", "confidence": <int 0-100, \
your confidence in the assessment above — does not affect the assessment itself>}}"""


def run_cross_modal_domain(vlm: InternVLClient, title: str, frames: List) -> DomainResult:
    result = DomainResult(domain="cross_modal")

    if not (title or "").strip():
        result.analysis_text = "No title provided — skipped (nothing to cross-check against the video)."
        result.reasoning = "No title provided."
        result.fake_types = []
        logger.info("[cross_modal] skipped — no title provided")
        return result

    prompt = CROSS_MODAL_PROMPT.format(title=title)
    raw = vlm.generate(prompt, frames=frames, json_mode=True)
    parsed = try_parse_json(raw) or {}

    result.analysis_text = parsed.get("analysis", "")
    result.reasoning = parsed.get("reasoning", "")

    confidence = parsed.get("confidence")
    if isinstance(confidence, (int, float)):
        result.confidence = max(0.0, min(100.0, float(confidence)))

    fake_types = []
    if parsed.get("contradictory_content"):
        fake_types.append("contradictory_content")
    if parsed.get("unsupported_content"):
        fake_types.append("unsupported_content")
    result.fake_types = fake_types

    if fake_types:
        logger.info("[cross_modal] FAKE — types=%s reasoning=%r", fake_types, result.reasoning)
    else:
        logger.info("[cross_modal] real — reasoning=%r", result.reasoning)

    return result
