"""Runs the Backtest page's requests (decision 85), one at a time, in the Freqtrade container.

The api writes `jobs/<id>.request.json`; this checks it again (api/backtest_runs.py), runs the
same download and backtest commands as run.sh, as argument lists, and writes
`jobs/<id>.status.json` beside it, with Freqtrade's output in `jobs/<id>.log`. A
`jobs/<id>.cancel` file stops it. It never reads keys or the desk's database, and opens no port.
"""

import json
import os
import re
import signal
import subprocess
import time
from pathlib import Path
from typing import Any

from api.backtest_runs import BadRun, check, commands

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


def beat() -> None:
    write(JOBS / "worker.json", {"seen": int(time.time() * 1000)})


def status(job: str, **fields: Any) -> None:
    path = JOBS / f"{job}.status.json"
    old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"id": job}
    write(path, {**old, **fields})


def now() -> int:
    return int(time.time() * 1000)


def pending() -> list[str]:
    """Requests not yet finished, oldest first."""
    found: list[str] = []
    for path in sorted(JOBS.glob("job-*.request.json")):
        job = path.name.removesuffix(".request.json")
        if not JOB_ID.fullmatch(job):
            continue
        done = JOBS / f"{job}.status.json"
        state = json.loads(done.read_text(encoding="utf-8")).get("state") if done.exists() else None
        if state in {None, "queued", "running"}:
            found.append(job)
    return found


def _newest_result(since: float) -> str | None:
    last = RESULTS / ".last_result.json"
    if not last.exists() or last.stat().st_mtime < since:
        return None
    name = str(json.loads(last.read_text(encoding="utf-8"))["latest_backtest"])
    return name.removesuffix(".zip") if (RESULTS / name).exists() else None


def _step(job: str, cmd: list[str], log: Path) -> str | None:
    """Runs one command; 'cancelled', 'failed' or None when it finished cleanly."""
    with log.open("a", encoding="utf-8") as out:
        out.write(f"\n$ {' '.join(cmd)}\n")
        out.flush()
        proc = subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT)  # noqa: S603 - a fixed argument list
        while proc.poll() is None:
            beat()
            if (JOBS / f"{job}.cancel").exists() or not running:
                proc.terminate()
                try:
                    proc.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    proc.kill()
                return "cancelled"
            time.sleep(POLL_SECONDS)
    return None if proc.returncode == 0 else "failed"


def run(job: str) -> None:
    started = time.time()
    request = json.loads((JOBS / f"{job}.request.json").read_text(encoding="utf-8"))
    if (JOBS / f"{job}.cancel").exists():
        status(job, state="cancelled", finished=now())
        return
    try:
        wanted = check(request)
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
        if ended == "failed":
            status(
                job,
                state="failed",
                finished=now(),
                error=f"Freqtrade stopped while {step.lower()}.",
            )
            return
    result = _newest_result(started)
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
    # The api runs as another user and writes the requests here (known-mistakes 13c).
    JOBS.chmod(0o777)  # noqa: S103 - local/ on the owner's machine; holds no secrets
    # A run cut off by a restart can't be resumed: say so rather than leave it running.
    for job in pending():
        path = JOBS / f"{job}.status.json"
        if path.exists() and json.loads(path.read_text(encoding="utf-8")).get("state") == "running":
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
