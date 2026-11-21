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
    screened = p.get("screened")
    # When trading-agent moved the screen's levels, the one-tap says so and from what (audit 21).
    moved = (
        [
            f"Levels moved by trading-agent: the screen had entry {screened['entry']}, "
            f"stop {screened['stop']}, target {screened['target']}."
        ]
        if isinstance(screened, dict)
        else []
    )
    return "\n".join(
        [
            f"trading-agent: {p['coin']}, {p['setup']}",
            p["reason"],
            "",
            f"Entry {p['entry']} (limit), stop {p['stop']} (−{p['stopPct']}%), "
            f"target {p['target']}",
            *moved,
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
    """Monday's message (decision 96): the plan to date, then what 7pm will do on its own."""
    lines = [
        f"dca-agent: Monday close-out, week {state['week']}",
        f"Plan to date: {_num(state['planned'])} USDC ({state['weeks']} weeks)",
        f"Bought: {_num(state['bought'])} · In open limits: {_num(state['waiting'])}"
        f" · No order yet: {_num(state['toPlace'])}",
    ]
    carried = [o for o in state["open"] if o.get("carried")]
    fresh = [o for o in state["open"] if not o.get("carried")]

    def listed(rows: list[dict[str, Any]]) -> str:
        return " · ".join(
            f"{o['coin']} {_num(o['left'])} at {_num(o['price'])}" if o["price"] else o["coin"]
            for o in rows
        )

    lines += ["", "At 7pm, unless you choose:"]
    if Decimal(state["toPlace"]) > 0:
        short = Decimal(state.get("needsDeposit") or "0")
        line = f"- {_num(state['toPlace'])} USDC with no order yet is bought at market"
        if short > 0:
            line += f"; {_num(state['needsDeposit'])} of it waits for a deposit"
        lines.append(line + ".")
    if carried:
        lines.append(f"- Limits from earlier weeks are bought at market: {listed(carried)}.")
    if fresh:
        lines.append(f"- This week's limits wait one more week: {listed(fresh)}.")
    lines += [
        "",
        "Buy everything now buys it all at market, limits too. Skip this week takes its amount "
        "out of the plan. The Trading account's money is never used.",
    ]
    return "\n".join(lines)


def _due(state: dict[str, Any]) -> bool:
    """Anything for 7pm to do: money with no order yet, or a limit from an earlier week."""
    return Decimal(state["toPlace"]) > 0 or any(o.get("carried") for o in state["open"])


def close_out(s: Services, now: datetime) -> str:
    """5pm Monday: tell the owner what 7pm will do, with Buy everything now and Skip."""
    state = DcaBook(Trading(s.binance, s.store, s.audit)).week_state()
    if Decimal(state["planned"]) <= 0 and not state["open"]:
        return "No weekly plan set and nothing open: nothing to close out."
    if state["skipped"]:
        return "This week is skipped: nothing to close out."
    if not _due(state):
        return f"On plan: {_num(state['bought'])} USDC bought, nothing due at 7pm."
    week, _ = week_of(int(now.timestamp() * 1000))
    turn = now.replace(hour=19, minute=0, second=0, microsecond=0)
    buy = schedule.offer(s.store, "dca-close-out", week, turn, now)
    skip = schedule.offer(s.store, "dca-skip", week, turn, now)
    missed = _tell(
        s, close_out_text(state), [("Buy everything now", buy), ("Skip this week", skip)]
    )
    found = f"{len(state['open'])} open, {_num(state['toPlace'])} USDC with no order yet."
    return f"{found} {'Not sent: ' + missed if missed else 'Asked on Telegram.'}"


def close_out_auto(s: Services, now: datetime) -> str:
    """Just before 7pm Monday: the close-out runs on its own (decision 96), unless the week was
    skipped. Money with no order yet and limits from earlier weeks are bought at market, up to
    the free USDC that isn't the Trading account's; this week's limits wait one more week."""
    book = DcaBook(Trading(s.binance, s.store, s.audit))
    state = book.week_state(funds=False)
    if state["skipped"] or not _due(state):
        return "Nothing due." if not state["skipped"] else "This week is skipped."
    week, _ = week_of(int(now.timestamp() * 1000))
    try:
        done = book.close_out(week, auto=True)
    except (Refused, BinanceError) as error:
        said = f"Not done: {getattr(error, 'message', None) or error}"
        _tell(s, f"dca-agent: Monday close-out {said}")
        return said
    said = _done_words(done)
    _tell(s, f"dca-agent: Monday close-out done. {said}")
    return said


def _done_words(done: dict[str, Any]) -> str:
    said = f"Bought at market: {', '.join(done['closed'])}." if done["closed"] else ""
    if done["missed"]:
        said += f" Not bought: {', '.join(done['missed'])}."
    if Decimal(done.get("short") or "0") > 0:
        said += f" {_num(done['short'])} USDC waits for a deposit."
    return said.strip() or "Nothing was left to buy."


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
        "dca-close-out-auto": lambda: close_out_auto(s, now),
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
    return _done_words(DcaBook(desk).close_out(week))


def act(s: Services, item: dict[str, Any], now: datetime) -> str:
    """What a button does, in the same code as the desk's buttons; the words for the reply."""
    desk = Trading(s.binance, s.store, s.audit)
    kind, arg = str(item["kind"]), str(item["arg"])
    try:
        if kind in ("pot-place", "pot-dismiss"):
            return _setup(desk, kind, arg, s)
        if kind == "dca-close-out":
            return _close_out(desk, arg, now)
        if kind == "dca-skip":
            DcaBook(desk).skip(arg)
            return "Skipped: this week's amount is out of the plan. Open limits stay as they are."
        if kind == "dca-keep":  # a button from before decision 96
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
