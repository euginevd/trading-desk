"""The trading pot (docs/plan-trade.md): money set apart for trading-agent's trades, as its own
book. Money put in is a ledger row (POT-IN-1); each trade has a lifelong reference
(TRD-SOL-26W47-1) and each of its Binance orders carries it as the client id (-E the entry,
-X1 the stop and target as one OCO, -M a close at market). Results are judged after fees and in
R, the trade's first risk; the pot's figures are always net of money put in."""

import contextlib
import json
import re
from collections.abc import Callable
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, cast
from zoneinfo import ZoneInfo

from api import my_agents, pot_stats, screener
from api.binance import BinanceError, Filters, missing, plain, unknown
from api.dca_book import binance_state
from api.locks import locked
from api.market import QUOTE
from api.trading import Refused, Trading, number

SYDNEY = ZoneInfo("Australia/Sydney")
ZERO = Decimal(0)
HUNDRED = Decimal(100)
AGENT = "trading-agent"
TAG = "TRD-"
COINS = ("BTC", "ETH", "SOL", "HYPE", "ZEC", "SUI", "NEAR")
CONFIG_KEY = "pot_config"
PROPOSALS_KEY = "pot_proposals"
SCAN_KEY = "pot_last_scan"
RING_FENCE = False  # the account's cap on the shared USDC, off for now (owner, 21 Nov 2026)
# maxRisk: a cap in USDC on any one trade's risk, on top of riskPct ("" for none).
DEFAULT_CONFIG = {"mode": "test", "fixed": "10", "riskPct": "1", "maxRisk": ""}
FEE = Decimal("0.001")  # Binance spot, each side, before any BNB discount
MIN_RR = Decimal(2)
MIN_ORDER = Decimal(10)  # the smallest buy the account places, in the quote (owner, 21 Nov 2026)
MAX_POSITION_PCT = Decimal(25)
MAX_OPEN_RISK_PCT = Decimal(6)  # three trades at 2% (owner, 20 Nov 2026)
MONTH_LOSS_PCT = Decimal(6)
STOP_OUT_PCT = Decimal(20)
MAX_ALTS = 2
JUDGE_AFTER = 30
BAND = "PERCENT_PRICE"  # Binance's refusal of a limit too far from the price
BAND_ROOM = Decimal("0.9")  # the band follows a 5-minute average, so the target waits for room
RETRY_MS = 10 * 60_000  # a refused stop is watched this long before Binance is asked again
TARGET_RETRY_MS = 60 * 60_000  # a live stop is taken off for its target this often at most
PAST = "Past its "  # _through's note when its market sell at the stop or target was refused
WATCHED = "The desk is watching its stop."
HELD = "held"  # an open trade's exit_kind while the owner holds it with no stop or target
SCAN_HOUR, SCAN_MINUTE = 11, 15
LIVE = ("placing", "waiting", "open")
SETUP = re.compile(r"[\w ,.'()-]{1,60}")
COINS_LINE = re.compile(r"^- (?:Fallback c|C)oins:\s*(.+)$", re.MULTILINE)


def ref_week(ms: int) -> str:
    """The ISO week in Sydney, as in a reference: 26W47."""
    year, week, _ = datetime.fromtimestamp(ms / 1000, SYDNEY).isocalendar()
    return f"{year % 100:02d}W{week:02d}"


def next_scan(ms: int) -> int:
    """The next daily-close scan: 11:15am Sydney."""
    now = datetime.fromtimestamp(ms / 1000, SYDNEY)
    at = now.replace(hour=SCAN_HOUR, minute=SCAN_MINUTE, second=0, microsecond=0)
    if at <= now:
        at += timedelta(days=1)
    return int(at.timestamp() * 1000)


def sma(values: list[Decimal], period: int) -> Decimal | None:
    return sum(values[-period:], ZERO) / period if len(values) >= period else None


def regime_of(closes: list[Decimal]) -> tuple[str | None, str]:
    """Bull, Neutral or Bear from BTC's daily closes: its 200-day and 50-day averages."""
    fast, slow = sma(closes, 50), sma(closes, 200)
    if fast is None or slow is None or not closes:
        return None, "not enough history to judge"
    above = closes[-1] > slow
    words = f"{'above' if above else 'under'} its 200-day, 50-day "
    words += "above it" if fast > slow else "still under it"
    if above and fast > slow:
        return "bull", words
    if not above and fast < slow:
        return "bear", words
    return "neutral", words


FAST_DAYS, SLOW_DAYS = 50, 200


def days_to_cross(closes: list[Decimal], cap: int = 120) -> int | None:
    """For the market card: if BTC closed at today's price every day from now, how many days
    until its 50-day falls under its 200-day; None if not within `cap` days or already under."""
    if len(closes) < SLOW_DAYS:
        return None
    flat, run = closes[-1], list(closes)
    for day in range(cap + 1):
        fast, slow = sma(run, FAST_DAYS), sma(run, SLOW_DAYS)
        if fast is None or slow is None:
            return None
        if fast < slow:
            return day or None
        run.append(flat)
    return None


LADDER_MAX = 6  # rungs in one ladder
LADDER_OF = re.compile(r"Ladder (\S+), \d+ of \d+")  # a ladder limit's position, in its setup


def given_rungs(rules: Filters, given: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The owner's own limits, to Binance's price steps."""
    return [
        {
            "price": rules.price(number(r.get("price"), "Price")),
            "spend": number(r.get("spend"), "Spend"),
            "why": str(r.get("why") or "")[:60],
        }
        for r in given[:LADDER_MAX]
    ]


def rung_qty(rules: Filters, price: Decimal, spend: Decimal) -> Decimal:
    """A limit's quantity in Binance's steps; one step more when rounding took a spend at the
    $10 floor under it, so a $10 limit is never refused for a few cents."""
    qty = rules.amount(spend / price) if price > ZERO else ZERO
    if ZERO < qty * price < max(rules.min_notional, MIN_ORDER) <= spend:
        qty += rules.step
    return qty


def smallest(binance_min: Decimal) -> str:
    """Why a buy is too small: the desk's own $10 floor, or Binance's if that's higher."""
    floor = max(binance_min, MIN_ORDER)
    whose = "the desk's" if floor == MIN_ORDER else "Binance's"
    return f"That's under {whose} smallest order of ${floor:,.2f}."


def touch_odds(rows: list[list[Any]], ratio: float, days: int = 7) -> int:
    """How often, over the year of daily candles, the price fell to `ratio` of a day's close
    within the next `days` days: the rung's odds of a fill in a week, in percent."""
    lows = [float(r[3]) for r in rows]
    closes = [float(r[4]) for r in rows]
    starts = range(len(rows) - days)
    hits = sum(1 for t in starts if min(lows[t + 1 : t + 1 + days]) <= closes[t] * ratio)
    return round(hits * 100 / len(starts)) if len(starts) > 0 else 0


def suggest_rungs(
    rows: list[list[Any]], now: Decimal, total: Decimal, count: int, rules: Filters
) -> list[dict[str, Any]]:
    """Rungs under the price at its support (swing lows, the year's levels, the averages),
    each a little above its level; where support runs out, an ATR apart. The deepest rungs
    get the most, as in the DCA book's ladders."""
    a = screener.atr(rows) or float(now) * 0.03
    nearest = float(now) * 0.99
    zones = [
        z for z in reversed(screener.levels(rows, a)) if float(now) * 0.6 < z["price"] < nearest
    ]
    picked: list[tuple[float, str]] = []
    for z in zones:
        if len(picked) == count:
            break
        if picked and picked[-1][0] - z["price"] < a * 0.5:
            continue  # too close to the rung above
        picked.append((z["price"] * 1.003, ", ".join(z["names"][:2])))
    while len(picked) < count:
        top = picked[-1][0] if picked else float(now)
        picked.append((top - a, f"{len(picked) + 1} ATR under"))
    weights = [Decimal(2 + i) for i in range(count)]
    whole = sum(weights, ZERO)
    return [
        {
            "price": rules.price(Decimal(str(price))),
            "spend": (total * w / whole).quantize(Decimal("0.01")),
            "why": why[:60],
        }
        for (price, why), w in zip(picked, weights, strict=True)
    ]


# The ladder's two shapes (owner, 21 Nov 2026), for $50 a coin by default and $10 the
# smallest order: A, an entry and three limits (10, 10, 13, 17), for a coin that swings 6% or
# more a day; B, an entry and two deeper limits (10, 16, 24), for a calmer one. The entry sits
# where it fills within an hour about 80% of the time.
PLANS = {
    "A": [Decimal(10), Decimal(10), Decimal(13), Decimal(17)],
    "B": [Decimal(10), Decimal(16), Decimal(24)],
}
SWINGY = 0.06  # a day's ATR at or over 6% of the price: plan A
NEAR_LOW = 0.08  # the 30-day low within 8% under the price: the first limit goes just under it
ENTRY_ODDS = 80  # the entry's chance of a fill within the hour, in percent


def hour_entry(five: list[list[Any]], now: float) -> tuple[float, int]:
    """The highest price under now that 5-minute candles of the last few days reached within
    an hour at least ENTRY_ODDS% of the time; and those odds."""
    lows = [float(r[3]) for r in five]
    closes = [float(r[4]) for r in five]
    starts = range(len(five) - 12)
    best = (now * 0.998, 0)
    for step in range(1, 21):  # 0.1% to 2% under
        d = step / 1000
        hits = sum(1 for t in starts if min(lows[t + 1 : t + 13]) <= closes[t] * (1 - d))
        odds = round(hits * 100 / len(starts)) if len(starts) > 0 else 0
        if odds < ENTRY_ODDS:
            break
        best = (now * (1 - d), odds)
    return best


def suggest_plan(  # noqa: PLR0913 - the candles, the price and the plan's parts
    rows: list[list[Any]],
    five: list[list[Any]],
    now: Decimal,
    total: Decimal,
    rules: Filters,
    *,
    asked: object = None,
) -> tuple[str, str, list[dict[str, Any]]]:
    """The desk's pick of A or B for this coin (or the one asked), its entry within the hour,
    and its limits: the first just under the 30-day low when that's near, the deeper ones
    about one and two ATR under, each snapped to support when there is some close by."""
    price = float(now)
    a = screener.atr(rows) or price * 0.04
    swing = a / price
    plan = str(asked) if asked in PLANS else "A" if swing >= SWINGY else "B"
    why = f"Moves {swing * 100:.1f}% a day: " + (
        "an entry and three limits catch the wider swings."
        if plan == "A"
        else "an entry and two deeper limits."
    )
    entry, odds = hour_entry(five, price) if five else (price * 0.998, 0)
    low = min(float(r[3]) for r in rows[-30:]) if rows else price
    zones = [z["price"] for z in screener.levels(rows, a)] if rows else []

    def snap(target: float) -> tuple[float, str]:
        near = [z for z in zones if abs(z - target) <= a * 0.3 and z < price]
        if near:
            z = min(near, key=lambda z: abs(z - target))
            return z * 1.003, "At support"
        return target, f"{(1 - target / price) * 100:.0f}% under"

    if plan == "A":
        first = (
            (low * 0.998, "Under the 30-day low")
            if 0 < (price - low) / price <= NEAR_LOW
            else snap(price - a * 0.5)
        )
        deeper = [snap(price - a), snap(price - a * 2)]
        levels = [first, *deeper]
    else:
        levels = [snap(price - a), snap(price - a * 2)]
    shape = PLANS[plan]
    if total < MIN_ORDER * len(shape):  # a small add: fewer limits, none under $10
        shape = [Decimal(1)] * max(1, int(total // MIN_ORDER))  # even parts
        levels = levels[: len(shape) - 1]
    scale = total / sum(shape, ZERO)
    spends = [max((w * scale).quantize(Decimal("0.01")), MIN_ORDER) for w in shape]
    rungs = [
        {
            "price": rules.price(Decimal(str(entry))),
            "spend": spends[0],
            "why": f"Entry: {odds}% in an hour" if odds else "Entry",
        }
    ]
    last = entry
    for (level, w), spend in zip(levels, spends[1:], strict=True):
        at = min(level, last * 0.985)  # each limit at least 1.5% under the one above
        rungs.append({"price": rules.price(Decimal(str(at))), "spend": spend, "why": w})
        last = at
    return plan, why, rungs


def exit_problems(
    rungs: list[dict[str, Any]], now: Decimal, stop: Decimal | None, target: Decimal | None
) -> list[str]:
    """A ladder's stop and target against its limits."""
    deepest = min((r["price"] for r in rungs), default=now)
    highest = max((r["price"] for r in rungs), default=now)
    found: list[str] = []
    if stop is not None and stop >= deepest:
        found.append("The stop goes under the deepest limit.")
    if target is not None and target <= highest:
        found.append("The target goes over the highest limit.")
    if target is not None and stop is None:
        found.append("A target needs a stop: set both, or neither.")
    return found


def trade_result(row: dict[str, Any], now: Decimal | None) -> Decimal | None:
    """After fees: what a closed trade made, or an open one would make at `now`."""
    paid, fees = Decimal(row["fill_quote"]), Decimal(row["fees_usd"])
    if row["status"] == "closed":
        return Decimal(row["exit_quote"]) - paid - fees
    if row["status"] == "open" and now is not None:
        held = Decimal(row["fill_qty"]) - Decimal(row["exit_qty"])
        return Decimal(row["exit_quote"]) + held * now - paid - fees
    return None


def r_of(row: dict[str, Any], result: Decimal | None) -> Decimal | None:
    risk = Decimal(row["risk"])
    return (result / risk).quantize(Decimal("0.01")) if result is not None and risk else None


def style_from(setup: str) -> str | None:
    """A trade's style, from its setup's name (`Position - Pullback to the 20-week`)."""
    return next((s.key for s in screener.STYLES.values() if setup.startswith(f"{s.name} - ")), None)


def _cents(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01")))


def _never_placed(row: dict[str, Any]) -> bool:
    """An exit Binance refused outright: kept in the book, but only the latest is shown."""
    return (
        row["role"] == "exit"
        and row["status"] == "cancelled"
        and row["order_id"] is None
        and row["list_id"] is None
    )


def is_held(row: dict[str, Any]) -> bool:
    """An open trade the owner holds with no stop or target: nothing on Binance, nothing watched,
    and no risk counted, until a stop is set again (decision 94)."""
    return row["status"] == "open" and row["exit_kind"] == HELD


def position_key(row: dict[str, Any]) -> str:
    """The position a trade belongs to: its ladder's first reference, or its own."""
    found = LADDER_OF.search(str(row["setup"] or ""))
    return found.group(1) if found else str(row["ref"])


def order_view(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "ref": row["ref"],
        "role": row["role"],
        "kind": row["kind"],
        "price": row["price"],
        "stop": row["stop"],
        "qty": row["qty"],
        "status": row["status"],
        "created": row["created"],
    }


class Pot:
    def __init__(self, desk: Trading) -> None:
        self._desk = desk
        self._binance, self._store, self._audit, self._clock = desk.parts()
        self._regime: tuple[str | None, str] | None = None
        self._btc: dict[str, str] = {}  # BTC's price and its 50 and 200-day averages, once read

    def _now(self) -> int:
        return int(self._clock() * 1000)

    # What trading-agent's side shares (pot_agent).

    @property
    def binance(self) -> Any:
        return self._binance

    @property
    def store(self) -> Any:
        return self._store

    def now_ms(self) -> int:
        return self._now()

    # What take profit (pot_tp) shares.

    @property
    def audit(self) -> Any:
        return self._audit

    def rules_of(self, coin: str) -> Filters:
        return self._rules_of(coin)

    def price_now(self, coin: str) -> Decimal:
        return self._price_now(coin)

    def trade(self, ref: str) -> dict[str, Any]:
        return self._trade(ref)

    def order(self, ref: str) -> dict[str, Any]:
        return self._order(ref)

    def save_trade(self, row: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
        return self._save_trade(row, changes)

    def save_order(self, row: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
        return self._save_order(row, changes)

    def fees(self, coin: str, order_id: int) -> tuple[Decimal, Decimal]:
        return self._fees(coin, order_id)

    def refresh(self, order: dict[str, Any]) -> None:
        self._refresh(order)

    def pull_exit(self, trade: dict[str, Any]) -> None:
        self._pull_exit(trade)

    def log(self, ref: str, text: str) -> None:
        self._log(ref, text)

    def close_part(
        self, trade: dict[str, Any], qty: Decimal, quote: Decimal, fees: Decimal, kind: str
    ) -> None:
        self._close(trade, qty, quote, fees, kind)

    def _tp_guard(self, trade: dict[str, Any]) -> None:
        """A position with take-profit sells waiting has its coins on Binance's book."""
        key = position_key(trade)
        if any(
            o["role"] == "tp" and o["trade_ref"] == key and o["status"] in ("placing", "open")
            for o in self._store.pot_orders()
        ):
            raise Refused(
                "Its take-profit sells hold its coins on Binance: cancel them first, or sell "
                "100% at market from Take profit."
            )

    # Settings: the test phase or sizing from the stop.

    def config(self) -> dict[str, str]:
        raw = self._store.setting(CONFIG_KEY, "")
        return {**DEFAULT_CONFIG, **(json.loads(raw) if raw else {})}

    def set_config(self, body: dict[str, Any]) -> dict[str, Any]:
        mode = str(body.get("mode", "test"))
        if mode not in ("test", "risk"):
            raise Refused("The pot sizes trades as a fixed amount (test) or from the stop (risk).")
        fixed = number(body.get("fixed", "10"), "The fixed amount")
        risk = number(body.get("riskPct", "1"), "Risk per trade")
        if risk > 2:  # noqa: PLR2004 - the agent's rules say 1%; 2% is the most the desk allows
            raise Refused("Risk per trade is at most 2% of the pot.")
        raw_cap = body.get("maxRisk")
        cap = "" if raw_cap in (None, "") else plain(number(raw_cap, "The most at risk"))
        config = {"mode": mode, "fixed": plain(fixed), "riskPct": plain(risk), "maxRisk": cap}
        self._store.set_setting(CONFIG_KEY, json.dumps(config))
        capped = f", at most {cap} {QUOTE}" if cap else ""
        self._audit.record(
            "pot", "Sizing", f"{mode}: {plain(fixed)} a trade, {plain(risk)}% risk{capped}"
        )
        return self.view()

    def allowed(self, equity: Decimal) -> Decimal:
        """The most one trade may risk: riskPct of the pot, and never past maxRisk."""
        config = self.config()
        allowed = equity * Decimal(config["riskPct"]) / HUNDRED
        if config.get("maxRisk"):
            allowed = min(allowed, Decimal(config["maxRisk"]))
        return allowed

    def coins(self) -> list[str]:
        """The coins trading-agent's file names, else its usual seven."""
        found = COINS_LINE.search(my_agents.file(self._store, AGENT)["markdown"] or "")
        if not found:
            return list(COINS)
        named = [c.strip().upper() for c in found.group(1).split(",")]
        return [c for c in named if c.isalnum() and len(c) <= 10] or list(COINS)  # noqa: PLR2004

    def _tradable(self, coin: str) -> None:
        """trading-agent's own coins, or any coin New trade's screener found today."""
        if coin not in self.coins() and coin not in screener.tradable(self._store):
            raise Refused(f"{coin or 'That coin'} isn't one trading-agent trades.")

    @staticmethod
    def style_of(body: dict[str, Any]) -> screener.Style | None:
        """The trading style a trade is sized by; none for a trade by hand or a scan's."""
        key = body.get("style")
        if key in (None, ""):
            return None
        style = screener.STYLES.get(str(key))
        if style is None:
            raise Refused("Pick scalp, day, swing or position.")
        return style

    # Money in and out.

    @locked
    def put_in(self, body: dict[str, Any]) -> dict[str, Any]:
        usdc = number(body.get("usdc"), "The amount")
        if usdc > Decimal(100_000):
            raise Refused("That's more than the pot takes in one go.")
        ref = self._store.add_pot_move("in", plain(usdc), self._now())
        self._audit.record("pot", f"{ref}: put in", f"{plain(usdc)} {QUOTE}")
        return self.view()

    def _put_in(self) -> Decimal:
        total = ZERO
        for m in self._store.pot_moves():
            total += Decimal(m["usdc"]) * (1 if m["kind"] == "in" else -1)
        return total

    def _closed(self) -> Decimal:
        rows = self._store.pot_trades()
        return sum((trade_result(r, None) or ZERO for r in rows if r["status"] == "closed"), ZERO)

    def equity(self) -> Decimal:
        """What sizing and the limits measure: money put in plus closed results."""
        return self._put_in() + self._closed()

    # The market.

    def regime(self) -> tuple[str | None, str]:
        if self._regime is None:
            try:
                rows = self._binance.klines(f"BTC{QUOTE}", "1d", 210)
                closes = [Decimal(str(r[4])) for r in rows]
                self._regime = regime_of(closes)
                fast, slow = sma(closes, 50), sma(closes, 200)
                if closes and fast is not None and slow is not None:  # for the market card
                    whole = Decimal(1)
                    self._btc = {
                        "btc": plain(closes[-1].quantize(whole)),
                        "sma50": plain(fast.quantize(whole)),
                        "sma200": plain(slow.quantize(whole)),
                    }
                    bear_in = days_to_cross(closes)
                    if bear_in is not None:
                        self._btc["bearIn"] = str(bear_in)
            except BinanceError:
                self._regime = (None, "no answer from Binance")
        return self._regime

    def regime_view(self) -> dict[str, Any]:
        """The regime for the page: its state and words, BTC and its averages, days to Bear."""
        state, words = self.regime()
        return {"state": state, "words": words} | self._btc

    def prices(self, coins: list[str]) -> dict[str, Decimal]:
        rows = self._binance.tickers([f"{c}{QUOTE}" for c in coins])
        return {
            c: Decimal(str(rows[f"{c}{QUOTE}"]["lastPrice"]))
            for c in coins
            if f"{c}{QUOTE}" in rows
        }

    # Sizing and the rules (trading-agent.md, Step 2 and the test phase).

    def _rules_of(self, coin: str) -> Filters:
        return self._binance.filters(f"{coin}{QUOTE}")

    def _under_now(self, coin: str, entry: Decimal) -> None:
        """A limit buy above the price would fill at once, lower, maybe under its stop."""
        now = self.prices([coin]).get(coin)
        if now is None:
            raise Refused(f"There's no {coin}/{QUOTE} price on Binance.")
        if entry > now:
            raise Refused(
                f"The entry is above the price now ({plain(now)}): a limit buy goes at or under it."
            )

    def _numbers(self, body: dict[str, Any], *, existing: bool = False) -> dict[str, Any]:
        """A trade's prices to Binance's steps, its size by the pot's sizing, and its risk and
        reward after fees; refuses only what can't be sized at all. An existing trade's coin
        stays tradable even if it has left today's screener universe."""
        coin = str(body.get("coin", "")).upper()
        if not existing:
            self._tradable(coin)
        style = self.style_of(body)
        rules = self._rules_of(coin)
        entry = rules.price(number(body.get("entry"), "Entry"))
        stop = rules.price(number(body.get("stop"), "Stop"))
        target = rules.price(number(body.get("target"), "Target"))
        if not stop < entry < target:
            raise Refused("The stop goes under the entry and the target above it.")
        config, equity = self.config(), self.equity()
        if equity <= ZERO:
            raise Refused("Put money in the pot first.")
        allowed = self.allowed(equity)
        if style is not None:  # every style risks the same 1%; none opens a long in Bear
            self._regime_rule({"style": style.key})
        if config["mode"] == "test":
            qty = rules.amount(Decimal(config["fixed"]) / entry)
            if qty * entry < Decimal(config["fixed"]):
                qty += rules.step  # whole steps: one more, never under the fixed amount
        else:
            qty = rules.amount(allowed / (entry - stop + entry * FEE * 2))
            qty = min(qty, rules.amount(equity * MAX_POSITION_PCT / HUNDRED / entry))
        spend = qty * entry
        risk = qty * (entry - stop) + spend * FEE + qty * stop * FEE
        reward = qty * (target - entry) - spend * FEE - qty * target * FEE
        if qty <= ZERO or spend < max(rules.min_notional, MIN_ORDER):
            raise Refused(smallest(rules.min_notional))
        return {
            "coin": coin,
            "entry": entry,
            "stop": stop,
            "target": target,
            "qty": qty,
            "spend": spend,
            "risk": risk,
            "reward": reward,
            "allowed": allowed,
            "equity": equity,
            "style": style.key if style else None,
            "minRr": Decimal(str(style.min_rr)) if style else MIN_RR,
        }

    @staticmethod
    def _shown(n: dict[str, Any]) -> dict[str, Any]:
        entry = n["entry"]
        return {
            "coin": n["coin"],
            "entry": plain(entry),
            "stop": plain(n["stop"]),
            "target": plain(n["target"]),
            "qty": plain(n["qty"]),
            "spend": _cents(n["spend"]),
            "risk": _cents(n["risk"]),
            "stopPct": str(((entry - n["stop"]) / entry * HUNDRED).quantize(Decimal("0.1"))),
            "rr": str((n["reward"] / n["risk"]).quantize(Decimal("0.1"))),
            "style": n.get("style"),
        }

    @classmethod
    def _limits(cls, n: dict[str, Any]) -> None:
        """The sizing rules: the risk a trade allows, and 2 : 1 after fees."""
        cls._risk_rule(n)
        cls._rr_rule(n)

    @staticmethod
    def _risk_rule(n: dict[str, Any]) -> None:
        risk, allowed = n["risk"], n["allowed"]
        if risk > allowed * Decimal("1.0001"):
            stop_pct = (n["entry"] - n["stop"]) / n["entry"] * HUNDRED
            raise Refused(
                f"The stop is {stop_pct:.1f}% under the entry: that risks ${risk:.2f}, over the "
                f"${allowed:.2f} a trade allows. A closer stop, or pass."
            )

    @staticmethod
    def _rr_rule(n: dict[str, Any]) -> None:
        rr, least = n["reward"] / n["risk"], n.get("minRr", MIN_RR)
        if rr < least:
            raise Refused(
                f"Reward to risk is {rr:.1f} : 1 after fees; the rules need {least:g} : 1."
            )

    def size(self, body: dict[str, Any]) -> dict[str, Any]:
        """A trade sized and shown; refuses one that breaks a sizing rule."""
        n = self._numbers(body)
        if body.get("market") is not True:  # a market buy is sized at the price now, whatever it is
            self._under_now(n["coin"], n["entry"])
        self._limits(n)
        return self._shown(n)

    def preview(self, body: dict[str, Any]) -> dict[str, Any]:
        """A trade typed by hand, before it's placed: the price now, its numbers, and every rule
        it breaks (not just the first), so the page can draw it as it's typed."""
        coin = str(body.get("coin", "")).upper()
        self._tradable(coin)
        now = self.prices([coin]).get(coin)
        rules = self._rules_of(coin)
        out: dict[str, Any] = {
            "coin": coin,
            "ref": self._ref(coin),  # the reference it would get, if placed now
            "now": plain(now) if now is not None else None,
            "tick": plain(rules.tick),
            "trade": None,
            "problems": [],
        }
        if not all(body.get(k) for k in ("entry", "stop", "target")):
            return out
        try:
            n = self._numbers(body)
        except Refused as error:
            out["problems"] = [str(error)]
            return out
        fees = n["spend"] * FEE + n["qty"] * n["target"] * FEE
        out["trade"] = {
            **self._shown(n),
            "reward": _cents(n["reward"]),
            "targetPct": str(
                ((n["target"] - n["entry"]) / n["entry"] * HUNDRED).quantize(Decimal("0.1"))
            ),
            "riskOfPot": str((n["risk"] / n["equity"] * HUNDRED).quantize(Decimal("0.01"))),
            "allowed": _cents(n["allowed"]),
            "fees": _cents(fees),
            # The price that pays back both fees, a tick up so it's never under.
            "breakeven": plain(rules.price(n["entry"] * (1 + FEE) / (1 - FEE)) + rules.tick),
        }
        problems: list[str] = []
        warnings: list[str] = []
        for step in (
            lambda: self._under_now(n["coin"], n["entry"]),
            lambda: self._risk_rule(n),
            lambda: self._rr_rule(n),
            lambda: self.check_rules(self._shown(n), soft=warnings),
        ):
            try:
                step()
            except Refused as error:
                problems.append(str(error))
        out["problems"] = problems
        out["warnings"] = warnings  # rules the owner may place past (owner, 21 Nov 2026)
        return out

    # Ladder trades (owner, 21 Nov 2026): a position bought in rungs, like the DCA book's
    # ladders. Each rung is a trade of its own (its limit, its fill), named
    # "Position - Ladder <first ref>, i of k" so the page groups them. The stop and target are
    # optional: a rung with no stop is held from the start, nothing sells it until one is set.

    def ladder_preview(self, body: dict[str, Any]) -> dict[str, Any]:
        """The rungs (suggested from support when none are given), each with its fill odds,
        the average if all fill, the risk, and what the rules say: problems refuse, warnings
        the owner may place past."""
        coin = str(body.get("coin", "")).upper()
        self._tradable(coin)
        now = self.prices([coin]).get(coin)
        if now is None:
            raise Refused(f"There's no {coin}/{QUOTE} price on Binance.")
        rules = self._rules_of(coin)
        rows = self._binance.klines(f"{coin}{QUOTE}", "1d", 400)
        given = cast(list[dict[str, Any]], body.get("rungs") or [])
        replacing = self._replacing(coin, body)
        freed = sum((Decimal(r["spend"]) for r in replacing), ZERO)
        plan = why_plan = ""
        if given:
            rungs = given_rungs(rules, given)
        else:
            added = number(body.get("total") or ("0" if replacing else "50"), "Total")
            total = added + freed
            if total < MIN_ORDER:
                raise Refused(smallest(rules.min_notional))
            five = self._binance.klines(f"{coin}{QUOTE}", "5m", 1000)
            plan, why_plan, rungs = suggest_plan(
                rows, five, now, total, rules, asked=body.get("plan")
            )
        stop = rules.price(number(body["stop"], "Stop")) if body.get("stop") else None
        target = rules.price(number(body["target"], "Target")) if body.get("target") else None
        problems: list[str] = []
        shown: list[dict[str, Any]] = []
        qty_all = spend_all = risk = ZERO
        for r in rungs:
            price, spend = cast(Decimal, r["price"]), cast(Decimal, r["spend"])
            qty = rung_qty(rules, price, spend)
            if price > now:
                problems.append(f"{plain(price)} is above the price now ({plain(now)}).")
            if qty * price < max(rules.min_notional, MIN_ORDER):
                problems.append(f"At {plain(price)}: {smallest(rules.min_notional)}")
            qty_all += qty
            spend_all += qty * price
            # No stop: held, so no risk counted, as for a held position (decision 94).
            risk += qty * (price - stop) if stop is not None else ZERO
            shown.append(
                {
                    "price": plain(price),
                    "spend": _cents(qty * price),
                    "qty": plain(qty),
                    "underPct": str(((1 - price / now) * HUNDRED).quantize(Decimal("0.1"))),
                    "odds": touch_odds(rows, float(price / now)),
                    "why": r["why"],
                }
            )
        deepest = min((r["price"] for r in rungs), default=now)
        problems += exit_problems(rungs, now, stop, target)
        warnings: list[str] = []
        sized = {
            "coin": coin,
            "entry": plain(deepest),
            "stop": plain(stop) if stop is not None else "0",
            "spend": plain(spend_all),
            "risk": plain(risk),
            "style": "position",
            "joining": bool(body.get("position")),
        }
        try:
            self._ladder_rules(sized, [Decimal(x["spend"]) for x in shown], warnings, freed)
        except Refused as error:
            problems.append(str(error))
        avg = spend_all / qty_all if qty_all else ZERO
        likely = sum((Decimal(x["spend"]) * x["odds"] / 100 for x in shown), ZERO)
        return {
            "coin": coin,
            "now": plain(now),
            "tick": plain(rules.tick),
            **({"plan": plan, "planWhy": why_plan} if not given else {}),
            "rungs": shown,
            "total": _cents(spend_all),
            "avg": plain(rules.price(avg)) if avg else None,
            "avgPct": str(((1 - avg / now) * HUNDRED).quantize(Decimal("0.1"))) if avg else None,
            "likely": _cents(likely),
            "stop": plain(stop) if stop is not None else None,
            "target": plain(target) if target is not None else None,
            "risk": _cents(risk),
            "problems": problems,
            "warnings": warnings,
            "replacing": [
                {"ref": r["ref"], "price": r["entry"], "spend": _cents(Decimal(r["spend"]))}
                for r in replacing
            ],
            "freed": _cents(freed),
        }

    def _replacing(self, coin: str, body: dict[str, Any]) -> list[dict[str, Any]]:
        """With "replace", the position's waiting buy limits: cancelled and planned again with
        the money added (owner, 21 Nov 2026: add funds, or move the limits)."""
        if body.get("replace") is not True:
            return []
        key = self._position_of(coin, body.get("position"))
        if key is None:
            raise Refused("Pick the position whose limits to replace.")
        return [
            r
            for r in self._store.pot_trades()
            if position_key(r) == key and r["status"] in ("placing", "waiting")
        ]

    def _ladder_rules(
        self, sized: dict[str, Any], spends: list[Decimal], soft: list[str], freed: Decimal = ZERO
    ) -> None:
        """The account's rules on a ladder as one position: the soft ones into `soft`, then
        the stop's band, free USDC, and the desk's limits (each rung an order of its own)."""
        for check in (
            lambda: self._regime_rule(sized),
            self._account_rules,
            lambda: self._open_rules(
                sized,
                # Adding to a position already held: its own buys aren't "another trade".
                [
                    r
                    for r in self._live()
                    if not (sized.get("joining") and r["coin"] == sized["coin"])
                ],
                Decimal(sized["risk"]),
                self.equity(),
            ),
        ):
            try:
                check()
            except Refused as why:
                soft.append(str(why))
        self._band_rule(sized)
        total = Decimal(sized["spend"])
        with contextlib.suppress(BinanceError):
            free = self.free_quote() + freed  # limits replaced give their USDC back first
            if total > free:
                raise Refused(
                    f"Binance has ${free:.2f} {QUOTE} free; the ladder needs ${total:.2f}."
                )
        settings = self._desk.settings()
        if not settings["tradingOn"]:
            raise Refused("Trading is off. Turn it on in the top bar to trade.")
        per_order, per_day = Decimal(settings["perOrder"]), Decimal(settings["perDay"])
        if per_order <= ZERO or per_day <= ZERO:
            raise Refused("Set your per-order and daily limits first.")
        if spends and max(spends) > per_order:
            raise Refused(f"A limit order is over your per-order limit of ${per_order:,.2f}.")
        if Decimal(settings["spentToday"]) + total - freed > per_day:
            raise Refused(f"That would take today past your daily limit of ${per_day:,.2f}.")

    @locked
    def place_ladder(self, body: dict[str, Any]) -> dict[str, Any]:
        """Every rung as its own limit buy, after the preview's rules: a problem refuses, a
        warning needs the owner's "anyway"."""
        if not body.get("rungs"):
            raise Refused("Give the ladder's rungs.")
        seen = self.ladder_preview(body)
        if seen["problems"]:
            raise Refused(seen["problems"][0])
        if seen["warnings"] and body.get("anyway") is not True:
            raise Refused("Read the warnings, then place anyway: " + " ".join(seen["warnings"]))
        coin = seen["coin"]
        for old in seen["replacing"]:  # their USDC back before the new limits go on
            done = self.cancel(old["ref"])
            if done["status"] != "cancelled":
                self._log(old["ref"], "It had filled when replaced, so it stays a buy.")
        state, _ = self.regime()
        reason = str(body.get("reason") or "").strip()[:400]
        first = self._position_of(coin, body.get("position")) or self._ref(coin)
        count = len(seen["rungs"])
        stop = seen["stop"] or "0"
        target = seen["target"] or "0"
        for i, r in enumerate(seen["rungs"], start=1):
            price, qty = Decimal(r["price"]), Decimal(r["qty"])
            risk = qty * (price - Decimal(stop)) if seen["stop"] else qty * price
            trade: dict[str, Any] = {
                "coin": coin,
                "entry": r["price"],
                "stop": stop,
                "target": target,
                "qty": r["qty"],
                "spend": plain(qty * price),
                "risk": plain(risk.quantize(Decimal("0.01"))),
                "ref": self._ref(coin),
                "setup": f"Position - Ladder {first}, {i} of {count}",
                "regime": state or "unknown",
                "reason": reason,
                "mode": self.config()["mode"],
                "created": self._now(),
            }
            self._store.add_pot_trade(trade)
            if not seen["stop"]:  # no stop: held from the start, nothing sells it
                self._save_trade(self._trade(trade["ref"]), {"exit_kind": HELD})
            self._place_rung(trade)
        self._audit.record("pot", f"Ladder {first}", f"{count} rungs, {seen['total']} {QUOTE}")
        return self.view()

    def _position_of(self, coin: str, ref: object) -> str | None:
        """The position a ladder adds to (owner, 21 Nov 2026: ladder buys are one position): a
        live trade of the same coin, named by its ladder's first ref or its own."""
        if not ref:
            return None
        row = self._store.pot_trade(str(ref))
        if row is None or row["coin"] != coin or row["status"] not in LIVE:
            raise Refused(f"There's no open {coin} position with that reference.")
        found = LADDER_OF.search(str(row["setup"]))
        return found.group(1) if found else str(row["ref"])

    def _place_rung(self, trade: dict[str, Any]) -> None:
        order: dict[str, Any] = {
            "ref": f"{trade['ref']}-E",
            "trade_ref": trade["ref"],
            "role": "entry",
            "kind": "limit",
            "side": "buy",
            "price": trade["entry"],
            "stop": None,
            "qty": trade["qty"],
            "spend": trade["spend"],
            "created": trade["created"],
        }
        self._store.add_pot_order(order)
        self._log(
            trade["ref"],
            f"Placed: ladder limit, buy {trade['qty']} at {trade['entry']}"
            + (f"; stop {trade['stop']}" if trade["stop"] != "0" else "; no stop")
            + ".",
        )
        saved = self._order(order["ref"])
        try:
            sent = self._binance.buy_limit(
                f"{trade['coin']}{QUOTE}",
                Decimal(trade["qty"]),
                Decimal(trade["entry"]),
                order["ref"],
            )
        except BinanceError as error:
            if not unknown(error):
                self._save_order(saved, {"status": "cancelled"})
                self._save_trade(
                    self._trade(trade["ref"]), {"status": "cancelled", "note": error.message}
                )
            raise
        self._follow(saved, sent)

    def _live(self) -> list[dict[str, Any]]:
        return [r for r in self._store.pot_trades() if r["status"] in LIVE]

    @staticmethod
    def _risk_of(r: dict[str, Any]) -> Decimal:
        # No stop, bought or still waiting (a ladder's limits): not a measured risk, and
        # outside the open-risk cap.
        if is_held(r) or r["exit_kind"] == HELD or Decimal(r["stop"] or "0") <= ZERO:
            return ZERO
        paid = Decimal(r["fill_quote"]) / Decimal(r["fill_qty"]) if Decimal(r["fill_qty"]) else None
        entry = paid or Decimal(r["entry"])
        held = Decimal(r["fill_qty"]) or Decimal(r["qty"])
        stop = Decimal(r["stop"])
        return max(held * (entry - stop) + held * (entry + stop) * FEE, ZERO)

    def open_risk(self, leaving_out: str | None = None) -> Decimal:
        return sum((self._risk_of(r) for r in self._live() if r["ref"] != leaving_out), ZERO)

    def month_result(self) -> Decimal:
        start = datetime.fromtimestamp(self._now() / 1000, SYDNEY).replace(
            day=1, hour=0, minute=0, second=0, microsecond=0
        )
        since = int(start.timestamp() * 1000)
        rows = self._store.pot_trades()
        return sum(
            (
                trade_result(r, None) or ZERO
                for r in rows
                if r["status"] == "closed" and (r["closed"] or 0) >= since
            ),
            ZERO,
        )

    def cash(self) -> Decimal:
        """Money put in and closed results, less what live trades hold or have set aside."""
        held = ZERO
        for r in self._live():
            filled = Decimal(r["fill_quote"])
            held += filled if r["status"] == "open" else Decimal(r["spend"])
        return self.equity() - held

    def _quote_balance(self) -> tuple[Decimal, Decimal]:
        row = next((b for b in self._binance.balances() if b["asset"] == QUOTE), None)
        if row is None:
            return ZERO, ZERO
        return Decimal(row["free"]), Decimal(row.get("locked") or 0)

    def free_quote(self) -> Decimal:
        return self._quote_balance()[0]

    def backing(self) -> dict[str, str]:
        """The quote on Binance: free to spend, and locked in open limit orders (the DCA
        book's and the account's). One wallet, so either spends from the same USDC."""
        held = max(self.cash(), ZERO)
        free, locked = self._quote_balance()
        return {
            "free": _cents(free),
            "locked": _cents(locked),
            "held": _cents(held),
            "short": _cents(max(held - free, ZERO)),
        }

    def guard(self, spend: Decimal, what: str = "this order") -> str | None:
        """The account's soft ring-fence (owner, 18 Nov 2026): a buy from outside it (the DCA
        book, a hand order) should leave the account's available USDC free on Binance. It
        warns, never blocks: the words go to the audit log and back to the caller. A waiting
        entry is locked on Binance already, so only the account's free cash is kept back.
        Off for now (owner, 21 Nov 2026): no cap on the account, trades spend what's free on
        Binance, so there is nothing to fence."""
        if not RING_FENCE:
            return None
        held = self.cash()
        if held <= ZERO or spend <= ZERO:
            return None
        try:
            free = self.free_quote()
        except BinanceError:
            return None  # the order itself will meet the same outage
        room = max(free - held, ZERO)
        if spend <= room:
            return None
        said = (
            f"{what[:1].upper()}{what[1:]} uses {spend - room:,.2f} of the trading account's "
            f"{QUOTE}: "
            f"{free:,.2f} is free on Binance and {held:,.2f} of it is the account's."
        )
        self._audit.record("pot", "Ring-fence", said)
        return said

    def check_rules(
        self,
        sized: dict[str, Any],
        replacing: dict[str, Any] | None = None,
        *,
        soft: list[str] | None = None,
    ) -> None:
        """The pot's limits on a new trade, on top of its sizing. `replacing`: a waiting trade
        this one takes the place of (enter now), left out of the cash, risk and coin counts.
        `soft`: the owner's own trade (owner, 21 Nov 2026): the regime, the account's stops,
        open risk, the alt count and one trade a coin go into it as warnings instead of
        refusing; Binance's limits, free USDC and the desk's own limits still refuse."""

        def rule(check: Callable[[], None]) -> None:
            try:
                check()
            except Refused as why:
                if soft is None:
                    raise
                soft.append(str(why))

        put_in, equity = self._put_in(), self.equity()
        if put_in <= ZERO:
            raise Refused("Put money in the pot first.")
        rule(lambda: self._regime_rule(sized))
        rule(lambda: self._account_rules(put_in, equity))
        self._band_rule(sized)
        mine = replacing["ref"] if replacing else None
        others = [r for r in self._live() if r["ref"] != mine]
        spend, risk = Decimal(sized["spend"]), Decimal(sized["risk"])
        # No cap on the account for now (owner, 21 Nov 2026): a trade spends what's free on
        # Binance. No answer from Binance: the order itself will meet the same outage.
        back = Decimal(replacing["spend"]) if replacing else ZERO
        with contextlib.suppress(BinanceError):
            free = self.free_quote() + back
            if spend > free:
                raise Refused(
                    f"Binance has ${free:.2f} {QUOTE} free; that trade needs ${spend:.2f}."
                )
        rule(lambda: self._open_rules(sized, others, risk, equity, mine))
        self._check_desk(spend)

    def _open_rules(  # noqa: PLR0913 - the trade and what's open beside it
        self,
        sized: dict[str, Any],
        others: list[dict[str, Any]],
        risk: Decimal,
        equity: Decimal,
        mine: str | None = None,
    ) -> None:
        """Open risk, the alt count and one trade a coin: what's on already."""
        if self.open_risk(mine) + risk > equity * MAX_OPEN_RISK_PCT / HUNDRED:
            raise Refused(
                f"That would put more than {MAX_OPEN_RISK_PCT}% of the pot at risk across open "
                "trades."
            )
        if sized["coin"] != "BTC":
            alts = [
                r
                for r in others
                if r["coin"] != "BTC" and not is_held(r) and r["exit_kind"] != HELD
            ]
            if len(alts) >= MAX_ALTS:
                raise Refused("Two alt trades are on already: alts move with BTC.")
        if any(r["coin"] == sized["coin"] for r in others):
            raise Refused(f"A {sized['coin']} trade is on already.")

    def _band_rule(self, sized: dict[str, Any]) -> None:
        """A stop Binance won't hold is refused before the trade, not found out after the fill:
        it takes no stop further under the price than the pair's band (decision 93)."""
        rules = self._rules_of(sized["coin"])
        if rules.ask_down is None:
            return
        entry, stop = Decimal(str(sized["entry"])), Decimal(str(sized["stop"]))
        if stop <= ZERO:  # a ladder rung with no stop: nothing for Binance to hold
            return
        lowest = rules.price(entry * rules.ask_down) + rules.tick
        if stop < lowest:
            pct = ((1 - rules.ask_down) * HUNDRED).normalize()
            raise Refused(
                f"Binance holds no stop more than {pct:f}% under the price on {sized['coin']}: "
                f"with this entry the lowest it takes is {plain(lowest)}."
            )

    def _account_rules(self, put_in: Decimal | None = None, equity: Decimal | None = None) -> None:
        """The pot's stops on buying more, for a new trade and an add alike: the month's loss
        limit, the 20% stop-out, and no new longs in a Bear regime."""
        put_in = self._put_in() if put_in is None else put_in
        equity = self.equity() if equity is None else equity
        if self.regime()[0] == "bear":
            raise Refused("BTC is in a Bear regime: no new longs until it turns.")
        if self.month_result() <= -put_in * MONTH_LOSS_PCT / HUNDRED:
            raise Refused("The month's 6% loss limit is used: no new trades until the 1st.")
        if equity <= put_in * (HUNDRED - STOP_OUT_PCT) / HUNDRED:
            raise Refused("The pot is down 20% from what was put in: trading stops for a review.")

    def _regime_rule(self, sized: dict[str, Any]) -> None:
        """No new longs in a Bear regime; a style may need more (position: Bull only)."""
        state, _ = self.regime()
        if state == "bear":
            raise Refused("BTC is in a Bear regime: no new longs until it turns.")
        style = screener.STYLES.get(str(sized.get("style") or ""))
        if style is not None:
            allowed, why = screener.gate(style, state)
            if not allowed:
                raise Refused(why)

    def _check_desk(self, spend: Decimal) -> None:
        settings = self._desk.settings()
        if not settings["tradingOn"]:
            raise Refused("Trading is off. Turn it on in the top bar to trade.")
        per_order, per_day = Decimal(settings["perOrder"]), Decimal(settings["perDay"])
        if per_order <= ZERO or per_day <= ZERO:
            raise Refused("Set your per-order and daily limits first.")
        if spend > per_order:
            raise Refused(f"That's over your per-order limit of ${per_order:,.2f}.")
        if Decimal(settings["spentToday"]) + spend > per_day:
            raise Refused(f"That would take today past your daily limit of ${per_day:,.2f}.")

    # Placing, following and ending a trade.

    def _ref(self, coin: str) -> str:
        week = ref_week(self._now())
        taken = {r["ref"] for r in self._store.pot_trades()}
        n = 1
        while f"{TAG}{coin}-{week}-{n}" in taken:
            n += 1
        return f"{TAG}{coin}-{week}-{n}"

    @locked
    def place(self, body: dict[str, Any]) -> dict[str, Any]:
        expires = body.get("expires")
        if isinstance(expires, int) and self._now() > expires:
            raise Refused("That proposal has expired: the price has moved on. Scan again.")
        market = body.get("market") is True
        if market:  # sized at the price now; the style's reward to risk must still hold
            coin = str(body.get("coin", "")).upper()
            now = self.prices([coin]).get(coin)
            if now is None:
                raise Refused(f"There's no {coin}/{QUOTE} price on Binance.")
            body = {**body, "entry": plain(now)}
        sized = self.size(body)
        # The owner's own trade, past warnings they've read ("anyway"); a proposal of
        # trading-agent's keeps every rule.
        mine = body.get("anyway") is True and not body.get("proposal")
        warned: list[str] = []
        self.check_rules(sized, soft=warned if mine else None)
        setup = str(body.get("setup") or "By hand").strip()
        style = self.style_of(body)
        if style is not None:
            setup = f"{style.name} - {setup}"
        setup = setup[:60]
        if not SETUP.fullmatch(setup):
            setup = f"{style.name} - by hand" if style else "By hand"
        reason = str(body.get("reason") or "").strip()[:400]
        state, _ = self.regime()
        now = self._now()
        trade: dict[str, Any] = {
            **sized,
            "ref": self._ref(sized["coin"]),
            "setup": setup,
            "regime": state or "unknown",
            "reason": reason,
            "mode": self.config()["mode"],
            "created": now,
        }
        self._store.add_pot_trade(trade)
        order: dict[str, Any] = {
            "ref": f"{trade['ref']}-E",
            "trade_ref": trade["ref"],
            "role": "entry",
            "kind": "market" if market else "limit",
            "side": "buy",
            "price": sized["entry"],
            "stop": None,
            "qty": sized["qty"],
            "spend": sized["spend"],
            "created": now,
        }
        self._store.add_pot_order(order)
        self._drop_proposal(str(body.get("proposal") or ""))
        how = "market buy, about" if market else "limit buy"
        self._log(
            trade["ref"],
            f"Placed: {how} {sized['qty']} at {sized['entry']}; stop {sized['stop']}, target "
            f"{sized['target']}; {sized['risk']} {QUOTE} at risk, {sized['rr']} : 1 after fees.",
        )
        if reason:
            self._log(trade["ref"], reason, "thesis")
        saved = self._order(order["ref"])
        try:
            symbol = f"{sized['coin']}{QUOTE}"
            sent = (
                self._binance.buy_market(symbol, Decimal(sized["spend"]), order["ref"])
                if market
                else self._binance.buy_limit(
                    symbol, Decimal(sized["qty"]), Decimal(sized["entry"]), order["ref"]
                )
            )
        except BinanceError as error:
            if not unknown(error):  # refused: never placed
                self._save_order(saved, {"status": "cancelled"})
                self._save_trade(
                    self._trade(trade["ref"]), {"status": "cancelled", "note": error.message}
                )
            raise
        self._audit.record("pot", f"{trade['ref']}: entry", f"{sized['qty']} at {sized['entry']}")
        self._follow(saved, sent)
        return self.trade_view(self._trade(trade["ref"]), None)

    def _trade(self, ref: str) -> dict[str, Any]:
        row = self._store.pot_trade(ref)
        if row is None:
            raise Refused("There's no trade with that reference.")
        return row

    def _order(self, ref: str) -> dict[str, Any]:
        row = self._store.pot_order(ref)
        if row is None:
            raise LookupError(ref)
        return row

    def _save_order(self, row: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
        new = {**row, **changes, "updated": self._now()}
        self._store.save_pot_order(new)
        return new

    def _save_trade(self, row: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
        new = {**row, **changes, "updated": self._now()}
        self._store.save_pot_trade(new)
        return new

    def _fees(self, coin: str, order_id: int) -> tuple[Decimal, Decimal]:
        """A fill's commission: valued in the quote (BNB at today's price), and apart from it
        what was paid in the coin itself."""
        in_coin = in_quote = ZERO
        others: dict[str, Decimal] = {}
        for fill in self._binance.order_fills(f"{coin}{QUOTE}", order_id):
            amount, asset = Decimal(str(fill["commission"])), str(fill["commissionAsset"])
            if asset == coin:
                in_coin += amount
            elif asset == QUOTE:
                in_quote += amount
            else:
                others[asset] = others.get(asset, ZERO) + amount
        if others:
            prices = self.prices(list(others))
            in_quote += sum((q * prices.get(a, ZERO) for a, q in others.items()), ZERO)
        return in_quote, in_coin

    def _follow(self, order: dict[str, Any], sent: dict[str, Any]) -> None:
        """An entry or close order's latest state from Binance, into the book."""
        if order["role"] == "tp":  # a position's take-profit sell (pot_tp)
            from api.pot_tp import TakeProfit  # noqa: PLC0415 - pot_tp imports this module

            TakeProfit(self).follow(order, sent)
            return
        state, executed = binance_state(sent)
        quote = Decimal(str(sent.get("cummulativeQuoteQty", "0")))
        order_id = int(sent.get("orderId") or 0) or order["order_id"]
        changes: dict[str, Any] = {
            "order_id": order_id,
            "status": state,
            "executed_qty": plain(executed),
            "executed_quote": plain(quote),
        }
        trade = self._trade(order["trade_ref"])
        if state == "open":
            self._save_order(order, changes)
            if trade["status"] == "placing":
                self._save_trade(trade, {"status": "waiting"})
            return
        # Every Binance read before the first save: a failed read leaves the order to be followed
        # again in 30 seconds, never saved filled with its trade left behind. The pair's rules
        # are kept once read, so the steps after the saves don't call Binance for them.
        self._rules_of(trade["coin"])
        fee, in_coin = (ZERO, ZERO)
        if executed > ZERO and order_id:
            fee, in_coin = self._fees(trade["coin"], int(order_id))
        if order["side"] != "buy":  # on a sell, coin paid as a fee is a cost; on a buy it
            fee += in_coin * quote / executed if executed else ZERO  # is held less, not a fee
        self._save_order(order, changes | {"fee_usd": plain(fee)})
        fees = Decimal(trade["fees_usd"]) + fee
        if order["role"] == "entry":
            if executed <= ZERO:
                self._save_trade(trade, {"status": "cancelled"})
                return
            held = self._rules_of(trade["coin"]).amount(executed - in_coin)
            trade = self._save_trade(
                trade,
                {
                    "status": "open",
                    "fill_qty": plain(held),
                    "fill_quote": plain(quote),
                    "fees_usd": plain(fees),
                    "filled": self._now(),
                },
            )
            paid = quote / executed
            slip = (paid / Decimal(trade["entry"]) - 1) * HUNDRED
            self._log(
                trade["ref"],
                f"Filled {plain(held)} at {plain(round(paid, 8))} ({slip:+.2f}% from the planned "
                f"{trade['entry']}); fees {fee:.4f} {QUOTE}.",
            )
            self._exit(trade)
        elif order["role"] == "add":
            self._added(trade, executed, in_coin, quote, fees)
        else:  # a close at market, or the stop placed alone (_stop_alone)
            self._close(
                trade, executed, quote, fees, "stop" if order["role"] == "exit" else "market"
            )

    def _rest(self, trade: dict[str, Any]) -> Decimal:
        """What the trade still holds, in whole steps; dust under Binance's smallest order
        counts as nothing."""
        rules = self._rules_of(trade["coin"])
        rest = rules.amount(Decimal(trade["fill_qty"]) - Decimal(trade["exit_qty"]))
        if is_held(trade) or Decimal(trade["stop"]) <= ZERO:
            return rest  # a held buy's rest goes with its position's next sell, however small
        return rest if rest * Decimal(trade["stop"]) >= rules.min_notional else ZERO

    def _close(
        self, trade: dict[str, Any], qty: Decimal, quote: Decimal, fees: Decimal, kind: str
    ) -> None:
        sold = {
            "exit_qty": plain(Decimal(trade["exit_qty"]) + qty),
            "exit_quote": plain(Decimal(trade["exit_quote"]) + quote),
            "fees_usd": plain(fees),
        }
        trade = self._save_trade(trade, sold)
        if self._rest(trade) > ZERO:  # sold nothing, or only part: the rest stays protected
            if qty > ZERO:
                self._log(
                    trade["ref"],
                    f"Sold {plain(qty)} at {plain(round(quote / qty, 8))} ({kind}); "
                    f"{plain(self._rest(trade))} still held.",
                )
            note = "Part sold; " if qty > ZERO else "Nothing sold; "
            rest = (
                "the rest is held."
                if is_held(trade)
                else "its stop and target go back on the rest."
            )
            self._save_trade(trade, {"note": note + rest})
            self._audit.record("pot", f"{trade['ref']}: {kind} sold {plain(qty)}", "rest kept")
            return
        self._save_trade(trade, {"status": "closed", "exit_kind": kind, "closed": self._now()})
        closed = self._trade(trade["ref"])
        result = trade_result(closed, None)
        self._audit.record("pot", f"{trade['ref']}: closed at {kind}", f"{result} {QUOTE}")
        r = r_of(closed, result)
        at = plain(round(quote / qty, 8)) if qty else "-"
        self._log(
            trade["ref"],
            f"Closed at {kind}: sold {plain(qty)} at {at}; "
            f"{_cents(result or ZERO)} {QUOTE} after fees"
            + (f", {plain(r)}R." if r is not None else "."),
        )

    def _exit_ref(self, trade_ref: str) -> str:
        made = [
            o
            for o in self._store.pot_orders()
            if o["trade_ref"] == trade_ref and o["role"] == "exit"
        ]
        return f"{trade_ref}-X{len(made) + 1}"

    def _exit(self, trade: dict[str, Any], *, fallback: bool = True) -> None:
        """The stop and target on Binance as one OCO sell, so they hold with the desk off. If
        Binance refuses it because the price is already through the stop or the target, the
        rest is sold at market, as that leg would have (decision 86). Levels outside Binance's
        price band are watched by the desk, or the stop placed alone (decision 91)."""
        qty = self._rest(trade)
        if qty <= ZERO or is_held(trade):
            return
        if str(trade["note"] or "").startswith(WATCHED) and self._refused_lately(trade, RETRY_MS):
            if fallback:  # Binance refused these levels minutes ago: watched, not sent again
                self._through(trade, qty)
            return
        fits = self._fits(trade)
        if fits == "none":
            self._watched(trade, qty, fallback=fallback)
            return
        if fits == "stop":
            self._lone(trade, qty, fallback=fallback)
            return
        self._oco(trade, qty, fallback=fallback)

    def _oco(self, trade: dict[str, Any], qty: Decimal, *, fallback: bool) -> None:
        """The stop and target sent to Binance as one OCO, and what a refusal leads to."""
        ref = self._exit_ref(trade["ref"])
        order: dict[str, Any] = {
            "ref": ref,
            "trade_ref": trade["ref"],
            "role": "exit",
            "kind": "oco",
            "side": "sell",
            "price": trade["target"],
            "stop": trade["stop"],
            "qty": plain(qty),
            "spend": None,
            "created": self._now(),
        }
        self._store.add_pot_order(order)
        saved = self._order(ref)
        try:
            sent = self._binance.sell_oco(
                f"{trade['coin']}{QUOTE}",
                qty,
                Decimal(trade["target"]),
                Decimal(trade["stop"]),
                ref,
            )
        except BinanceError as error:
            if unknown(error):  # it may be on Binance: the next sync looks it up by its id
                self._save_trade(trade, {"note": "Waiting for Binance to confirm its exits."})
                return
            self._save_order(saved, {"status": "cancelled"})
            if BAND in error.message:  # the desk's reading of the band was off: the stop alone
                self._lone(trade, qty, fallback=fallback)
                return
            self._save_trade(
                trade, {"note": f"Its stop and target aren't on Binance yet: {error.message}"}
            )
            if fallback:
                self._through(self._trade(trade["ref"]), qty)
            return
        self._listed(saved, sent)
        if trade["note"]:
            self._save_trade(self._trade(trade["ref"]), {"note": None})

    def _fits(self, trade: dict[str, Any]) -> str:
        """Which exits Binance will take now. It refuses a sell whose limit or stop price is
        outside a band around the recent average price (NEARUSDC: 0.8 to 2 times), and with
        it the whole OCO: "both" fit, the "stop" alone, or "none" (the stop is too far under
        the price). Unknown band or price: "both", and Binance's answer decides."""
        rules = self._rules_of(trade["coin"])
        now = self.prices([trade["coin"]]).get(trade["coin"])
        if now is None:
            return "both"
        if rules.ask_down is not None and Decimal(trade["stop"]) < now * rules.ask_down:
            return "none"
        if Decimal(trade["target"]) <= ZERO:  # a ladder with a stop and no target
            return "stop"
        if rules.ask_up is not None and Decimal(trade["target"]) > now * rules.ask_up:
            return "stop"
        return "both"

    def _refused_lately(self, trade: dict[str, Any], within_ms: int, kind: str = "") -> bool:
        """Binance refused an exit at these same levels a short while ago (of one kind, or
        any): the memory that stops the desk sending it again on every sync."""
        last = next(
            (
                o
                for o in reversed(self._store.pot_orders())
                if o["trade_ref"] == trade["ref"] and _never_placed(o) and kind in ("", o["kind"])
            ),
            None,
        )
        return (
            last is not None
            and last["stop"] == trade["stop"]
            and last["price"] in (None, trade["target"])
            and self._now() - int(last["created"]) < within_ms
        )

    def _watched(self, trade: dict[str, Any], qty: Decimal, *, fallback: bool) -> None:
        """Binance takes no stop for the trade yet, so the desk holds it: every sync it sells
        at market once the price is at or past the stop or the target (_through), and puts
        the stop on Binance once the price is close enough. Said once, with no order sent."""
        said = (
            f"{WATCHED} Binance takes no stop this far under the price, so the desk sells at "
            f"market if the price reaches {trade['stop']}, while it is running. The stop goes "
            "on Binance once the price is closer."
        )
        if not str(trade["note"] or "").startswith((WATCHED, PAST)):
            self._save_trade(trade, {"note": said})
        if not any(n["text"] == said for n in self._store.pot_notes(trade["ref"])):
            self._log(trade["ref"], said)  # and audited with it: once, not on every sync
            self._audit.record("pot", f"{trade['ref']}: stop out of Binance's range", "watched")
        if fallback:
            self._through(self._trade(trade["ref"]), qty)

    def _lone(self, trade: dict[str, Any], qty: Decimal, *, fallback: bool) -> None:
        """The stop placed alone; refused, the trade is watched (Binance's band) or says
        Binance's own reason, and either way the desk still sells at the stop itself."""
        refused = self._stop_alone(trade, qty)
        if refused is None:
            return
        if BAND in refused:
            self._watched(trade, qty, fallback=fallback)
            return
        if refused:
            fresh = self._trade(trade["ref"])
            self._save_trade(fresh, {"note": f"Its stop isn't on Binance yet: {refused}"})
        if fallback:
            self._through(self._trade(trade["ref"]), qty)

    def _stop_alone(self, trade: dict[str, Any], qty: Decimal) -> str | None:
        """Binance takes no limit sell far above the price, so a far target had the whole OCO
        refused and the trade left with no stop. The stop goes on alone; the sync adds the
        target once the price is close enough (_target_back). None: placed, or sent without
        an answer yet. Else Binance's reason for refusing it; empty when the price is unknown
        or already at the stop, and nothing was sent."""
        now = self.prices([trade["coin"]]).get(trade["coin"])
        if now is None or now <= Decimal(trade["stop"]):  # past the stop: _through's to sell
            return ""
        ref = self._exit_ref(trade["ref"])
        order: dict[str, Any] = {
            "ref": ref,
            "trade_ref": trade["ref"],
            "role": "exit",
            "kind": "stop",
            "side": "sell",
            "price": None,
            "stop": trade["stop"],
            "qty": plain(qty),
            "spend": None,
            "created": self._now(),
        }
        self._store.add_pot_order(order)
        saved = self._order(ref)
        try:
            sent = self._binance.sell_stop(
                f"{trade['coin']}{QUOTE}", qty, Decimal(trade["stop"]), ref
            )
        except BinanceError as error:
            if unknown(error):  # it may be on Binance: the next sync looks it up by its id
                self._save_trade(trade, {"note": "Waiting for Binance to confirm its stop."})
                return None
            self._save_order(saved, {"status": "cancelled"})
            return error.message or "Refused"
        self._save_order(saved, {"order_id": int(sent["orderId"]), "status": "open"})
        said = (
            f"Its stop is on Binance alone: the target ({trade['target']}) is further above "
            "the price than Binance accepts. The desk adds it once the price is closer."
        )
        self._save_trade(self._trade(trade["ref"]), {"note": said})
        if not any(n["text"] == said for n in self._store.pot_notes(trade["ref"])):
            self._log(trade["ref"], said)  # once, not on every replacement
        self._audit.record("pot", f"{trade['ref']}: target out of Binance's range", "stop alone")
        return None

    def _target_back(self, trade: dict[str, Any]) -> None:
        """A trade holding its stop alone gets its stop and target as one OCO again, but only
        when Binance would take both: a live stop is never taken off for less. The target
        waits for room inside the band, and a refused try isn't repeated for an hour."""
        if self._refused_lately(trade, TARGET_RETRY_MS, "oco"):
            return
        ask_up = self._rules_of(trade["coin"]).ask_up
        now = self.prices([trade["coin"]]).get(trade["coin"])
        if now is None or self._fits(trade) != "both":
            return
        if ask_up is not None and Decimal(trade["target"]) > now * ask_up * BAND_ROOM:
            return
        try:
            self._pull_exit(trade)
        except Refused:
            return  # the stop filled, or stayed on: nothing to replace
        after = self._trade(trade["ref"])
        if after["status"] == "open":
            self._exit(after)

    def _through(self, trade: dict[str, Any], qty: Decimal) -> None:
        """The price already past the stop or the target: sold at market now, rather than the
        position held unprotected while the OCO is refused every 30 seconds. Never while a sell
        or an add is still unanswered (it may have sold or bought already), and a refused sell
        is said once in the note, never raised: the caller's own step still finishes."""
        unanswered = any(
            o["trade_ref"] == trade["ref"]
            and o["role"] in ("close", "add")
            and o["status"] == "placing"
            for o in self._store.pot_orders()
        )
        now = self.prices([trade["coin"]]).get(trade["coin"])
        if unanswered or now is None:
            return
        if now <= Decimal(trade["stop"]):
            past = "stop"
        elif Decimal(trade["target"]) > ZERO and now >= Decimal(trade["target"]):
            past = "target"
        else:
            return
        try:
            self._sell(trade, qty, fallback=False)
        except BinanceError as error:
            note = f"{PAST}{past}, but Binance refused the market sell: {error.message}"
            self._save_trade(self._trade(trade["ref"]), {"note": note})
            said = note + ". The desk tries again every 30 seconds."
            if not any(n["text"] == said for n in self._store.pot_notes(trade["ref"])):
                self._log(trade["ref"], said)  # once, not every 30 seconds
            return
        self._audit.record("pot", f"{trade['ref']}: price {plain(now)} past its {past}", "sold")
        self._log(
            trade["ref"],
            f"The price ({plain(now)}) was already past its {past}, so Binance refused the "
            "stop and target: sold at market instead.",
        )

    def _listed(self, order: dict[str, Any], sent: dict[str, Any]) -> dict[str, Any]:
        legs = [int(o["orderId"]) for o in sent.get("orders", [])]
        return self._save_order(
            order, {"list_id": int(sent["orderListId"]), "legs": json.dumps(legs), "status": "open"}
        )

    def _check_exit(self, order: dict[str, Any]) -> None:
        listed = self._binance.order_list(int(order["list_id"]))
        trade = self._trade(order["trade_ref"])
        self._rules_of(trade["coin"])  # read before any save, as in _follow
        if listed.get("listStatusType") == "REJECT" or listed.get("listOrderStatus") == "REJECT":
            self._save_order(order, {"status": "cancelled"})
            return
        if listed.get("listOrderStatus") != "ALL_DONE":
            return
        if self._legs_sold(order, trade):
            return
        self._save_order(order, {"status": "cancelled"})
        if trade["status"] == "open":  # the next sync puts them back
            self._save_trade(trade, {"note": "Its stop and target were cancelled on Binance."})

    def _legs_sold(self, order: dict[str, Any], trade: dict[str, Any]) -> bool:
        """A finished OCO's sale, in whole or in part, into the trade (only one leg can sell);
        False when neither leg sold anything."""
        symbol = f"{trade['coin']}{QUOTE}"
        for leg in json.loads(order["legs"] or "[]"):
            sent = self._binance.order(symbol, int(leg))
            _, executed = binance_state(sent)
            if executed <= ZERO:
                continue
            quote = Decimal(str(sent.get("cummulativeQuoteQty", "0")))
            fee, in_coin = self._fees(trade["coin"], int(leg))
            fee += in_coin * quote / executed
            self._save_order(
                order,
                {
                    "status": "filled",
                    "executed_qty": plain(executed),
                    "executed_quote": plain(quote),
                    "fee_usd": plain(fee),
                },
            )
            kind = "target" if str(sent.get("type")) in ("LIMIT_MAKER", "LIMIT") else "stop"
            self._close(trade, executed, quote, Decimal(trade["fees_usd"]) + fee, kind)
            return True
        return False

    def _refresh(self, order: dict[str, Any]) -> None:
        if order["kind"] == "oco":
            if order["list_id"] is None and not self._found_list(order):
                return
            self._check_exit(self._order(order["ref"]))
            return
        symbol = f"{self._trade(order['trade_ref'])['coin']}{QUOTE}"
        try:
            if order["status"] == "placing":
                sent = self._binance.order_by_client(symbol, order["ref"])
            else:
                sent = self._binance.order(symbol, int(order["order_id"]))
        except BinanceError as error:
            if order["status"] != "placing" or not missing(error):
                raise
            sent = {"orderId": 0, "status": "REJECTED"}  # Binance never took it
        self._follow(order, sent)

    def _found_list(self, order: dict[str, Any]) -> bool:
        """An exit sent without an answer, looked up on Binance by its id: found, it's live;
        not there, it was never placed."""
        try:
            sent = self._binance.order_list_by_client(order["ref"])
        except BinanceError as error:
            if not missing(error):
                raise
            self._save_order(order, {"status": "cancelled"})
            return False
        self._listed(order, sent)
        return True

    @locked
    def sync(self) -> None:
        """Every open order brought up to date; the api runs it every 30 seconds. A filled entry
        whose exits couldn't be placed is tried again."""
        for order in self._store.pot_orders():
            if order["status"] in ("placing", "open"):
                self._safely(order["ref"], lambda o=order: self._refresh(o))
        for trade in self._live():
            if trade["status"] != "open":
                continue
            live = self._live_exit(trade["ref"])
            if live is None:
                self._safely(trade["ref"], lambda t=trade: self._exit(t))
            elif live["kind"] == "stop" and live["status"] == "open":
                self._safely(trade["ref"], lambda t=trade: self._target_back(t))

    def _safely(self, ref: str, step: Callable[[], None]) -> None:
        try:
            step()
        except BinanceError:
            return  # tried again in 30 seconds
        except Exception as error:  # noqa: BLE001 - one bad row must not stop the others
            self._audit.record("pot", f"{ref}: sync failed", repr(error)[:200])

    def _live_exit(self, trade_ref: str) -> dict[str, Any] | None:
        return next(
            (
                o
                for o in self._store.pot_orders()
                if o["trade_ref"] == trade_ref
                and o["role"] == "exit"
                and o["status"] in ("placing", "open")
            ),
            None,
        )

    @locked
    def cancel(self, ref: object) -> dict[str, Any]:
        """An entry that hasn't filled; any part that did becomes an open trade with exits."""
        trade = self._trade(str(ref or ""))
        if trade["status"] not in ("placing", "waiting"):
            raise Refused("Only a trade waiting for its entry can be cancelled. Close it instead.")
        order = self._order(f"{trade['ref']}-E")
        symbol = f"{trade['coin']}{QUOTE}"
        if order["order_id"] is None:  # sent without an answer: looked up by its id first
            self._refresh(order)
            order = self._order(order["ref"])
        if order["order_id"] is not None and order["status"] in ("placing", "open"):
            with contextlib.suppress(BinanceError):  # filled meanwhile: its state says so
                self._binance.cancel(symbol, int(order["order_id"]))
            self._follow(order, self._binance.order(symbol, int(order["order_id"])))
        status = self._trade(trade["ref"])["status"]
        done = self._order(order["ref"])
        whole = Decimal(done["executed_qty"] or "0") >= Decimal(done["qty"] or "0") > ZERO
        self._audit.record("pot", f"{trade['ref']}: entry cancelled", status)
        self._log(
            trade["ref"],
            "Entry cancelled."
            if status == "cancelled"
            else "The entry had filled already, so nothing was cancelled; it's an open trade."
            if whole
            else "Entry cancelled; part had filled, so that part is an open trade with exits.",
        )
        return self.trade_view(self._trade(trade["ref"]), None)

    def _pull_exit(self, trade: dict[str, Any]) -> None:
        """Takes the stop and target off Binance; refuses if one has filled meanwhile."""
        live = self._live_exit(trade["ref"])
        if live is None:
            return
        if live["kind"] == "stop":
            self._pull_stop(trade, live)
            return
        if live["list_id"] is None and not self._found_list(live):
            return
        live = self._order(live["ref"])
        try:
            self._binance.cancel_list(f"{trade['coin']}{QUOTE}", int(live["list_id"]))
        except BinanceError:
            self._check_exit(live)
            if self._trade(trade["ref"])["status"] == "closed":
                raise Refused(
                    "Its stop or target filled a moment ago; the trade is closed."
                ) from None
            raise Refused(
                "Binance didn't take its stop and target off, so nothing changed. Try again."
            ) from None
        # A target can part-fill before the cancel: that sale is recorded, and the caller's copy
        # of the trade is stale, so it must not sell or re-protect the old amount (audit 4).
        trade = self._trade(trade["ref"])
        self._rules_of(trade["coin"])  # read before any save, as in _check_exit
        if self._legs_sold(live, trade):
            raise Refused(
                "Part of it sold on Binance a moment ago (its stop or target), so nothing "
                "changed. Look again."
            )
        self._save_order(live, {"status": "cancelled"})

    def _pull_stop(self, trade: dict[str, Any], live: dict[str, Any]) -> None:
        """Takes a stop placed alone off Binance. Refuses if it filled meanwhile, in whole or
        in part: the caller's copy of the trade is stale then, and must not be acted on."""
        symbol = f"{trade['coin']}{QUOTE}"
        moved = Refused("Its stop sold on Binance a moment ago, so nothing changed. Look again.")
        before = (trade["status"], trade["exit_qty"])
        if live["order_id"] is None:  # sent without an answer: looked up by its id first
            self._refresh(live)
            after = self._trade(trade["ref"])
            if (after["status"], after["exit_qty"]) != before:
                raise moved
            live = self._order(live["ref"])
            if live["status"] not in ("placing", "open"):
                return  # Binance never took it
            if live["order_id"] is None:
                raise Refused("Binance hasn't confirmed its stop yet, so nothing changed.")
        try:
            done = self._binance.cancel(symbol, int(live["order_id"]))
        except BinanceError:
            self._refresh(live)
            after = self._trade(trade["ref"])
            if (after["status"], after["exit_qty"]) != before:
                raise moved from None
            raise Refused(
                "Binance didn't take its stop off, so nothing changed. Try again."
            ) from None
        if Decimal(str(done.get("executedQty", "0"))) > ZERO:  # part sold before the cancel
            self._follow(live, done)
            raise moved
        self._save_order(live, {"status": "cancelled"})

    def _keeps_stop(self, trade: dict[str, Any], levels: dict[str, str]) -> None:
        """Refuses a change that would take the trade's exits off Binance and get none back:
        with these levels its stop is further under the price than Binance accepts."""
        if self._live_exit(trade["ref"]) is not None and self._fits(trade | levels) == "none":
            raise Refused(
                "Binance wouldn't take its stop back at this price (it is too far under it), "
                "so nothing changed: the stop stays on Binance as it is."
            )

    @locked
    def move_stop(self, body: dict[str, Any]) -> dict[str, Any]:
        """A new stop, only ever toward profit and under the price: the OCO is replaced."""
        trade = self._trade(str(body.get("ref") or ""))
        if trade["status"] != "open":
            raise Refused("Only an open trade's stop can move.")
        rules = self._rules_of(trade["coin"])
        stop = rules.price(number(body.get("stop"), "Stop"))
        was_held = is_held(trade)
        if not was_held and stop <= Decimal(trade["stop"]):
            raise Refused("A stop only moves toward profit, never further away.")
        now = self.prices([trade["coin"]]).get(trade["coin"])
        if now is None:
            raise Refused(f"There's no {trade['coin']}/{QUOTE} price on Binance to check it by.")
        if stop >= now:
            raise Refused(f"A stop at or above the price ({plain(now)}) would sell straight away.")
        self._keeps_stop(trade, {"stop": plain(stop)})
        if was_held and self._fits(trade | {"stop": plain(stop)}) == "none":
            raise Refused(
                "Binance holds no stop that far under the price. Set one closer, or keep "
                "holding it with none."
            )
        self._pull_exit(trade)
        old = "none" if was_held else trade["stop"]
        armed = {"exit_kind": None, "note": None} if was_held else {}
        trade = self._save_trade(trade, {"stop": plain(stop)} | armed)
        self._exit(trade)
        self._audit.record("pot", f"{trade['ref']}: stop moved", plain(stop))
        self._log(trade["ref"], f"Stop moved from {old} to {plain(stop)}.")
        return self.trade_view(self._trade(trade["ref"]), now)

    @locked
    def close(self, ref: object) -> dict[str, Any]:
        """Sells what the trade holds at market, its stop and target taken off first."""
        trade = self._trade(str(ref or ""))
        if trade["status"] != "open":
            raise Refused("Only an open trade can be closed at market.")
        self._tp_guard(trade)
        self._pull_exit(trade)
        qty = self._rules_of(trade["coin"]).amount(
            Decimal(trade["fill_qty"]) - Decimal(trade["exit_qty"])
        )
        self._sell(trade, qty)
        return self.trade_view(self._trade(trade["ref"]), None)

    @locked
    def hold(self, ref: object) -> dict[str, Any]:
        """An open trade held with no stop or target: its exits come off Binance and the desk
        stops watching them. It stays in the account and on the page; setting a stop later
        (the panel, or trading-agent's chat) puts its exits back."""
        trade = self._trade(str(ref or ""))
        if trade["status"] != "open":
            raise Refused("Only an open trade can be held.")
        if is_held(trade):
            return self.trade_view(trade, None)
        if any(
            o["trade_ref"] == trade["ref"] and o["status"] == "placing" and o["role"] != "exit"
            for o in self._store.pot_orders()
        ):
            raise Refused("An order for this trade is still unanswered. Try again in a minute.")
        self._pull_exit(trade)
        trade = self._trade(trade["ref"])
        said = "Held with no stop or target. Nothing sells it until you set a stop or close it."
        self._save_trade(trade, {"exit_kind": HELD, "note": said})
        self._audit.record("pot", f"{trade['ref']}: held", "no stop or target")
        self._log(
            trade["ref"],
            f"Held with no stop or target (they were {trade['stop']} and {trade['target']}): "
            "its exits are off Binance and the desk no longer watches them. It counts toward "
            "no risk limit until a stop is set.",
        )
        return self.trade_view(self._trade(trade["ref"]), None)

    @locked
    def keep(self, ref: object) -> dict[str, Any]:
        """An open trade's coins kept as a long-term holding: nothing is sold. Its exits come
        off Binance, the trade closes in the book at the price now, and that amount leaves the
        account (POT-OUT-n), since the coins are no longer the account's to trade or stop."""
        trade = self._trade(str(ref or ""))
        if trade["status"] != "open":
            raise Refused("Only an open trade can be kept as a holding.")
        self._tp_guard(trade)
        if any(
            o["trade_ref"] == trade["ref"] and o["status"] == "placing" and o["role"] != "exit"
            for o in self._store.pot_orders()
        ):
            raise Refused("An order for this trade is still unanswered. Try again in a minute.")
        now = self._price_now(trade["coin"])
        self._pull_exit(trade)
        trade = self._trade(trade["ref"])
        held = Decimal(trade["fill_qty"]) - Decimal(trade["exit_qty"])
        value = (held * now).quantize(Decimal("0.01"))
        kept = {
            "exit_qty": plain(Decimal(trade["exit_qty"]) + held),
            "exit_quote": plain(Decimal(trade["exit_quote"]) + value),
            "status": "closed",
            "exit_kind": "kept",
            "closed": self._now(),
            "note": None,
        }
        self._save_trade(trade, kept)
        out = self._store.add_pot_move("out", plain(value), self._now())
        closed = self._trade(trade["ref"])
        result = trade_result(closed, None)
        self._audit.record("pot", f"{trade['ref']}: kept as a holding", f"{out} {value} {QUOTE}")
        self._log(
            trade["ref"],
            f"Kept as a long-term holding, not sold: {plain(held)} {trade['coin']} left the "
            f"account at {plain(now)} ({out}, {value} {QUOTE}); booked "
            f"{_cents(result or ZERO)} {QUOTE} after fees. No stop or target any more.",
        )
        return self.trade_view(closed, now)

    def _price_now(self, coin: str) -> Decimal:
        now = self.prices([coin]).get(coin)
        if now is None:
            raise Refused(f"There's no {coin}/{QUOTE} price on Binance.")
        return now

    def _next_ref(self, trade_ref: str, tag: str) -> str:
        made = [o for o in self._store.pot_orders() if o["trade_ref"] == trade_ref]
        n = 1 + sum(1 for o in made if o["ref"].startswith(f"{trade_ref}-{tag}"))
        return f"{trade_ref}-{tag}{n}"

    @locked
    def enter_now(self, ref: object) -> dict[str, Any]:
        """A waiting entry bought now at market instead: re-sized at the price now so risk
        stays within the rule, and refused (nothing touched) if reward to risk no longer
        holds; then the limit is cancelled and a market buy goes in."""
        trade = self._trade(str(ref or ""))
        if trade["status"] != "waiting":
            raise Refused("Only a trade waiting for its entry can enter now.")
        coin = trade["coin"]
        now = self._price_now(coin)
        style = style_from(trade["setup"])
        n = self._numbers(
            {"coin": coin, "entry": plain(now), "stop": trade["stop"], "target": trade["target"]}
            | {"style": style},
            existing=True,
        )
        self._limits(n)
        shown = self._shown(n)
        self.check_rules(shown | {"style": style}, replacing=trade)  # every rule a new trade meets
        entry = self._order(f"{trade['ref']}-E")
        symbol = f"{coin}{QUOTE}"
        if entry["order_id"] is not None:
            with contextlib.suppress(BinanceError):  # filled meanwhile: its state says so
                self._binance.cancel(symbol, int(entry["order_id"]))
            sent = self._binance.order(symbol, int(entry["order_id"]))
            state, filled = binance_state(sent)
            if filled > ZERO:  # part or all filled at the limit: keep that
                self._follow(entry, sent)
                self._log(trade["ref"], "Enter now stopped: the limit had filled (or part).")
                return self.trade_view(self._trade(trade["ref"]), now)
            if state != "cancelled":  # the cancel didn't take: never buy twice
                self._follow(entry, sent)
                raise Refused("Binance still has the limit order live. Try again in a moment.")
        self._save_order(entry, {"status": "cancelled"})
        trade = self._save_trade(
            trade,
            {k: shown[k] for k in ("entry", "qty", "spend", "risk")} | {"status": "placing"},
        )
        self._log(
            trade["ref"],
            f"Enter now at market: about {shown['qty']} at {shown['entry']} instead of the limit "
            f"at {entry['price']}; {shown['risk']} {QUOTE} at risk, {shown['rr']} : 1.",
        )
        self._buy(trade, "entry", "E", Decimal(shown["spend"]), Decimal(shown["qty"]))
        return self.trade_view(self._trade(trade["ref"]), now)

    @locked
    def add(self, body: dict[str, Any]) -> dict[str, Any]:
        """More of an open trade at market: only while it's in profit (never averaging down),
        and only if the whole position's risk to its stop stays within the rule."""
        trade = self._trade(str(body.get("ref") or ""))
        if trade["status"] != "open":
            raise Refused("Only an open trade can be added to.")
        if Decimal(trade["fill_qty"]) <= ZERO:
            raise Refused("Nothing of this trade filled, so there's nothing to add to.")
        self._account_rules()
        coin, stop = trade["coin"], Decimal(trade["stop"])
        now = self._price_now(coin)
        held = Decimal(trade["fill_qty"]) - Decimal(trade["exit_qty"])
        cost = Decimal(trade["fill_quote"]) / Decimal(trade["fill_qty"])
        if now <= cost:
            raise Refused(
                f"Only a trade in profit can be added to: {coin} is at {plain(now)}, at or under "
                f"its average entry of {plain(round(cost, 8))}. No averaging down."
            )
        self._keeps_stop(trade, {})
        rules = self._rules_of(coin)
        # $10 asked rounds under $10 at Binance's step: one step more, as a ladder's limit does.
        qty = rung_qty(rules, now, number(body.get("usdc"), "The amount"))
        spend = qty * now
        if qty <= ZERO or spend < max(rules.min_notional, MIN_ORDER):
            raise Refused(smallest(rules.min_notional))
        total = held + qty
        average = (held * cost + spend) / total
        risk = max(total * (average - stop) + total * (average + stop) * FEE, ZERO)
        equity = self.equity()
        allowed = self.allowed(equity)
        if risk > allowed * Decimal("1.0001"):
            raise Refused(
                f"That would put ${risk:.2f} at risk to the stop at {trade['stop']}, over the "
                f"${allowed:.2f} a trade allows. Raise the stop first, or add less."
            )
        if total * now > equity * MAX_POSITION_PCT / HUNDRED:
            raise Refused("That would make the position more than 25% of the pot.")
        with contextlib.suppress(BinanceError):  # no cap for now: what's free on Binance
            free = self.free_quote()
            if spend > free:
                raise Refused(f"Binance has ${free:.2f} {QUOTE} free; that needs ${spend:.2f}.")
        mine = max(held * (cost - stop) + held * (cost + stop) * FEE, ZERO)
        if self.open_risk() - mine + risk > equity * MAX_OPEN_RISK_PCT / HUNDRED:
            raise Refused(
                f"That would put more than {MAX_OPEN_RISK_PCT}% of the pot at risk across open "
                "trades."
            )
        self._check_desk(spend)
        self._pull_exit(trade)
        self._buy(self._trade(trade["ref"]), "add", "A", spend, qty)
        return self.trade_view(self._trade(trade["ref"]), now)

    def _added(
        self,
        trade: dict[str, Any],
        executed: Decimal,
        in_coin: Decimal,
        quote: Decimal,
        fees: Decimal,
    ) -> None:
        if executed > ZERO:
            got = self._rules_of(trade["coin"]).amount(executed - in_coin)
            trade = self._save_trade(
                trade,
                {
                    "fill_qty": plain(Decimal(trade["fill_qty"]) + got),
                    "fill_quote": plain(Decimal(trade["fill_quote"]) + quote),
                    "fees_usd": plain(fees),
                },
            )
            average = Decimal(trade["fill_quote"]) / Decimal(trade["fill_qty"])
            self._log(
                trade["ref"],
                f"Added {plain(got)} at {plain(round(quote / executed, 8))}; now holds "
                f"{plain(Decimal(trade['fill_qty']) - Decimal(trade['exit_qty']))} at an "
                f"average of {plain(round(average, 8))}. R stays measured on the first risk.",
            )
        # A sync may have put the old size's stop back while the add went unanswered: take it
        # off, so the new stop and target cover everything held.
        self._pull_exit(trade)
        self._exit(self._trade(trade["ref"]))

    def _buy(
        self, trade: dict[str, Any], role: str, tag: str, spend: Decimal, qty: Decimal
    ) -> None:
        """A market buy for the trade (an entry now, or an add), tagged with its reference."""
        order: dict[str, Any] = {
            "ref": self._next_ref(trade["ref"], tag) if role == "add" else f"{trade['ref']}-EM",
            "trade_ref": trade["ref"],
            "role": role,
            "kind": "market",
            "side": "buy",
            "price": None,
            "stop": None,
            "qty": plain(qty),
            "spend": _cents(spend),
            "created": self._now(),
        }
        self._store.add_pot_order(order)
        saved = self._order(order["ref"])
        try:
            sent = self._binance.buy_market(f"{trade['coin']}{QUOTE}", spend, order["ref"])
        except BinanceError as error:
            if not unknown(error):  # refused: nothing bought
                self._save_order(saved, {"status": "cancelled"})
                if role == "add":
                    self._exit(self._trade(trade["ref"]))
                else:
                    self._save_trade(
                        self._trade(trade["ref"]), {"status": "cancelled", "note": error.message}
                    )
            raise
        self._follow(saved, sent)

    @locked
    def reduce(self, body: dict[str, Any]) -> dict[str, Any]:
        """Part of an open trade sold at market; its stop and target go back on the rest."""
        trade = self._trade(str(body.get("ref") or ""))
        if trade["status"] != "open":
            raise Refused("Only an open trade can be reduced.")
        self._tp_guard(trade)
        pct = number(body.get("pct"), "The share to sell")
        if pct >= HUNDRED:
            raise Refused("To sell it all, close it at market.")
        rules = self._rules_of(trade["coin"])
        held = Decimal(trade["fill_qty"]) - Decimal(trade["exit_qty"])
        qty = rules.amount(held * pct / HUNDRED)
        now = self._price_now(trade["coin"])
        kept_at_stop = (held - qty) * Decimal(trade["stop"])  # as _rest measures what's kept
        if qty * now < rules.min_notional or kept_at_stop < rules.min_notional:
            raise Refused(
                f"Both the part sold and the part kept must be over Binance's smallest order of "
                f"{rules.min_notional}. Close it at market instead."
            )
        self._pull_exit(trade)
        self._sell(self._trade(trade["ref"]), qty)
        after = self._trade(trade["ref"])
        if after["status"] == "open" and not self._live_exit(after["ref"]):
            self._exit(after)
        return self.trade_view(self._trade(trade["ref"]), now)

    @locked
    def move_target(self, body: dict[str, Any]) -> dict[str, Any]:
        """A new target above the price: the OCO is replaced."""
        trade = self._trade(str(body.get("ref") or ""))
        if trade["status"] not in ("open", "waiting"):
            raise Refused("Only a live trade's target can move.")
        target = self._rules_of(trade["coin"]).price(number(body.get("target"), "Target"))
        now = self._price_now(trade["coin"])
        if target <= now or target <= Decimal(trade["entry"]):
            raise Refused(f"A target goes above the price ({plain(now)}) and the entry.")
        if trade["status"] == "waiting":  # not filled yet: the style's reward to risk still holds
            n = self._numbers(
                {"coin": trade["coin"], "entry": trade["entry"], "stop": trade["stop"]}
                | {"target": plain(target)},
                existing=True,
            )
            style = screener.STYLES.get(str(style_from(trade["setup"]) or ""))
            if style is not None:
                n["minRr"] = Decimal(str(style.min_rr))
            self._rr_rule(n)
        old = trade["target"]
        if trade["status"] == "open":
            self._keeps_stop(trade, {"target": plain(target)})
            self._pull_exit(trade)
        trade = self._save_trade(trade, {"target": plain(target)})
        if trade["status"] == "open":
            self._exit(trade)
        self._audit.record("pot", f"{trade['ref']}: target moved", plain(target))
        self._log(trade["ref"], f"Target moved from {old} to {plain(target)}.")
        return self.trade_view(self._trade(trade["ref"]), now)

    def _sell(self, trade: dict[str, Any], qty: Decimal, *, fallback: bool = True) -> None:
        """A market sell of `qty` for the trade, its exits already taken off. `fallback` off:
        a refused sell puts the exits back without selling again (no loop with _through)."""
        closes = [o for o in self._store.pot_orders() if o["trade_ref"] == trade["ref"]]
        n = 1 + sum(1 for o in closes if o["role"] == "close")
        order: dict[str, Any] = {
            "ref": f"{trade['ref']}-M{n}",
            "trade_ref": trade["ref"],
            "role": "close",
            "kind": "market",
            "side": "sell",
            "price": None,
            "stop": None,
            "qty": plain(qty),
            "spend": None,
            "created": self._now(),
        }
        self._store.add_pot_order(order)
        saved = self._order(order["ref"])
        try:
            sent = self._binance.sell_market(f"{trade['coin']}{QUOTE}", qty, order["ref"])
        except BinanceError as error:
            if not unknown(error):  # refused: nothing sold, so the exits go back on
                self._save_order(saved, {"status": "cancelled"})
                self._exit(self._trade(trade["ref"]), fallback=fallback)
            raise
        self._follow(saved, sent)

    # Proposals from trading-agent: kept until placed or dismissed.

    def proposals(self) -> list[dict[str, Any]]:
        raw = self._store.setting(PROPOSALS_KEY, "")
        return list(json.loads(raw)) if raw else []

    def set_proposals(self, found: list[dict[str, Any]]) -> None:
        self._store.set_setting(PROPOSALS_KEY, json.dumps(found))

    def _drop_proposal(self, proposal_id: str) -> None:
        if proposal_id:
            self.set_proposals([p for p in self.proposals() if p["id"] != proposal_id])

    def dismiss(self, body: dict[str, Any]) -> dict[str, Any]:
        self._drop_proposal(str(body.get("id") or ""))
        return self.view()

    def last_scan(self) -> dict[str, Any] | None:
        raw = self._store.setting(SCAN_KEY, "")
        return json.loads(raw) if raw else None

    def set_last_scan(
        self,
        line: str,
        styles: list[dict[str, Any]] | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        """The scan's line, a card and report per style, and the gates and cost
        (pot_agent.scan)."""
        last: dict[str, Any] = {"at": self._now(), "line": line[:600]} | (extra or {})
        if styles is not None:
            last["styles"] = styles
        self._store.set_setting(SCAN_KEY, json.dumps(last))

    # What the page shows.

    def trade_view(self, row: dict[str, Any], now: Decimal | None) -> dict[str, Any]:
        result = trade_result(row, now)
        r = r_of(row, result)
        fill_qty = Decimal(row["fill_qty"])
        exit_qty = Decimal(row["exit_qty"])
        orders = [
            o
            for o in self._store.pot_orders()
            if o["trade_ref"] == row["ref"] and o["role"] != "tp"
        ]
        refused = [o["ref"] for o in orders if _never_placed(o)]
        hidden = set(refused[:-1])  # the latest refusal says it all
        orders = [o for o in orders if o["ref"] not in hidden]
        live = next((o for o in orders if o["role"] == "exit" and o["status"] == "open"), None)
        return {
            "exits": None
            if row["status"] != "open"
            else "held"
            if is_held(row)
            else "desk"
            if live is None and str(row["note"] or "").startswith(WATCHED)
            else "none"
            if live is None
            else "stop"
            if live["kind"] == "stop"
            else "both",
            "ref": row["ref"],
            "coin": row["coin"],
            "setup": row["setup"],
            "regime": row["regime"],
            "reason": row["reason"],
            "status": row["status"],
            "entry": row["entry"],
            "stop": row["stop"],
            "target": row["target"],
            "qty": row["fill_qty"] if fill_qty else row["qty"],
            "spend": row["fill_quote"] if fill_qty else row["spend"],
            "risk": row["risk"],
            "fillPrice": plain(round(Decimal(row["fill_quote"]) / fill_qty, 8))
            if fill_qty
            else None,
            "now": plain(now) if now is not None else None,
            "exitPrice": plain(round(Decimal(row["exit_quote"]) / exit_qty, 8))
            if exit_qty
            else None,
            "exitKind": row["exit_kind"],
            "result": _cents(result) if result is not None else None,
            "r": plain(r) if r is not None else None,
            "fees": plain(Decimal(row["fees_usd"]).quantize(Decimal("0.0001"))),
            "rulesKept": bool(row["rules_kept"]),
            "created": row["created"],
            "filled": row["filled"],
            "closed": row["closed"],
            "note": row["note"],
            "style": style_from(row["setup"]),
            "notes": self._store.pot_notes(row["ref"]),
            "orders": [order_view(o) for o in orders],
        }

    def _stats(self, rows: list[dict[str, Any]], put_in: Decimal) -> dict[str, Any]:
        def one(row: dict[str, Any]) -> pot_stats.Closed:
            result = trade_result(row, None) or ZERO
            style = style_from(row["setup"])
            return pot_stats.Closed(
                closed=row["closed"] or 0,
                setup=row["setup"],
                style=screener.STYLES[style].name if style else None,
                result=result,
                r=r_of(row, result) or ZERO,
            )

        closed = (one(r) for r in rows if r["status"] == "closed")
        return pot_stats.stats(closed, put_in, JUDGE_AFTER)

    def _log(self, ref: str, text: str, kind: str = "desk") -> None:
        self._store.add_pot_note(ref, kind, text[:400], self._now())

    def note(self, body: dict[str, Any]) -> dict[str, Any]:
        """Your own note on a trade, kept in its log beside the desk's."""
        trade = self._trade(str(body.get("ref") or ""))
        text = " ".join(str(body.get("text") or "").split())[:400]
        if not text:
            raise Refused("Type the note first.")
        self._log(trade["ref"], text, "you")
        return self.trade_view(self._trade(trade["ref"]), None)

    def view(self) -> dict[str, Any]:
        found = self.book_view()
        try:
            found["backing"] = self.backing()
        except BinanceError:
            found["backing"] = None
        return found

    def book_view(self) -> dict[str, Any]:
        rows = self._store.pot_trades()
        live = [r["coin"] for r in rows if r["status"] in LIVE]
        error = None
        try:
            prices = self.prices(sorted(set(live))) if live else {}
        except BinanceError as e:
            prices, error = {}, e.message
        trades = [self.trade_view(r, prices.get(r["coin"])) for r in rows]
        put_in = self._put_in()
        open_result = sum(
            (Decimal(t["result"]) for t in trades if t["status"] == "open" and t["result"]), ZERO
        )
        value = self.equity() + open_result
        return {
            "quote": QUOTE,
            "config": self.config(),
            "allowedRisk": _cents(self.allowed(self.equity())),
            "putIn": plain(put_in),
            "value": _cents(value),
            "result": _cents(value - put_in),
            "resultPct": plain(((value - put_in) / put_in * HUNDRED).quantize(Decimal("0.01")))
            if put_in > 0
            else None,
            "cash": _cents(self.cash()),
            "openRisk": _cents(self.open_risk()),
            "fees": _cents(sum((Decimal(r["fees_usd"]) for r in rows), ZERO)),
            "monthResult": _cents(self.month_result()),
            "monthLimit": _cents(put_in * MONTH_LOSS_PCT / HUNDRED),
            "openRiskLimit": _cents(self.equity() * MAX_OPEN_RISK_PCT / HUNDRED),
            "regime": self.regime_view(),
            "nextScan": next_scan(self._now()),
            "lastScan": self.last_scan(),
            # The scheduler runs the 11:15am scan while it's on (api.schedule).
            "scansOnItsOwn": self._store.setting("schedule_on", "1") == "1",
            "proposals": self.proposals(),
            "trades": trades,
            "takeProfits": self._take_profits(),
            "moves": [
                {"ref": m["ref"], "kind": m["kind"], "usdc": m["usdc"], "created": m["created"]}
                for m in self._store.pot_moves()
            ],
            "stats": self._stats(rows, put_in),
            "coins": self.coins(),
            "priceError": error,
        }

    def _take_profits(self) -> list[dict[str, Any]]:
        from api.pot_tp import TakeProfit  # noqa: PLC0415 - pot_tp imports this module

        return TakeProfit(self).views()

    # Check against Binance: every order the pot sent, found there by its tag.

    def check(self) -> dict[str, Any]:
        mine: dict[str, str] = {}
        coins: set[str] = set()
        trades = {r["ref"]: r for r in self._store.pot_trades()}
        for o in self._store.pot_orders():
            if o["order_id"] is None and o["list_id"] is None:
                continue  # never reached Binance
            coins.add(trades[o["trade_ref"]]["coin"])
            if o["kind"] == "oco":
                mine[f"{o['ref']}T"] = mine[f"{o['ref']}S"] = "exit"
            else:
                mine[o["ref"]] = o["status"]
        theirs: dict[str, str] = {}
        for coin in sorted(coins):
            for order in self._binance.all_orders(f"{coin}{QUOTE}"):
                tag = str(order.get("clientOrderId", ""))
                if tag.startswith(TAG):
                    theirs[tag] = binance_state(order)[0]
        differ = [
            {"ref": tag, "desk": state, "binance": theirs[tag]}
            for tag, state in mine.items()
            if tag in theirs and state != "exit" and state != theirs[tag]
        ]
        return {
            "matched": sum(1 for tag in mine if tag in theirs),
            "missing": sorted(tag for tag in mine if tag not in theirs),
            "unknown": sorted(tag for tag in theirs if tag not in mine),
            "differ": differ,
        }
