from typing import List

from domains.types import DomainResult
from result import FakeMarkResult

_DOMAIN_DISPLAY_NAMES = {
    "title": "Title",
    "speech": "Speech",
    "temporal": "Temporal",
    "cgi": "CGI",
    "cross_modal": "Title vs Video",
    "speech_video": "Speech vs Video",
}

_FAKE_TYPE_DISPLAY_NAMES = {
    "false_title": "False Title",
    "temporal_edit": "Temporal Edit",
    "CGI": "CGI",
    "false_speech": "False Speech",
    "contradictory_content": "Title/Video Contradictory Content",
    "unsupported_content": "Title/Video Unsupported Content",
    "speech_video_contradictory": "Speech/Video Contradictory Content",
    "speech_video_unsupported": "Speech/Video Unsupported Content",
}


def aggregate(
    title_result: DomainResult,
    speech_result: DomainResult,
    temporal_result: DomainResult,
    cgi_result: DomainResult,
    cross_modal_result: DomainResult,
    speech_video_result: DomainResult,
    video_duration: float = 0.0,
    video_fps: float = 0.0,
    video_num_frames: int = 0,
) -> FakeMarkResult:
    domain_results = [
        title_result,
        speech_result,
        temporal_result,
        cgi_result,
        cross_modal_result,
        speech_video_result,
    ]

    fake_types: List[str] = []
    for d in domain_results:
        for ft in d.fake_types:
            if ft not in fake_types:
                fake_types.append(ft)
    is_fake = bool(fake_types)

    domain_confidences = [d.confidence for d in domain_results if d.confidence is not None]
    overall_confidence = round(sum(domain_confidences) / len(domain_confidences), 1) if domain_confidences else None

    lines = [f"Video: {'FAKE' if is_fake else 'REAL'}"]
    domain_summaries: List[dict] = []
    for d in domain_results:
        name = _DOMAIN_DISPLAY_NAMES.get(d.domain, d.domain)
        labels = [_FAKE_TYPE_DISPLAY_NAMES.get(ft, ft) for ft in d.fake_types]
        lines.append(f"{name} {''.join(f'[{l}]' for l in labels) or '[Real]'}: {d.reasoning}".strip())
        domain_summaries.append(
            {
                "domain": name,
                "labels": labels,
                "reasoning": d.reasoning,
                "n_claims": len(d.claims),
            }
        )
    binary_reasoning = "\n".join(lines)

    claims = list(title_result.claims) + list(speech_result.claims)

    fake_claims = list(title_result.fake_claims) + list(speech_result.fake_claims)

    text_groundings = {}
    text_groundings.update(title_result.text_groundings)
    text_groundings.update(speech_result.text_groundings)

    evidence = list(title_result.evidence) + list(speech_result.evidence)

    analysis = {
        "title": title_result.analysis_text,
        "speech": speech_result.analysis_text,
        "video_temporal": temporal_result.analysis_text,
        "video_spatial": cgi_result.analysis_text,
        "cross_modal": cross_modal_result.analysis_text,
        "speech_video": speech_video_result.analysis_text,
        "claims": claims,
    }

    return FakeMarkResult(
        is_fake=is_fake,
        confidence=overall_confidence,
        binary_reasoning=binary_reasoning,
        domain_summaries=domain_summaries,
        fake_types=fake_types,
        analysis=analysis,
        text_groundings=text_groundings,
        fake_claims=fake_claims,
        temporal_grounding=temporal_result.temporal_grounding,
        cgi_grounding=cgi_result.cgi_grounding,
        evidence=evidence,
        video_duration=video_duration,
        video_fps=video_fps,
        video_num_frames=video_num_frames,
    )
