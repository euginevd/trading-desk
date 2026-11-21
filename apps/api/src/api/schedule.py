"""The scheduler: wakes each agent at its time, Sydney time, and hands what it proposes to the
owner on Telegram with buttons. It is plain code, no model: timing and delivery must be exact,
and judgement stays with the agents, money with the desk's checks.

Each job runs once per slot (a row in `job_runs`, claimed before it starts, so a restart can't
run it twice). A slot missed while the desk was off still runs within its grace; later, it's
skipped. A Telegram button works once and expires, and only the owner's linked chat can press
one (api.telegram.taps)."""

import json
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, cast
from zoneinfo import ZoneInfo

from api.store import Store

SYDNEY = ZoneInfo("Australia/Sydney")
ON_KEY = "schedule_on"
OFFERS_KEY = "schedule_offers"
DAILY = -1
NOON = 12


@dataclass(frozen=True)
class Job:
    key: str
    agent: str
    label: str
    weekday: int  # Monday 0 … Sunday 6, or DAILY
    hour: int
    minute: int
    grace: timedelta

    def when(self) -> str:
        day = "Daily" if self.weekday == DAILY else DAYS[self.weekday]
        hour = self.hour % NOON or NOON
        minute = f":{self.minute:02d}" if self.minute else ""
        return f"{day} {hour}{minute}{'pm' if self.hour >= NOON else 'am'}"


DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
JOBS = (
    Job("pot-scan", "trading-agent", "the daily scan", DAILY, 11, 15, timedelta(hours=3)),
    Job("dca-deposit", "dca-agent", "deposit day", 4, 19, 0, timedelta(hours=6)),
    # The DCA week turns over at Monday 7pm (dca_book.week_of), so the close-out is offered at
    # 5pm and its button works until 7pm.
    Job("dca-close-out", "dca-agent", "the close-out", 0, 17, 0, timedelta(hours=2)),
    # Unless skipped, the close-out then runs on its own before the turnover (decision 96):
    # its grace ends before 7pm, so a late start never acts on the next week.
    Job("dca-close-out-auto", "dca-agent", "the close-out run", 0, 18, 45, timedelta(minutes=14)),
    # risk-agent: the daily check is plain code and speaks only when a state gets worse; the
    # Sunday review is written by the model from the same figures.
    Job("risk-check", "risk-agent", "the risk check", DAILY, 21, 0, timedelta(hours=3)),
    Job("risk-review", "risk-agent", "the weekly review", 6, 18, 0, timedelta(hours=6)),
)


def slot(job: Job, now: datetime) -> datetime:
    """The job's latest time at or before now."""
    at = now.astimezone(SYDNEY).replace(hour=job.hour, minute=job.minute, second=0, microsecond=0)
    if job.weekday == DAILY:
        return at if at <= now else at - timedelta(days=1)
    at -= timedelta(days=(at.weekday() - job.weekday) % 7)
    return at if at <= now else at - timedelta(days=7)


def next_slot(job: Job, now: datetime) -> datetime:
    return slot(job, now) + timedelta(days=1 if job.weekday == DAILY else 7)


def is_on(store: Store) -> bool:
    return store.setting(ON_KEY, "1") == "1"


def set_on(store: Store, on: bool) -> None:
    store.set_setting(ON_KEY, "1" if on else "0")


Runner = Callable[[], str]


def run_due(
    store: Store,
    runners: dict[str, Runner],
    now: datetime,
    record: Callable[[str, str], None],
) -> list[str]:
    """Runs every job whose slot has come and not yet run; returns the keys it ran. A runner
    returns its line for the run log; one that raises is logged as failed, never retried."""
    if not is_on(store):
        return []
    ran: list[str] = []
    for job in JOBS:
        at = slot(job, now)
        if now - at > job.grace or job.key not in runners:
            continue
        ms = int(at.timestamp() * 1000)
        if not store.claim_job_run(job.key, ms, int(now.timestamp() * 1000)):
            continue
        try:
            line, status = runners[job.key](), "ok"
        except Exception as error:  # noqa: BLE001 - one job failing must not stop the others
            line, status = f"Failed: {str(error)[:200] or type(error).__name__}", "failed"
        store.finish_job_run(
            job.key, ms, status, line, int(datetime.now(SYDNEY).timestamp() * 1000)
        )
        record(f"{job.agent}: {job.label}", line)
        ran.append(job.key)
    return ran


def view(store: Store, now: datetime) -> dict[str, Any]:
    jobs: list[dict[str, Any]] = []
    for job in JOBS:
        last = next(iter(store.job_runs(job.key, 1)), None)
        jobs.append(
            {
                "key": job.key,
                "agent": job.agent,
                "label": job.label,
                "when": job.when(),
                "next": int(next_slot(job, now).timestamp() * 1000),
                "last": None
                if last is None
                else {
                    "at": last["slot"],
                    "status": last["status"],
                    "line": last["line"],
                },
            }
        )
    return {"on": is_on(store), "jobs": jobs}


# One-tap answers on Telegram: each button carries a random token, kept with what it does and
# when it stops working; a token is taken once.


def _offers(store: Store) -> dict[str, dict[str, Any]]:
    try:
        found: object = json.loads(store.setting(OFFERS_KEY, "{}"))
    except json.JSONDecodeError:
        return {}
    return cast(dict[str, dict[str, Any]], found) if isinstance(found, dict) else {}


def offer(store: Store, kind: str, arg: str, until: datetime, now: datetime) -> str:
    kept = {
        t: o
        for t, o in _offers(store).items()
        if int(o.get("until", 0)) > int(now.timestamp() * 1000)
    }
    token = secrets.token_urlsafe(9)
    kept[token] = {"kind": kind, "arg": arg, "until": int(until.timestamp() * 1000)}
    store.set_setting(OFFERS_KEY, json.dumps(kept))
    return token


def take(store: Store, token: str, now: datetime) -> dict[str, Any] | None:
    """What a button does, once: None when it's unknown, used or past its time."""
    found = _offers(store)
    item = found.pop(token, None)
    store.set_setting(OFFERS_KEY, json.dumps(found))
    if item is None or int(item.get("until", 0)) <= int(now.timestamp() * 1000):
        return None
    return item
