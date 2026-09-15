from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class DomainResult:
    domain: str
    fake_types: List[str] = field(default_factory=list)
    reasoning: str = ""
    analysis_text: str = ""

  
    confidence: Optional[float] = None

    claims: List[str] = field(default_factory=list)

    fake_claims: List[str] = field(default_factory=list)

    text_groundings: Dict[str, List[str]] = field(default_factory=dict)

    evidence: List[Dict] = field(default_factory=list)

    temporal_grounding: Optional[Dict] = None

    cgi_grounding: Optional[Dict] = None
