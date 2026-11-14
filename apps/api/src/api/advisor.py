"""The facts the AI plan is built on (decision 46), gathered and worked out in code: the market
on three timeframes, swing levels, the owner's position and rules, the what-if of a trade,
Fear & Greed, funding and open interest where Binance has them, and the last signal. Only
these numbers reach the model: never keys, account or order ids."""

from decimal import Decimal
from typing import Any

import httpx

from api.binance import Binance, BinanceError, plain
from api.indicators import Candle
from api.market import QUOTE, candles
from api.plan import Position, Rules, checks, frame, levels, position, what_if
from api.store import Store

ZERO = Decimal(0)
STABLES = ("USDC", "USDT", "FDUSD")
FUTURES_URL = "https://fapi.binance.com"
OK = 200
RULE_KEYS = {
    "max_coin_pct": "risk_max_coin_pct",
    "trade_budget_aud": "risk_trade_budget_aud",
    "max_loss_pct": "risk_max_loss_pct",
}
RULE_RANGES = {
    "max_coin_pct": (Decimal(1), Decimal(100)),
    "trade_budget_aud": (Decimal(10), Decimal(1_000_000)),
    "max_loss_pct": (Decimal(1), Decimal(100)),
}


def rules_of(store: Store) -> Rules:
    base = Rules()
    return Rules(
        **{
            field: Decimal(store.setting(key, str(getattr(base, field))))
            for field, key in RULE_KEYS.items()
        }
    )


def set_rules(store: Store, body: dict[str, Any]) -> dict[str, str]:
    """The owner's risk rules, each within a sensible range."""
    from api.trading import Refused  # noqa: PLC0415 - avoids a cycle through trading

    names = {
        "max_coin_pct": "maxCoinPct",
        "trade_budget_aud": "tradeBudgetAud",
        "max_loss_pct": "maxLossPct",
    }
    for field, key in names.items():
        try:
            value = Decimal(str(body.get(key, "")).strip())
        except ArithmeticError as error:
            raise Refused("Each rule must be a number.") from error
        low, high = RULE_RANGES[field]
        if not value.is_finite() or not low <= value <= high:
            raise Refused(f"{key} must be from {low} to {high}.")
        store.set_setting(RULE_KEYS[field], format(value.normalize(), "f"))
    return rules_of(store).view()


def futures(client: httpx.Client, coin: str) -> dict[str, str] | None:
    """Funding and open interest on Binance's USDT perpetual, if there is one; public data."""
    symbol = f"{coin}USDT"
    try:
        index = client.get(f"{FUTURES_URL}/fapi/v1/premiumIndex", params={"symbol": symbol})
        interest = client.get(f"{FUTURES_URL}/fapi/v1/openInterest", params={"symbol": symbol})
        if index.status_code != OK or interest.status_code != OK:
            return None
        rate = Decimal(str(index.json()["lastFundingRate"])) * 100
        mark = Decimal(str(index.json()["markPrice"]))
        held = Decimal(str(interest.json()["openInterest"]))
    except (httpx.HTTPError, ValueError, KeyError, TypeError, ArithmeticError):
        return None
    return {
        "fundingPct": plain(rate.quantize(Decimal("0.0001"))),
        "openInterestUsd": plain((held * mark).quantize(Decimal(1))),
    }


def _p(value: Decimal | None, places: str = "0.00000001") -> str | None:
    return plain(value.quantize(Decimal(places))) if value is not None else None


def _frame_view(bars: list[Candle]) -> dict[str, Any]:
    found = frame(bars)
    return {k: (_p(v, "0.01") if isinstance(v, Decimal) else v) for k, v in found.items()}


def position_view(pos: Position) -> dict[str, Any]:
    return {
        "held": pos.held(),
        "qty": plain(pos.qty),
        "avgCost": _p(pos.avg_cost),
        "invested": _p(pos.invested, "0.01"),
        "value": _p(pos.value, "0.01"),
        "pnl": _p(pos.pnl, "0.01"),
        "pnlPct": _p(pos.pnl_pct, "0.1"),
        "weightPct": _p(pos.weight_pct, "0.1"),
    }


def what_if_view(found: dict[str, Any]) -> dict[str, Any]:
    return {
        "amount": _p(found["amount"], "0.01"),
        "price": plain(found["price"]),
        "newAvg": _p(found["newAvg"]),
        "breakEvenBefore": _p(found["breakEvenBefore"], "0.1"),
        "breakEvenAfter": _p(found["breakEvenAfter"], "0.1"),
        "weightBefore": _p(found["weightBefore"], "0.1"),
        "weightAfter": _p(found["weightAfter"], "0.1"),
        "cashLeft": _p(found["cashLeft"], "0.01"),
    }


def gather(
    binance: Binance,
    store: Store,
    portfolio: dict[str, Any],
    coin: str,
    extras: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Every number the plan rests on, for one coin, worked out here."""
    symbol = f"{coin}{QUOTE}"
    ticker = binance.tickers([symbol])[symbol]
    price = Decimal(ticker["lastPrice"])
    four = candles(binance.klines(symbol, "4h", 250))
    daily = candles(binance.klines(symbol, "1d", 250))
    weekly = candles(binance.klines(symbol, "1w", 150))
    holdings: list[dict[str, Any]] = portfolio["holdings"]
    total = Decimal(portfolio["total"]["value"])
    cash = sum(
        (
            Decimal(h["amount"])
            for h in holdings
            if h["asset"] in STABLES and h["source"] == "Binance"
        ),
        ZERO,
    )
    rates: dict[str, str] = portfolio["total"].get("rates") or {}
    aud = Decimal(rates.get("AUD", "1.5"))
    rules = rules_of(store)
    pos = position(holdings, coin, total)
    budget = rules.trade_budget_aud / aud
    trade = min(budget, cash) if cash > ZERO else budget
    found = what_if(pos, price, trade, total, cash)
    ruled = checks(pos, rules, found["weightAfter"])
    month_volume = [c.volume for c in daily[-31:-1]]
    average = sum(month_volume, ZERO) / len(month_volume) if month_volume else ZERO
    today = Decimal(ticker.get("quoteVolume") or "0")
    orders = [  # side, price and amount only: no order ids reach the model
        {"side": str(o["side"]).lower(), "price": str(o["price"]), "amount": str(o["amount"])}
        for o in portfolio.get("openOrders", [])
        if str(o.get("pair", "")).startswith(f"{coin}/")
    ]
    return {
        "coin": coin,
        "symbol": symbol,
        "pair": f"{coin}/{QUOTE}",
        "quote": QUOTE,
        "price": plain(price),
        "change24h": ticker["priceChangePercent"],
        "volume24h": plain(today),
        "volumeVsMonthPct": _p((today / average - 1) * 100, "0.1") if average > ZERO else None,
        "frames": {"4h": _frame_view(four), "1D": _frame_view(daily), "1W": _frame_view(weekly)},
        "levels": [
            {
                "id": lv["id"],
                "price": plain(lv["price"]),
                "source": lv["source"],
                "awayPct": _p(lv["away"], "0.1"),
            }
            for lv in levels(daily, weekly, price)
        ],
        "position": position_view(pos),
        "cash": _p(cash, "0.01"),
        "total": _p(total, "0.01"),
        "audPerUsd": plain(aud),
        "openOrders": orders,
        "rules": rules.view(),
        "whatIf": what_if_view(found),
        "checks": ruled,
        **(extras or {}),
    }


def check_alerts(binance: Binance, store: Store, audit: Any, now_ms: int) -> int:
    """Marks each waiting alert whose price has been crossed; how many were."""
    waiting = [a for a in store.alerts() if a["triggered"] is None]
    if not waiting:
        return 0
    symbols = sorted({f"{a['coin']}{QUOTE}" for a in waiting})
    listed = binance.symbols()
    prices = {
        s: Decimal(t["lastPrice"])
        for s, t in binance.tickers([s for s in symbols if s in listed]).items()
    }
    hit = 0
    for a in waiting:
        now = prices.get(f"{a['coin']}{QUOTE}")
        if now is None:
            continue
        at = Decimal(a["price"])
        if (a["direction"] == "above" and now >= at) or (a["direction"] == "below" and now <= at):
            store.trigger_alert(int(a["id"]), now_ms)
            audit.record(
                "alert", f"Alert on {a['coin']}", f"{a['direction']} {a['price']}: now {now}"
            )
            hit += 1
    return hit


def history_candles(binance: Binance, coin: str) -> list[Candle]:
    """About 41 days of hourly candles, to score past signals against."""
    try:
        return candles(binance.klines(f"{coin}{QUOTE}", "1h", 1000))
    except BinanceError:
        return []
