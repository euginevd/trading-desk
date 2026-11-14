"""DCA bots (decision 37): when a candle closes below the lower Bollinger Band, a base order and
a ladder of DCA orders go to Binance as limit buys; a limit sell at take profit over the average
follows the fills. A bot is created switched off; switching it on is the owner's confirm for the
orders it places, inside the per-order and daily limits and the kill switch (spec 10)."""

import json
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, replace
from decimal import Decimal
from typing import Any

from api.audit import Audit
from api.binance import Binance, BinanceError, Filters, plain
from api.indicators import Candle, bollinger
from api.locks import locked
from api.market import QUOTE, candles
from api.portfolio import pair
from api.store import Store
from api.trading import Refused, Trading, money

ZERO = Decimal(0)
HUNDRED = Decimal(100)
FEE = Decimal("0.001")  # Binance spot's standard fee, for the backtest
TIMEFRAMES = {"15m": 900_000, "1h": 3_600_000, "4h": 14_400_000}
HISTORY = 1000  # candles for the backtest: Binance's most in one call
CHART = 120  # candles the wizard's chart shows
DONE = ("CANCELED", "EXPIRED", "REJECTED", "EXPIRED_IN_MATCH")
TP_RUNG = 100  # take-profit sells are numbered from here, after the buys
MAX_BOTS = 10
MAX_TRADES = 30
STOP_RUNG = 200  # a stop-loss or close-at-market sale
MAX_DROP = Decimal(95)
MAX_DEALS = 5
SUGGEST_MS = 30 * 86_400_000  # a preset's backtest: the last 30 days
SUGGEST_TIMEFRAMES = ("1h", "4h")
ONE_CENT = Decimal("0.01")
SUGGEST_GRID = [
    (Decimal(d), n, Decimal(m), Decimal(t))
    for d in ("1", "1.5", "2", "3")
    for n in (3, 5, 8)
    for m in ("1", "1.5")
    for t in ("1", "1.5", "2", "3")
]
EIGHT = Decimal("1e-8")
CENT = Decimal("0.01")


@dataclass(frozen=True)
class Config:
    """A bot's settings, in the industry's terms."""

    timeframe: str = "1h"
    bb_length: int = 20
    bb_deviation: Decimal = Decimal(2)
    base_order: Decimal = Decimal(25)
    dca_order: Decimal = Decimal(20)
    deviation: Decimal = Decimal(2)  # % between orders, of the base order's price
    max_dca_orders: int = 5
    size_multiplier: Decimal = Decimal(1)  # DCA size multiplier
    deviation_multiplier: Decimal = Decimal(1)
    take_profit: Decimal = Decimal("1.5")  # % over the average price
    max_deals: int = 1  # simultaneous deals
    entry_price: Decimal | None = None  # set: a one-off smart trade, entered at this price
    tp_on: bool = True
    stop_loss: Decimal | None = None  # a price; the deal sells at market under it

    def is_trade(self) -> bool:
        return self.entry_price is not None

    def budget(self) -> Decimal:
        return self.base_order + sum(
            (self.dca_order * self.size_multiplier**k for k in range(self.max_dca_orders)), ZERO
        )

    def drops(self) -> list[Decimal]:
        """Each order's distance below the base order, in %: 0 for the base order."""
        found, drop = [ZERO], ZERO
        for k in range(self.max_dca_orders):
            drop += self.deviation * self.deviation_multiplier**k
            found.append(drop)
        return found

    def sizes(self) -> list[Decimal]:
        return [
            self.base_order,
            *(self.dca_order * self.size_multiplier**k for k in range(self.max_dca_orders)),
        ]

    def view(self) -> dict[str, Any]:
        return {
            "timeframe": self.timeframe,
            "bbLength": self.bb_length,
            "bbDeviation": plain(self.bb_deviation),
            "baseOrder": plain(self.base_order),
            "dcaOrder": plain(self.dca_order),
            "deviation": plain(self.deviation),
            "maxDcaOrders": self.max_dca_orders,
            "sizeMultiplier": plain(self.size_multiplier),
            "deviationMultiplier": plain(self.deviation_multiplier),
            "takeProfit": plain(self.take_profit),
            "maxDeals": self.max_deals,
            "entryPrice": plain(self.entry_price) if self.entry_price is not None else None,
            "takeProfitOn": self.tp_on,
            "stopLoss": plain(self.stop_loss) if self.stop_loss is not None else None,
        }


def checked(body: dict[str, Any], key: str, low: str, high: str, label: str) -> Decimal:
    try:
        value = Decimal(str(body.get(key, "")).strip())
    except ArithmeticError as error:
        raise Refused(f"{label} isn't a number.") from error
    if not value.is_finite() or not Decimal(low) <= value <= Decimal(high):
        raise Refused(f"{label} must be from {low} to {high}.")
    return value


def checked_whole(body: dict[str, Any], key: str, low: int, high: int, label: str) -> int:
    value = checked(body, key, str(low), str(high), label)
    if value != value.to_integral_value():
        raise Refused(f"{label} must be a whole number.")
    return int(value)


def parse(body: dict[str, Any]) -> Config:
    """The wizard's settings, each checked against a sensible range (fail closed)."""
    timeframe = str(body.get("timeframe", ""))
    if timeframe not in TIMEFRAMES:
        raise Refused("Choose a timeframe: 15m, 1h or 4h.")
    body = {**body, "maxDeals": body.get("maxDeals", 1)}
    config = Config(
        timeframe=timeframe,
        bb_length=checked_whole(body, "bbLength", 5, 100, "Bollinger length"),
        bb_deviation=checked(body, "bbDeviation", "1", "4", "Bollinger deviation"),
        base_order=checked(body, "baseOrder", "1", "100000", "Base order"),
        dca_order=checked(body, "dcaOrder", "1", "100000", "DCA order"),
        deviation=checked(body, "deviation", "0.1", "50", "Deviation %"),
        max_dca_orders=checked_whole(body, "maxDcaOrders", 0, 20, "Max DCA orders"),
        size_multiplier=checked(body, "sizeMultiplier", "1", "3", "DCA size multiplier"),
        deviation_multiplier=checked(
            body, "deviationMultiplier", "0.5", "3", "Deviation multiplier"
        ),
        take_profit=checked(body, "takeProfit", "0.1", "50", "Take profit %"),
        max_deals=checked_whole(body, "maxDeals", 1, MAX_DEALS, "Simultaneous deals"),
        entry_price=_optional(body, "entryPrice", "Entry price"),
        tp_on=body.get("takeProfitOn", True) is not False,
        stop_loss=_optional(body, "stopLoss", "Stop loss"),
    )
    if config.stop_loss is not None:
        start = config.entry_price
        if start is None:
            raise Refused("A stop loss is for a smart trade.")
        last = start * (1 - config.drops()[-1] / HUNDRED)
        if config.stop_loss >= last:
            raise Refused("The stop loss must sit under the last buy.")
    if config.drops()[-1] >= MAX_DROP:
        raise Refused("The last DCA order would sit 95% or more below the base order.")
    return config


def _optional(body: dict[str, Any], key: str, label: str) -> Decimal | None:
    if str(body.get(key) or "").strip() == "":
        return None
    return checked(body, key, "0.00000001", "100000000", label)


def config_of(bot: dict[str, Any]) -> Config:
    raw: dict[str, Any] = json.loads(str(bot["config"]))
    return Config(
        timeframe=str(raw["timeframe"]),
        bb_length=int(raw["bb_length"]),
        bb_deviation=Decimal(raw["bb_deviation"]),
        base_order=Decimal(raw["base_order"]),
        dca_order=Decimal(raw["dca_order"]),
        deviation=Decimal(raw["deviation"]),
        max_dca_orders=int(raw["max_dca_orders"]),
        size_multiplier=Decimal(raw["size_multiplier"]),
        deviation_multiplier=Decimal(raw["deviation_multiplier"]),
        take_profit=Decimal(raw["take_profit"]),
        max_deals=int(raw.get("max_deals", 1)),
        entry_price=Decimal(raw["entry_price"]) if raw.get("entry_price") else None,
        tp_on=bool(raw.get("tp_on", True)),
        stop_loss=Decimal(raw["stop_loss"]) if raw.get("stop_loss") else None,
    )


def stored(config: Config) -> str:
    return json.dumps(
        {k: str(v) if isinstance(v, Decimal) else v for k, v in asdict(config).items()}
    )


def _up(value: Decimal, filters: Filters | None) -> Decimal:
    """A sell price rounded up to the pair's price step, so take profit is never short."""
    if filters is None:
        return value
    price = filters.price(value)
    return price if price >= value else price + filters.tick


def ladder(config: Config, price: Decimal, filters: Filters | None = None) -> list[dict[str, Any]]:
    """Every order a deal would place from this price: the base order, then each DCA order,
    with the running total, the average price and the take profit if it filled."""
    rows: list[dict[str, Any]] = []
    total = held = ZERO
    for rung, (drop, size) in enumerate(zip(config.drops(), config.sizes(), strict=True)):
        at = price * (1 - drop / HUNDRED)
        at = filters.price(at) if filters else at
        qty = filters.amount(size / at) if filters else size / at
        spend = at * qty
        total += spend
        held += qty
        average = total / held if held else at
        rows.append(
            {
                "rung": rung,
                "drop": drop,
                "price": at,
                "qty": qty,
                "spend": spend,
                "total": total,
                "average": average,
                "takeProfit": _up(average * (1 + config.take_profit / HUNDRED), filters),
            }
        )
    return rows


def ladder_view(rows: list[dict[str, Any]]) -> list[dict[str, str | int]]:
    return [
        {k: (v if isinstance(v, int) else plain(v.quantize(Decimal("1e-8")))) for k, v in r.items()}
        for r in rows
    ]


def bands(closes: list[Decimal], config: Config) -> list[tuple[Decimal, Decimal, Decimal] | None]:
    """The bands at every candle, None until there are enough closes."""
    n = config.bb_length
    return [
        bollinger(closes[max(0, i + 1 - n) : i + 1], n, config.bb_deviation)
        for i in range(len(closes))
    ]


@dataclass
class _Deal:
    start: int
    rungs: list[dict[str, Any]]
    filled: int = 0
    qty: Decimal = ZERO
    spent: Decimal = ZERO

    def take_profit(self, config: Config) -> Decimal:
        return self.spent / self.qty * (1 + config.take_profit / HUNDRED)


@dataclass
class _Tally:
    deals: int = 0
    expired: int = 0
    profit: Decimal = ZERO
    most_filled: int = 0
    most_spent: Decimal = ZERO
    worst: Decimal = ZERO  # the deepest unrealised loss on a deal, in %
    hours: Decimal = ZERO


def _fill(deal: _Deal, low: Decimal) -> None:
    for row in deal.rungs[deal.filled :]:
        if low > row["price"]:
            break
        deal.qty += row["spend"] / row["price"] * (1 - FEE)
        deal.spent += row["spend"]
        deal.filled += 1


def _step_deal(deal: _Deal, candle: Candle, config: Config, tally: _Tally, at: int) -> bool:
    """One candle of an open deal; True while it stays open."""
    if deal.filled and candle.high >= deal.take_profit(config):
        tally.profit += deal.qty * deal.take_profit(config) * (1 - FEE) - deal.spent
        tally.deals += 1
        tally.hours += Decimal(at - deal.start)
        return False
    _fill(deal, candle.low)
    if not deal.filled:
        tally.expired += 1
        return False
    tally.most_filled = max(tally.most_filled, deal.filled - 1)
    tally.worst = min(tally.worst, (deal.qty * candle.low / deal.spent - 1) * HUNDRED)
    return True


def backtest(
    config: Config,
    history: list[Candle],
    step_ms: int,
    found: list[tuple[Decimal, Decimal, Decimal] | None] | None = None,
) -> dict[str, Any]:
    """The bot's settings over past candles: a deal starts at a close below the lower band
    (up to the simultaneous deals allowed), its orders fill when a later candle's low reaches
    them, and it closes when a high reaches take profit (checked before that candle's fills, so
    the result errs on the cautious side). Fees at 0.1% a side; a base order expires if the
    next candle doesn't fill it."""
    closes = [c.close for c in history]
    found = found if found is not None else bands(closes, config)
    tally = _Tally()
    deals: list[_Deal] = []
    for i, candle in enumerate(history):
        deals = [d for d in deals if _step_deal(d, candle, config, tally, i)]
        tally.most_spent = max(tally.most_spent, sum((d.spent for d in deals), ZERO))
        band = found[i]
        if len(deals) < config.max_deals and band is not None and candle.close < band[0]:
            deals.append(_Deal(i, ladder(config, candle.close)))
    held = [d for d in deals if d.filled]
    unrealised = sum((d.qty * closes[-1] - d.spent for d in held), ZERO)
    budget = config.budget() * config.max_deals
    hours = Decimal(step_ms) / 3_600_000
    return {
        "from": history[0].time if history else None,
        "to": history[-1].time + step_ms if history else None,
        "candles": len(history),
        "deals": tally.deals,
        "expired": tally.expired,
        "profit": plain(tally.profit.quantize(CENT)),
        "profitPercent": plain((tally.profit / budget * HUNDRED).quantize(Decimal("0.1"))),
        "mostDcaFilled": tally.most_filled,
        "mostSpent": plain(tally.most_spent.quantize(CENT)),
        "worstDrawdown": plain(tally.worst.quantize(Decimal("0.1"))),
        "averageHours": plain((tally.hours * hours / tally.deals).quantize(Decimal("0.1")))
        if tally.deals
        else None,
        "openDeal": bool(held),
        "unrealised": plain(unrealised.quantize(CENT)),
    }


@dataclass(frozen=True)
class Order:
    """One limit order a deal places: its rung (0 the base order), side, price and amount."""

    rung: int
    side: str
    price: Decimal
    qty: Decimal


class Bots:
    def __init__(
        self,
        binance: Binance,
        store: Store,
        audit: Audit,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._binance = binance
        self._store = store
        self._audit = audit
        self._clock = clock
        self.trading = Trading(binance, store, audit, clock)

    def _now(self) -> int:
        return int(self._clock() * 1000)

    def _say(self, bot: dict[str, Any], what: str, result: str) -> None:
        kind = "TR" if config_of(bot).is_trade() else "DCA"
        self._audit.record("bot", f"{kind}-{bot['id']} {bot['symbol']}: {what}", result)

    # Market data: closed candles only, so a signal can't flicker within a candle.

    def _closed(self, symbol: str, config: Config, count: int) -> list[Candle]:
        return candles(self._binance.klines(symbol, config.timeframe, count + 1))[:-1]

    def _symbol(self, body: dict[str, Any]) -> str:
        symbol = str(body.get("symbol", "")).upper()
        if not symbol.endswith(QUOTE) or not symbol.isalnum():
            raise Refused(f"Pick a {QUOTE} pair.")
        if symbol not in self._binance.symbols():
            raise Refused(f"{pair(symbol)} isn't listed on Binance spot.")
        return symbol

    def problems(self, config: Config, rows: list[dict[str, Any]], filters: Filters) -> list[str]:
        """What stops this ladder going to Binance: its minimums and the owner's limits."""
        settings = self.trading.settings()
        per_order, per_day = Decimal(settings["perOrder"]), Decimal(settings["perDay"])
        found: list[str] = []
        if per_order <= ZERO or per_day <= ZERO:
            found.append("Set your per-order and daily limits first.")
        small = [r for r in rows if r["spend"] < filters.min_notional]
        if small:
            found.append(f"Each order must be at least {money(filters.min_notional)} on Binance.")
        if per_order > ZERO and any(r["spend"] > per_order for r in rows):
            found.append(f"An order is over your per-order limit of {money(per_order)}.")
        if per_day > ZERO and rows[-1]["total"] > per_day:
            found.append(f"The budget is over your daily limit of {money(per_day)}.")
        if config.budget() <= ZERO:
            found.append("The budget must be more than zero.")
        return found

    # The wizard: what a bot would place now, and how its settings did on past candles.

    def preview(self, body: dict[str, Any]) -> dict[str, Any]:
        symbol, config = self._symbol(body), parse(body)
        history = self._closed(symbol, config, HISTORY)
        if len(history) <= config.bb_length:
            raise Refused(f"Binance has too few candles for {pair(symbol)} yet.")
        filters = self._binance.filters(symbol)
        price = Decimal(self._binance.tickers([symbol])[symbol]["lastPrice"])
        rows = ladder(config, config.entry_price or price, filters)
        closes = [c.close for c in history]
        found = bands(closes, config)
        lower, middle, upper = found[-1] or (ZERO, ZERO, ZERO)
        free = next((b["free"] for b in self._binance.balances() if b["asset"] == QUOTE), "0")
        return {
            "symbol": symbol,
            "pair": pair(symbol),
            "quote": QUOTE,
            "price": plain(price),
            "band": {
                "lower": plain(lower.quantize(EIGHT)),
                "middle": plain(middle.quantize(EIGHT)),
                "upper": plain(upper.quantize(EIGHT)),
            },
            "met": closes[-1] < lower,
            "ladder": ladder_view(rows),
            "budget": plain(rows[-1]["total"].quantize(Decimal("0.01"))),
            "covers": plain(rows[-1]["drop"]),
            "available": free,
            "settings": self.trading.settings(),
            "problems": self.problems(config, rows, filters),
            "chart": [
                {
                    "t": c.time,
                    "o": plain(c.open),
                    "h": plain(c.high),
                    "l": plain(c.low),
                    "c": plain(c.close),
                    "lower": plain(b[0].quantize(EIGHT)) if b else None,
                    "upper": plain(b[2].quantize(EIGHT)) if b else None,
                }
                for c, b in list(zip(history, found, strict=True))[-CHART:]
            ],
            "backtest": None
            if config.is_trade()
            else backtest(config, history, TIMEFRAMES[config.timeframe]),
        }

    # A preset for a coin: the settings that did best on its last 30 days, each with its why.

    def suggest(self, body: dict[str, Any]) -> dict[str, Any]:
        symbol = self._symbol(body)
        coin = pair(symbol).split("/")[0]
        tried: list[tuple[Decimal, int, Config, dict[str, Any]]] = []
        for timeframe in SUGGEST_TIMEFRAMES:
            plain_config = Config(timeframe=timeframe)
            step = TIMEFRAMES[timeframe]
            history = self._closed(symbol, plain_config, SUGGEST_MS // step)
            if len(history) <= plain_config.bb_length:
                continue
            found = bands([c.close for c in history], plain_config)
            for deviation, count, size, take in SUGGEST_GRID:
                config = Config(
                    timeframe=timeframe,
                    deviation=deviation,
                    max_dca_orders=count,
                    size_multiplier=size,
                    take_profit=take,
                )
                result = backtest(config, history, step, found)
                score = Decimal(result["profitPercent"]) - (
                    HUNDRED if result["deals"] == 0 else ZERO
                )
                tried.append((score, -count, config, result))
        if not tried:
            raise Refused(f"Binance has too few candles for {pair(symbol)} yet.")
        _, _, best, result = max(tried, key=lambda t: (t[0], t[1]))
        best, sizing = self._sized(best, symbol)
        reasons = {
            "timeframe": f"{best.timeframe} signals did best on {coin}'s last 30 days: "
            f"{result['deals']} deals closed",
            "bbLength": "The usual 20-candle band: a close below it is a sharp dip",
            "bbDeviation": "2 deviations: wide enough that only real dips count",
            "baseOrder": sizing,
            "dcaOrder": sizing,
            "deviation": f"{plain(best.deviation)}% steps did best of 1 to 3% over 30 days",
            "maxDcaOrders": f"Covers a {plain(best.drops()[-1])}% drop; the deepest dip used "
            f"{result['mostDcaFilled']} of them",
            "sizeMultiplier": "Buys more as the price falls, pulling the average down faster"
            if best.size_multiplier > 1
            else "Same size each time kept the budget smallest for the result",
            "deviationMultiplier": "Even steps between orders",
            "takeProfit": f"{plain(best.take_profit)}% over the average closed "
            f"{result['deals']} deals for {result['profit']} {QUOTE} in 30 days",
            "maxDeals": "One deal at a time keeps what's at risk to one budget",
        }
        return {
            "symbol": symbol,
            "config": best.view(),
            "reasons": reasons,
            "backtest": result,
        }

    def _sized(self, config: Config, symbol: str) -> tuple[Config, str]:
        """Order sizes inside the owner's per-order limit and over Binance's minimum."""
        filters = self._binance.filters(symbol)
        per_order = Decimal(self.trading.settings()["perOrder"])
        floor = max(filters.min_notional * Decimal("1.2"), Decimal(6))
        top = config.size_multiplier ** max(config.max_dca_orders - 1, 0)
        if per_order <= ZERO:
            return config, "A small start; set your limits and it sizes to them"
        dca = max(floor, min(Decimal(20), (per_order / top).quantize(ONE_CENT)))
        base = max(floor, min(Decimal(25), per_order))
        sized = replace(config, base_order=base, dca_order=dca)
        return sized, f"Fits your per-order limit of {money(per_order)}"

    def detail(self, bot_id: int) -> dict[str, Any]:
        """One bot, every deal it ran (newest first) and every order each deal placed."""
        bot = self._store.bot(bot_id)
        symbol = str(bot["symbol"])
        price = Decimal(self._binance.tickers([symbol])[symbol]["lastPrice"])
        deals: list[dict[str, Any]] = []
        for deal in reversed(self._store.deals(bot_id)):
            rows = self._store.bot_orders(int(deal["id"]))
            view: dict[str, Any] = {
                "id": deal["id"],
                "ref": f"D-{deal['id']}",
                "status": deal["status"],
                "started": deal["started"],
                "ended": deal["ended"],
                "profit": deal["profit"],
                "note": deal["note"],
                "orders": [
                    {
                        "ref": f"D-{deal['id']}-{'TP' if r['side'] == 'sell' else r['rung']}",
                        "kind": "Take profit"
                        if r["side"] == "sell"
                        else "Base order"
                        if r["rung"] == 0
                        else f"DCA {r['rung']}",
                        "side": r["side"],
                        "price": r["price"],
                        "qty": r["qty"],
                        "spend": r["spend"],
                        "status": r["status"],
                        "filled": r["executed_qty"],
                        "time": r["updated"],
                    }
                    for r in rows
                ],
            }
            if deal["status"] == "open":
                view |= self._deal_view(deal, price)
            deals.append(view)
        return {"bot": self._bot_view(bot, price), "deals": deals}

    # The owner's bots.

    @locked
    def create(self, body: dict[str, Any]) -> dict[str, Any]:
        symbol, config = self._symbol(body), parse(body)
        name = pair(symbol)
        same = [b for b in self._store.bots() if config_of(b).is_trade() == config.is_trade()]
        most = MAX_TRADES if config.is_trade() else MAX_BOTS
        if len(same) >= most:
            raise Refused(f"Up to {most} at once: delete a finished one first.")
        bot_id = self._store.add_bot(name, symbol, stored(config), self._now())
        bot = self._store.bot(bot_id)
        self._say(bot, "created, switched off", json.dumps(config.view()))
        return self.view("trade" if config.is_trade() else "bot")

    def _idle(self, bot_id: int) -> dict[str, Any]:
        bot = self._store.bot(bot_id)
        if bot["enabled"]:
            raise Refused("Switch the bot off first.")
        if self._actives(bot_id):
            raise Refused("Wait for its deals to finish first.")
        return bot

    @locked
    def edit(self, bot_id: int, body: dict[str, Any]) -> dict[str, Any]:
        bot = self._idle(bot_id)
        symbol, config = self._symbol(body), parse(body)
        bot |= {
            "name": pair(symbol),
            "symbol": symbol,
            "config": stored(config),
            "updated": self._now(),
        }
        self._say(self._store.save_bot(bot), "settings changed", json.dumps(config.view()))
        return self.view()

    @locked
    def delete(self, bot_id: int) -> dict[str, Any]:
        bot = self._idle(bot_id)
        self._store.delete_bot(bot_id)
        self._say(bot, "deleted", "OK")
        return self.view()

    @locked
    def switch(self, bot_id: int, on: bool, confirmed: bool) -> dict[str, Any]:
        bot = self._store.bot(bot_id)
        if on:
            if not confirmed:
                raise Refused("Confirm the orders this bot may place first.")
            if not self.trading.settings()["tradingOn"]:
                raise Refused("Trading is off. Turn it on before switching a bot on.")
            symbol, config = bot["symbol"], config_of(bot)
            filters = self._binance.filters(symbol)
            price = config.entry_price or Decimal(
                self._binance.tickers([symbol])[symbol]["lastPrice"]
            )
            problems = self.problems(config, ladder(config, price, filters), filters)
            if problems:
                raise Refused(problems[0])
        bot |= {"enabled": 1 if on else 0, "note": None, "updated": self._now()}
        self._store.save_bot(bot)
        if not on:
            self._cancel_buys(bot)
        self._say(bot, "switched on" if on else "switched off", "OK")
        return self.view("trade" if config_of(bot).is_trade() else "bot")

    @locked
    def stop_all(self, reason: str) -> None:
        """The kill switch: every bot off and its open buys cancelled; take-profit sells stay,
        as they only take risk away."""
        for bot in self._store.bots():
            if bot["enabled"]:
                bot |= {"enabled": 0, "note": reason, "updated": self._now()}
                self._store.save_bot(bot)
                self._say(bot, "stopped", reason)
            self._cancel_buys(bot)

    # Following each bot: the api's watcher calls this every 30 seconds.

    @locked
    def step(self) -> None:
        if not self.trading.settings()["tradingOn"] and any(
            b["enabled"] for b in self._store.bots()
        ):
            self.stop_all("Stopped by the kill switch.")
        for bot in self._store.bots():
            try:
                for deal in self._actives(int(bot["id"])):
                    self._follow(bot, deal)
                fresh = self._store.bot(int(bot["id"]))
                room = len(self._actives(int(bot["id"]))) < config_of(fresh).max_deals
                if fresh["enabled"] and room:
                    self._start(fresh)
            except BinanceError as error:
                self._pause(bot, f"Paused: Binance said {error.message}")

    def _pause(self, bot: dict[str, Any], note: str) -> None:
        bot = self._store.bot(int(bot["id"]))
        bot |= {"enabled": 0, "note": note, "updated": self._now()}
        self._store.save_bot(bot)
        self._say(bot, "paused", note)

    def _actives(self, bot_id: int) -> list[dict[str, Any]]:
        return [d for d in self._store.deals(bot_id) if d["status"] == "open"]

    def _start(self, bot: dict[str, Any]) -> None:
        if not self.trading.settings()["tradingOn"]:
            return
        config, symbol = config_of(bot), str(bot["symbol"])
        if config.entry_price is not None:
            self._start_trade(bot, config)
            return
        history = self._closed(symbol, config, config.bb_length)
        band = bollinger([c.close for c in history], config.bb_length, config.bb_deviation)
        last = history[-1] if history else None
        if band is None or last is None or last.time <= int(bot["last_signal"]):
            return
        if last.close >= band[0]:
            return
        bot |= {"last_signal": last.time, "updated": self._now()}
        filters = self._binance.filters(symbol)
        price = Decimal(self._binance.tickers([symbol])[symbol]["lastPrice"])
        rows = ladder(config, price, filters)
        problem = self._cannot_start(config, rows, filters)
        if problem:
            bot["note"] = f"Skipped a signal: {problem}"
            self._say(self._store.save_bot(bot), "skipped a signal", problem)
            return
        bot["note"] = None
        self._store.save_bot(bot)
        self._open_deal(bot, rows)

    def _start_trade(self, bot: dict[str, Any], config: Config) -> None:
        if self._store.deals(int(bot["id"])):  # its one deal has run
            self._finish(bot, bot["note"] or "Finished.")
            return
        assert config.entry_price is not None  # noqa: S101 - a trade has one
        filters = self._binance.filters(str(bot["symbol"]))
        rows = ladder(config, config.entry_price, filters)
        problem = self._cannot_start(config, rows, filters)
        if problem:
            self._finish(bot, f"Not placed: {problem}")
            return
        self._open_deal(bot, rows)

    def _finish(self, bot: dict[str, Any], note: str) -> None:
        bot = self._store.bot(int(bot["id"]))
        bot |= {"enabled": 0, "note": note, "updated": self._now()}
        self._store.save_bot(bot)

    def _cannot_start(
        self, config: Config, rows: list[dict[str, Any]], filters: Filters
    ) -> str | None:
        problems = self.problems(config, rows, filters)
        if problems:
            return problems[0]
        budget = rows[-1]["total"]
        left = Decimal(self.trading.settings()["leftToday"])
        if budget > left:
            return f"only {money(left)} of today's limit is left."
        free = next((b["free"] for b in self._binance.balances() if b["asset"] == QUOTE), "0")
        if Decimal(free) < budget:
            return f"only {plain(Decimal(free))} {QUOTE} is free; the deal needs {plain(budget)}."
        return None

    def _open_deal(self, bot: dict[str, Any], rows: list[dict[str, Any]]) -> None:
        deal_id = self._store.add_deal(int(bot["id"]), self._now())
        self._say(
            bot, f"deal D-{deal_id} started", f"{len(rows)} limit buys, {plain(rows[-1]['total'])}"
        )
        for row in rows:
            try:
                self._place(bot, deal_id, Order(row["rung"], "buy", row["price"], row["qty"]))
            except BinanceError as error:
                if error.status == 0:
                    # No answer: that order may be live. The deal stays open and the order is
                    # looked up next step; the rest of the ladder isn't placed (decision 47).
                    note = (
                        "Binance didn't answer while placing this deal: the orders sent are "
                        "checked and followed, the rest of its ladder isn't placed."
                    )
                    self._store.save_bot(self._store.bot(int(bot["id"])) | {"note": note})
                    return
                self._pause(bot, f"Paused: Binance said {error.message}")
                break
        sent = [r for r in self._store.bot_orders(deal_id) if r["status"] != "cancelled"]
        if not sent:
            self._store.end_deal(deal_id, "expired", None, self._now(), "No order was placed.")

    def _place(self, bot: dict[str, Any], deal_id: int, placing: Order) -> None:
        """Records the order before sending it, under an id Binance won't take twice."""
        symbol = str(bot["symbol"])
        rung, side, price, qty = placing.rung, placing.side, placing.price, placing.qty
        client_id = f"tdb{bot['id']}d{deal_id}{'r' if side == 'buy' else 't'}{rung}"
        row = {
            "deal_id": deal_id,
            "rung": rung,
            "side": side,
            "client_id": client_id,
            "price": plain(price),
            "qty": plain(qty),
            "spend": plain(price * qty),
            "created": self._now(),
        }
        row_id = self._store.add_bot_order(row)
        saved = {
            "id": row_id,
            "order_id": None,
            "status": "cancelled",
            "executed_qty": "0",
            "executed_quote": "0",
            "fee_base": "0",
            "updated": self._now(),
        }
        try:
            if side == "buy":
                order = self._binance.buy_limit(symbol, qty, price, client_id)
            else:
                order = self._binance.limit_sell(symbol, qty, price, client_id)
        except BinanceError as error:
            if error.status != 0:  # refused: never placed
                self._store.save_bot_order(saved)
            # No answer (status 0): it may be on Binance. The row stays "placing" and the next
            # step finds it by its client id (decision 47).
            raise
        self._store.save_bot_order(saved | {"order_id": int(order["orderId"]), "status": "open"})

    # A deal's fills, its take profit and its end.

    def _record(self, bot: dict[str, Any], row: dict[str, Any], order: dict[str, Any]) -> None:
        status = str(order["status"])
        executed = Decimal(str(order.get("executedQty", "0")))
        if status != "FILLED" and status not in DONE:
            if row["status"] == "placing":
                self._store.save_bot_order(
                    row | {"order_id": int(order["orderId"]), "status": "open"}
                )
            return
        quote = Decimal(str(order.get("cummulativeQuoteQty", "0")))
        fee = ZERO
        if executed > ZERO:
            fee, quote = self._fees(bot, row, int(order["orderId"]), quote)
        self._store.save_bot_order(
            row
            | {
                "order_id": int(order["orderId"]),
                "status": "filled" if status == "FILLED" else "cancelled",
                "executed_qty": plain(executed),
                "executed_quote": plain(quote),
                "fee_base": plain(fee),
                "updated": self._now(),
            }
        )
        if executed > ZERO:
            what = "take profit" if row["side"] == "sell" else f"order {row['rung']}"
            self._say(bot, f"{what} filled", f"{plain(executed)} for {plain(quote)}")

    def _fees(
        self, bot: dict[str, Any], row: dict[str, Any], order_id: int, quote: Decimal
    ) -> tuple[Decimal, Decimal]:
        """A buy's fee paid in the coin comes off what's held; a sell's fee in the quote comes
        off what it raised. A fee paid in BNB changes neither."""
        symbol = str(bot["symbol"])
        base = symbol[: -len(QUOTE)]
        fee_base = fee_quote = ZERO
        for fill in self._binance.order_fills(symbol, order_id):
            amount = Decimal(str(fill["commission"]))
            if fill["commissionAsset"] == base:
                fee_base += amount
            elif fill["commissionAsset"] == QUOTE:
                fee_quote += amount
        if row["side"] == "sell":
            return ZERO, quote - fee_quote
        return fee_base, quote

    def _refresh(self, bot: dict[str, Any], row: dict[str, Any]) -> None:
        symbol = str(bot["symbol"])
        try:
            if row["status"] == "placing":  # sent, but the reply never came back
                order = self._binance.order_by_client(symbol, str(row["client_id"]))
            else:
                order = self._binance.order(symbol, int(row["order_id"]))
        except BinanceError as error:
            if row["status"] != "placing" or error.status == 0:
                raise
            order = {"orderId": 0, "status": "REJECTED"}  # Binance never took it
        self._record(bot, row, order)

    def _row(self, row: dict[str, Any]) -> dict[str, Any]:
        return next(r for r in self._store.bot_orders(int(row["deal_id"])) if r["id"] == row["id"])

    def _cancel(self, bot: dict[str, Any], row: dict[str, Any]) -> None:
        if row["status"] == "placing":  # find out first whether Binance has it
            self._refresh(bot, row)
            row = self._row(row)
        if row["status"] != "open":
            return
        try:
            order = self._binance.cancel(str(bot["symbol"]), int(row["order_id"]))
        except BinanceError:
            order = self._binance.order(str(bot["symbol"]), int(row["order_id"]))
        self._record(bot, row, order)

    def _cancel_buys(self, bot: dict[str, Any]) -> None:
        for deal in self._actives(int(bot["id"])):
            self._cancel_deal_buys(bot, deal)

    def _cancel_deal_buys(self, bot: dict[str, Any], deal: dict[str, Any]) -> None:
        for row in self._store.bot_orders(int(deal["id"])):
            if row["side"] == "buy":
                self._cancel(bot, row)
        if not self._position(int(deal["id"]))["bought"]:
            self._store.end_deal(
                int(deal["id"]), "stopped", None, self._now(), "Stopped before a buy filled."
            )

    def _position(self, deal_id: int) -> dict[str, Any]:
        rows = self._store.bot_orders(deal_id)
        done = [r for r in rows if r["status"] in ("filled", "cancelled")]
        buys = [r for r in done if r["side"] == "buy"]
        sells = [r for r in done if r["side"] == "sell"]
        bought = sum((Decimal(r["executed_qty"]) - Decimal(r["fee_base"]) for r in buys), ZERO)
        spent = sum((Decimal(r["executed_quote"]) for r in buys), ZERO)
        sold = sum((Decimal(r["executed_qty"]) for r in sells), ZERO)
        return {
            "rows": rows,
            "bought": bought,
            "spent": spent,
            "sold": sold,
            "raised": sum((Decimal(r["executed_quote"]) for r in sells), ZERO),
            "held": bought - sold,
            "filled": sum(1 for r in buys if Decimal(r["executed_qty"]) > ZERO),
            "taken": any(
                r["side"] == "sell" and r["status"] == "filled" and r["rung"] < STOP_RUNG
                for r in rows
            ),
            "soldOut": any(r["rung"] == STOP_RUNG and r["status"] == "filled" for r in rows),
            "tp": next((r for r in rows if r["side"] == "sell" and r["status"] == "open"), None),
        }

    def _follow(self, bot: dict[str, Any], deal: dict[str, Any]) -> None:
        deal_id = int(deal["id"])
        for row in self._store.bot_orders(deal_id):
            if row["status"] in ("placing", "open"):
                self._refresh(bot, row)
        position = self._position(deal_id)
        if position["soldOut"]:  # a market sale whose answer came late: end it as stopped
            self.sell_out(bot, deal, "Sold at market.")
            return
        if position["taken"]:
            self._close(bot, deal_id)
            return
        config = config_of(bot)
        if config.stop_loss is not None:
            now = Decimal(
                self._binance.tickers([str(bot["symbol"])])[str(bot["symbol"])]["lastPrice"]
            )
            if now <= config.stop_loss:
                self.sell_out(bot, deal, f"Stop loss: the price fell to {plain(now)}.")
                return
        if not position["bought"]:
            if config.is_trade():
                return  # a trade's entry waits for its price
            candle = TIMEFRAMES[config.timeframe]
            if self._now() > int(deal["started"]) + candle:
                self._cancel_deal_buys(bot, deal)
            return
        self._take_profit(bot, deal_id, position)

    def _take_profit(self, bot: dict[str, Any], deal_id: int, position: dict[str, Any]) -> None:
        """Keeps one limit sell for everything held at take profit over the average price."""
        symbol, config = str(bot["symbol"]), config_of(bot)
        if not config.tp_on:
            return  # take profit off: held until the stop loss or the owner closes it
        filters = self._binance.filters(symbol)
        qty = filters.amount(position["held"])
        current = position["tp"]
        if current is not None and Decimal(current["qty"]) == qty:
            return
        if not self.trading.settings()["tradingOn"]:
            return  # no new orders with the kill switch on; the old take profit stays
        if current is not None:
            self._cancel(bot, current)
            position = self._position(deal_id)
            if position["taken"]:
                self._close(bot, deal_id)
                return
            qty = filters.amount(position["held"])
        average = position["spent"] / position["bought"]
        price = _up(average * (1 + config.take_profit / HUNDRED), filters)
        if qty <= ZERO or qty * price < filters.min_notional:
            return
        rung = TP_RUNG + sum(1 for r in position["rows"] if r["side"] == "sell")
        self._place(bot, deal_id, Order(rung, "sell", price, qty))

    def _close(self, bot: dict[str, Any], deal_id: int) -> None:
        for row in self._store.bot_orders(deal_id):
            if row["side"] == "buy":
                self._cancel(bot, row)
        position = self._position(deal_id)
        cost = (
            position["spent"] * position["sold"] / position["bought"]
            if position["bought"]
            else ZERO
        )
        profit = (position["raised"] - cost).quantize(Decimal("0.00000001"))
        self._store.end_deal(deal_id, "closed", plain(profit), self._now(), None)
        self._say(bot, f"deal D-{deal_id} closed at take profit", f"profit {plain(profit)} {QUOTE}")
        if config_of(bot).is_trade():
            self._finish(bot, "Finished at take profit.")

    @locked
    def close_now(self, bot_id: int) -> dict[str, Any]:
        """The owner's Close: cancels the deal's orders and sells what's held at market."""
        bot = self._store.bot(bot_id)
        deals = self._actives(bot_id)
        if not deals:
            raise Refused("Nothing is open to close.")
        for deal in deals:
            self.sell_out(bot, deal, "Closed at market by you.")
        bot = self._store.bot(bot_id)
        if bot["enabled"] and config_of(bot).is_trade():
            self._finish(bot, "Closed at market by you.")
        return self.view("trade" if config_of(bot).is_trade() else "bot")

    def sell_out(self, bot: dict[str, Any], deal: dict[str, Any], why: str) -> None:
        """Ends a deal now: its open orders cancelled, everything held sold at market."""
        deal_id = int(deal["id"])
        for row in self._store.bot_orders(deal_id):
            if row["status"] == "open":
                self._cancel(bot, row)
        self._market_sale(bot, deal_id)
        if any(
            r["rung"] == STOP_RUNG and r["status"] == "placing"
            for r in self._store.bot_orders(deal_id)
        ):
            return  # the sale's answer is still to come; the next step settles it
        position = self._position(deal_id)
        bought = position["bought"]
        cost = position["spent"] * position["sold"] / bought if bought else ZERO
        profit = (position["raised"] - cost).quantize(EIGHT)
        self._store.end_deal(deal_id, "stopped", plain(profit), self._now(), why)
        self._say(bot, f"deal D-{deal_id} ended", f"{why} Profit {plain(profit)} {QUOTE}")
        if config_of(bot).is_trade():
            self._finish(bot, why)

    def _market_sale(self, bot: dict[str, Any], deal_id: int) -> None:
        """Sells what the deal holds at market, once: the sale is recorded under its own client
        id before it's sent, and one sent without an answer is looked up, never sent again
        (decision 47)."""
        symbol = str(bot["symbol"])
        sales = [r for r in self._store.bot_orders(deal_id) if r["rung"] == STOP_RUNG]
        for row in sales:
            if row["status"] == "placing":
                self._refresh(bot, row)
        sales = [r for r in self._store.bot_orders(deal_id) if r["rung"] == STOP_RUNG]
        if any(r["status"] in ("placing", "open", "filled") for r in sales):
            return  # already sold, or still settling on Binance
        filters = self._binance.filters(symbol)
        qty = filters.amount(self._position(deal_id)["held"])
        now = Decimal(self._binance.tickers([symbol])[symbol]["lastPrice"])
        if qty <= ZERO or qty * now < filters.min_notional:
            return
        client_id = f"tdb{bot['id']}d{deal_id}m{len(sales)}"
        row_id = self._store.add_bot_order(
            {
                "deal_id": deal_id,
                "rung": STOP_RUNG,
                "side": "sell",
                "client_id": client_id,
                "price": plain(now),
                "qty": plain(qty),
                "spend": plain(qty * now),
                "created": self._now(),
            }
        )
        row = next(r for r in self._store.bot_orders(deal_id) if r["id"] == row_id)
        try:
            order = self._binance.sell_market(symbol, qty, client_id)
        except BinanceError as error:
            if error.status != 0:
                self._store.save_bot_order(row | {"status": "cancelled", "updated": self._now()})
            raise
        self._record(bot, row, order)

    # What the DCA Bot page shows.

    def _deal_view(self, deal: dict[str, Any], price: Decimal) -> dict[str, Any]:
        position = self._position(int(deal["id"]))
        buys = [r for r in position["rows"] if r["side"] == "buy"]
        waiting = [r for r in buys if r["status"] == "open"]
        tp = position["tp"]
        held, spent = position["held"], position["spent"]
        average = spent / position["bought"] if position["bought"] else None
        value = held * price
        cost = average * held if average is not None else ZERO
        return {
            "id": deal["id"],
            "ref": f"D-{deal['id']}",
            "started": deal["started"],
            "spent": plain(spent),
            "held": plain(held),
            "average": plain(average.quantize(Decimal("1e-8"))) if average is not None else None,
            "takeProfit": tp["price"] if tp else None,
            "filled": max(position["filled"] - 1, 0) if position["filled"] else 0,
            "baseFilled": position["filled"] > 0,
            "of": len(buys) - 1,
            "nextPrice": waiting[0]["price"] if waiting else None,
            "nextSpend": waiting[0]["spend"] if waiting else None,
            "unrealised": plain((value - cost).quantize(Decimal("0.01"))) if average else None,
            "unrealisedPercent": plain(((value / cost - 1) * HUNDRED).quantize(Decimal("0.1")))
            if average and cost
            else None,
        }

    def _bot_view(self, bot: dict[str, Any], price: Decimal | None) -> dict[str, Any]:
        config = config_of(bot)
        deals = self._store.deals(int(bot["id"]))
        active = [d for d in deals if d["status"] == "open"]
        closed = [d for d in deals if d["status"] in ("closed", "stopped")]
        lower = None
        if price is not None:
            history = self._closed(str(bot["symbol"]), config, config.bb_length)
            band = bollinger([c.close for c in history], config.bb_length, config.bb_deviation)
            lower = band[0] if band else None
        if active:
            status = "deal" if bot["enabled"] else "finishing"
        elif bot["enabled"]:
            status = "waiting"
        else:
            status = "paused" if bot["note"] else "off"
        return {
            "id": bot["id"],
            "ref": f"{'TR' if config.is_trade() else 'DCA'}-{bot['id']}",
            "name": pair(str(bot["symbol"])),
            "symbol": bot["symbol"],
            "pair": pair(str(bot["symbol"])),
            "enabled": bool(bot["enabled"]),
            "status": status,
            "note": bot["note"],
            "config": config.view(),
            "budget": plain(config.budget().quantize(Decimal("0.01"))),
            "maxBudget": plain((config.budget() * config.max_deals).quantize(CENT)),
            "covers": plain(config.drops()[-1]),
            "price": plain(price) if price is not None else None,
            "lower": plain(lower.quantize(Decimal("1e-8"))) if lower is not None else None,
            "deals": [self._deal_view(d, price) for d in active] if price is not None else [],
            "closed": len(closed),
            "profit": plain(sum((Decimal(d["profit"] or "0") for d in closed), ZERO)),
        }

    def view(self, kind: str = "bot") -> dict[str, Any]:
        trades = kind == "trade"
        bots = [b for b in self._store.bots() if config_of(b).is_trade() == trades]
        symbols = sorted({str(b["symbol"]) for b in bots})
        tickers = self._binance.tickers(symbols) if symbols else {}
        prices = {s: Decimal(t["lastPrice"]) for s, t in tickers.items()}
        return {
            "quote": QUOTE,
            "tradingOn": self.trading.settings()["tradingOn"],
            "bots": [self._bot_view(b, prices.get(str(b["symbol"]))) for b in bots],
        }
