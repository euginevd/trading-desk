"""The Backtest page's side of the api (decision 85): the styles, every result Freqtrade has
kept, one run in full, and the job queue the backtest worker reads. The api never starts a
process: it writes a checked request into `local/backtest/jobs`, and the worker runs it."""

import json
import os
import re
import secrets
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from api.backtest_report import load, summary
from api.backtest_runs import STYLES, BadRun, check, default

RUN_ID = re.compile(r"backtest-result-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}")
JOB_ID = re.compile(r"job-\d{8}-\d{6}-[0-9a-f]{6}")
LOG_LINES = 12
WORKER_STALE_MS = 30_000
OPEN = {"queued", "running"}

# A result never changes once written: each is read once per file and kept.
_cache: dict[tuple[str, float], dict[str, Any] | None] = {}


def root() -> Path:
    return Path(os.environ.get("DESK_DB_DIR", "local")) / "backtest"


def _now_ms() -> int:
    return int(time.time() * 1000)


def _read(path: Path) -> dict[str, Any] | None:
    try:
        found: object = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return cast(dict[str, Any], found) if isinstance(found, dict) else None


class Backtests:
    def __init__(self, base: Path | None = None, now: Callable[[], int] = _now_ms) -> None:
        self.base = base or root()
        self.results = self.base / "backtest_results"
        self.jobs = self.base / "jobs"
        self.now = now

    # Results

    def _summary(self, run_id: str) -> dict[str, Any] | None:
        path = self.results / f"{run_id}.zip"
        try:
            key = (run_id, path.stat().st_mtime)
        except OSError:
            return None
        if key not in _cache:
            try:
                _cache[key] = summary(load(path))
            except (OSError, ValueError, KeyError, StopIteration):
                _cache[key] = None  # a result Freqtrade was still writing, or not ours
        return _cache[key]

    @staticmethod
    def _created(run_id: str) -> int:
        stamp = datetime.strptime(run_id.removeprefix("backtest-result-"), "%Y-%m-%d_%H-%M-%S")
        return int(stamp.replace(tzinfo=UTC).timestamp() * 1000)

    def runs(self) -> list[dict[str, Any]]:
        """Every kept result, newest first, as one line each."""
        found: list[dict[str, Any]] = []
        names = sorted((p.stem for p in self.results.glob("backtest-result-*.zip")), reverse=True)
        for run_id in names:
            if not RUN_ID.fullmatch(run_id):
                continue
            s = self._summary(run_id)
            if s is None:
                continue
            found.append(
                {
                    "id": run_id,
                    "created": self._created(run_id),
                    "style": s["style"],
                    "ai": s["ai"],
                    "strategy": s["strategy"],
                    "from": s["from"],
                    "to": s["to"],
                    "all": s["all"],
                }
            )
        return found

    def run(self, run_id: object) -> dict[str, Any]:
        if not isinstance(run_id, str) or not RUN_ID.fullmatch(run_id):
            raise BadRun("That isn't a backtest run.")
        found = self._summary(run_id)
        if found is None:
            raise LookupError(run_id)
        return {"id": run_id, "created": self._created(run_id), **found}

    # Jobs

    def _job(self, job: str) -> dict[str, Any]:
        request = _read(self.jobs / f"{job}.request.json") or {}
        state = _read(self.jobs / f"{job}.status.json") or {"state": "queued"}
        log = self.jobs / f"{job}.log"
        try:
            tail = log.read_text(encoding="utf-8", errors="replace").splitlines()[-LOG_LINES:]
        except OSError:
            tail = []
        cancelling = (self.jobs / f"{job}.cancel").exists()
        named = state.get("state", "queued")
        if named == "queued" and cancelling:
            named = "cancelled"  # the worker will say the same when it reaches it
        return {
            "id": job,
            "style": request.get("style"),
            "ai": request.get("ai", False),
            "from": request.get("from"),
            "to": request.get("to"),
            "created": request.get("created"),
            "state": named,
            "step": state.get("step"),
            "started": state.get("started"),
            "finished": state.get("finished"),
            "error": state.get("error"),
            "result": state.get("result"),
            "cancelling": cancelling and named == "running",
            "log": tail,
        }

    def _last_job(self) -> dict[str, Any] | None:
        names = sorted(
            (p.name.removesuffix(".request.json") for p in self.jobs.glob("job-*.request.json")),
            reverse=True,
        )
        for job in names:
            if JOB_ID.fullmatch(job):
                return self._job(job)
        return None

    def _worker_seen(self) -> int | None:
        seen = (_read(self.jobs / "worker.json") or {}).get("seen")
        return seen if isinstance(seen, int) else None

    def view(self) -> dict[str, Any]:
        seen = self._worker_seen()
        return {
            "styles": [
                {
                    "key": s.key,
                    "name": s.name,
                    "candles": s.candles,
                    "takes": s.takes,
                    "ai": s.ai_strategy is not None,
                    "from": default(s)[0],
                    "to": default(s)[1],
                }
                for s in STYLES.values()
            ],
            "runs": self.runs(),
            "job": self._last_job(),
            "worker": {
                "seen": seen,
                "on": seen is not None and self.now() - seen < WORKER_STALE_MS,
            },
        }

    def start(self, body: dict[str, Any]) -> dict[str, Any]:
        """Queues a checked run; one at a time."""
        wanted = check(body)
        last = self._last_job()
        if last is not None and last["state"] in OPEN:
            raise BadRun("A run is already going: wait for it, or cancel it first.")
        self.jobs.mkdir(parents=True, exist_ok=True)
        stamp = datetime.fromtimestamp(self.now() / 1000, UTC).strftime("%Y%m%d-%H%M%S")
        job = f"job-{stamp}-{secrets.token_hex(3)}"
        request = {
            "style": wanted.style.key,
            "ai": wanted.ai,
            "from": wanted.start.isoformat(),
            "to": wanted.end.isoformat(),
            "created": self.now(),
        }
        tmp = self.jobs / f"{job}.request.tmp"
        tmp.write_text(json.dumps(request), encoding="utf-8")
        tmp.replace(self.jobs / f"{job}.request.json")
        return self.view()

    def cancel(self, body: dict[str, Any]) -> dict[str, Any]:
        job = body.get("id")
        if not isinstance(job, str) or not JOB_ID.fullmatch(job):
            raise BadRun("That isn't a backtest job.")
        if not (self.jobs / f"{job}.request.json").exists():
            raise LookupError(job)
        (self.jobs / f"{job}.cancel").write_text("", encoding="utf-8")
        return self.view()


ROUTES: dict[tuple[str, str], Callable[[dict[str, str], dict[str, Any]], dict[str, Any]]] = {
    ("GET", "/backtest"): lambda _q, _b: Backtests().view(),
    ("GET", "/backtest/run"): lambda q, _b: Backtests().run(q.get("id")),
    ("POST", "/backtest/jobs"): lambda _q, b: Backtests().start(b),
    ("POST", "/backtest/jobs/cancel"): lambda _q, b: Backtests().cancel(b),
}
