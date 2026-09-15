from typing import Dict, List, Optional, Sequence
from urllib.parse import urlparse

FAKE_TYPE_LABELS = {
    "false_title": "False Title",
    "false_speech": "False Speech",
    "temporal_edit": "Temporal Edit",
    "CGI": "CGI / Synthetic",
    "contradictory_content": "Contradictory Content",
    "unsupported_content": "Unsupported Content",
    "speech_video_contradictory": "Speech/Video Contradictory",
    "speech_video_unsupported": "Speech/Video Unsupported",
}


def _build_claims(claims: List[str], fake_claims: List[str]) -> List[Dict]:
    fake_set = set(fake_claims or [])
    return [
        {"text": c, "type": "CLAIM", "stance": "refute" if c in fake_set else "neutral"}
        for c in (claims or [])
        if c
    ]


def _confidence(confidence: Optional[float], is_fake: bool, n_fake_types: int) -> Dict[str, int]:
    if confidence is None:
        overall = 95 if not is_fake else min(99, 40 + 10 * n_fake_types)
    else:
        overall = round(confidence)
    return {"overall": overall, "technical": overall, "retrieval": overall}


def _build_timeline(result_dict: Dict) -> Dict:
    duration = result_dict.get("video_duration") or 0.0
    fps = result_dict.get("video_fps") or 0.0
    is_fake = result_dict["is_fake"]

    n_keyframes = 8
    keyframes = []
    danger_range = None

    if is_fake and duration > 0:
        cgi = result_dict.get("cgi_grounding")
        temporal = result_dict.get("temporal_grounding")

        if cgi and cgi.get("frame_span") and fps > 0:
            fs, fe = cgi["frame_span"]
            danger_range = (fs / fps, fe / fps)
        elif temporal and temporal.get("transition_frames") and fps > 0:
            t = temporal["transition_frames"][0] / fps
            danger_range = (max(0.0, t - 2.0), min(duration, t + 2.0))

    for i in range(n_keyframes):
        t = duration * (i + 0.5) / n_keyframes if duration > 0 else i
        flagged = bool(danger_range and danger_range[0] <= t <= danger_range[1])
        keyframes.append({"t": _fmt_time(t), "flag": flagged, "label": f"KF{i+1}"})

    if not is_fake or duration <= 0:
        risk = [{"pct": 100, "level": "safe", "tip": "No issues detected"}]
    elif danger_range:
        pre_pct = max(0.0, danger_range[0] / duration * 100)
        danger_pct = max(1.0, (danger_range[1] - danger_range[0]) / duration * 100)
        post_pct = max(0.0, 100 - pre_pct - danger_pct)
        risk = []
        if pre_pct > 0:
            risk.append({"pct": round(pre_pct, 1), "level": "safe", "tip": "No issues detected"})
        risk.append({"pct": round(danger_pct, 1), "level": "danger", "tip": "Flagged region — see Grounding panel"})
        if post_pct > 0:
            risk.append({"pct": round(post_pct, 1), "level": "safe", "tip": "No issues detected"})
    else:
        risk = [{"pct": 100, "level": "warn", "tip": "Misinformation detected — no specific video segment localized"}]

    speech = [{"pct": 100, "color": "#e2e2dc"}]

    return {"speech": speech, "risk": risk, "keyframes": keyframes}


def _fmt_time(seconds: float) -> str:
    seconds = max(0, int(seconds))
    return f"{seconds // 60}:{seconds % 60:02d}"


def _build_grounding_cards(result_dict: Dict) -> List[Dict]:
    is_fake = result_dict["is_fake"]
    fake_types = result_dict.get("fake_types", [])
    cards = []

    if not is_fake:
        cards.append(
            {
                "name": "Video Grounding",
                "val": 0,
                "unit": "%",
                "color": "#10b981",
                "verdict": "CLEAN",
                "vcolor": "var(--verified)",
                "vbg": "var(--verified-bg)",
                "vborder": "var(--verified-border)",
            }
        )
        return cards

    temporal = result_dict.get("temporal_grounding")
    if "temporal_edit" in fake_types:
        detected = bool(temporal and temporal.get("transition_indices"))
        cards.append(
            {
                "name": "Temporal Edit",
                "val": 100 if detected else 0,
                "unit": "%",
                "color": "#ef4444" if detected else "#10b981",
                "verdict": "DETECTED" if detected else "NOT LOCALIZED",
                "vcolor": "var(--deepfake)" if detected else "var(--text3)",
                "vbg": "var(--deepfake-bg)" if detected else "var(--surface2)",
                "vborder": "var(--deepfake-border)" if detected else "var(--border2)",
                "detail": (temporal or {}).get("reasoning", ""),
            }
        )

    cgi = result_dict.get("cgi_grounding")
    if "CGI" in fake_types:
        detected = bool(cgi and cgi.get("boxes"))
        cards.append(
            {
                "name": "CGI / Synthetic Content",
                "val": 100 if detected else 0,
                "unit": "%",
                "color": "#ef4444" if detected else "#10b981",
                "verdict": "DETECTED" if detected else "NOT LOCALIZED",
                "vcolor": "var(--deepfake)" if detected else "var(--text3)",
                "vbg": "var(--deepfake-bg)" if detected else "var(--surface2)",
                "vborder": "var(--deepfake-border)" if detected else "var(--border2)",
                "detail": (cgi or {}).get("object_description", ""),
            }
        )

    text_types = [
        t
        for t in fake_types
        if t
        in (
            "false_title",
            "false_speech",
            "contradictory_content",
            "unsupported_content",
            "speech_video_contradictory",
            "speech_video_unsupported",
        )
    ]
    if text_types:
        cards.append(
            {
                "name": "Text / Cross-Modal Issues",
                "val": 100,
                "unit": "%",
                "color": "#ef4444",
                "verdict": "DETECTED",
                "vcolor": "var(--deepfake)",
                "vbg": "var(--deepfake-bg)",
                "vborder": "var(--deepfake-border)",
                "detail": ", ".join(FAKE_TYPE_LABELS.get(t, t) for t in text_types),
            }
        )

    if not cards:
        cards.append(
            {
                "name": "Video Grounding",
                "val": 0,
                "unit": "%",
                "color": "#9a9a94",
                "verdict": "N/A",
                "vcolor": "var(--text3)",
                "vbg": "var(--surface2)",
                "vborder": "var(--border2)",
                "detail": "",
            }
        )

    return cards


import re
import html as _html


_BADGE_ROLE = {
    "Real": "success",
    "Unsupported Content": "warning",
}

_CLAIM_SPLIT_RE = re.compile(r"(?=Claim\s*\d+\s*:)")
_CLAIM_LABEL_RE = re.compile(r"^(Claim\s*\d+\s*:)\s*(.*)$", re.DOTALL)


def _badge_html(label: str) -> str:
    role = _BADGE_ROLE.get(label, "danger")
    return f'<span class="reasoning-badge reasoning-badge-{role}">{_html.escape(label)}</span>'


def _claim_lines_html(reasoning: str, n_claims: int) -> str:
    text = (reasoning or "").strip()
    if not text:
        return '<p class="reasoning-claim-line">(no reasoning returned)</p>'


    parts = [p.strip() for p in _CLAIM_SPLIT_RE.split(text) if p.strip()]
    if len(parts) > 1 or (parts and _CLAIM_LABEL_RE.match(parts[0])):
        rows = []
        for part in parts:
            m = _CLAIM_LABEL_RE.match(part)
            if m:
                label, body = m.group(1), m.group(2).strip()
            else:
                label, body = "", part
            rows.append(
                f'<p class="reasoning-claim-line"><span class="reasoning-claim-label">{_html.escape(label)}</span> '
                f"{_html.escape(body)}</p>"
            )
        return "".join(rows)


    if n_claims > 1:
        blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
        if len(blocks) == n_claims:
            rows = []
            for i, block in enumerate(blocks, start=1):
                rows.append(
                    f'<p class="reasoning-claim-line"><span class="reasoning-claim-label">Claim {i}:</span> '
                    f"{_html.escape(block)}</p>"
                )
            return "".join(rows)


    return f'<p class="reasoning-claim-line">{_html.escape(text)}</p>'


def _build_reasoning(result_dict: Dict) -> str:
    summaries = result_dict.get("domain_summaries") or []
    if not summaries:
        return (result_dict.get("binary_reasoning", "") or "").replace("\n", "<br>")

    is_fake = result_dict["is_fake"]
    verdict = "FAKE" if is_fake else "REAL"
    verdict_role = "danger" if is_fake else "success"
    parts = [f'<p class="reasoning-verdict">Video: <span class="reasoning-verdict-word reasoning-role-{verdict_role}">{verdict}</span></p>']

    for d in summaries:
        labels = d.get("labels") or []
        badges = "".join(_badge_html(l) for l in labels) if labels else _badge_html("Real")
        parts.append(
            '<div class="reasoning-domain">'
            f'<div class="reasoning-domain-head"><span class="reasoning-domain-name">{_html.escape(d["domain"])}</span>{badges}</div>'
            f'<div class="reasoning-domain-body">{_claim_lines_html(d.get("reasoning", ""), d.get("n_claims", 0))}</div>'
            "</div>"
        )
    return "".join(parts)


def _build_transcript(result_dict: Dict, transcript_segments: Sequence) -> List[Dict]:
    if not transcript_segments:
        return []

    false_speech_spans = (result_dict.get("text_groundings") or {}).get("false_speech", [])
    false_speech_spans = [s.lower() for s in false_speech_spans if s]

    out = []
    for seg in transcript_segments:
        text = seg.text
        flagged = any(span in text.lower() for span in false_speech_spans)
        out.append({"t": _fmt_time(seg.start), "text": text, "flag": flagged})
    return out


def _build_evidence(evidence: List[Dict], max_items: int = 8) -> List[Dict]:
    seen_sources = set()
    seen_urls = set()
    items = []
    for e in sorted(evidence or [], key=lambda x: x.get("score") or 0, reverse=True):
        url = (e.get("url") or "").strip()
        if not url:
            continue
        source = (urlparse(url).netloc or url).lower().removeprefix("www.")
        if source in seen_sources or url in seen_urls:
            continue
        seen_sources.add(source)
        seen_urls.add(url)
        items.append(
            {
                "title": e.get("title") or "(untitled)",
                "url": url,
                "source": urlparse(url).netloc or url,
                "snippet": (e.get("content") or "")[:220],
                "stance": "neutral",
                "claim": e.get("claim") or "",
            }
        )
        if len(items) >= max_items:
            break
    return items


def map_result_to_ui(result_dict: Dict, title: str, transcript_segments: Optional[Sequence] = None) -> Dict:
    is_fake = result_dict["is_fake"]
    fake_types = result_dict.get("fake_types", [])

    analysis = result_dict.get("analysis") or {}
    claims = _build_claims(analysis.get("claims", []), result_dict.get("fake_claims", []))

    return {
        "verdict": "FAKE" if is_fake else "REAL",
        "icon": "⚠️" if is_fake else "✅",
        "fake_types": fake_types,
        "fake_type_labels": [FAKE_TYPE_LABELS.get(t, t) for t in fake_types],
        "conf": _confidence(result_dict.get("confidence"), is_fake, len(fake_types)),
        "reasoning": _build_reasoning(result_dict),
        "domain_summaries": result_dict.get("domain_summaries") or [],
        "entities": [],
        "style": "Not analyzed (style detection not implemented)",
        "timeline": _build_timeline(result_dict),
        "grounding": _build_grounding_cards(result_dict),
        "claims": claims,
        "evidence": _build_evidence(result_dict.get("evidence", [])),
        "provenance": None,
        "transcript": _build_transcript(result_dict, transcript_segments or []),
        "caption": title,
    }
