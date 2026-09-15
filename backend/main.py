import argparse
import json
import logging
from pathlib import Path

from pipeline import FakeMark

logger = logging.getLogger("fakemark.main")


def _load_asr_if_needed(auto: bool):
    if not auto:
        return None
    from utils.asr import WhisperASR

    logger.info("--auto_transcribe set; loading Whisper (faster-whisper, large-v3)...")
    try:
        return WhisperASR()
    except Exception:
        logger.exception("ASR init failed; continuing without transcript support")
        return None


def _maybe_transcribe(video_path: str, cli_transcript: str, asr) -> str:
    if cli_transcript:
        return cli_transcript
    if asr is None:
        return ""
    logger.info("No transcript given; running ASR (faster-whisper large-v3) on %s", video_path)
    return asr.transcribe(video_path).text


def run_single(args):
    fm = FakeMark(
        qwen_base_url=args.qwen_url,
        qwen_model=args.qwen_model,
        internvl_base_url=args.internvl_url,
        internvl_model=args.internvl_model,
    )
    asr = _load_asr_if_needed(args.auto_transcribe)
    transcript = _maybe_transcribe(args.video, args.transcript, asr)
    result = fm.run(video_path=args.video, title=args.title, transcript=transcript)
    print(json.dumps(result.to_dict(), indent=2, ensure_ascii=False))
    if result.timing:
        print("\n--- Timing (seconds) ---")
        for k, v in result.timing.items():
            print(f"  {k}: {v}")
    if args.out:
        Path(args.out).write_text(json.dumps(result.to_dict(), indent=2, ensure_ascii=False))
        print(f"\nSaved to {args.out}")


def run_dataset(args):
    fm = FakeMark(
        qwen_base_url=args.qwen_url,
        qwen_model=args.qwen_model,
        internvl_base_url=args.internvl_url,
        internvl_model=args.internvl_model,
    )
    video_dir = Path(args.video_dir)
    out_path = Path(args.out)
    all_timings = []
    asr = _load_asr_if_needed(args.auto_transcribe)
    with open(args.dataset_jsonl) as fin, open(out_path, "w") as fout:
        for line in fin:
            line = line.strip()
            if not line:
                continue
            sample = json.loads(line)
            video_path = str(video_dir / sample["video"])
            try:
                transcript = _maybe_transcribe(video_path, sample.get("transcript", ""), asr)
                result = fm.run(video_path=video_path, title=sample.get("title", ""), transcript=transcript)
                out_record = {"id": sample.get("id"), **result.to_dict()}
                if result.timing:
                    all_timings.append(result.timing)
            except Exception as e:
                logger.exception("Failed on sample %s", sample.get("id"))
                out_record = {"id": sample.get("id"), "error": str(e)}
            fout.write(json.dumps(out_record, ensure_ascii=False) + "\n")
            fout.flush()
    print(f"Done. Results written to {out_path}")

    if all_timings:
        keys = sorted({k for t in all_timings for k in t})
        print("\n--- Average timing across {} samples (seconds) ---".format(len(all_timings)))
        for k in keys:
            vals = [t[k] for t in all_timings if k in t]
            avg = sum(vals) / len(vals)
            print(f"  {k}: avg={avg:.2f}s  (n={len(vals)})")


def main():
    parser = argparse.ArgumentParser(description="FakeMark: GroundMM inference pipeline")
    parser.add_argument("--qwen_url", default=None, help="Override Qwen3-8B vLLM base_url")
    parser.add_argument("--qwen_model", default=None, help="Override Qwen3-8B served model name")
    parser.add_argument("--internvl_url", default=None, help="Override InternVL vLLM base_url")
    parser.add_argument("--internvl_model", default=None, help="Override InternVL served model name")

    sub = parser.add_subparsers(dest="mode", required=True)

    p_single = sub.add_parser("single", help="Run on a single video")
    p_single.add_argument("--video", required=True)
    p_single.add_argument("--title", required=True)
    p_single.add_argument("--transcript", default="")
    p_single.add_argument(
        "--auto_transcribe", action="store_true",
        help="If --transcript is not given, run Whisper (faster-whisper, large-v3) ASR on --video instead of leaving it empty.",
    )
    p_single.add_argument("--out", default=None)

    p_ds = sub.add_parser("dataset", help="Run on a JSONL dataset")
    p_ds.add_argument("--dataset_jsonl", required=True)
    p_ds.add_argument("--video_dir", required=True)
    p_ds.add_argument("--out", required=True)
    p_ds.add_argument(
        "--auto_transcribe", action="store_true",
        help="For samples missing a 'transcript' field, run Whisper (faster-whisper, large-v3) ASR instead of leaving it empty.",
    )

    args = parser.parse_args()

    import config as cfg

    if args.qwen_url:
        cfg.QWEN_BASE_URL = args.qwen_url
    if args.qwen_model:
        cfg.QWEN_MODEL = args.qwen_model
    if args.internvl_url:
        cfg.INTERNVL_BASE_URL = args.internvl_url
    if args.internvl_model:
        cfg.INTERNVL_MODEL = args.internvl_model

    if args.mode == "single":
        run_single(args)
    else:
        run_dataset(args)


if __name__ == "__main__":
    main()
