"""What each scheduled job does (api.schedule), and the owner's answers from Telegram.

trading-agent's daily scan sends each setup it finds with Place it and Dismiss; dca-agent's
deposit day is a reminder; its close-out lists the week's unfilled limits with Buy the rest at
market. A button runs the same code as the desk's own button, with the same checks."""

from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, cast

from api import risk, schedule, telegram
from api.binance import BinanceError
from api.dca_book import DcaBook, week_of
from api.handler import (  # pyright: ignore[reportPrivateUsage]
    SYDNEY,
    Services,
    _coach,  # pyright: ignore[reportPrivateUsage]
    _pot_agent,  # pyright: ignore[reportPrivateUsage]
    _pretrade,  # pyright: ignore[reportPrivateUsage]
    live_portfolio,
    risk_board,
    risk_model,
)
from api.pot import Pot
from api.trading import Refused, Trading

PROPOSAL_HOURS = 12


def _tell(s: Services, text: str, buttons: list[tuple[str, str]] | None = None) -> str | None:
    """Sends to the owner's Telegram; the reason it didn't, or None once sent."""
    if not telegram.token():
        return "Telegram isn't set up, so nothing was sent."
    try:
        with telegram.client() as client:
            telegram.send(s.store, client, text, buttons)
    except telegram.TelegramError as error:
        return str(error)
    return None


def _usd(value: str | Decimal) -> str:
    return f"${Decimal(value):,.2f}"


def proposal_text(p: dict[str, Any]) -> str:
    return "\n".join(
        [
            f"trading-agent: {p['coin']}, {p['setup']}",
            p["reason"],
            "",
            f"Entry {p['entry']} (limit), stop {p['stop']} (−{p['stopPct']}%), "
            f"target {p['target']}",
            f"{_usd(p['spend'])} position, {_usd(p['risk'])} at risk, {p['rr']} : 1 after fees",
            f"Crowding: {p['crowding']}",
        ]
    )


def scan(s: Services, now: datetime) -> str:
    view = _pot_agent(s, None)
    last = cast(dict[str, Any], view.get("lastScan") or {})
    line = str(last.get("line", "Scanned."))
    found = cast(list[dict[str, Any]], view.get("proposals", []))
    if not found:
        return line
    until = now + timedelta(hours=PROPOSAL_HOURS)
    missed: str | None = None
    for p in found:
        place = schedule.offer(s.store, "pot-place", p["id"], until, now)
        drop = schedule.offer(s.store, "pot-dismiss", p["id"], until, now)
        missed = _tell(s, proposal_text(p), [("Place it", place), ("Dismiss", drop)]) or missed
    return f"{line} {'Not sent: ' + missed if missed else 'Sent to Telegram.'}"


def deposit_day(s: Services, now: datetime) -> str:
    del now
    plan = DcaBook(Trading(s.binance, s.store, s.audit)).plan() or {}
    week = sum(Decimal(str(o.get("spend", "0"))) for o in plan.get("orders", []))
    money = coach_line(_coach(s, write=False).get("deposits", {}))
    text = (
        f"dca-agent: deposit day. Move this week's {week:,.0f} USDC in "
        f"(Coinbase → USDC → Binance).{money}"
        if week
        else f"dca-agent: deposit day. Set the weekly plan on the desk first.{money}"
    )
    missed = _tell(s, text)
    return "Reminder sent." if missed is None else f"Not sent: {missed}"


def coach_line(dep: dict[str, Any]) -> str:
    if not dep.get("capAud"):
        return ""
    month, cap = Decimal(dep["monthAud"]), Decimal(dep["capAud"])
    return f" Deposits this month: A${month:,.0f} of A${cap:,.0f}."


def _num(value: str) -> str:
    return f"{Decimal(value):,.2f}".rstrip("0").rstrip(".")


def close_out_text(state: dict[str, Any]) -> str:
    """Monday's message: the whole week, whichever button placed its orders (TODO 27)."""
    lines = [
        f"dca-agent: Monday close-out, week {state['week']}",
        f"Bought so far: {_num(state['bought'])} of {_num(state['planned'])} USDC",
    ]
    if state["open"]:
        limits = " · ".join(
            f"{o['coin']} {_num(o['left'])} at {_num(o['price'])}"
            if o["price"]
            else f"{o['coin']} {_num(o['left'])}"
            for o in state["open"]
        )
        lines.append(f"Open limits: {limits}")
    if Decimal(state["toPlace"]) > 0:
        lines.append(f"Not placed yet: {_num(state['toPlace'])} USDC")
    lines += [
        "",
        "Open limits stay open unless you choose. Buy the rest at market buys them and what's "
        "not placed, until 7pm. Or choose per coin on the DCA book.",
    ]
    return "\n".join(lines)


def close_out(s: Services, now: datetime) -> str:
    state = DcaBook(Trading(s.binance, s.store, s.audit)).week_state()
    if not state["open"] and Decimal(state["planned"]) <= 0:
        return "No weekly plan set and nothing open: nothing to close out."
    if not state["open"] and Decimal(state["toPlace"]) <= 0:
        return f"This week is bought: {_num(state['bought'])} USDC. Nothing to close out."
    week, _ = week_of(int(now.timestamp() * 1000))
    turn = now.replace(hour=19, minute=0, second=0, microsecond=0)
    keep = schedule.offer(s.store, "dca-keep", week, turn, now)
    buy = schedule.offer(s.store, "dca-close-out", week, turn, now)
    missed = _tell(
        s, close_out_text(state), [("Keep them open", keep), ("Buy the rest at market", buy)]
    )
    found = f"{len(state['open'])} open, {_num(state['toPlace'])} USDC not placed."
    return f"{found} {'Not sent: ' + missed if missed else 'Asked on Telegram.'}"


def risk_check(s: Services, now: datetime) -> str:
    """The daily check: plain code, a message only when a limit got worse since the last."""
    board = risk_board(s, now)
    worse = risk.changes(s.store, board["limits"])
    line = board["sentence"]
    if board["missing"]:
        line += f" Not read: {', '.join(board['missing'])}."
    if not worse:
        return line
    missed = _tell(s, risk.alert_text(worse))
    return f"{line} {'Not sent: ' + missed if missed else 'Told you on Telegram.'}"


def risk_review(s: Services, now: datetime) -> str:
    board = risk_board(s, now)
    kept = risk.review(
        s.store, s.signals, board["limits"], board["checkedAt"], lambda: risk_model(s)
    )
    missed = _tell(s, f"risk-agent, weekly review: {kept['headline']}")
    return f"{kept['headline']} {'Not sent: ' + missed if missed else ''}".strip()


def runners(s: Services, now: datetime) -> dict[str, schedule.Runner]:
    return {
        "pot-scan": lambda: scan(s, now),
        "dca-deposit": lambda: deposit_day(s, now),
        "dca-close-out": lambda: close_out(s, now),
        "risk-check": lambda: risk_check(s, now),
        "risk-review": lambda: risk_review(s, now),
    }


def _setup(desk: Trading, kind: str, arg: str, s: Services) -> str:
    pot = Pot(desk)
    p = next((x for x in pot.proposals() if x["id"] == arg), None)
    if p is None:
        return "That setup is gone: dismissed, placed, or replaced by a newer scan."
    if kind == "pot-dismiss":
        pot.dismiss({"id": arg})
        return "Dismissed."
    fields = ("coin", "entry", "stop", "target", "setup", "reason")
    body = {k: p[k] for k in fields} | {"proposal": arg}
    body |= {k: p[k] for k in ("style", "expires") if p.get(k)}
    # The Profile's pre-trade check, as on the desk (decision 78); no override from a button.
    if _pretrade(desk, "/pot/trades", body, s.portfolio or live_portfolio) is not None:
        return "Not placed: it breaks a Profile rule. Open the Trading account to place it anyway."
    t = pot.place(body)
    return f"Placed {t['ref']}: the entry waits on Binance at {t['entry']}."


def _close_out(desk: Trading, week: str, now: datetime) -> str:
    if week_of(int(now.timestamp() * 1000))[0] != week:
        return "Too late: the week turned over at 7pm. The DCA book shows what's open."
    done = DcaBook(desk).close_out()
    said = f"Bought at market: {', '.join(done['closed'])}." if done["closed"] else ""
    if done["missed"]:
        said += f" Not bought: {', '.join(done['missed'])}."
    return said.strip() or "Nothing was left to buy."


def act(s: Services, item: dict[str, Any], now: datetime) -> str:
    """What a button does, in the same code as the desk's buttons; the words for the reply."""
    desk = Trading(s.binance, s.store, s.audit)
    kind, arg = str(item["kind"]), str(item["arg"])
    try:
        if kind in ("pot-place", "pot-dismiss"):
            return _setup(desk, kind, arg, s)
        if kind == "dca-close-out":
            return _close_out(desk, arg, now)
        if kind == "dca-keep":
            return "Kept open: they wait on Binance. Change or cancel them on the DCA book."
    except (Refused, BinanceError) as error:
        return f"Not done: {getattr(error, 'message', None) or error}"
    return "The desk doesn't know that button."


def answer_taps(s: Services, now: datetime | None = None) -> int:
    """The owner's button presses since the last look, each acted on once."""
    if not telegram.token():
        return 0
    now = now or datetime.now(SYDNEY)
    with telegram.client() as client:
        found = telegram.taps(s.store, client)
        for tap in found:
            item = schedule.take(s.store, tap["data"], now)
            said = (
                "That button has expired or was used already."
                if item is None
                else act(s, item, now)
            )
            s.audit.record("telegram", "Button", said)
            telegram.answer(s.store, client, tap, said)
    return len(found)


def tick(s: Services, now: datetime | None = None) -> None:
    """One look: due jobs run, then any buttons pressed."""
    now = now or datetime.now(SYDNEY)
    schedule.run_due(
        s.store, runners(s, now), now, lambda what, line: s.audit.record("agents", what, line)
    )
    answer_taps(s, now)
