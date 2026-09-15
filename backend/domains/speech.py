import logging
from typing import List, Optional

from clients import QwenClient, TavilyClient, try_parse_json

from .evidence import claims_and_answers_block, gather_evidence
from .types import DomainResult

logger = logging.getLogger("fakemark.domains.speech")

SPEECH_COMBINED_PROMPT = """You are a fact-checking assistant. You are given a list of factual claims \
extracted from a video's spoken transcript. For EACH claim, INDEPENDENTLY:
1. Reason briefly using your own knowledge (state clearly if you cannot verify it).
2. Decide whether it is false or unsupported (this is the "false_speech" misinformation type). A claim \
being false does not make the others false — judge every claim on its own.

Claims:
{claims_block}

Respond ONLY with JSON: {{"verdicts": [{{"claim_number": 1, "reasoning": "<brief reasoning for this claim>", \
"is_fake": true or false}}, ...], "confidence": <int 0-100, your overall confidence in this assessment>}}"""


SPEECH_DECISION_FROM_TAVILY_PROMPT = """You are a fact-checking classifier.
 
You will receive claim-by-claim Tavily answers, each paired with the exact claim it was searched for. \
For EACH claim, classify independently based ONLY on its own Tavily answer:
- is_fake=true if the Tavily answer contradicts the claim, OR describes the claim (or the event/trend/story \
it refers to) as false, fake, a hoax, a myth, misleading, unconfirmed, unverified, debunked, or with no \
confirmed/documented cases — even if the wording is hedged (e.g. "largely considered a hoax", "no confirmed \
reports", "authorities warn it may not be real").
- is_fake=false ONLY when the Tavily answer clearly supports/confirms the claim as true and real.
- If the Tavily answer is empty, irrelevant, or truly inconclusive either way, is_fake=false.
 
Trust the Tavily answer over your own prior knowledge. Do not soften a clear "hoax/fake/unconfirmed" verdict \
into is_fake=false just because the phrasing is polite or hedged.
 
{claims_and_evidence}
 
Respond ONLY with JSON: {{"verdicts": [{{"claim_number": 1, "is_fake": true or false}}, ...], "confidence": \
<int 0-100, your overall confidence in this assessment>}}"""

def _claims_block(claims: List[str]) -> str:
    return "\n".join(f"Claim{i + 1}: {c}" for i, c in enumerate(claims)) if claims else "(no claims extracted)"


def _format_verdict_reasoning(claims: List[str], verdicts: List[dict]) -> str:
    lines = []
    for v in verdicts:
        if not isinstance(v, dict):
            continue
        try:
            idx = int(v.get("claim_number")) - 1
        except (TypeError, ValueError):
            continue
        if 0 <= idx < len(claims):
            lines.append(f"Claim {idx + 1}: {v.get('reasoning', '').strip()}")
    return " ".join(lines)


def run_speech_domain(
    llm: QwenClient,
    transcript: str,
    claims: List[str],
    tavily: Optional[TavilyClient] = None,
) -> DomainResult:
    result = DomainResult(domain="speech", claims=claims)

    if not (transcript or "").strip():
        result.analysis_text = "(no transcript available)"
        result.reasoning = "No transcript available — nothing to evaluate."
        return result

    if not claims:
        result.analysis_text = "(no checkable claims extracted)"
        result.reasoning = "Transcript has no checkable factual content — nothing to evaluate."
        return result

    tavily_ok = True
    evidence, answers = [], {}
    if tavily is not None:
        evidence, answers, tavily_ok = gather_evidence(tavily, claims)

    if tavily is not None and tavily_ok:
        result.evidence = evidence
        result.analysis_text = claims_and_answers_block(claims, answers)
        prompt = SPEECH_DECISION_FROM_TAVILY_PROMPT.format(
            claims_and_evidence=result.analysis_text
        )
        raw = llm.generate(prompt, json_mode=True)
        parsed = try_parse_json(raw) or {}
        result.reasoning = result.analysis_text
    else:
        if tavily is not None and not tavily_ok:
            logger.warning("[speech] Tavily unavailable (quota/error) — falling back to Qwen's own knowledge")
        prompt = SPEECH_COMBINED_PROMPT.format(claims_block=_claims_block(claims))
        raw = llm.generate(prompt, json_mode=True)
        parsed = try_parse_json(raw) or {}
        verdicts = parsed.get("verdicts") or []
        result.reasoning = _format_verdict_reasoning(claims, verdicts) or "(no reasoning returned)"
        result.analysis_text = result.reasoning

    verdicts = parsed.get("verdicts") or []

    fake_claims: List[str] = []
    for v in verdicts:
        if not isinstance(v, dict) or not v.get("is_fake"):
            continue
        try:
            idx = int(v.get("claim_number")) - 1
        except (TypeError, ValueError):
            continue
        if 0 <= idx < len(claims) and claims[idx] not in fake_claims:
            fake_claims.append(claims[idx])

    confidence = parsed.get("confidence")
    if isinstance(confidence, (int, float)):
        result.confidence = max(0.0, min(100.0, float(confidence)))

    if fake_claims:
        result.fake_types = ["false_speech"]
        result.fake_claims = fake_claims
        result.text_groundings["false_speech"] = fake_claims
        logger.info("[speech] FAKE — fake_claims=%r reasoning=%r", fake_claims, result.reasoning)
    else:
        logger.info("[speech] real — reasoning=%r", result.reasoning)

    return result
