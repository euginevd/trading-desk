"""The facts behind the AI plan (decision 46), all worked out here, deterministically: the
owner's position in a coin, swing support and resistance from daily and weekly candles, the
what-if of adding, the risk rules' checks and the track record. The model gets these numbers
and only chooses and explains; it never does arithmetic."""

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from api.indicators import Candle, rsi, sma

ZERO = Decimal(0)
HUNDRED = Decimal(100)
SWING = 2  # a weekly swing high or low beats the two candles either side
DAILY_SWING = 3  # a daily one, the three either side
MIN_AWAY = Decimal("0.5")  # % : a level this close to the price isn't one to plan around
CLUSTER = Decimal("1.5")  # % : levels this close together count as one
NEAR = 3  # levels kept each side of the price
FLAT = Decimal(3)  # a Hold or Wait was right if the price moved less than 3% either way
TRACK_HOURS = 24
TRACK_LAST = 20


@dataclass(frozen=True)
class Rules:
    """The owner's risk rules, with the defaults asked for."""

    max_coin_pct: Decimal = Decimal(25)
    trade_budget_aud: Decimal = Decimal(500)
    max_loss_pct: Decimal = Decimal(20)

    def view(self) -> dict[str, str]:
        return {
            "maxCoinPct": str(self.max_coin_pct),
            "tradeBudgetAud": str(self.trade_budget_aud),
            "maxLossPct": str(self.max_loss_pct),
        }


@dataclass(frozen=True)
class Position:
    qty: Decimal
    avg_cost: Decimal | None
    invested: Decimal
    value: Decimal
    pnl: Decimal | None
    pnl_pct: Decimal | None
    weight_pct: Decimal

    def held(self) -> bool:
        return self.qty > ZERO


def position(holdings: list[dict[str, Any]], coin: str, total: Decimal) -> Position:
    """One coin across Binance and the wallet: amount, average cost over what has a cost,
    invested, value, unrealised PnL and its share of the whole portfolio."""
    rows = [h for h in holdings if h["asset"] == coin]
    qty = sum((Decimal(h["amount"]) for h in rows), ZERO)
    value = sum((Decimal(h["value"] or "0") for h in rows), ZERO)
    costed = [h for h in rows if h.get("averageCost") and h.get("covered")]
    covered = sum((Decimal(h["covered"]) for h in costed), ZERO)
    invested = sum((Decimal(h["covered"]) * Decimal(h["averageCost"]) for h in costed), ZERO)
    avg = invested / covered if covered > ZERO else None
    pnl = sum((Decimal(h["profit"]) for h in rows if h.get("profit") is not None), ZERO)
    has_pnl = any(h.get("profit") is not None for h in rows)
    return Position(
        qty=qty,
        avg_cost=avg,
        invested=invested,
        value=value,
        pnl=pnl if has_pnl else None,
        pnl_pct=pnl / invested * HUNDRED if has_pnl and invested > ZERO else None,
        weight_pct=value / total * HUNDRED if total > ZERO else ZERO,
    )


def break_even_pct(avg: Decimal | None, price: Decimal) -> Decimal | None:
    """How far the price must rise to get back to the average cost; 0 if already above."""
    if avg is None or price <= ZERO:
        return None
    return max(ZERO, (avg / price - 1) * HUNDRED)


def what_if(
    pos: Position, price: Decimal, amount: Decimal, total: Decimal, cash: Decimal
) -> dict[str, Any]:
    """Adding `amount` (in the quote) at `price`: the new average cost, the rise needed to
    break even before and after, the new weight, and the cash left. Total value doesn't
    change: cash becomes coin."""
    bought = amount / price if price > ZERO else ZERO
    qty = pos.qty + bought
    base = pos.avg_cost * pos.qty if pos.avg_cost is not None else pos.value
    new_avg = (base + amount) / qty if qty > ZERO else None
    return {
        "amount": amount,
        "price": price,
        "newAvg": new_avg,
        "breakEvenBefore": break_even_pct(pos.avg_cost, price),
        "breakEvenAfter": break_even_pct(new_avg, price),
        "weightBefore": pos.weight_pct,
        "weightAfter": (pos.value + amount) / total * HUNDRED if total > ZERO else ZERO,
        "cashLeft": cash - amount,
    }


def checks(pos: Position, rules: Rules, after_weight: Decimal) -> dict[str, Any]:
    """What the risk rules allow, in plain words for the model and the page."""
    over_cap = pos.weight_pct >= rules.max_coin_pct
    would_exceed = after_weight > rules.max_coin_pct
    past_loss = pos.pnl_pct is not None and -pos.pnl_pct >= rules.max_loss_pct
    notes: list[str] = []
    if over_cap:
        notes.append(
            f"At {pos.weight_pct:.0f}% of the portfolio, over the {rules.max_coin_pct:.0f}% "
            "cap a coin: no adding."
        )
    elif would_exceed:
        notes.append(
            f"Adding a full trade would take it to {after_weight:.0f}%, over the "
            f"{rules.max_coin_pct:.0f}% cap a coin: no adding."
        )
    if past_loss and pos.pnl_pct is not None:
        notes.append(
            f"Down {-pos.pnl_pct:.0f}%, past the {rules.max_loss_pct:.0f}% max loss a position."
        )
    return {"canAdd": not (over_cap or would_exceed), "pastMaxLoss": past_loss, "notes": notes}


def _swings(bars: list[Candle], high: bool, span: int = SWING) -> list[Decimal]:
    found: list[Decimal] = []
    for i in range(span, len(bars) - span):
        here = bars[i].high if high else bars[i].low
        side = bars[i - span : i] + bars[i + 1 : i + 1 + span]
        if all((here > b.high) if high else (here < b.low) for b in side):
            found.append(here)
    return found


def _pick(found: list[tuple[Decimal, str]], price: Decimal) -> list[tuple[Decimal, str]]:
    """Nearest first, skipping any too close to the price or to a level already picked."""
    chosen: list[tuple[Decimal, str]] = []
    for value, source in sorted(found, key=lambda t: abs(t[0] - price)):
        if abs(value / price - 1) * HUNDRED < MIN_AWAY:
            continue
        if any(abs(value / v - 1) * HUNDRED < CLUSTER for v, _ in chosen):
            continue
        chosen.append((value, source))
        if len(chosen) == NEAR:
            break
    return chosen


def levels(daily: list[Candle], weekly: list[Candle], price: Decimal) -> list[dict[str, Any]]:
    """Support under the price and resistance over it, from daily and weekly swing lows and
    highs (a high broken below the price is support now, and the other way round): the three
    nearest each side that stand apart, as S1, S2, S3 and R1, R2, R3."""
    swings = [(v, "weekly swing low") for v in _swings(weekly, high=False)]
    swings += [(v, "weekly swing high") for v in _swings(weekly, high=True)]
    swings += [(v, "daily swing low") for v in _swings(daily, high=False, span=DAILY_SWING)]
    swings += [(v, "daily swing high") for v in _swings(daily, high=True, span=DAILY_SWING)]
    below = _pick([t for t in swings if t[0] < price], price)
    above = _pick([t for t in swings if t[0] > price], price)
    found: list[dict[str, Any]] = []
    for prefix, side in (("S", below), ("R", above)):
        for n, (value, source) in enumerate(side, start=1):
            away = (value / price - 1) * HUNDRED
            found.append({"id": f"{prefix}{n}", "price": value, "source": source, "away": away})
    return found


def frame(bars: list[Candle]) -> dict[str, Any]:
    """One timeframe's RSI, 20, 50 and 200 averages, and its trend."""
    closes = [c.close for c in bars]
    last = closes[-1] if closes else None
    ma20, ma50, ma200 = sma(closes, 20), sma(closes, 50), sma(closes, 200)
    if last is None or ma20 is None or ma50 is None:
        trend = "Not enough data"
    elif last > ma20 > ma50:
        trend = "Up"
    elif last < ma20 < ma50:
        trend = "Down"
    else:
        trend = "Sideways"
    return {"rsi": rsi(closes), "ma20": ma20, "ma50": ma50, "ma200": ma200, "trend": trend}


def correct(action: str, change_pct: Decimal) -> bool:
    """Was a signal right a day later? Buy or Add if the price rose, Sell or Trim if it fell,
    Hold or Wait if it moved less than 3% either way."""
    if action in ("Buy", "Add"):
        return change_pct > ZERO
    if action in ("Sell", "Trim"):
        return change_pct < ZERO
    return abs(change_pct) < FLAT


def track(history: list[dict[str, Any]], hourly: list[Candle], now_ms: int) -> dict[str, int]:
    """The last 20 signals that are a day old, scored against the price a day later."""
    due = [h for h in history if now_ms - int(h["ran"]) >= TRACK_HOURS * 3_600_000]
    scored = right = 0
    for h in due[-TRACK_LAST:]:
        later = int(h["ran"]) + TRACK_HOURS * 3_600_000
        after = next((c.close for c in hourly if c.time >= later), None)
        if after is None or Decimal(h["price"]) <= ZERO:
            continue
        scored += 1
        right += correct(str(h["action"]), (after / Decimal(h["price"]) - 1) * HUNDRED)
    return {"scored": scored, "correct": right, "hours": TRACK_HOURS}
