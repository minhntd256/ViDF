import os

QWEN_BASE_URL = os.environ.get("QWEN_BASE_URL", "")
QWEN_MODEL = os.environ.get("QWEN_MODEL", "Qwen/Qwen3-8B")
QWEN_API_KEY = "EMPTY"

INTERNVL_BASE_URL = os.environ.get("INTERNVL_BASE_URL", "")
INTERNVL_MODEL = os.environ.get("INTERNVL_MODEL", "OpenGVLab/InternVL2_5-8B")
INTERNVL_API_KEY = "EMPTY"

LLM_MAX_TOKENS = 1024
VLM_MAX_TOKENS = 1024
TEMPERATURE = 0.0

VIDEO_FULL_SAMPLE_FRAMES_MIN = 4
VIDEO_FULL_SAMPLE_FRAMES_MAX = 8
VIDEO_FULL_SAMPLE_FRAMES = VIDEO_FULL_SAMPLE_FRAMES_MAX
VIDEO_SCENE_SAMPLE_FRAMES = 8

CGI_BBOX_SAMPLE_FRAMES = 4


def compute_full_sample_frames(n_scenes: int, duration_seconds: float) -> int:
    scene_based = VIDEO_FULL_SAMPLE_FRAMES_MIN + 2 * max(0, n_scenes - 1)
    duration_based = VIDEO_FULL_SAMPLE_FRAMES_MIN + int(duration_seconds // 15)
    n = max(scene_based, duration_based)
    return max(VIDEO_FULL_SAMPLE_FRAMES_MIN, min(VIDEO_FULL_SAMPLE_FRAMES_MAX, n))


VIDEO_FRAME_MAX_DIM = 336

MAX_VIDEO_DURATION_SECONDS = 180

USE_TRANSNETV2 = True

ASR_ENABLED = True
ASR_MODEL_ID = "turbo"
ASR_DEVICE = "auto"
ASR_COMPUTE_TYPE = "auto"
ASR_TASK = "transcribe" 
ASR_BEAM_SIZE = 5


MT_ENABLED = True
MT_MODEL_ID = "/app/models/nllb-200-distilled-600M-ct2"  
MT_TOKENIZER_ID = "facebook/nllb-200-distilled-600M" 
MT_DEVICE = "auto"
MT_COMPUTE_TYPE = "auto"
MT_BEAM_SIZE = 4
MT_TARGET_LANG = "eng_Latn"

TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")
USE_TAVILY_SEARCH = True
TAVILY_MAX_RESULTS_PER_CLAIM = 3

FAKE_TYPES = [
    "false_title",
    "temporal_edit",
    "CGI",
    "false_speech",
    "contradictory_content",
    "unsupported_content",
]
