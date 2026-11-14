"""Add-only audit log (spec 10): one JSON line per event, never edited or deleted."""

import json
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import TextIO

# One open handle per log, shared by every thread under one lock: the portfolio's parallel
# reads, the watcher and the bots all append, and reopening the file for each line lost lines
# on Windows (known-mistakes 27a).
_LOCK = threading.Lock()
_OPEN: dict[Path, TextIO] = {}


def _handle(path: Path) -> TextIO:
    log = _OPEN.get(path)
    if log is None or log.closed:
        path.parent.mkdir(parents=True, exist_ok=True)
        log = _OPEN[path] = path.open("a", encoding="utf-8")  # noqa: SIM115 - kept open
    return log


class Audit:
    def __init__(self, path: Path) -> None:
        self._path = path.resolve()

    def record(self, kind: str, action: str, result: str) -> None:
        """Appends one entry. Callers pass no secrets: no keys, signatures or query strings."""
        entry = {
            "time": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "kind": kind,
            "asked_by": "owner",
            "action": action,
            "result": result,
        }
        with _LOCK:
            log = _handle(self._path)
            log.write(json.dumps(entry) + "\n")
            log.flush()
