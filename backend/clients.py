import base64
import io
import json
import logging
from typing import Optional, Sequence, Union

import numpy as np
from openai import OpenAI
from PIL import Image

import config as config

logger = logging.getLogger("fakemark.clients")


def _frame_to_b64(frame: Union[np.ndarray, Image.Image], fmt: str = "JPEG") -> str:
    if isinstance(frame, np.ndarray):
        img = Image.fromarray(frame.astype("uint8"))
    else:
        img = frame
    img = img.convert("RGB")

    max_dim = getattr(config, "VIDEO_FRAME_MAX_DIM", None)
    if max_dim and max(img.size) > max_dim:
        img.thumbnail((max_dim, max_dim), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


class QwenClient:

    def __init__(
        self,
        base_url: str = config.QWEN_BASE_URL,
        model: str = config.QWEN_MODEL,
        api_key: str = config.QWEN_API_KEY,
    ):
        self.client = OpenAI(base_url=base_url, api_key=api_key)
        self.model = model

    def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        max_tokens: int = config.LLM_MAX_TOKENS,
        temperature: float = config.TEMPERATURE,
        json_mode: bool = False,
    ) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        kwargs = dict(
            model=self.model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        kwargs["extra_body"] = {"chat_template_kwargs": {"enable_thinking": False}}

        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        try:
            resp = self.client.chat.completions.create(**kwargs)
            return resp.choices[0].message.content.strip()
        except Exception as e:
            logger.warning("Qwen call failed (%s), retrying without chat_template_kwargs", e)
            kwargs.pop("extra_body", None)
            resp = self.client.chat.completions.create(**kwargs)
            return resp.choices[0].message.content.strip()


class InternVLClient:

    def __init__(
        self,
        base_url: str = config.INTERNVL_BASE_URL,
        model: str = config.INTERNVL_MODEL,
        api_key: str = config.INTERNVL_API_KEY,
    ):
        self.client = OpenAI(base_url=base_url, api_key=api_key)
        self.model = model

    def generate(
        self,
        prompt: str,
        frames: Optional[Sequence[Union[np.ndarray, Image.Image]]] = None,
        system: Optional[str] = None,
        max_tokens: int = config.VLM_MAX_TOKENS,
        temperature: float = config.TEMPERATURE,
        json_mode: bool = False,
    ) -> str:
        content = []
        if frames:
            for f in frames:
                b64 = _frame_to_b64(f)
                content.append(
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
                    }
                )
        content.append({"type": "text", "text": prompt})

        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": content})

        kwargs = dict(
            model=self.model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}

        resp = self.client.chat.completions.create(**kwargs)
        return resp.choices[0].message.content.strip()


def get_claims_client(qwen: "QwenClient") -> "QwenClient":
    return qwen


class TavilyClient:

    def __init__(self, api_key: str = config.TAVILY_API_KEY):
        if not api_key:
            raise ValueError("TAVILY_API_KEY is not set (check your .env file).")
        from tavily import TavilyClient as _TavilyClient

        self.client = _TavilyClient(api_key=api_key)

    def search(self, query: str, max_results: int = config.TAVILY_MAX_RESULTS_PER_CLAIM) -> Optional[dict]:
        try:
            resp = self.client.search(
                query=query, max_results=max_results, search_depth="advanced", include_answer=True
            )
        except Exception:
            logger.warning("Tavily search failed for %r (quota/error) — signaling unavailable", query, exc_info=True)
            return None
        if not isinstance(resp, dict):
            return {"answer": "", "results": []}
        results = resp.get("results", []) or []
        return {
            "answer": resp.get("answer") or "",
            "results": [
                {
                    "title": r.get("title", ""),
                    "url": r.get("url", ""),
                    "content": r.get("content", ""),
                    "score": r.get("score"),
                }
                for r in results
            ],
        }


def get_tavily_client() -> Optional[TavilyClient]:
    if config.USE_TAVILY_SEARCH and config.TAVILY_API_KEY:
        try:
            return TavilyClient()
        except Exception:
            logger.exception("TavilyClient init failed, continuing without web-search evidence")
    return None


def try_parse_json(text: str) -> Optional[dict]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
    try:
        return json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        for open_c, close_c in [("{", "}"), ("[", "]")]:
            start = cleaned.find(open_c)
            end = cleaned.rfind(close_c)
            if start != -1 and end != -1 and end > start:
                try:
                    return json.loads(cleaned[start : end + 1])
                except (json.JSONDecodeError, ValueError):
                    continue
        logger.warning("Could not parse JSON from model output: %s", text[:200])
        return None
