"""Runs the Backtest page's requests (decision 87), one at a time, in the Freqtrade container.

The api writes `jobs/<id>.request.json`; this checks it again (api/backtest_runs.py), runs the
same download and backtest commands as run.sh, as argument lists, and writes
`jobs/<id>.status.json` beside it, with Freqtrade's output in `jobs/<id>.log`. A
`jobs/<id>.cancel` file stops it. It never reads keys or the desk's database, and opens no port.
"""

import contextlib
import json
import os
import re
import signal
import subprocess
import time
from pathlib import Path
from typing import Any

from api.backtest_report import load, strategy_of
from api.backtest_runs import BadRun, Run, check, commands

DATA = Path(os.environ.get("BACKTEST_DIR", "/freqtrade/user_data"))
JOBS = DATA / "jobs"
RESULTS = DATA / "backtest_results"
JOB_ID = re.compile(r"job-\d{8}-\d{6}-[0-9a-f]{6}")
STEPS = ("Downloading candles", "Downloading older candles", "Testing")
POLL_SECONDS = 1.0
running = True


def write(path: Path, data: dict[str, Any]) -> None:
    """Whole or not at all: the api may read it at any moment."""
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data), encoding="utf-8")
    tmp.replace(path)


def read(path: Path) -> dict[str, Any] | None:
    """A job file as a dict, or None when it's missing or not one (the folder is shared)."""
    try:
        found: object = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return found if isinstance(found, dict) else None  # pyright: ignore[reportUnknownVariableType]


def beat() -> None:
    write(JOBS / "worker.json", {"seen": int(time.time() * 1000)})


def status(job: str, **fields: Any) -> None:
    old = read(JOBS / f"{job}.status.json") or {"id": job}
    write(JOBS / f"{job}.status.json", {**old, **fields})


def now() -> int:
    return int(time.time() * 1000)


def pending() -> list[str]:
    """Requests not yet finished, oldest first."""
    found: list[str] = []
    for path in sorted(JOBS.glob("job-*.request.json")):
        job = path.name.removesuffix(".request.json")
        if not JOB_ID.fullmatch(job):
            continue
        state = (read(JOBS / f"{job}.status.json") or {}).get("state")
        if state in {None, "queued", "running"}:
            found.append(job)
    return found


def _result_for(run: Run, since: float) -> str | None:
    """The result Freqtrade wrote for this run: newer than its start, and its strategy."""
    last = RESULTS / ".last_result.json"
    if not last.exists() or last.stat().st_mtime < since:
        return None
    name = str((read(last) or {}).get("latest_backtest", ""))
    path = RESULTS / name
    if not name.endswith(".zip") or not path.exists():
        return None
    found = strategy_of(load(path))
    return name.removesuffix(".zip") if found and found[0] == run.strategy else None


def _step(job: str, cmd: list[str], log: Path) -> str | None:
    """Runs one command; 'cancelled', 'stopped', 'failed' or None when it finished cleanly."""
    with log.open("a", encoding="utf-8") as out:
        out.write(f"\n$ {' '.join(cmd)}\n")
        out.flush()
        proc = subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT)  # noqa: S603 - a fixed argument list
        while proc.poll() is None:
            beat()
            cancelled = (JOBS / f"{job}.cancel").exists()
            if cancelled or not running:
                proc.terminate()
                try:
                    proc.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    proc.kill()
                return "cancelled" if cancelled else "stopped"
            time.sleep(POLL_SECONDS)
    return None if proc.returncode == 0 else "failed"


def run(job: str) -> None:
    started = time.time()
    if (JOBS / f"{job}.cancel").exists():
        status(job, state="cancelled", finished=now())
        return
    try:
        wanted = check(read(JOBS / f"{job}.request.json") or {})
    except BadRun as e:
        status(job, state="failed", error=str(e), finished=now())
        return
    log = JOBS / f"{job}.log"
    status(job, state="running", started=now(), step=STEPS[0])
    for step, cmd in zip(STEPS, commands(wanted), strict=True):
        status(job, step=step)
        ended = _step(job, cmd, log)
        if ended == "cancelled":
            status(job, state="cancelled", finished=now())
            return
        if ended is not None:
            why = "The worker was stopped" if ended == "stopped" else "Freqtrade stopped"
            status(job, state="failed", finished=now(), error=f"{why} while {step.lower()}.")
            return
    try:
        result = _result_for(wanted, started)
    except (OSError, ValueError, KeyError, StopIteration):
        result = None
    if result is None:
        status(job, state="failed", finished=now(), error="Freqtrade finished without a result.")
        return
    status(job, state="done", step="Done", finished=now(), result=result)


def stop(_signum: int, _frame: object) -> None:
    global running  # noqa: PLW0603 - the loop's one switch
    running = False


def main() -> None:
    signal.signal(signal.SIGTERM, stop)
    JOBS.mkdir(parents=True, exist_ok=True)
    # The api runs as another user and writes the requests here (known-mistakes 13c); if the api
    # made the folder first, it opened it itself.
    with contextlib.suppress(PermissionError):
        JOBS.chmod(0o777)  # noqa: S103 - local/ on the owner's machine; holds no secrets
    # A run cut off by a restart can't be resumed: say so rather than leave it running.
    for job in pending():
        if (read(JOBS / f"{job}.status.json") or {}).get("state") == "running":
            status(job, state="failed", finished=now(), error="The worker restarted mid-run.")
    print("Backtest worker: watching", JOBS, flush=True)
    while running:
        beat()
        jobs = pending()
        if jobs:
            run(jobs[0])
        else:
            time.sleep(2)


if __name__ == "__main__":
    main()
