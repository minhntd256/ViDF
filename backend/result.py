from dataclasses import asdict, dataclass, field
from typing import Dict, List, Optional


@dataclass
class FakeMarkResult:
    is_fake: bool
    confidence: Optional[float] = None
    binary_reasoning: str = ""
    domain_summaries: List[Dict] = field(default_factory=list)
    fake_types: List[str] = field(default_factory=list)
    analysis: Optional[Dict] = None
    text_groundings: Dict[str, List[str]] = field(default_factory=dict)
    fake_claims: List[str] = field(default_factory=list)
    temporal_grounding: Optional[Dict] = None
    cgi_grounding: Optional[Dict] = None
    evidence: List[Dict] = field(default_factory=list)
    timing: Optional[Dict[str, float]] = None
    video_duration: float = 0.0
    video_fps: float = 0.0
    video_num_frames: int = 0

    def to_dict(self):
        return asdict(self)
