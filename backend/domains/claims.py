import re
from typing import List

from clients import QwenClient, try_parse_json

_CLAIM_RULES = """Follow these rules strictly to avoid duplicate/overlapping claims:
- Merge sentences that describe the same underlying fact/event into ONE claim, even if worded differently or \
adding extra detail elsewhere in the text (e.g. "a challenge encourages kids to go missing" and "the challenge \
encourages teens as young as 14 to disappear for days" describe the same claim — combine them into a single, \
more complete claim rather than two separate ones).
- Do NOT list minor supporting details, restatements, or opinions/commentary as their own claims (e.g. "some \
parents are turning to Facebook" or "the situation is not a good idea" are not independent checkable claims — \
drop them, or fold them into the main claim only if essential to what's being checked).
- Only extract claims that are independently checkable facts (something that could be verified true/false), not \
vague statements, feelings, or predictions.
- Output at most 5 claims. If the text really only makes 1-2 central factual assertions, output just those 1-2 \
— fewer, more complete claims are better than many overlapping fragments.
- Only split into separate claims when they describe clearly unrelated events/topics (different subject, \
different incident). If multiple sentences are about the same underlying subject/event, merge them into ONE \
claim even if the wording or level of detail differs.
- If the text is a joke, meme, casual exclamation, or purely emotional caption with no verifiable facts, \
return an empty claims array.
- Do NOT add meta-description not present in the original text (e.g. do not prepend "A video shows", \
"claims that", "released a video saying"). Extract the claim as a clean, self-contained declarative \
sentence using only the text's own content.
- Preserve exact speaker names, quotes, or handles mentioned in the text (e.g. "Kasich:", "@username") — \
do not generalize them to "a person" or "someone".
- Strip sensational exclamations, clickbait phrasing, calls-to-action, and hashtags (e.g. "Ewwwww!", \
"Share now!", "#fake") — these are not part of the claim itself.
- Fix obvious spelling/typo errors in the claim text for clarity, without changing its meaning.
- Do not infer motive, cause, or implication not explicitly stated in the text.
- Preserve exact numbers, dates, locations, and proper nouns as written — do not round, approximate, or \
generalize them.
- Always output each claim in English — translate from the original language if the text is not in English, \
while keeping names, numbers, dates, and locations accurate."""

TITLE_CLAIM_EXTRACTION_PROMPT = """You are a fact-checking assistant. Given ONLY a video's title (do not assume \
anything about the video's actual content), extract the DISTINCT, core, checkable factual claim(s) made BY THE \
TITLE ITSELF. Do NOT evaluate or search for evidence yet — only extract the claims themselves.

{rules}

Title: {title}

Respond ONLY with JSON: {{"claims": ["<claim 1>", "<claim 2>", ...]}}. Use an empty array if the title makes no \
checkable factual claim."""

SPEECH_CLAIM_EXTRACTION_PROMPT = """You are a fact-checking assistant. Given ONLY a video's spoken transcript \
(do not assume anything about the title or the video's visuals), extract the DISTINCT, core, checkable factual \
claim(s) made IN THE SPEECH ITSELF. Do NOT evaluate or search for evidence yet — only extract the claims \
themselves.

{rules}

Transcript: {transcript}

Respond ONLY with JSON: {{"claims": ["<claim 1>", "<claim 2>", ...]}}. Use an empty array if the transcript \
makes no checkable factual claim."""

_PREFILTER_PROMPT = """Does the following video transcript state any SPECIFIC, checkable fact about the real \
world (e.g. a named event, person, place, date, or statistic that could be verified true/false against an \
external source)?

Vague reactions, personal feelings, or unspecific statements ("I'm never flying again", "they won't be flying \
anymore", "that's crazy") do NOT count as checkable content unless they specify a concrete, verifiable event.

Transcript: {transcript}

Respond ONLY with JSON: {{"has_content": true/false}}"""


_STOPWORDS = {
    "the", "a", "an", "is", "are", "was", "were", "it", "its", "and", "or", "to",
    "for", "of", "in", "on", "with", "as", "at", "by", "from", "that", "this",
    "be", "been", "has", "have", "had", "will", "would", "can", "could",
}


def _normalize_words(text: str) -> set:
    words = set(re.findall(r"[a-z0-9]+", text.lower()))
    return words - _STOPWORDS


def dedupe_claims(claims: List[str], overlap_threshold: float = 0.5) -> List[str]:
    ordered = sorted(claims, key=len, reverse=True)
    kept: List[str] = []
    kept_words: List[set] = []
    for claim in ordered:
        words = _normalize_words(claim)
        if not words:
            continue
        is_dup = any(
            kw and (len(words & kw) / min(len(words), len(kw))) >= overlap_threshold
            for kw in kept_words
        )
        if not is_dup:
            kept.append(claim)
            kept_words.append(words)
    order_index = {c: i for i, c in enumerate(claims)}
    kept.sort(key=lambda c: order_index.get(c, 0))
    return kept


def _parse_claims_json(raw: str) -> List[str]:
    parsed = try_parse_json(raw) or {}
    claims = parsed.get("claims", []) if isinstance(parsed, dict) else (parsed if isinstance(parsed, list) else [])
    return [c.strip() for c in claims if isinstance(c, str) and c.strip()]


def _speech_has_content(client: QwenClient, transcript: str) -> bool:
    prompt = _PREFILTER_PROMPT.format(transcript=transcript)
    try:
        raw = client.generate(prompt, json_mode=True)
    except Exception:
        return True
    parsed = try_parse_json(raw) or {}
    if not isinstance(parsed, dict):
        return True
    return bool(parsed.get("has_content", True))


def extract_title_claims(client: QwenClient, title: str) -> List[str]:
    if not (title or "").strip():
        return []
    prompt = TITLE_CLAIM_EXTRACTION_PROMPT.format(rules=_CLAIM_RULES, title=title)
    raw = client.generate(prompt, json_mode=True)
    return dedupe_claims(_parse_claims_json(raw))


def extract_speech_claims(client: QwenClient, transcript: str) -> List[str]:
    if not (transcript or "").strip():
        return []
    prompt = SPEECH_CLAIM_EXTRACTION_PROMPT.format(rules=_CLAIM_RULES, transcript=transcript)
    raw = client.generate(prompt, json_mode=True)
    return dedupe_claims(_parse_claims_json(raw))
