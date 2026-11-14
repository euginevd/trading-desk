"""Smart trades (decision 12): a buy, then its exits on Binance, inside the owner's limits."""

import time
from collections.abc import Callable
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo

from api.audit import Audit
from api.binance import Binance, BinanceError, Filters, plain
from api.portfolio import pair
from api.store import Store

SYDNEY = ZoneInfo("Australia/Sydney")
QUOTE = "USDT"
DEFAULT_PAIRS = ("BTC", "ETH", "SOL", "BNB")
ZERO = Decimal(0)
CLOSED = {"closed_tp": "take-profit", "closed_sl": "stop-loss", "closed_market": "market"}


class Refused(Exception):
    """An order the desk won't send; the message says why, in plain words."""


def number(value: object, name: str) -> Decimal:
    try:
        result = Decimal(str(value))
    except InvalidOperation as error:
        raise Refused(f"{name} isn't a number.") from error
    if not result.is_finite() or result <= ZERO:
        raise Refused(f"{name} must be more than zero.")
    return result


def money(value: Decimal) -> str:
    return f"${value:,.2f}"


class Trading:
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

    def _now(self) -> int:
        return int(self._clock() * 1000)

    # Limits and the kill switch (spec 10): zero until set, and trading on by default.

    def settings(self) -> dict[str, Any]:
        per_order = Decimal(self._store.setting("per_order", "0"))
        per_day = Decimal(self._store.setting("per_day", "0"))
        spent = self._spent_today()
        return {
            "tradingOn": self._store.setting("trading_on", "1") == "1",
            "perOrder": plain(per_order),
            "perDay": plain(per_day),
            "spentToday": plain(spent),
            "leftToday": plain(max(per_day - spent, ZERO)),
        }

    def set_limits(self, per_order: object, per_day: object) -> dict[str, Any]:
        order = number(per_order, "The per-order limit")
        day = number(per_day, "The daily limit")
        if order > day:
            raise Refused("The per-order limit can't be more than the daily limit.")
        self._store.set_setting("per_order", plain(order))
        self._store.set_setting("per_day", plain(day))
        self._audit.record("settings", "Limits", f"Per order {money(order)}, per day {money(day)}")
        return self.settings()

    def set_trading(self, on: bool) -> dict[str, Any]:
        self._store.set_setting("trading_on", "1" if on else "0")
        self._audit.record("settings", "Kill switch", "Trading on" if on else "Trading off")
        return self.settings()

    def _spent_today(self) -> Decimal:
        midnight = datetime.fromtimestamp(self._clock(), SYDNEY).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        return self._store.spent_since(int(midnight.timestamp() * 1000))

    # Placing a smart trade.

    def _check(self, request: dict[str, Any]) -> dict[str, Any]:
        """Every limit, checked in code before anything reaches Binance (spec 10, fail closed)."""
        settings = self.settings()
        if not settings["tradingOn"]:
            raise Refused("Trading is off. Turn it on in the top bar to trade.")
        per_order = Decimal(settings["perOrder"])
        per_day = Decimal(settings["perDay"])
        if per_order <= ZERO or per_day <= ZERO:
            raise Refused("Set your per-order and daily limits first.")
        symbol = str(request.get("symbol", "")).upper()
        if not symbol.endswith(QUOTE) or not symbol.isalnum():
            raise Refused("Pick a USDT pair.")
        spend = number(request.get("spend"), "Spend")
        self._within(spend, per_order, per_day, Decimal(settings["spentToday"]))
        return self._priced(request, symbol, spend)

    def _within(self, spend: Decimal, per_order: Decimal, per_day: Decimal, spent: Decimal) -> None:
        if spend > per_order:
            raise Refused(f"That's over your per-order limit of {money(per_order)}.")
        if spent + spend > per_day:
            raise Refused(
                f"That would take today to {money(spent + spend)}, "
                f"over your daily limit of {money(per_day)}."
            )

    def _priced(self, request: dict[str, Any], symbol: str, spend: Decimal) -> dict[str, Any]:
        entry = str(request.get("entry", ""))
        if entry not in ("market", "limit"):
            raise Refused("Choose Market or Limit.")
        filters = self._binance.filters(symbol)
        current = Decimal(self._binance.tickers([symbol])[symbol]["lastPrice"])
        limit_price = None
        if entry == "limit":
            limit_price = filters.price(number(request.get("limitPrice"), "The limit price"))
        reference = limit_price or current
        if spend < filters.min_notional:
            raise Refused(
                f"Binance's smallest order on this pair is {money(filters.min_notional)}."
            )
        take = request.get("takeProfit")
        stop = request.get("stopLoss")
        take_price = filters.price(number(take, "Take profit")) if take not in (None, "") else None
        stop_price = filters.price(number(stop, "Stop loss")) if stop not in (None, "") else None
        if take_price is not None and take_price <= reference:
            raise Refused("Take profit must be above the entry price.")
        if stop_price is not None and stop_price >= reference:
            raise Refused("Stop loss must be below the entry price.")
        client_id = str(request.get("clientId", ""))
        if not 8 <= len(client_id) <= 64 or not client_id.replace("-", "").isalnum():  # noqa: PLR2004
            raise Refused("Missing request id: reload the page and try again.")
        return {
            "client_id": client_id,
            "created": self._now(),
            "symbol": symbol,
            "entry": entry,
            "limit_price": plain(limit_price) if limit_price else None,
            "spend": plain(spend),
            "take_profit": plain(take_price) if take_price else None,
            "stop_loss": plain(stop_price) if stop_price else None,
        }

    def place(self, request: dict[str, Any]) -> dict[str, Any]:
        trade, new = self._store.claim(self._check(request))
        if not new:
            return trade
        symbol = trade["symbol"]
        order_id = "td" + trade["client_id"].replace("-", "")[:32]
        try:
            if trade["entry"] == "market":
                order = self._binance.buy_market(symbol, Decimal(trade["spend"]), order_id)
            else:
                price = Decimal(trade["limit_price"])
                qty = self._binance.filters(symbol).amount(Decimal(trade["spend"]) / price)
                order = self._binance.buy_limit(symbol, qty, price, order_id)
        except BinanceError as error:
            self._store.update(
                trade["id"], status="cancelled", note=error.message, updated=self._now()
            )
            raise
        trade = self._store.update(
            trade["id"], status="waiting", buy_id=int(order["orderId"]), updated=self._now()
        )
        return self._follow(trade, order)

    # Following a trade through: fills, exits and how it ended.

    def _filled(self, trade: dict[str, Any], order: dict[str, Any]) -> dict[str, Any]:
        """Records the fill: what was bought, net of any fee in the coin, and at what price."""
        symbol = trade["symbol"]
        executed = Decimal(str(order["executedQty"]))
        spent = Decimal(str(order["cummulativeQuoteQty"]))
        base = symbol[: -len(QUOTE)]
        fee = sum(
            (
                Decimal(str(f["commission"]))
                for f in self._binance.order_fills(symbol, int(order["orderId"]))
                if f["commissionAsset"] == base
            ),
            ZERO,
        )
        qty = self._binance.filters(symbol).amount(executed - fee)
        return self._store.update(
            trade["id"],
            status="needs_exits",
            qty=plain(qty),
            entry_price=plain(spent / executed),
            updated=self._now(),
        )

    def _exits(self, trade: dict[str, Any]) -> dict[str, Any]:
        symbol, qty = trade["symbol"], Decimal(trade["qty"])
        take = Decimal(trade["take_profit"]) if trade["take_profit"] else None
        stop = Decimal(trade["stop_loss"]) if trade["stop_loss"] else None
        try:
            if take and stop:
                placed = self._binance.sell_oco(symbol, qty, take, stop)
                kind, exit_id = "oco", int(placed["orderListId"])
            elif take:
                kind, exit_id = "tp", int(self._binance.sell_limit(symbol, qty, take)["orderId"])
            elif stop:
                kind, exit_id = "sl", int(self._binance.sell_stop(symbol, qty, stop)["orderId"])
            else:
                return self._store.update(
                    trade["id"], status="open", note=None, updated=self._now()
                )
        except BinanceError as error:
            return self._store.update(trade["id"], note=error.message, updated=self._now())
        return self._store.update(
            trade["id"],
            status="protected",
            exit_kind=kind,
            exit_id=exit_id,
            note=None,
            updated=self._now(),
        )

    def _follow(self, trade: dict[str, Any], order: dict[str, Any]) -> dict[str, Any]:
        status = str(order["status"])
        if status == "FILLED":
            return self._exits(self._filled(trade, order))
        if status in ("CANCELED", "EXPIRED", "REJECTED", "EXPIRED_IN_MATCH"):
            if Decimal(str(order["executedQty"])) > ZERO:
                return self._exits(self._filled(trade, order))
            return self._store.update(trade["id"], status="cancelled", updated=self._now())
        return trade

    def _closed(self, trade: dict[str, Any], order: dict[str, Any], status: str) -> dict[str, Any]:
        executed = Decimal(str(order["executedQty"]))
        price = Decimal(str(order["cummulativeQuoteQty"])) / executed if executed else None
        return self._store.update(
            trade["id"],
            status=status,
            exit_price=plain(price) if price else None,
            updated=self._now(),
        )

    def _check_exits(self, trade: dict[str, Any]) -> dict[str, Any]:
        symbol = trade["symbol"]
        if trade["exit_kind"] == "oco":
            listed = self._binance.order_list(int(trade["exit_id"]))
            if listed.get("listOrderStatus") != "ALL_DONE":
                return trade
            for leg in listed.get("orders", []):
                order = self._binance.order(symbol, int(leg["orderId"]))
                if order["status"] == "FILLED":
                    won = order["type"] in ("LIMIT_MAKER", "LIMIT")
                    return self._closed(trade, order, "closed_tp" if won else "closed_sl")
        else:
            order = self._binance.order(symbol, int(trade["exit_id"]))
            if order["status"] == "FILLED":
                return self._closed(trade, order, f"closed_{trade['exit_kind']}")
            if order["status"] not in ("CANCELED", "EXPIRED"):
                return trade
        note = "Its exits were cancelled on Binance; it's held with no exits."
        return self._store.update(trade["id"], status="open", note=note, updated=self._now())

    def refresh(self, trade: dict[str, Any]) -> dict[str, Any]:
        if trade["status"] == "waiting":
            return self._follow(trade, self._binance.order(trade["symbol"], int(trade["buy_id"])))
        if trade["status"] == "needs_exits":
            return self._exits(trade)
        if trade["status"] == "protected":
            return self._check_exits(trade)
        return trade

    def watch(self) -> None:
        """Brings every open trade up to date; the api runs it every 30 seconds."""
        for trade in self._store.open_trades():
            try:
                self.refresh(trade)
            except BinanceError:
                continue

    def cancel(self, trade_id: int) -> dict[str, Any]:
        trade = self._store.trade(trade_id)
        if trade["status"] != "waiting":
            raise Refused("Only a trade waiting for its entry can be cancelled. Close it instead.")
        order = self._binance.cancel(trade["symbol"], int(trade["buy_id"]))
        return self._follow(trade, {**order, "status": "CANCELED"})

    def close(self, trade_id: int) -> dict[str, Any]:
        trade = self.refresh(self._store.trade(trade_id))
        if trade["status"] not in ("protected", "needs_exits", "open"):
            raise Refused("Only an open trade can be closed at market.")
        symbol = trade["symbol"]
        if trade["status"] == "protected":
            if trade["exit_kind"] == "oco":
                self._binance.cancel_list(symbol, int(trade["exit_id"]))
            else:
                self._binance.cancel(symbol, int(trade["exit_id"]))
        order = self._binance.sell_market(symbol, Decimal(trade["qty"]))
        return self._closed(trade, order, "closed_market")

    # What the trade terminal shows.

    def _view(self, trade: dict[str, Any], prices: dict[str, Decimal]) -> dict[str, Any]:
        entry = Decimal(trade["entry_price"]) if trade["entry_price"] else None
        qty = Decimal(trade["qty"]) if trade["qty"] else None
        exit_price = Decimal(trade["exit_price"]) if trade["exit_price"] else None
        now = exit_price or prices.get(trade["symbol"])
        profit = (now - entry) * qty if entry and qty and now else None
        return {
            "id": trade["id"],
            "created": trade["created"],
            "pair": pair(trade["symbol"]),
            "entry": trade["entry"],
            "entryPrice": plain(entry) if entry else trade["limit_price"],
            "amount": trade["qty"],
            "spend": trade["spend"],
            "takeProfit": trade["take_profit"],
            "stopLoss": trade["stop_loss"],
            "status": trade["status"],
            "exitPrice": trade["exit_price"],
            "profit": plain(profit) if profit is not None else None,
            "note": trade["note"],
        }

    def terminal(self, symbol: str) -> dict[str, Any]:
        symbol = (symbol or "BTCUSDT").upper()
        self.watch()
        balances = {b["asset"]: b for b in self._binance.balances()}
        listed = self._binance.symbols()
        coins = dict.fromkeys([*DEFAULT_PAIRS, *balances])
        pairs = [f"{c}{QUOTE}" for c in coins if f"{c}{QUOTE}" in listed]
        if symbol not in listed:
            symbol = pairs[0] if pairs else "BTCUSDT"
        trades = self._store.trades()
        watched = {
            symbol,
            *(t["symbol"] for t in trades if t["status"] in ("protected", "open", "needs_exits")),
        }
        tickers = self._binance.tickers(sorted(watched))
        prices = {s: Decimal(t["lastPrice"]) for s, t in tickers.items()}
        filters: Filters = self._binance.filters(symbol)
        base = symbol[: -len(QUOTE)]
        return {
            "symbol": symbol,
            "pair": pair(symbol),
            "pairs": [{"symbol": s, "pair": pair(s)} for s in pairs],
            "price": tickers[symbol]["lastPrice"],
            "change24h": tickers[symbol]["priceChangePercent"],
            "base": base,
            "quoteFree": balances.get(QUOTE, {}).get("free", "0"),
            "baseFree": balances.get(base, {}).get("free", "0"),
            "step": plain(filters.step),
            "tick": plain(filters.tick),
            "minOrder": plain(filters.min_notional),
            "settings": self.settings(),
            "trades": [self._view(t, prices) for t in trades],
        }
