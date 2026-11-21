"""The owner's limits and kill switch (spec 10), and changing or cancelling an open order from
the open-orders list (decision 43). The old smart trades are gone: the Trading account places
trades now."""

import time
from collections.abc import Callable
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo

from api.audit import Audit
from api.binance import Binance, plain
from api.locks import locked
from api.portfolio import pair
from api.store import Store

SYDNEY = ZoneInfo("Australia/Sydney")
ZERO = Decimal(0)


# Client ids the DCA book and the Trading account give their orders (DCA-BTC-26W47-1,
# TRD-SOL-26W47-1-E): changed from the open-orders list, their books would lose them.
DESK_TAGS = ("DCA-", "TRD-")


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

    def _owner(self, order_id: int) -> str | None:
        """The part of the desk an open order belongs to, which alone may change it."""
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
        tag = str(current.get("clientOrderId", ""))
        if tag.startswith(DESK_TAGS):  # one the book hasn't an id for yet: sent, no answer
            raise Refused(f"This order belongs to {tag}: change it on its own page.")
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

    @locked
    def cancel_order(self, symbol: object, order_id: object) -> dict[str, Any]:
        """Cancels an open spot order. Cancelling works with trading off: it only takes risk away.
        The DCA book, the Trading account, bots and grids each see the cancel on their next
        sync and keep their books right."""
        text = str(symbol or "").upper()
        if not text.isalnum():
            raise Refused("Pick an order to cancel.")
        try:
            number_id = int(str(order_id))
        except ValueError as error:
            raise Refused("Pick an order to cancel.") from error
        self._binance.cancel(text, number_id)
        return {"message": f"Cancelled the order on {pair(text)}."}
