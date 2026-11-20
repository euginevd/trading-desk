"""The Backtest page's side of the api (decision 87): the styles and coins to pick from, the
runs started from the desk, one run in full, and the job queue the backtest worker reads. The
api never starts a process: it writes a checked request into `local/backtest/jobs`, and the
worker runs it. Only the desk's own runs are listed, never run.sh's (owner, 20 Nov 2026)."""

import json
import os
import re
import secrets
import time
import zipfile
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from api.backtest_report import load, summary
from api.backtest_runs import QUOTE, STYLES, BadRun, check, default

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
    def __init__(
        self,
        base: Path | None = None,
        now: Callable[[], int] = _now_ms,
        coins: Callable[[], list[str]] = list,
    ) -> None:
        self.base = base or root()
        self.results = self.base / "backtest_results"
        self.jobs = self.base / "jobs"
        self.now = now
        self.coins = coins  # today's top 100 USDC coins, by volume, from the screener

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
            except (OSError, ValueError, KeyError, TypeError, StopIteration, zipfile.BadZipFile):
                _cache[key] = None  # a result Freqtrade was still writing, cut off, or not ours
        return _cache[key]

    @staticmethod
    def _created(run_id: str) -> int:
        stamp = datetime.strptime(run_id.removeprefix("backtest-result-"), "%Y-%m-%d_%H-%M-%S")
        return int(stamp.replace(tzinfo=UTC).timestamp() * 1000)

    def runs(self) -> list[dict[str, Any]]:
        """The runs started from the desk that finished, newest first, as one line each."""
        found: list[dict[str, Any]] = []
        for job in self._job_ids():
            state = _read(self.jobs / f"{job}.status.json") or {}
            run_id = state.get("result")
            if state.get("state") != "done" or not isinstance(run_id, str):
                continue
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
                    "coin": s["coin"],
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

    def _job_ids(self) -> list[str]:
        """Every job the desk queued, newest first."""
        names = (p.name.removesuffix(".request.json") for p in self.jobs.glob("job-*.request.json"))
        return sorted((n for n in names if JOB_ID.fullmatch(n)), reverse=True)

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
        error = state.get("error")
        if named == "queued" and cancelling:
            named = "cancelled"  # the worker will say the same when it reaches it
        if named == "running" and not self._worker_on():
            # The worker died mid-run; it says the same when it starts again.
            named, error = "failed", "The backtest worker stopped mid-run. Start it and run again."
        return {
            "id": job,
            "style": request.get("style"),
            "coin": request.get("coin"),
            "ai": request.get("ai", False),
            "from": request.get("from"),
            "to": request.get("to"),
            "created": request.get("created"),
            "state": named,
            "step": state.get("step"),
            "started": state.get("started"),
            "finished": state.get("finished"),
            "error": error,
            "result": state.get("result"),
            "cancelling": cancelling and named == "running",
            "log": tail,
        }

    def _last_job(self) -> dict[str, Any] | None:
        ids = self._job_ids()
        return self._job(ids[0]) if ids else None

    def _worker_seen(self) -> int | None:
        seen = (_read(self.jobs / "worker.json") or {}).get("seen")
        return seen if isinstance(seen, int) else None

    def _worker_on(self) -> bool:
        seen = self._worker_seen()
        return seen is not None and self.now() - seen < WORKER_STALE_MS

    def view(self) -> dict[str, Any]:
        start, end = default()
        return {
            "styles": [
                {"key": s.key, "name": s.name, "candles": s.candles} for s in STYLES.values()
            ],
            "coins": self.coins(),
            "quote": QUOTE,
            "from": start,
            "to": end,
            "runs": self.runs(),
            "job": self._last_job(),
            "worker": {"seen": self._worker_seen(), "on": self._worker_on()},
        }

    def start(self, body: dict[str, Any]) -> dict[str, Any]:
        """Queues a checked run; one at a time."""
        coins = self.coins()
        if not coins:
            raise BadRun("The desk hasn't read today's top 100 yet: scan on the Trade page first.")
        wanted = check(body, coins)
        last = self._last_job()
        if last is not None and last["state"] in OPEN:
            raise BadRun("A run is already going: wait for it, or cancel it first.")
        if not self.jobs.exists():
            # The worker runs as another user and must write here too (known-mistakes 13c).
            self.jobs.mkdir(parents=True)
            self.jobs.chmod(0o777)  # noqa: S103 - local/ on the owner's machine; no secrets
        stamp = datetime.fromtimestamp(self.now() / 1000, UTC).strftime("%Y%m%d-%H%M%S")
        job = f"job-{stamp}-{secrets.token_hex(3)}"
        request = {
            "style": wanted.style.key,
            "coin": wanted.coin,
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


Route = Callable[[Backtests, dict[str, str], dict[str, Any]], dict[str, Any]]
ROUTES: dict[tuple[str, str], Route] = {
    ("GET", "/backtest"): lambda b, _q, _body: b.view(),
    ("GET", "/backtest/run"): lambda b, q, _body: b.run(q.get("id")),
    ("POST", "/backtest/jobs"): lambda b, _q, body: b.start(body),
    ("POST", "/backtest/jobs/cancel"): lambda b, _q, body: b.cancel(body),
}
