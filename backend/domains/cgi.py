import logging
from typing import List, Optional, Tuple

from clients import InternVLClient, try_parse_json
from utils.video_utils import Scene

from .types import DomainResult

logger = logging.getLogger("fakemark.domains.cgi")



CGI_ANALYSIS_PROMPT = """You are a synthetic-media detection assistant. You are given a uniformly-sampled \
sequence of {n_frames} frames from a video, in temporal order. The frames are indexed 0 to {max_idx} in the \
order shown.
 
Evaluate the visual authenticity of the underlying FOOTAGE ITSELF: look for unnatural motion, impossible \
physics, inconsistent lighting/shadows, warped or overly smooth textures on people/objects/scenes, or other \
signs that part or all of the footage may be CGI, AI-generated, or digitally manipulated.
 
Do NOT flag ordinary text/graphic overlays added during normal video editing — captions, subtitles, \
hashtags, watermarks, logos, stickers, or on-screen titles. Only flag such overlays if the underlying scene behind/around them is itself visibly \
fake.
 
Decide whether part or all of this video's actual footage is CGI, AI-generated, or digitally manipulated \
(this is the "CGI" misinformation type).
 
First finalize "is_fake", "reasoning", and "suspicious_frame_indices" based purely on the visual evidence \
above. Only AFTER that, separately rate how confident you are in that finalized assessment — this confidence \
rating must NOT change or soften the "is_fake" value you already decided on.

Respond ONLY with JSON: {{"is_fake": true or false, "reasoning": "<2-4 sentences, explicitly naming the \
object/region that looks suspicious, if any>", "suspicious_frame_indices": [<int>, ...], "confidence": \
<int 0-100, your confidence in the assessment above — does not affect the assessment itself>}}
 
"suspicious_frame_indices" must be a subset of {{0, ..., {max_idx}}} — the indices (from the list above) of \
the frames where the suspicious/fake content is actually visible. Use an empty list if is_fake is false."""

def _frame_indices_to_span(
    indices: List[int], full_idxs: List[int], scenes: List[Scene]
) -> Optional[Tuple[int, int]]:
    matched: List[Scene] = []
    for i in indices:
        if not isinstance(i, int) or not (0 <= i < len(full_idxs)):
            continue
        frame_num = full_idxs[i]
        for sc in scenes:
            if sc.start_frame <= frame_num < sc.end_frame:
                matched.append(sc)
                break
    if not matched:
        return None
    return (min(sc.start_frame for sc in matched), max(sc.end_frame for sc in matched))


def run_cgi_domain(
    vlm: InternVLClient,
    full_frames: List,
    full_idxs: List[int],
    scenes: List[Scene],
) -> DomainResult:
    result = DomainResult(domain="cgi")

    prompt = CGI_ANALYSIS_PROMPT.format(n_frames=len(full_frames), max_idx=max(len(full_frames) - 1, 0))
    raw = vlm.generate(prompt, frames=full_frames, json_mode=True)
    parsed = try_parse_json(raw) or {}

    is_fake = bool(parsed.get("is_fake"))
    result.reasoning = parsed.get("reasoning", "")
    result.analysis_text = result.reasoning
    suspicious_indices = parsed.get("suspicious_frame_indices") or []

    confidence = parsed.get("confidence")
    if isinstance(confidence, (int, float)):
        result.confidence = max(0.0, min(100.0, float(confidence)))

    if not is_fake or not scenes:
        logger.info("[cgi] real — reasoning=%r", result.reasoning)
        return result

    span = _frame_indices_to_span(suspicious_indices, full_idxs, scenes)
    if span is None:
        span = (scenes[0].start_frame, scenes[-1].end_frame)
        logger.info("[cgi] FAKE but no frame indices mapped to a scene — falling back to full-video span")

    f_s, f_e = span
    result.fake_types = ["CGI"]
    result.cgi_grounding = {
        "object_description": result.reasoning,
        "suspicious_frame_indices": suspicious_indices,
        "frame_span": (f_s, f_e),
    }
    logger.info("[cgi] FAKE — span=%s reasoning=%r", (f_s, f_e), result.reasoning)
    return result
