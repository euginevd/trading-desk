"""Scan now, as it happens: which style the scan is on and what each has found so far, for the
Trade page's steps panel. One record for the process, kept in memory behind a lock; it holds
only stage names and counts, never a balance or a key. Nothing is recorded unless Scan now
began it, so the daily scan and the tests leave it alone."""

import threading
import time
from typing import Any

STATES = ("waiting", "screening", "checking odds", "judging", "sizing", "done", "failed")
ENDED = ("done", "failed")
NOTE_LENGTH = 160
MAX_NOTES = 3

_lock = threading.Lock()
_running = False
_started: int | None = None
_ended: int | None = None
_steps: list[dict[str, Any]] = []


def _now() -> int:
    return int(time.time() * 1000)


def begin(now_ms: int | None = None) -> bool:
    """Scan now starts: True for the scan that owns the record, False while another runs."""
    global _running, _started, _ended, _steps  # noqa: PLW0603 - the process's one record
    with _lock:
        if _running:
            return False
        _running, _started, _ended, _steps = True, now_ms or _now(), None, []
        return True


def plan(styles: list[tuple[str, str]]) -> None:
    """The styles this scan will run, in order, each waiting."""
    global _steps  # noqa: PLW0603 - the process's one record
    with _lock:
        if not _running:
            return
        _steps = [
            {"style": key, "name": name, "state": "waiting", "notes": []} for key, name in styles
        ]


def step(style: str, state: str | None, note: str | None = None) -> None:
    """One style moves to a stage (None: it stays where it is), with a short count or reason.
    A stage never follows the style's end, and an unknown stage or style is ignored."""
    with _lock:
        if not _running or (state is not None and state not in STATES):
            return
        row = next((s for s in _steps if s["style"] == style), None)
        if row is None or row["state"] in ENDED:
            return
        row["state"] = state or row["state"]
        words = " ".join(str(note or "").split())[:NOTE_LENGTH]
        if words and words not in row["notes"] and len(row["notes"]) < MAX_NOTES:
            row["notes"].append(words)


def finish(now_ms: int | None = None) -> None:
    """The scan ended, however it went: a style still under way is marked failed."""
    global _running, _ended  # noqa: PLW0603 - the process's one record
    with _lock:
        if not _running:
            return
        for row in _steps:
            if row["state"] not in (*ENDED, "waiting"):
                row["state"] = "failed"
        _running, _ended = False, now_ms or _now()


def view() -> dict[str, Any]:
    """The record as it is now; before any scan, an empty one."""
    with _lock:
        return {
            "running": _running,
            "started": _started,
            "ended": _ended,
            "steps": [{**row, "notes": list(row["notes"])} for row in _steps],
        }


def reset() -> None:
    """Back to nothing run, for the tests."""
    global _running, _started, _ended, _steps  # noqa: PLW0603 - the process's one record
    with _lock:
        _running, _started, _ended, _steps = False, None, None, []
