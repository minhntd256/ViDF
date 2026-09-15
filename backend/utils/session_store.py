import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from domains.types import DomainResult

logger = logging.getLogger("fakemark.session")

SESSION_TTL_SECONDS = 30 * 60


@dataclass
class SessionState:
    session_id: str
    video_path: str
    title: str
    created_at: float = field(default_factory=time.time)
    last_access: float = field(default_factory=time.time)

    video: Optional[Any] = None
    full_frames: Optional[List] = None
    full_idxs: Optional[List] = None

    transcript: str = ""
    transcript_segments: List = field(default_factory=list)
    asr_done: bool = False

    title_claims: List[str] = field(default_factory=list)
    title_claims_done: bool = False
    speech_claims: List[str] = field(default_factory=list)
    speech_claims_done: bool = False

    title_result: Optional[DomainResult] = None
    speech_result: Optional[DomainResult] = None
    temporal_result: Optional[DomainResult] = None
    cgi_result: Optional[DomainResult] = None
    cross_modal_result: Optional[DomainResult] = None
    speech_video_result: Optional[DomainResult] = None

    scenes: Optional[List] = None
    transitions: Optional[List] = None
    scene_frames_by_scene: Optional[Dict] = None

    timing: Dict[str, float] = field(default_factory=dict)

    def claims_ready(self) -> bool:
        return self.title_claims_done and self.speech_claims_done

    def domain_result(self, domain: str) -> DomainResult:
        result = getattr(self, f"{domain}_result", None)
        return result if result is not None else DomainResult(domain=domain)


class SessionStore:
    def __init__(self, ttl_seconds: int = SESSION_TTL_SECONDS):
        self._sessions: Dict[str, SessionState] = {}
        self._lock = threading.Lock()
        self.ttl_seconds = ttl_seconds

    def create(self, video_path: str, title: str) -> SessionState:
        session_id = uuid.uuid4().hex
        state = SessionState(session_id=session_id, video_path=video_path, title=title)
        with self._lock:
            self._sessions[session_id] = state
        return state

    def get(self, session_id: str) -> Optional[SessionState]:
        with self._lock:
            state = self._sessions.get(session_id)
            if state is not None:
                state.last_access = time.time()
            return state

    def delete(self, session_id: str) -> None:
        with self._lock:
            state = self._sessions.pop(session_id, None)
        if state is not None:
            Path(state.video_path).unlink(missing_ok=True)
            logger.info("Session %s deleted, %s removed", session_id, state.video_path)

    def sweep_expired(self) -> int:
        now = time.time()
        with self._lock:
            expired = [sid for sid, s in self._sessions.items() if now - s.last_access > self.ttl_seconds]
        for sid in expired:
            self.delete(sid)
        if expired:
            logger.info("Swept %d expired session(s)", len(expired))
        return len(expired)

    def start_background_sweeper(self, interval_seconds: int = 300) -> None:

        def _loop():
            while True:
                time.sleep(interval_seconds)
                try:
                    self.sweep_expired()
                except Exception:
                    logger.exception("Session sweep failed")

        t = threading.Thread(target=_loop, daemon=True)
        t.start()
