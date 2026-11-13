"""Add-only audit log (spec 10): one JSON line per event, never edited or deleted."""

import json
from datetime import UTC, datetime
from pathlib import Path


class Audit:
    def __init__(self, path: Path) -> None:
        self._path = path

    def record(self, kind: str, action: str, result: str) -> None:
        """Appends one entry. Callers pass no secrets: no keys, signatures or query strings."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        entry = {
            "time": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "kind": kind,
            "asked_by": "owner",
            "action": action,
            "result": result,
        }
        with self._path.open("a", encoding="utf-8") as log:
            log.write(json.dumps(entry) + "\n")
