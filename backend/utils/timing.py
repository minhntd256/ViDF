import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Dict, List, Tuple


@dataclass
class Timer:

    records: List[Tuple[str, float]] = field(default_factory=list)

    @contextmanager
    def measure(self, stage_name: str):
        start = time.perf_counter()
        try:
            yield
        finally:
            elapsed = time.perf_counter() - start
            self.records.append((stage_name, elapsed))

    @property
    def total(self) -> float:
        return sum(t for _, t in self.records)

    def as_dict(self) -> Dict[str, float]:
        d = {name: round(t, 3) for name, t in self.records}
        d["total"] = round(self.total, 3)
        return d

    def report(self) -> str:
        lines = ["Processing time breakdown:"]
        width = max((len(n) for n, _ in self.records), default=10)
        for name, t in self.records:
            pct = (t / self.total * 100) if self.total > 0 else 0
            lines.append(f"  {name.ljust(width)}  {t:7.2f}s  ({pct:5.1f}%)")
        lines.append(f"  {'TOTAL'.ljust(width)}  {self.total:7.2f}s")
        return "\n".join(lines)
