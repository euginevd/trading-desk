"""Smart trades (decision 12): a buy, then its exits on Binance, inside the owner's limits."""

import time
from collections.abc import Callable
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo

from api.audit import Audit
from api.binance import Binance, BinanceError, Filters, plain
from api.locks import locked
from api.market import QUOTE
from api.portfolio import orders_view, pair
from api.store import Store

SYDNEY = ZoneInfo("Australia/Sydney")
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

    def parts(self) -> tuple[Binance, Store, Audit, Callable[[], float]]:
        """What a DCA bot needs to share this desk's exchange, store and log (decision 37)."""
        return self._binance, self._store, self._audit, self._clock

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

    @locked
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
            raise Refused(f"Pick a {QUOTE} pair.")
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

    @locked
    def place(self, request: dict[str, Any]) -> dict[str, Any]:
        trade, new = self._store.claim(self._check(request))
        if not new:
            return trade
        symbol = trade["symbol"]
        # The last 34 characters, so a ladder rung's suffix keeps its id apart from the others.
        order_id = "td" + trade["client_id"].replace("-", "")[-34:]
        try:
            if trade["entry"] == "market":
                order = self._binance.buy_market(symbol, Decimal(trade["spend"]), order_id)
            else:
                price = Decimal(trade["limit_price"])
                qty = self._binance.filters(symbol).amount(Decimal(trade["spend"]) / price)
                order = self._binance.buy_limit(symbol, qty, price, order_id)
        except BinanceError as error:
            found = self._sent(symbol, order_id) if error.status == 0 else None
            if found is None:
                self._store.update(
                    trade["id"], status="cancelled", note=error.message, updated=self._now()
                )
                raise
            order = found  # Binance took it; the answer was lost on the way back
        trade = self._store.update(
            trade["id"], status="waiting", buy_id=int(order["orderId"]), updated=self._now()
        )
        return self._follow(trade, order)

    # Limit orders from the Trade page's order form (decision 18).

    @locked
    def place_order(self, request: dict[str, Any]) -> dict[str, Any]:
        """A limit buy goes through the smart trade, so its optional exits work; a limit sell
        goes straight to Binance. Both inside the kill switch, limits and request id."""
        side = str(request.get("side", ""))
        price = number(request.get("price"), "The limit price")
        amount = number(request.get("amount"), "The amount")
        if side == "buy":
            trade = self.place(
                {
                    "clientId": request.get("clientId"),
                    "symbol": request.get("symbol"),
                    "entry": "limit",
                    "limitPrice": plain(price),
                    "spend": plain(price * amount),
                    "takeProfit": request.get("takeProfit"),
                    "stopLoss": request.get("stopLoss"),
                }
            )
            return {"message": f"Limit buy placed on {trade['symbol']}.", "trade": trade}
        if side != "sell":
            raise Refused("Choose Limit buy or Limit sell.")
        return self._sell(request, price, amount)

    @locked
    def ladder_order(self, request: dict[str, Any]) -> dict[str, Any]:
        """A ladder of limit buys from a top to a bottom price (decision 39): each rung a smart
        trade with the same exits, all checked together first so a ladder never goes half."""
        symbol = str(request.get("symbol", "")).upper()
        if not symbol.endswith(QUOTE) or not symbol.isalnum():
            raise Refused(f"Pick a {QUOTE} pair.")
        client_id = str(request.get("clientId", ""))
        if not 8 <= len(client_id) <= 40 or not client_id.replace("-", "").isalnum():  # noqa: PLR2004
            raise Refused("Missing request id: reload the page and try again.")
        filters = self._binance.filters(symbol)
        rungs = ladder_rungs(request, filters)
        settings = self.settings()
        if not settings["tradingOn"]:
            raise Refused("Trading is off. Turn it on in the top bar to trade.")
        per_order, per_day = Decimal(settings["perOrder"]), Decimal(settings["perDay"])
        if per_order <= ZERO or per_day <= ZERO:
            raise Refused("Set your per-order and daily limits first.")
        total = sum((p * q for p, q in rungs), ZERO)
        for p, q in rungs:
            if p * q < filters.min_notional:
                raise Refused(
                    f"Each buy must be at least {money(filters.min_notional)}: fewer orders "
                    "or more to spend."
                )
            if p * q > per_order:
                raise Refused(f"A buy of {money(p * q)} is over your per-order limit.")
        spent = Decimal(settings["spentToday"])
        if spent + total > per_day:
            raise Refused(
                f"The ladder would take today to {money(spent + total)}, "
                f"over your daily limit of {money(per_day)}."
            )
        take, stop = request.get("takeProfit"), request.get("stopLoss")
        placed = [
            self.place(
                {
                    "clientId": f"{client_id}-{n}",
                    "symbol": symbol,
                    "entry": "limit",
                    "limitPrice": plain(p),
                    "spend": plain(p * q),
                    "takeProfit": take,
                    "stopLoss": stop,
                }
            )
            for n, (p, q) in enumerate(rungs)
        ]
        return {
            "message": f"Ladder placed: {len(placed)} limit buys on {pair(symbol)}, "
            f"{money(total)} in all.",
            "trades": placed,
        }

    def _sell(self, request: dict[str, Any], price: Decimal, amount: Decimal) -> dict[str, Any]:
        settings = self.settings()
        if not settings["tradingOn"]:
            raise Refused("Trading is off. Turn it on in the top bar to trade.")
        per_order = Decimal(settings["perOrder"])
        if per_order <= ZERO:
            raise Refused("Set your per-order and daily limits first.")
        symbol = str(request.get("symbol", "")).upper()
        if not symbol.endswith(QUOTE) or not symbol.isalnum():
            raise Refused(f"Pick a {QUOTE} pair.")
        client_id = str(request.get("clientId", ""))
        if not 8 <= len(client_id) <= 64 or not client_id.replace("-", "").isalnum():  # noqa: PLR2004
            raise Refused("Missing request id: reload the page and try again.")
        filters = self._binance.filters(symbol)
        price, qty = filters.price(price), filters.amount(amount)
        value = price * qty
        if qty <= ZERO or value < filters.min_notional:
            raise Refused(
                f"Binance's smallest order on this pair is {money(filters.min_notional)}."
            )
        if value > per_order:
            raise Refused(f"That's over your per-order limit of {money(per_order)}.")
        # Binance refuses a second open order with the same client id, so a double submit can't
        # sell twice.
        order_id = "td" + client_id.replace("-", "")[:32]
        if self._sent(symbol, order_id) is not None:  # a double submit: sent once already
            return {"message": f"That sell is already placed on {pair(symbol)}."}
        self._binance.limit_sell(symbol, qty, price, order_id)
        return {"message": f"Limit sell placed: {plain(qty)} {pair(symbol)} at {plain(price)}."}

    def _owner(self, order_id: int) -> str | None:
        """The bot, smart trade or grid an open order belongs to, which alone may change it."""
        for trade in self._store.open_trades():
            if order_id in (trade["buy_id"], trade["exit_id"]):
                return f"ST-{trade['id']}"
        return self._store.order_owner(order_id)

    def _editable(self, request: dict[str, Any]) -> tuple[str, int, str]:
        """The order to change, checked: whose it is, the kill switch, the limits, the id."""
        symbol = str(request.get("symbol", "")).upper()
        try:
            order_id = int(str(request.get("orderId")))
        except ValueError as error:
            raise Refused("Pick an order to change.") from error
        if not symbol.isalnum():
            raise Refused("Pick an order to change.")
        owner = self._owner(order_id)
        if owner:
            raise Refused(f"This order belongs to {owner}: change it there.")
        settings = self.settings()
        if not settings["tradingOn"]:
            raise Refused("Trading is off. Turn it on in the top bar to trade.")
        if Decimal(settings["perOrder"]) <= ZERO:
            raise Refused("Set your per-order and daily limits first.")
        client_id = str(request.get("clientId", ""))
        if not 8 <= len(client_id) <= 64 or not client_id.replace("-", "").isalnum():  # noqa: PLR2004
            raise Refused("Missing request id: reload the page and try again.")
        return symbol, order_id, "td" + client_id.replace("-", "")[-34:]

    @locked
    def edit_order(self, request: dict[str, Any]) -> dict[str, Any]:
        """A new price or amount for an open limit order (decision 43): Binance cancels it and
        places the replacement in one call, inside the kill switch and the limits."""
        symbol, order_id, client_id = self._editable(request)
        current = self._binance.order(symbol, order_id)
        if current.get("status") != "NEW" or str(current.get("type")) != "LIMIT":
            raise Refused("Only an open limit order that hasn't started filling can be changed.")
        filters = self._binance.filters(symbol)
        price = filters.price(number(request.get("price"), "The limit price"))
        qty = filters.amount(number(request.get("amount"), "The amount"))
        value = price * qty
        if qty <= ZERO or value < filters.min_notional:
            raise Refused(
                f"Binance's smallest order on this pair is {money(filters.min_notional)}."
            )
        settings = self.settings()
        if value > Decimal(settings["perOrder"]):
            raise Refused(
                f"That's over your per-order limit of {money(Decimal(settings['perOrder']))}."
            )
        side = str(current["side"])
        was = Decimal(str(current["price"])) * Decimal(str(current["origQty"]))
        left = Decimal(settings["leftToday"])
        if side == "BUY" and value - was > left:
            raise Refused(f"That's more than today's limit has left ({money(left)}).")
        new = {"side": side, "quantity": plain(qty), "price": plain(price)}
        done = self._binance.replace_limit(symbol, order_id, {**new, "newClientOrderId": client_id})
        self._audit.record(
            "order",
            f"Changed order {order_id} on {pair(symbol)}",
            f"{plain(qty)} at {plain(price)}",
        )
        return {
            "message": f"Order changed: {side.lower()} {plain(qty)} {pair(symbol)} "
            f"at {plain(price)}.",
            "orderId": int(done.get("newOrderResponse", {}).get("orderId", 0)),
        }

    def _sent(self, symbol: str, client_id: str) -> dict[str, Any] | None:
        """The order Binance has under this client id, or None if it has none (decision 47)."""
        try:
            return self._binance.order_by_client(symbol, client_id)
        except BinanceError as error:
            if error.status == 0:
                raise
            return None

    @locked
    def cancel_order(self, symbol: object, order_id: object) -> dict[str, Any]:
        """Cancels an open spot order. A smart trade's buy is cancelled as the trade, so its
        record stays right. Cancelling works with trading off: it only takes risk away."""
        text = str(symbol or "").upper()
        if not text.isalnum():
            raise Refused("Pick an order to cancel.")
        try:
            number_id = int(str(order_id))
        except ValueError as error:
            raise Refused("Pick an order to cancel.") from error
        for trade in self._store.open_trades():
            if trade["status"] == "waiting" and trade["buy_id"] == number_id:
                self.cancel(int(trade["id"]))
                return {"message": f"Cancelled the limit buy on {pair(text)}."}
        self._binance.cancel(text, number_id)
        return {"message": f"Cancelled the order on {pair(text)}."}

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

    @locked
    def watch(self) -> None:
        """Brings every open trade up to date; the api runs it every 30 seconds."""
        for trade in self._store.open_trades():
            try:
                self.refresh(trade)
            except BinanceError:
                continue

    @locked
    def cancel(self, trade_id: int) -> dict[str, Any]:
        trade = self._store.trade(trade_id)
        if trade["status"] != "waiting":
            raise Refused("Only a trade waiting for its entry can be cancelled. Close it instead.")
        order = self._binance.cancel(trade["symbol"], int(trade["buy_id"]))
        return self._follow(trade, {**order, "status": "CANCELED"})

    @locked
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
            "ref": f"ST-{trade['id']}",
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
        symbol = (symbol or f"BTC{QUOTE}").upper()
        self.watch()
        balances = {b["asset"]: b for b in self._binance.balances()}
        listed = self._binance.symbols()
        coins = dict.fromkeys([*DEFAULT_PAIRS, *balances])
        pairs = [f"{c}{QUOTE}" for c in coins if f"{c}{QUOTE}" in listed]
        if symbol not in listed:
            symbol = pairs[0] if pairs else f"BTC{QUOTE}"
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
            "quote": QUOTE,
            "quoteFree": balances.get(QUOTE, {}).get("free", "0"),
            "baseFree": balances.get(base, {}).get("free", "0"),
            "step": plain(filters.step),
            "tick": plain(filters.tick),
            "minOrder": plain(filters.min_notional),
            "settings": self.settings(),
            "trades": [self._view(t, prices) for t in trades],
            "openOrders": orders_view(self._binance.open_orders()),
        }


LADDER_MAX = 20


def ladder_rungs(request: dict[str, Any], filters: Filters) -> list[tuple[Decimal, Decimal]]:
    """Each rung's price and amount: evenly spaced from top to bottom, the spend split equally
    or weighted 1, 2, 3... towards the lower prices, amounts rounded down to the pair's step."""
    top = filters.price(number(request.get("top"), "The top price"))
    bottom = filters.price(number(request.get("bottom"), "The bottom price"))
    if bottom >= top:
        raise Refused("The bottom price must be under the top price.")
    try:
        count = int(str(request.get("count", "")))
    except ValueError as error:
        raise Refused("Choose how many buys.") from error
    if not 2 <= count <= LADDER_MAX:  # noqa: PLR2004
        raise Refused(f"A ladder has 2 to {LADDER_MAX} buys.")
    spend = number(request.get("spend"), "The total to spend")
    weighting = str(request.get("weighting", "equal"))
    if weighting not in ("equal", "lower"):
        raise Refused("Size the buys equally or more at lower prices.")
    weights = [Decimal(1 if weighting == "equal" else n + 1) for n in range(count)]
    found: list[tuple[Decimal, Decimal]] = []
    for n, weight in enumerate(weights):
        at = filters.price(top - (top - bottom) * n / (count - 1))
        found.append((at, filters.amount(spend * weight / sum(weights) / at)))
    return found
