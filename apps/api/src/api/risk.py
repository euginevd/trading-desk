"""risk-agent's board (local/agents/risk-agent.md): every limit the Profile sets, worked out by
the desk from its own figures (never by the model), each kept, near or broken. The daily check
is plain code and messages the owner only when a state changes; the weekly review is the one
place the model writes, from these figures.

Limits come from the Profile's rules (cited per row) and the pot's own constants, so the board
and the desk's checks never disagree."""

import json
from collections.abc import Callable
from datetime import datetime
from decimal import Decimal
from typing import Any, cast

from api import my_agents
from api.ai_signal import MODELS, SignalError, Signals
from api.pot import MAX_OPEN_RISK_PCT, MONTH_LOSS_PCT, STOP_OUT_PCT
from api.store import Store

AGENT = "risk-agent"
MODEL = "claude-opus-5-5"
ZERO = Decimal(0)
HUNDRED = Decimal(100)
STABLES = ("USDC", "USDT", "FDUSD")
MAX_OPEN_TRADES = 3  # Profile 5.4.3
DRIFT_POINTS = Decimal(5)  # Profile 5.3.4: a coin 5 points off its DCA target
CUSTODY_AUD = Decimal(5000)  # Profile 6.7: a coin over A$5K moves to the Ledger
TAO_SHARE = Decimal(80)  # Profile 7.1: ~79% of crypto, not to grow from new money
MILESTONES = (Decimal(500_000), Decimal(750_000), Decimal(1_000_000))  # Profile 6.4, US$
MILESTONE_NEAR = Decimal(5)  # within 5% of a milestone
ALERTED_KEY = "risk_alerted"
REVIEW_KEY = "risk_review"
CLOSE_OUT_HOUR = 17  # the DCA close-out is offered at Monday 5pm (api.schedule)
SUNDAY = 6
MONDAY = 0
ORDER = {"kept": 0, "near": 1, "broken": 2}


def _d(value: object) -> Decimal:
    try:
        return Decimal(str(value)) if value not in (None, "") else ZERO
    except ArithmeticError:
        return ZERO


def _pct(value: Decimal) -> str:
    return f"{value.quantize(Decimal('0.1'))}%"


def _aud(value: Decimal) -> str:
    return f"A${value:,.0f}"


def _row(  # noqa: PLR0913, PLR0917 - one row of the board, each field named
    key: str,
    area: str,
    name: str,
    value: Decimal,
    warn: Decimal | None,
    limit: Decimal | None,
    *,
    figure: str,
    of: str,
    rule: str,
    owner: str,
    state: str | None = None,
    words: str = "",
) -> dict[str, Any]:
    """A limit: higher is worse; near from `warn`, broken past `limit`."""
    if state is None:
        if limit is not None and value > limit:
            state = "broken"
        elif warn is not None and value >= warn:
            state = "near"
        else:
            state = "kept"
    return {
        "key": key,
        "area": area,
        "name": name,
        "value": str(value.quantize(Decimal("0.01"))),
        "warn": None if warn is None else str(warn),
        "limit": None if limit is None else str(limit),
        "figure": figure,
        "of": of,
        "rule": rule,
        "owner": owner,
        "state": state,
        "words": words,
    }


def pot_limits(pot: dict[str, Any]) -> list[dict[str, Any]]:
    put_in, value = _d(pot.get("putIn")), _d(pot.get("value"))
    if put_in <= ZERO:
        return []
    area, owner = "Trading pot", "trading-agent, on Trade"
    config = cast(dict[str, Any], pot.get("config") or {})
    allowed = _d(config.get("riskPct")) or Decimal(1)
    if _d(pot.get("allowedRisk")) > ZERO and value > ZERO:  # a dollar cap under the %
        allowed = min(allowed, _d(pot.get("allowedRisk")) / value * HUNDRED).quantize(
            Decimal("0.01")
        )
    live = [
        t
        for t in cast(list[dict[str, Any]], pot.get("trades") or [])
        if t.get("status") in ("placing", "waiting", "open")
    ]
    equity = value if value > ZERO else put_in
    worst = max((_d(t.get("risk")) / equity * HUNDRED for t in live), default=ZERO)
    open_risk = _d(pot.get("openRisk")) / equity * HUNDRED
    month = max(-_d(pot.get("monthResult")) / put_in * HUNDRED, ZERO)
    down = max((put_in - value) / put_in * HUNDRED, ZERO) if value > ZERO else ZERO
    alts = sum(1 for t in live if t.get("coin") != "BTC")
    backing = cast(dict[str, Any], pot.get("backing") or {})
    short = _d(backing.get("short"))
    covered = (
        [
            _row(
                "pot-backing",
                area,
                "Available money on Binance",
                short,
                Decimal("0.01"),
                None,
                figure="Covered" if short <= ZERO else f"{short:,.2f} {pot.get('quote', '')} short",
                of="the account's available balance, free on Binance",
                rule="5.4",
                owner="you: top up, or keep other buys off it",
                words="One wallet: the DCA book and hand orders spend the same USDC. A buy that "
                "dips into the account's money is let through and logged.",
            )
        ]
        if backing
        else []
    )
    return covered + [
        _row(
            "pot-trade-risk",
            area,
            "Risk on one trade",
            worst,
            allowed,
            allowed,
            figure=_pct(worst),
            of=f"{allowed.normalize():f}% a trade",
            rule="5.4.3",
            owner=owner,
            words="Largest risk of any open trade, as a share of the pot.",
        ),
        _row(
            "pot-open-risk",
            area,
            "Open risk",
            open_risk,
            MAX_OPEN_RISK_PCT * Decimal("0.85"),
            MAX_OPEN_RISK_PCT,
            figure=_pct(open_risk),
            of=f"{MAX_OPEN_RISK_PCT}% across trades",
            rule="5.4.3",
            owner=owner,
            words="Everything the open trades could lose at their stops, fees in.",
        ),
        _row(
            "pot-trades",
            area,
            "Trades open",
            Decimal(len(live)),
            Decimal(MAX_OPEN_TRADES),
            Decimal(MAX_OPEN_TRADES),
            figure=f"{len(live)}" + (f", {alts} alt{'s' if alts != 1 else ''}" if live else ""),
            of=f"{MAX_OPEN_TRADES} at most, 2 alts",
            rule="5.4.3",
            owner=owner,
        ),
        _row(
            "pot-month",
            area,
            "Loss this month",
            month,
            MONTH_LOSS_PCT * Decimal("0.75"),
            MONTH_LOSS_PCT,
            figure=_pct(month),
            of=f"{MONTH_LOSS_PCT}%: then no new trades",
            rule="5.4.4",
            owner=owner,
        ),
        _row(
            "pot-drawdown",
            area,
            "Down from money put in",
            down,
            STOP_OUT_PCT * Decimal("0.75"),
            STOP_OUT_PCT,
            figure=_pct(down),
            of=f"{STOP_OUT_PCT}%: then trading stops",
            rule="5.4.4",
            owner=owner,
        ),
    ]


def dca_limits(dca: dict[str, Any], open_weekly: int, now: datetime) -> list[dict[str, Any]]:
    area, owner = "DCA book", "dca-agent, on the DCA book"
    plan = cast(dict[str, Any], dca.get("plan") or {})
    slots = cast(list[dict[str, Any]], plan.get("orders") or [])
    weekly = sum((_d(o.get("spend")) for o in slots), ZERO)
    positions = cast(list[dict[str, Any]], dca.get("positions") or [])
    held = sum((_d(p.get("value")) for p in positions), ZERO)
    rows: list[dict[str, Any]] = []
    if weekly > ZERO and held > ZERO:
        worst, coin = ZERO, ""
        for p in positions:
            target = (
                sum((_d(o.get("spend")) for o in slots if o.get("coin") == p.get("coin")), ZERO)
                / weekly
                * HUNDRED
            )
            gap = abs(_d(p.get("value")) / held * HUNDRED - target)
            if gap > worst:
                worst, coin = gap, str(p.get("coin"))
        rows.append(
            _row(
                "dca-mix",
                area,
                "Mix against target",
                worst,
                DRIFT_POINTS,
                None,
                figure=f"{coin} {worst.quantize(Decimal('0.1'))} points off"
                if coin
                else "On target",
                of=f"{DRIFT_POINTS} points: look at it each quarter",
                rule="5.3.4",
                owner=owner,
                words="The coin furthest from its share of the weekly buy. Drift is left to "
                "the quarterly check; the weekly buy never tilts.",
            )
        )
    late = now.weekday() == MONDAY and now.hour >= CLOSE_OUT_HOUR
    rows.append(
        _row(
            "dca-week",
            area,
            "This week's limits",
            Decimal(open_weekly),
            None,
            None,
            figure=f"{open_weekly} open" if open_weekly else "All filled",
            of="every week bought by Monday 7pm",
            rule="6.1",
            owner=owner,
            state="near" if late and open_weekly else "kept",
            words="Unfilled limits are bought at market at Monday's close-out, so a week is "
            "never skipped.",
        )
    )
    return rows


def deposit_limits(dep: dict[str, Any]) -> list[dict[str, Any]]:
    cap = _d(dep.get("capAud"))
    if cap <= ZERO:
        return []
    month = _d(dep.get("monthAud"))
    return [
        _row(
            "deposits",
            "Deposits",
            "Deposits this month",
            month,
            cap * 6 / 7,
            cap,
            figure=_aud(month),
            of=f"{_aud(cap)} a month",
            rule="5.2.4",
            owner="you",
            words="Over the cap is shown, never blocked: the weekly buy goes on.",
        )
    ]


def portfolio_limits(portfolio: dict[str, Any]) -> list[dict[str, Any]]:
    total = cast(dict[str, Any], portfolio.get("total") or {})
    rate = _d(total.get("audRate")) or Decimal(1)
    holdings = cast(list[dict[str, Any]], portfolio.get("holdings") or [])
    crypto = [h for h in holdings if h.get("asset") not in STABLES and h.get("value")]
    value = sum((_d(h.get("value")) for h in crypto), ZERO)
    rows: list[dict[str, Any]] = []
    area, owner = "Portfolio", "you, on Portfolio"
    if value > ZERO:
        tao = sum((_d(h.get("value")) for h in crypto if h.get("asset") == "TAO"), ZERO)
        share = tao / value * HUNDRED
        rows.append(
            _row(
                "tao-share",
                area,
                "TAO's share of crypto",
                share,
                TAO_SHARE,
                None,
                figure=_pct(share),
                of="~79%, no new money",
                rule="7.1",
                owner=owner,
                words="Concentration: new money goes elsewhere, so this falls over time.",
            )
        )
    on_binance = [
        (str(h["asset"]), _d(h.get("value")) * rate) for h in crypto if h.get("source") == "Binance"
    ]
    biggest = max(on_binance, key=lambda x: x[1], default=("", ZERO))
    rows.append(
        _row(
            "custody",
            area,
            "Largest coin on Binance",
            biggest[1],
            CUSTODY_AUD,
            None,
            figure=f"{biggest[0]} {_aud(biggest[1])}" if biggest[0] else "None",
            of=f"{_aud(CUSTODY_AUD)}: to the Ledger, monthly",
            rule="6.7",
            owner=owner,
            words="Over A$5K, a coin moves to self-custody in the monthly batch.",
        )
    )
    usd = _d(total.get("value"))
    nxt = next((m for m in MILESTONES if usd < m), None)
    if nxt is not None and usd > ZERO:
        away = (nxt - usd) / nxt * HUNDRED
        rows.append(
            _row(
                "take-profit",
                area,
                "Next take-profit",
                HUNDRED - away,
                HUNDRED - MILESTONE_NEAR,
                None,
                figure=f"US${usd:,.0f}",
                of=f"US${nxt:,.0f}: move 20% out",
                rule="6.4",
                owner=owner,
                words=f"{away.quantize(Decimal('1'))}% to go. At the milestone, 20% of the "
                "portfolio moves out: half to BTC, half to cash.",
            )
        )
    return rows


def _mid_sentence(name: str) -> str:
    """A row's name inside a sentence: its first word lowercased, unless it's a name like TAO."""
    return name[:1].lower() + name[1:] if name[1:2].islower() else name


def sentence(rows: list[dict[str, Any]]) -> str:
    broken = [_mid_sentence(r["name"]) for r in rows if r["state"] == "broken"]
    near = [_mid_sentence(r["name"]) for r in rows if r["state"] == "near"]
    if broken:
        return f"{len(broken)} broken: {', '.join(broken)}."
    if near:
        return f"Every rule kept; {len(near)} near a limit: {', '.join(near)}."
    return "Every rule kept."


def changes(store: Store, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rows whose state got worse since the last message; remembers the states. A row that
    recovers is remembered too, so it warns again if it slips back."""
    try:
        seen = cast(dict[str, str], json.loads(store.setting(ALERTED_KEY, "{}")))
    except json.JSONDecodeError:
        seen = {}
    worse = [r for r in rows if ORDER[r["state"]] > ORDER.get(seen.get(r["key"], "kept"), 0)]
    store.set_setting(ALERTED_KEY, json.dumps({r["key"]: r["state"] for r in rows}))
    return worse


def alert_text(rows: list[dict[str, Any]]) -> str:
    lines = ["risk-agent:"]
    for r in rows:
        if r["state"] == "broken":
            lines.append(
                f"Rule broken: {r['name']}: {r['figure']} against {r['of']} (Profile "
                f"{r['rule']}). {r['owner'].capitalize()}."
            )
        else:
            lines.append(
                f"Near a limit: {r['name']}: {r['figure']} against {r['of']} (Profile "
                f"{r['rule']}). {r['owner'].capitalize()}."
            )
    return "\n".join(lines)


REVIEW_SHAPE: dict[str, Any] = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"title": {"type": "string"}, "text": {"type": "string"}},
                "required": ["title", "text"],
                "additionalProperties": False,
            },
        },
        "action": {"type": "string"},
    },
    "required": ["headline", "sections", "action"],
    "additionalProperties": False,
}


def review(
    store: Store,
    signals: Signals | None,
    rows: list[dict[str, Any]],
    now_ms: int,
    model_of: Callable[[], str] | None = None,
) -> dict[str, Any]:
    """The weekly risk review, written by risk-agent from the board's figures, and kept."""
    if signals is None:
        raise LookupError("risk-agent has no model to write with.")
    system = my_agents.file(store, AGENT)["markdown"] or "You are risk-agent, a calm risk officer."
    prompt = (
        "Write this week's risk review from the desk's figures below, in your file's format: "
        "a headline of one sentence; sections for the trading pot, the DCA book, deposits and "
        "the portfolio, each two or three short sentences naming its figures; and the one "
        "thing to do this week (or 'Nothing: keep going.'). Use only these figures.\n\n"
        "THE BOARD:\n" + json.dumps(rows, indent=1)
    )
    model = (model_of or (lambda: ""))()
    try:
        reply, _cost, _name = signals.step(
            system,
            prompt,
            REVIEW_SHAPE,
            "Risk: weekly review",
            model=model if model in MODELS else MODEL,
            searches=0,
        )
    except SignalError as error:
        raise LookupError("risk-agent couldn't be reached. Try again in a minute.") from error
    kept = {
        "at": now_ms,
        "headline": str(reply.get("headline") or "")[:240],
        "sections": [
            {"title": str(s.get("title", ""))[:60], "text": str(s.get("text", ""))[:600]}
            for s in cast(list[dict[str, Any]], reply.get("sections") or [])[:6]
        ],
        "action": str(reply.get("action") or "")[:240],
    }
    store.set_setting(REVIEW_KEY, json.dumps(kept))
    return kept


def last_review(store: Store) -> dict[str, Any] | None:
    raw = store.setting(REVIEW_KEY, "")
    try:
        return cast(dict[str, Any], json.loads(raw)) if raw else None
    except json.JSONDecodeError:
        return None
