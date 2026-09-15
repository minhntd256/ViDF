import logging
from typing import Optional

import config as config

logger = logging.getLogger("fakemark.translate")


_WHISPER_TO_NLLB = {
    "en": "eng_Latn", "vi": "vie_Latn", "zh": "zho_Hans", "ja": "jpn_Jpan",
    "ko": "kor_Hang", "th": "tha_Thai", "fr": "fra_Latn", "de": "deu_Latn",
    "es": "spa_Latn", "ru": "rus_Cyrl", "id": "ind_Latn", "ms": "zsm_Latn",
    "ar": "arb_Arab", "hi": "hin_Deva", "pt": "por_Latn", "it": "ita_Latn",
}


class NLLBTranslator:
    """Lightweight MT fallback for ASR models (e.g. whisper 'turbo') that don't
    support task='translate'. Loaded lazily and cached; only used when the
    detected source language isn't already English.
    """

    def __init__(
        self,
        model_id: str = config.MT_MODEL_ID,
        tokenizer_id: str = config.MT_TOKENIZER_ID,
        device: str = config.MT_DEVICE,
        compute_type: str = config.MT_COMPUTE_TYPE,
    ):
        try:
            import ctranslate2
            from transformers import AutoTokenizer

            if device == "auto":
                try:
                    import torch

                    device = "cuda" if torch.cuda.is_available() else "cpu"
                except Exception:
                    device = "cpu"
            self.device = device

            logger.info(
                "Loading NLLB translator (weights=%s, tokenizer=%s, device=%s, compute_type=%s)...",
                model_id, tokenizer_id, device, compute_type,
            )
          
            self.tokenizer = AutoTokenizer.from_pretrained(tokenizer_id)
            self.translator = ctranslate2.Translator(
                model_id, device=device, compute_type=compute_type
            )
        except Exception as exc:
            raise RuntimeError(
                f"NLLB translator (weights='{model_id}', tokenizer='{tokenizer_id}') could not "
                "initialize on this machine. Falling back to untranslated transcript."
            ) from exc

        logger.info("NLLB translator ready.")

    def translate(self, text: str, src_lang: str, tgt_lang: str = "eng_Latn") -> str:
        text = (text or "").strip()
        if not text:
            return text

        nllb_src = _WHISPER_TO_NLLB.get(src_lang, f"{src_lang}_Latn")
        self.tokenizer.src_lang = nllb_src

        tokens = self.tokenizer.convert_ids_to_tokens(self.tokenizer.encode(text))
        results = self.translator.translate_batch(
            [tokens],
            target_prefix=[[tgt_lang]],
            beam_size=config.MT_BEAM_SIZE,
        )
        out_tokens = results[0].hypotheses[0][1:]
        return self.tokenizer.decode(self.tokenizer.convert_tokens_to_ids(out_tokens)).strip()


_translator_singleton: Optional[NLLBTranslator] = None


def get_translator() -> Optional[NLLBTranslator]:
    """Returns a process-wide cached NLLBTranslator, or None if it fails to load
    (caller should then just keep the original-language transcript)."""
    global _translator_singleton
    if _translator_singleton is None:
        try:
            _translator_singleton = NLLBTranslator()
        except Exception:
            logger.exception("NLLB translator failed to load, skipping translation.")
            _translator_singleton = False  
    return _translator_singleton or None
