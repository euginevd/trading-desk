"""Grid bots (decision 38): a price range split into lines, a limit buy on each line below the
price and a limit sell on each line above it; each fill places the opposite order one line away,
so every buy-low, sell-high round trip keeps one grid's profit. A grid is created switched off;
switching it on is the owner's confirm for the orders it places, inside the per-order and daily
limits and the kill switch (spec 10)."""

import json
import secrets
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass
from decimal import Decimal
from typing import Any

from api.audit import Audit
from api.binance import Binance, BinanceError, Filters, plain
from api.bots import FEE, checked, checked_whole
from api.indicators import Candle
from api.locks import locked
from api.market import QUOTE, candles
from api.portfolio import pair
from api.store import Store
from api.trading import Refused, Trading, money

ZERO = Decimal(0)
ONE = Decimal(1)
HUNDRED = Decimal(100)
EIGHT = Decimal("1e-8")
CENT = Decimal("0.01")
TIMEFRAME = "1h"  # the backtest's candles, and the suggested range's
HISTORY = 1000  # about 41 days of hours
SUGGEST = 14 * 24  # the suggested range: the last 14 days' low and high
CHART = 168  # a week of hours on the wizard's chart
DONE = ("CANCELED", "EXPIRED", "REJECTED", "EXPIRED_IN_MATCH")
MAX_GRIDS = 10
MIN_CANDLES = 2
SUGGEST_HOURS = 30 * 24  # a preset's backtest: the last 30 days of hours
SUGGEST_GRIDS = (5, 8, 10, 15, 20, 30)


@dataclass(frozen=True)
class GridConfig:
    lower: Decimal
    upper: Decimal
    grids: int = 10
    spacing: str = "geometric"  # or "arithmetic"
    investment: Decimal = Decimal(200)
    buy_first: bool = True  # limit buys at today's price for the sells above it
    stop_below: Decimal | None = None  # stop the grid if the price falls under this

    def lines(self) -> list[Decimal]:
        if self.spacing == "arithmetic":
            step = (self.upper - self.lower) / self.grids
            return [self.lower + step * i for i in range(self.grids + 1)]
        ratio = (self.upper / self.lower) ** (ONE / self.grids)
        return [self.lower * ratio**i for i in range(self.grids + 1)]

    def per_order(self) -> Decimal:
        return self.investment / self.grids

    def profit_per_grid(self) -> tuple[Decimal, Decimal]:
        """Each round trip's profit after 0.1% fees a side, in %: lowest and highest grid."""
        lines = self.lines()
        found = [
            ((ONE - FEE) * hi / lo - ONE - FEE) * HUNDRED
            for lo, hi in zip(lines, lines[1:], strict=False)
        ]
        return min(found), max(found)

    def view(self) -> dict[str, Any]:
        low, high = self.profit_per_grid()
        return {
            "lower": plain(self.lower),
            "upper": plain(self.upper),
            "grids": self.grids,
            "spacing": self.spacing,
            "investment": plain(self.investment),
            "buyFirst": self.buy_first,
            "stopBelow": plain(self.stop_below) if self.stop_below is not None else None,
            "perOrder": plain(self.per_order().quantize(CENT)),
            "profitPerGrid": [plain(low.quantize(CENT)), plain(high.quantize(CENT))],
        }


def parse_grid(
    body: dict[str, Any], suggested: tuple[Decimal, Decimal] | None = None
) -> GridConfig:
    """The wizard's settings, checked (fail closed). A missing range takes the suggested one."""
    spacing = str(body.get("spacing", "geometric"))
    if spacing not in ("arithmetic", "geometric"):
        raise Refused("Spacing: arithmetic or geometric.")
    if suggested and str(body.get("lower", "")).strip() == "":
        body = {**body, "lower": plain(suggested[0]), "upper": plain(suggested[1])}
    lower = checked(body, "lower", "0.00000001", "100000000", "Lower price")
    upper = checked(body, "upper", "0.00000001", "100000000", "Upper price")
    if upper <= lower * Decimal("1.002"):
        raise Refused("The upper price must be above the lower price.")
    stop = str(body.get("stopBelow") or "").strip()
    config = GridConfig(
        lower=lower,
        upper=upper,
        grids=checked_whole(body, "grids", 2, 100, "Grids"),
        spacing=spacing,
        investment=checked(body, "investment", "10", "1000000", "Investment"),
        buy_first=body.get("buyFirst", True) is not False,
        stop_below=checked(body, "stopBelow", "0.00000001", "100000000", "Stop below")
        if stop
        else None,
    )
    if config.stop_below is not None and config.stop_below >= config.lower:
        raise Refused("Stop below must be under the lower price.")
    if config.profit_per_grid()[0] <= ZERO:
        raise Refused("Each grid must be wider than the 0.2% a round trip pays in fees.")
    return config


def config_of(grid: dict[str, Any]) -> GridConfig:
    raw: dict[str, Any] = json.loads(str(grid["config"]))
    return GridConfig(
        lower=Decimal(raw["lower"]),
        upper=Decimal(raw["upper"]),
        grids=int(raw["grids"]),
        spacing=str(raw["spacing"]),
        investment=Decimal(raw["investment"]),
        buy_first=bool(raw["buy_first"]),
        stop_below=Decimal(raw["stop_below"]) if raw["stop_below"] is not None else None,
    )


def stored(config: GridConfig) -> str:
    fields = asdict(config).items()
    return json.dumps({k: str(v) if isinstance(v, Decimal) else v for k, v in fields})


@dataclass(frozen=True)
class Planned:
    """One order of a grid's opening: where it sits, and for a buy, which line it sells on."""

    line: int
    target: int
    side: str
    price: Decimal
    qty: Decimal


def closest(lines: list[Decimal], price: Decimal) -> int:
    return min(range(len(lines)), key=lambda i: abs(lines[i] - price))


def plan(config: GridConfig, price: Decimal, filters: Filters | None = None) -> list[Planned]:
    """The opening orders: a buy on each line below the line nearest the price, and for each
    line above it, a buy at today's price for the coins its sell needs (with buy first)."""
    lines = config.lines()
    if filters:
        lines = [filters.price(x) for x in lines]
    empty = closest(lines, price)
    per = config.per_order()
    at = filters.price(price) if filters else price
    found: list[Planned] = []
    for i, line in enumerate(lines):
        qty = per / line
        qty = filters.amount(qty) if filters else qty
        if i < empty:
            found.append(Planned(i, i + 1, "buy", line, qty))
        elif i > empty and config.buy_first:
            found.append(Planned(i, i, "buy", at, qty))
    return found


@dataclass
class _Book:
    """The backtest's state: orders by line, coins held and what they cost, and the tally."""

    orders: dict[int, tuple[str, Decimal, Decimal]]  # line: side, qty, cost of a sell's coins
    held: Decimal = ZERO
    cost: Decimal = ZERO
    profit: Decimal = ZERO
    trips: int = 0


def _fills(book: _Book, lines: list[Decimal], candle: Candle, per: Decimal) -> None:
    """Orders resting before this candle fill if its range reaches them; what they place in
    turn waits for the next candle, so the result errs on the cautious side."""
    placed: dict[int, tuple[str, Decimal, Decimal]] = {}
    for line, (side, qty, cost) in sorted(book.orders.items()):
        at = lines[line]
        if side == "buy" and candle.low <= at:
            got = qty * (ONE - FEE)
            book.held += got
            book.cost += qty * at
            placed[line + 1] = ("sell", got, qty * at)
        elif side == "sell" and candle.high >= at:
            book.held -= qty
            book.cost -= cost
            book.profit += qty * at * (ONE - FEE) - cost
            book.trips += 1
            placed[line - 1] = ("buy", per / lines[line - 1], ZERO)
        else:
            placed.setdefault(line, (side, qty, cost))
    book.orders = placed


def backtest(config: GridConfig, history: list[Candle]) -> dict[str, Any]:
    """The grid over past hourly candles, opened at the first close with buy first filled
    there; fees 0.1% a side. Compared with simply holding the coin over the same time."""
    if not history:
        return {"candles": 0}
    lines = config.lines()
    first = history[0].close
    book = _Book(orders={})
    for p in plan(config, first):
        if p.line == p.target:  # buy first: bought at the opening price, sold on its line
            got = p.qty * (ONE - FEE)
            book.held += got
            book.cost += p.qty * first
            book.orders[p.line] = ("sell", got, p.qty * first)
        else:
            book.orders[p.line] = ("buy", p.qty, ZERO)
    inside = 0
    for candle in history[1:]:
        _fills(book, lines, candle, config.per_order())
        inside += config.lower <= candle.close <= config.upper
    last = history[-1].close
    unrealised = book.held * last - book.cost
    total = book.profit + unrealised
    return {
        "from": history[0].time,
        "to": history[-1].time + 3_600_000,
        "candles": len(history),
        "trips": book.trips,
        "gridProfit": plain(book.profit.quantize(CENT)),
        "unrealised": plain(unrealised.quantize(CENT)),
        "totalPercent": plain((total / config.investment * HUNDRED).quantize(Decimal("0.1"))),
        "holdPercent": plain(((last / first - ONE) * HUNDRED).quantize(Decimal("0.1"))),
        "inRange": plain((Decimal(inside) / max(len(history) - 1, 1) * HUNDRED).quantize(ONE)),
    }


class Grids:
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

    def _say(self, grid: dict[str, Any], what: str, result: str) -> None:
        self._audit.record("bot", f"GRID-{grid['id']} {grid['symbol']}: {what}", result)

    def _symbol(self, body: dict[str, Any]) -> str:
        symbol = str(body.get("symbol", "")).upper()
        if not symbol.endswith(QUOTE) or not symbol.isalnum():
            raise Refused(f"Pick a {QUOTE} pair.")
        if symbol not in self._binance.symbols():
            raise Refused(f"{pair(symbol)} isn't listed on Binance spot.")
        return symbol

    def _price(self, symbol: str) -> Decimal:
        return Decimal(self._binance.tickers([symbol])[symbol]["lastPrice"])

    def _free(self) -> Decimal:
        return Decimal(
            next((b["free"] for b in self._binance.balances() if b["asset"] == QUOTE), "0")
        )

    def problems(self, config: GridConfig, symbol: str, price: Decimal) -> list[str]:
        """What stops this grid opening: Binance's minimum and the owner's limits."""
        filters = self._binance.filters(symbol)
        settings = self.trading.settings()
        per_order, per_day = Decimal(settings["perOrder"]), Decimal(settings["perDay"])
        found: list[str] = []
        if per_order <= ZERO or per_day <= ZERO:
            found.append("Set your per-order and daily limits first.")
        if config.per_order() < filters.min_notional * Decimal("1.05"):
            found.append(
                f"Each order would be {money(config.per_order())}: Binance needs at least "
                f"{money(filters.min_notional)}. Fewer grids or more investment."
            )
        if per_order > ZERO and config.per_order() > per_order:
            found.append(f"Each order is over your per-order limit of {money(per_order)}.")
        spend = sum((p.price * p.qty for p in plan(config, price, filters)), ZERO)
        if per_day > ZERO and spend > per_day:
            found.append(
                f"Opening it buys {money(spend)}, over your daily limit of {money(per_day)}."
            )
        return found

    # The wizard: lines, opening orders and a backtest.

    def preview(self, body: dict[str, Any]) -> dict[str, Any]:
        symbol = self._symbol(body)
        history = candles(self._binance.klines(symbol, TIMEFRAME, HISTORY + 1))[:-1]
        if len(history) < MIN_CANDLES:
            raise Refused(f"Binance has too few candles for {pair(symbol)} yet.")
        recent = history[-SUGGEST:]
        suggested = (min(c.low for c in recent), max(c.high for c in recent))
        config = parse_grid(body, suggested)
        price = self._price(symbol)
        filters = self._binance.filters(symbol)
        opening = plan(config, price, filters)
        lines = [filters.price(x) for x in config.lines()]
        empty = closest(lines, price)
        return {
            "symbol": symbol,
            "pair": pair(symbol),
            "quote": QUOTE,
            "price": plain(price),
            "config": config.view(),
            "suggested": {"lower": plain(suggested[0]), "upper": plain(suggested[1])},
            "inRange": config.lower <= price <= config.upper,
            "lines": [
                {
                    "price": plain(x),
                    "side": "buy" if i < empty else "sell" if i > empty else "none",
                }
                for i, x in enumerate(lines)
            ],
            "opening": {
                "buys": sum(1 for p in opening if p.line != p.target),
                "buyFirst": sum(1 for p in opening if p.line == p.target),
                "buyFirstSpend": plain(
                    sum((p.price * p.qty for p in opening if p.line == p.target), ZERO).quantize(
                        CENT
                    )
                ),
                "spend": plain(sum((p.price * p.qty for p in opening), ZERO).quantize(CENT)),
            },
            "available": plain(self._free()),
            "settings": self.trading.settings(),
            "problems": self.problems(config, symbol, price),
            "chart": [
                {
                    "t": c.time,
                    "o": plain(c.open),
                    "h": plain(c.high),
                    "l": plain(c.low),
                    "c": plain(c.close),
                }
                for c in history[-CHART:]
            ],
            "backtest": backtest(config, history),
        }

    # A preset for a coin: the range and grids that did best on its last 30 days, with why.

    def suggest(self, body: dict[str, Any]) -> dict[str, Any]:
        symbol = self._symbol(body)
        coin = pair(symbol).split("/")[0]
        history = candles(self._binance.klines(symbol, TIMEFRAME, SUGGEST_HOURS + 1))[:-1]
        if len(history) < MIN_CANDLES:
            raise Refused(f"Binance has too few candles for {pair(symbol)} yet.")
        price = self._price(symbol)
        per_order = Decimal(self.trading.settings()["perOrder"])
        ranges = {
            "the last 30 days' low and high": (
                min(c.low for c in history),
                max(c.high for c in history),
            ),
            "the last 14 days' low and high": (
                min(c.low for c in history[-SUGGEST:]),
                max(c.high for c in history[-SUGGEST:]),
            ),
            "10% either side of today's price": (price * Decimal("0.9"), price * Decimal("1.1")),
            "5% either side of today's price": (price * Decimal("0.95"), price * Decimal("1.05")),
        }
        tried: list[tuple[Decimal, str, GridConfig, dict[str, Any]]] = []
        for why, (lower, upper) in ranges.items():
            if not lower < price < upper:
                continue
            for count in SUGGEST_GRIDS:
                config = GridConfig(lower, upper, count, "geometric", Decimal(200))
                if config.profit_per_grid()[0] <= Decimal("0.3"):
                    continue
                result = backtest(config, history)
                tried.append((Decimal(result["totalPercent"]), why, config, result))
        if not tried:
            raise Refused(f"No range held {pair(symbol)}'s price over the last 30 days.")
        _, why, best, result = max(tried, key=lambda t: t[0])
        investment = Decimal(200)
        if per_order > ZERO:
            investment = min(investment, (per_order * best.grids).quantize(ONE))
        filters = self._binance.filters(symbol)
        lower = filters.price(best.lower)
        upper = filters.price(best.upper)
        stop = filters.price(best.lower * Decimal("0.95"))
        best = GridConfig(lower, upper, best.grids, "geometric", investment, True, stop)
        low = best.profit_per_grid()[0]
        return {
            "symbol": symbol,
            "config": best.view(),
            "reasons": {
                "lower": f"From {why}: it did best for {coin} over 30 days",
                "upper": f"Kept the price in range {result['inRange']}% of the last 30 days",
                "grids": f"{best.grids} grids made {result['trips']} round trips in 30 days, "
                f"{plain(low.quantize(CENT))}% each after fees",
                "spacing": "Geometric: every grid earns the same %, whatever the price",
                "investment": f"{plain(best.per_order().quantize(CENT))} {QUOTE} an order, "
                "inside your per-order limit"
                if per_order > ZERO
                else "A small start; set your limits and it sizes to them",
                "buyFirst": "Buys the coins for the sells above the price, so both sides trade",
                "stopBelow": "5% under the range: stops the grid if the price breaks down",
            },
            "backtest": result,
        }

    def detail(self, grid_id: int) -> dict[str, Any]:
        """One grid and every order it placed, newest first, each with its reference."""
        grid = self._store.grid(grid_id)
        price = self._price(str(grid["symbol"]))
        rows = self._store.grid_orders(grid_id)
        return {
            "grid": self._grid_view(grid, price),
            "orders": [
                {
                    "ref": f"GRID-{grid_id}-{r['id']}",
                    "side": r["side"],
                    "line": r["line"],
                    "price": r["price"],
                    "qty": r["qty"],
                    "status": r["status"],
                    "filled": r["executed_qty"],
                    "profit": r["profit"],
                    "time": r["updated"],
                }
                for r in reversed(rows)
                if r["status"] != "cancelled" or Decimal(r["executed_qty"]) > ZERO
            ],
        }

    # The owner's grids.

    @locked
    def create(self, body: dict[str, Any]) -> dict[str, Any]:
        symbol, config = self._symbol(body), parse_grid(body)
        name = pair(symbol)
        if len(self._store.grids()) >= MAX_GRIDS:
            raise Refused(f"Up to {MAX_GRIDS} grid bots: delete one first.")
        grid = self._store.grid(self._store.add_grid(name, symbol, stored(config), self._now()))
        self._say(grid, "created, switched off", json.dumps(config.view()))
        return self.view()

    def _idle(self, grid_id: int) -> dict[str, Any]:
        grid = self._store.grid(grid_id)
        if grid["enabled"]:
            raise Refused("Switch the grid off first.")
        if any(
            r["status"] in ("wanted", "placing", "open") for r in self._store.grid_orders(grid_id)
        ):
            raise Refused("It still has orders on Binance: switch it off to cancel them.")
        return grid

    @locked
    def edit(self, grid_id: int, body: dict[str, Any]) -> dict[str, Any]:
        grid = self._idle(grid_id)
        symbol, config = self._symbol(body), parse_grid(body)
        grid |= {
            "name": pair(symbol),
            "symbol": symbol,
            "config": stored(config),
            "updated": self._now(),
        }
        self._say(self._store.save_grid(grid), "settings changed", json.dumps(config.view()))
        return self.view()

    @locked
    def delete(self, grid_id: int) -> dict[str, Any]:
        grid = self._idle(grid_id)
        self._store.delete_grid(grid_id)
        self._say(grid, "deleted", "OK")
        return self.view()

    @locked
    def switch(self, grid_id: int, on: bool, confirmed: bool) -> dict[str, Any]:
        grid = self._store.grid(grid_id)
        if not on:
            grid |= {"enabled": 0, "note": None, "updated": self._now()}
            self._store.save_grid(grid)
            self._cancel(grid, sells=True)
            self._say(grid, "switched off", "its orders cancelled")
            return self.view()
        if grid["enabled"]:
            return self.view()
        if not confirmed:
            raise Refused("Confirm the orders this grid may place first.")
        left_over = [
            r
            for r in self._store.grid_orders(grid_id)
            if r["status"] in ("wanted", "placing", "open")
        ]
        if left_over:  # starting again would open a second grid on top of the first
            raise Refused(
                f"It still has {len(left_over)} orders from before. Stop it to cancel them, "
                "then start it again."
            )
        if not self.trading.settings()["tradingOn"]:
            raise Refused("Trading is off. Turn it on before switching a grid on.")
        symbol, config = str(grid["symbol"]), config_of(grid)
        price = self._price(symbol)
        problems = self.problems(config, symbol, price)
        if problems:
            raise Refused(problems[0])
        filters = self._binance.filters(symbol)
        opening = plan(config, price, filters)
        spend = sum((p.price * p.qty for p in opening), ZERO)
        left = Decimal(self.trading.settings()["leftToday"])
        if spend > left:
            raise Refused(f"Opening it buys {money(spend)}; only {money(left)} of today is left.")
        if spend > self._free():
            raise Refused(f"Opening it needs {plain(spend.quantize(CENT))} {QUOTE} free.")
        for p in opening:
            self._want(grid, p, ZERO)
        grid |= {"enabled": 1, "note": None, "started": self._now(), "updated": self._now()}
        self._store.save_grid(grid)
        self._say(grid, "switched on", f"{len(opening)} limit buys, {plain(spend)}")
        self._place_wanted(grid)
        return self.view()

    @locked
    def stop_all(self, reason: str) -> None:
        """The kill switch: every grid off and its buys cancelled; its sells stay, as they only
        take risk away, and are still followed so their profit is recorded."""
        for grid in self._store.grids():
            if grid["enabled"]:
                grid |= {"enabled": 0, "note": reason, "updated": self._now()}
                self._store.save_grid(grid)
                self._say(grid, "stopped", reason)
            self._cancel(grid, sells=False)

    # Following each grid: the api's watcher calls this every 30 seconds.

    @locked
    def step(self) -> None:
        if not self.trading.settings()["tradingOn"] and any(
            g["enabled"] for g in self._store.grids()
        ):
            self.stop_all("Stopped by the kill switch.")
        for grid in self._store.grids():
            try:
                self._follow(grid)
            except BinanceError as error:
                self._pause(grid, f"Paused: Binance said {error.message}")

    def _pause(self, grid: dict[str, Any], note: str) -> None:
        grid = self._store.grid(int(grid["id"]))
        grid |= {"enabled": 0, "note": note, "updated": self._now()}
        self._store.save_grid(grid)
        self._say(grid, "paused", note)

    def _follow(self, grid: dict[str, Any]) -> None:
        rows = self._store.grid_orders(int(grid["id"]))
        if not any(r["status"] in ("open", "wanted", "placing") for r in rows):
            return
        config = config_of(grid)
        stop = config.stop_below
        if grid["enabled"] and stop is not None and self._price(str(grid["symbol"])) < stop:
            self._stop_below(grid, stop)
            return
        for row in rows:
            if row["status"] in ("open", "placing"):
                self._refresh(grid, row)
        if self._store.grid(int(grid["id"]))["enabled"]:
            self._place_wanted(self._store.grid(int(grid["id"])))

    def _stop_below(self, grid: dict[str, Any], stop: Decimal) -> None:
        note = f"Stopped: the price fell under {plain(stop)}. Its orders are cancelled; coins kept."
        grid |= {"enabled": 0, "note": note, "updated": self._now()}
        self._store.save_grid(grid)
        self._cancel(grid, sells=True)
        self._say(grid, "stopped below", note)

    def _want(self, grid: dict[str, Any], p: Planned, cost: Decimal) -> None:
        self._store.add_grid_order(
            {
                "grid_id": grid["id"],
                "line": p.line,
                "target": p.target,
                "side": p.side,
                "client_id": f"tdg{grid['id']}x{secrets.token_hex(8)}",
                "price": plain(p.price),
                "qty": plain(p.qty),
                "spend": plain(p.price * p.qty),
                "cost": plain(cost),
                "created": self._now(),
            }
        )

    def _place_wanted(self, grid: dict[str, Any]) -> None:
        """Sends each wanted order; a buy waits while today's limit can't take it."""
        symbol = str(grid["symbol"])
        for row in self._store.grid_orders(int(grid["id"])):
            if row["status"] != "wanted":
                continue
            qty, price = Decimal(row["qty"]), Decimal(row["price"])
            if row["side"] == "buy":
                left = Decimal(self.trading.settings()["leftToday"])
                if price * qty > left:
                    note = "Waiting: today's limit is used up; buys resume tomorrow."
                    if grid["note"] != note:
                        grid = self._store.save_grid(grid | {"note": note})
                    continue
            self._store.save_grid_order(row | {"status": "placing", "updated": self._now()})
            try:
                if row["side"] == "buy":
                    order = self._binance.buy_limit(symbol, qty, price, str(row["client_id"]))
                else:
                    order = self._binance.limit_sell(symbol, qty, price, str(row["client_id"]))
            except BinanceError as error:
                if error.status != 0:  # refused: never placed
                    self._store.save_grid_order(
                        row | {"status": "cancelled", "updated": self._now()}
                    )
                raise  # no answer: it stays "placing" and is looked up next time
            self._store.save_grid_order(
                row | {"order_id": int(order["orderId"]), "status": "open", "updated": self._now()}
            )

    def _resolve(self, grid: dict[str, Any], row: dict[str, Any]) -> dict[str, Any]:
        """A row sent without an answer, looked up by its client id: open if Binance has it,
        wanted again if it never arrived (decision 47)."""
        try:
            found = self._binance.order_by_client(str(grid["symbol"]), str(row["client_id"]))
        except BinanceError as error:
            if error.status == 0:
                raise
            back = row | {"status": "wanted", "updated": self._now()}
            self._store.save_grid_order(back)
            return back
        opened = row | {"order_id": int(found["orderId"]), "status": "open", "updated": self._now()}
        self._store.save_grid_order(opened)
        return opened

    def _refresh(self, grid: dict[str, Any], row: dict[str, Any]) -> None:
        if row["status"] == "placing":
            row = self._resolve(grid, row)
            if row["status"] != "open":
                return
        order = self._binance.order(str(grid["symbol"]), int(row["order_id"]))
        status = str(order["status"])
        if status == "FILLED" or status in DONE:
            self._done(grid, row, order)

    def _done(self, grid: dict[str, Any], row: dict[str, Any], order: dict[str, Any]) -> None:
        """Records a finished order and, while the grid runs, places its other half."""
        symbol = str(grid["symbol"])
        executed = Decimal(str(order.get("executedQty", "0")))
        quote = Decimal(str(order.get("cummulativeQuoteQty", "0")))
        fee_base = fee_quote = ZERO
        if executed > ZERO:
            base = symbol[: -len(QUOTE)]
            for fill in self._binance.order_fills(symbol, int(order["orderId"])):
                amount = Decimal(str(fill["commission"]))
                if fill["commissionAsset"] == base:
                    fee_base += amount
                elif fill["commissionAsset"] == QUOTE:
                    fee_quote += amount
        profit = None
        if row["side"] == "sell" and executed > ZERO:
            share = executed / Decimal(row["qty"])
            profit = quote - fee_quote - Decimal(row["cost"]) * share
        filled = str(order["status"]) == "FILLED"
        self._store.save_grid_order(
            row
            | {
                "order_id": int(order["orderId"]),
                "status": "filled" if filled else "cancelled",
                "executed_qty": plain(executed),
                "executed_quote": plain(quote - fee_quote if row["side"] == "sell" else quote),
                "fee_base": plain(fee_base),
                "profit": plain(profit.quantize(EIGHT)) if profit is not None else None,
                "updated": self._now(),
            }
        )
        if executed > ZERO:
            self._say(
                grid,
                f"{row['side']} filled on line {row['line']}",
                f"{plain(executed)} for {plain(quote)}",
            )
        if filled and self._store.grid(int(grid["id"]))["enabled"]:
            self._other_half(grid, row, executed - fee_base, quote)

    def _other_half(
        self, grid: dict[str, Any], row: dict[str, Any], got: Decimal, quote: Decimal
    ) -> None:
        config = config_of(grid)
        filters = self._binance.filters(str(grid["symbol"]))
        lines = [filters.price(x) for x in config.lines()]
        if row["side"] == "buy":
            target = int(row["target"])
            qty = filters.amount(got)
            if qty * lines[target] >= filters.min_notional:
                self._want(grid, Planned(target, target, "sell", lines[target], qty), quote)
            return
        line = int(row["line"]) - 1
        if line >= 0:
            qty = filters.amount(config.per_order() / lines[line])
            self._want(grid, Planned(line, line + 1, "buy", lines[line], qty), ZERO)

    def _cancel(self, grid: dict[str, Any], sells: bool) -> None:
        for listed in self._store.grid_orders(int(grid["id"])):
            if not sells and listed["side"] == "sell":
                continue
            # One sent without an answer is looked up first: it may be live on Binance.
            row = self._resolve(grid, listed) if listed["status"] == "placing" else listed
            if row["status"] == "wanted":
                self._store.save_grid_order(row | {"status": "cancelled", "updated": self._now()})
            elif row["status"] == "open":
                symbol, order_id = str(grid["symbol"]), int(row["order_id"])
                try:
                    order = self._binance.cancel(symbol, order_id)
                except BinanceError:
                    order = self._binance.order(symbol, order_id)
                self._done(grid, row, order)

    # What the Grid Bot page shows.

    def _grid_view(self, grid: dict[str, Any], price: Decimal | None) -> dict[str, Any]:
        config = config_of(grid)
        rows = self._store.grid_orders(int(grid["id"]))
        buys = [r for r in rows if r["side"] == "buy"]
        sells = [r for r in rows if r["side"] == "sell"]
        bought = sum((Decimal(r["executed_qty"]) - Decimal(r["fee_base"]) for r in buys), ZERO)
        spent = sum((Decimal(r["executed_quote"]) for r in buys), ZERO)
        sold = sum((Decimal(r["executed_qty"]) for r in sells), ZERO)
        sold_cost = sum(
            (
                Decimal(r["cost"]) * Decimal(r["executed_qty"]) / Decimal(r["qty"])
                for r in sells
                if Decimal(r["qty"])
            ),
            ZERO,
        )
        held, held_cost = bought - sold, spent - sold_cost
        profit = sum((Decimal(r["profit"] or "0") for r in sells), ZERO)
        unrealised = held * price - held_cost if price is not None else None
        live = [r for r in rows if r["status"] in ("open", "wanted", "placing")]
        if grid["enabled"]:
            status = "running"
        elif live:
            status = "finishing"
        else:
            status = "paused" if grid["note"] and grid["note"].startswith("Paused") else "off"
        return {
            "id": grid["id"],
            "ref": f"GRID-{grid['id']}",
            "name": pair(str(grid["symbol"])),
            "symbol": grid["symbol"],
            "pair": pair(str(grid["symbol"])),
            "enabled": bool(grid["enabled"]),
            "status": status,
            "note": grid["note"],
            "config": config.view(),
            "started": grid["started"],
            "price": plain(price) if price is not None else None,
            "inRange": price is not None and config.lower <= price <= config.upper,
            "openBuys": sum(1 for r in live if r["side"] == "buy"),
            "openSells": sum(1 for r in live if r["side"] == "sell"),
            "trips": sum(1 for r in sells if r["status"] == "filled"),
            "gridProfit": plain(profit.quantize(CENT)),
            "held": plain(held),
            "unrealised": plain(unrealised.quantize(CENT)) if unrealised is not None else None,
        }

    def view(self) -> dict[str, Any]:
        grids = self._store.grids()
        symbols = sorted({str(g["symbol"]) for g in grids})
        tickers = self._binance.tickers(symbols) if symbols else {}
        prices = {s: Decimal(t["lastPrice"]) for s, t in tickers.items()}
        return {
            "quote": QUOTE,
            "tradingOn": self.trading.settings()["tradingOn"],
            "grids": [self._grid_view(g, prices.get(str(g["symbol"]))) for g in grids],
        }
