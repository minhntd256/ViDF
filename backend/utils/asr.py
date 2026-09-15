import logging
from dataclasses import dataclass, field
from typing import List

import config as config

logger = logging.getLogger("fakemark.asr")


@dataclass
class TranscriptSegment:
    start: float
    end: float
    text: str


@dataclass
class TranscriptResult:
    text: str = ""
    segments: List[TranscriptSegment] = field(default_factory=list)
    detected_language: str = ""
    language_probability: float = 0.0


class WhisperASR:
    def __init__(
        self,
        model_id: str = config.ASR_MODEL_ID,
        device: str = config.ASR_DEVICE,
        compute_type: str = config.ASR_COMPUTE_TYPE,
    ):
        try:
            from faster_whisper import WhisperModel

            if device == "auto":
                try:
                    import torch

                    device = "cuda" if torch.cuda.is_available() else "cpu"
                except Exception:
                    device = "cpu"
            self.device = device

            logger.info(
                "Loading faster-whisper model '%s' (device=%s, compute_type=%s)...",
                model_id, device, compute_type,
            )
            self.model = WhisperModel(model_id, device=device, compute_type=compute_type)
        except Exception as exc:
            raise RuntimeError(
                f"faster-whisper model '{model_id}' could not initialize on this machine. "
                "Transcript support will be disabled."
            ) from exc

        logger.info("faster-whisper model ready.")

    def transcribe(
        self,
        media_path: str,
        task: str = config.ASR_TASK,
        beam_size: int = config.ASR_BEAM_SIZE,
    ) -> TranscriptResult:
        logger.info("Running ASR (task=%s) on %s", task, media_path)

        segments_iter, info = self.model.transcribe(
            media_path,
            task=task,
            beam_size=beam_size,
        )

        segments: List[TranscriptSegment] = []
        text_parts: List[str] = []
        for seg in segments_iter:
            seg_text = (seg.text or "").strip()
            if not seg_text:
                continue
            segments.append(TranscriptSegment(start=seg.start, end=seg.end, text=seg_text))
            text_parts.append(seg_text)

        full_text = " ".join(text_parts).strip()

        logger.info(
            "ASR done: %d segments (detected_language=%s, prob=%.2f)",
            len(segments), info.language, info.language_probability,
        )

        detected_lang = info.language or ""
        if config.MT_ENABLED and detected_lang and detected_lang != "en" and full_text:
            from utils.translate import get_translator

            translator = get_translator()
            if translator is not None:
                try:
                    full_text = translator.translate(full_text, src_lang=detected_lang)
                    for seg in segments:
                        seg.text = translator.translate(seg.text, src_lang=detected_lang)
                    logger.info("Translated transcript %s -> %s.", detected_lang, config.MT_TARGET_LANG)
                except Exception:
                    logger.exception("NLLB translation failed, keeping original-language transcript.")

        return TranscriptResult(
            text=full_text,
            segments=segments,
            detected_language=info.language or "",
            language_probability=info.language_probability or 0.0,
        )
