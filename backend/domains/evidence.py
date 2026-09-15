from typing import Dict, List, Optional, Tuple

from clients import TavilyClient

_FAKE_NEWS_SUFFIX = "Is it a fake news?"


def build_tavily_query(claim: str) -> str:
    base = (claim or "").strip().rstrip(".!?")
    if not base:
        return _FAKE_NEWS_SUFFIX
    return f"{base}. {_FAKE_NEWS_SUFFIX}"


def gather_evidence(
    tavily: Optional[TavilyClient], claims: List[str]
) -> Tuple[List[Dict], Dict[str, str], bool]:
    """Returns (evidence_items, answers, ok). ok=False means Tavily itself failed
    (quota/error) at runtime and the caller should fall back to the LLM's own
    knowledge instead of trusting an empty/partial evidence set."""
    if tavily is None or not claims:
        return [], {}, True
    evidence_items: List[Dict] = []
    answers: Dict[str, str] = {}
    ok = True
    for claim in claims:
        query = build_tavily_query(claim)
        result = tavily.search(query)
        if result is None:
            ok = False
            continue
        answers[claim] = (result.get("answer") or "").strip()
        for item in result.get("results", []):
            evidence_items.append({**item, "claim": claim, "query": query})
    return evidence_items, answers, ok


def claims_and_answers_block(claims: List[str], answers: Dict[str, str]) -> str:
    if not claims:
        return "(no claims extracted)"
    lines = []
    for i, claim in enumerate(claims):
        answer = answers.get(claim, "")
        if answer:
            lines.append(f"{answer}")
        else:
            lines.append("  (No answer found for this claim)")
        lines.append("")
    return "\n".join(lines).strip()
