"""Take profit on a Trading-account position (owner, 21 Nov 2026): sell 25, 50, 75 or 100% of
it, at market now or as limit sells at prices the desk suggests from resistance. A position is
every buy of one ladder (or one trade), so each take-profit order is one Binance sell for the
whole position (-P1, -P2 on the position's first reference), and its fill is booked across the
position's buys, oldest first. Every sell is at least $10, and what stays is $10 or more, or
nothing, so no dust is left that Binance won't sell."""

import contextlib
from collections.abc import Callable
from decimal import Decimal
from typing import TYPE_CHECKING, Any, cast

from api import screener
from api.binance import BinanceError, Filters, plain
from api.dca_book import binance_state
from api.locks import locked
from api.market import QUOTE
from api.trading import Refused, number

if TYPE_CHECKING:
    from api.pot import Pot

ZERO = Decimal(0)
HUNDRED = Decimal(100)
TP_MAX = 3  # take-profit orders in one plan
SHARES = {1: [100], 2: [50, 50], 3: [40, 30, 30]}  # each order's part of what's sold
LIVE = ("placing", "open")
PCTS = (Decimal(25), Decimal(50), Decimal(75), HUNDRED)


def swing_highs(rows: list[list[Any]], k: int = 3) -> list[float]:
    """Highs higher than the k candles either side."""
    highs = [float(r[2]) for r in rows]
    return [
        highs[i]
        for i in range(k, len(highs) - k)
        if all(highs[i] > highs[j] for j in range(i - k, i + k + 1) if j != i)
    ]


def tp_count(value: Decimal, floor: Decimal) -> int:
    """How many orders a sell of `value` splits into: each at least `floor`, three at most."""
    n = TP_MAX
    while n > 1 and value * min(SHARES[n]) / HUNDRED < floor:
        n -= 1
    return n


def suggest_levels(  # noqa: PLR0913 - the candles, the prices and the sell
    rows: list[list[Any]],
    now: Decimal,
    avg: Decimal,
    *,
    value: Decimal,
    pct: Decimal,
    floor: Decimal,
) -> list[dict[str, Any]]:
    """Limit sells above the price and the average after fees, each just under resistance (the
    30-day high, swing highs, the calendar's levels and averages above); where resistance runs
    out, an ATR apart. `pct` of the position is split 100, 50/50 or 40/30/30 by size."""
    from api.pot import FEE  # noqa: PLC0415 - pot imports this module

    price = float(now)
    a = screener.atr(rows) or price * 0.04
    lowest = max(float(avg) * float(1 + 2 * FEE) * 1.005, price * 1.005)
    found: list[tuple[float, str]] = (
        [(z["price"], ", ".join(z["names"][:2])) for z in screener.levels(rows, a)] if rows else []
    )
    found += [(h, "Swing high") for h in swing_highs(rows[-90:])]
    if rows:
        found.append((max(float(r[2]) for r in rows[-30:]), "30-day high"))
    count = tp_count(value * pct / HUNDRED, floor)
    picked: list[tuple[float, str]] = []
    for level, name in sorted(f for f in found if f[0] * 0.995 >= lowest):
        if len(picked) == count:
            break
        if picked and level * 0.995 - picked[-1][0] < a * 0.5:
            continue  # too close to the one under it
        picked.append((level * 0.995, f"Under the {name[:1].lower()}{name[1:]}"[:60]))
    while len(picked) < count:
        top = picked[-1][0] if picked else max(lowest, price)
        picked.append((top + a, f"{(top + a) / price * 100 - 100:.0f}% over, an ATR up"))
    shares = SHARES[count]
    return [
        {"price": Decimal(str(p)), "pct": pct * s / HUNDRED, "why": why}
        for (p, why), s in zip(picked, shares, strict=True)
    ]


def plan_sells(  # noqa: C901, PLR0912, PLR0913, PLR0915 - one plan's checks, in order
    body: dict[str, Any],
    *,
    coin: str,
    rules: Filters,
    now: Decimal,
    avg: Decimal,
    held: Decimal,
    free: Decimal,
    days: Callable[[], list[list[Any]]],
) -> dict[str, Any]:
    """A plan to sell part or all of a holding, for the Trading account and the DCA book alike:
    its levels (the desk's, from resistance, or the owner's) with what each sells, and what's
    wrong with it: problems refuse, warnings (a sell under the average after fees) need
    "anyway". `free` is what's held and not already in a sell."""
    from api.pot import FEE, MIN_ORDER  # noqa: PLC0415 - pot imports this module

    market = body.get("market") is True
    pct = number(body.get("pct") or "100", "The share to sell")
    if pct <= ZERO or pct > HUNDRED:
        raise Refused("Sell between 1 and 100% of the position.")
    if free <= ZERO:
        raise Refused("Everything it holds is already in a sell order.")
    breakeven = avg * (1 + 2 * FEE)
    floor = max(rules.min_notional, MIN_ORDER)
    given = cast(list[dict[str, Any]], body.get("levels") or [])
    if market:
        levels = [{"price": None, "pct": pct, "why": "At market now"}]
    elif given:
        levels = [
            {
                "price": number(g.get("price"), "Price"),
                "pct": number(g.get("pct"), "Share"),
                "why": str(g.get("why") or "")[:60],
            }
            for g in given[:TP_MAX]
        ]
    else:
        levels = suggest_levels(days(), now, avg, value=free * now, pct=pct, floor=floor)
    problems: list[str] = []
    warnings: list[str] = []
    notes: list[str] = []
    total = sum((cast(Decimal, lv["pct"]) for lv in levels), ZERO)
    if total > HUNDRED:
        problems.append("The levels sell more than 100% of the position.")
    shown: list[dict[str, Any]] = []
    sold = ZERO
    for i, lv in enumerate(levels):
        at = rules.price(cast(Decimal, lv["price"])) if lv["price"] is not None else None
        last = i == len(levels) - 1 and total == HUNDRED
        qty = free - sold if last else rules.amount(free * cast(Decimal, lv["pct"]) / HUNDRED)
        sold += qty
        worth = qty * (at or now)
        if worth < floor:
            problems.append(
                f"{'Selling' if at is None else 'At ' + plain(at) + ','} {lv['pct']:.0f}% is "
                f"${worth:,.2f}: each sell is at least ${floor:,.2f}."
            )
        if at is not None and at <= now:
            problems.append(f"{plain(at)} is at or under the price now: sell at market.")
        if at is not None and rules.ask_up is not None and at > now * rules.ask_up:
            problems.append(f"{plain(at)} is further over the price than Binance accepts.")
        if (at or now) < breakeven:
            warnings.append(
                f"{'At market' if at is None else 'At ' + plain(at)} it sells under your "
                f"average after fees ({plain(rules.price(breakeven))}): a loss."
            )
        shown.append(
            {
                "price": plain(at) if at is not None else None,
                "pct": plain(cast(Decimal, lv["pct"]).quantize(Decimal("0.1")).normalize()),
                "qty": plain(qty),
                "value": str(worth.quantize(Decimal("0.01"))),
                "gainPct": str(((at or now) / avg * HUNDRED - HUNDRED).quantize(Decimal("0.1")))
                if avg
                else None,
                "why": lv["why"],
            }
        )
    kept = free - sold
    if ZERO < kept * now < floor:
        problems.append(
            f"That leaves ${kept * now:,.2f}, under ${floor:,.2f}, which Binance won't sell "
            "later: sell 100%, or less."
        )
    value = free * now
    return {
        "coin": coin,
        "market": market,
        "now": plain(now),
        "avg": plain(rules.price(avg)) if avg else None,
        "breakeven": plain(rules.price(breakeven)) if avg else None,
        "held": plain(held),
        "free": plain(free),
        "value": str(value.quantize(Decimal("0.01"))),
        # A share is offered when it can sell at least $10 and leave $10 or nothing.
        "pcts": [
            plain(p)
            for p in PCTS
            if value * p / HUNDRED >= floor
            and (p == HUNDRED or value * (HUNDRED - p) / HUNDRED >= floor)
        ],
        "maxLevels": tp_count(value * pct / HUNDRED, floor),
        "pct": plain(pct),
        "levels": shown,
        "problems": problems,
        "warnings": warnings,
        "notes": notes,
        "sellsAll": kept <= ZERO,
    }


class TakeProfit:
    def __init__(self, pot: "Pot") -> None:
        self._pot = pot
        self._store = pot.store
        self._binance = pot.binance

    # The position and what it holds.

    def trades(self, position: str) -> list[dict[str, Any]]:
        """The position's buys, oldest first."""
        from api.pot import position_key  # noqa: PLC0415 - pot imports this module

        rows = [r for r in self._store.pot_trades() if position_key(r) == position]
        return sorted(rows, key=lambda r: (r["filled"] or r["created"], r["created"]))

    def live(self, position: str) -> list[dict[str, Any]]:
        return [
            o
            for o in self._store.pot_orders()
            if o["role"] == "tp" and o["trade_ref"] == position and o["status"] in LIVE
        ]

    def _held(self, rows: list[dict[str, Any]]) -> Decimal:
        return sum(
            (
                Decimal(r["fill_qty"]) - Decimal(r["exit_qty"])
                for r in rows
                if r["status"] == "open"
            ),
            ZERO,
        )

    def _reserved(self, position: str) -> Decimal:
        return sum(
            (Decimal(o["qty"]) - Decimal(o["executed_qty"]) for o in self.live(position)), ZERO
        )

    # Preview and place.

    def preview(self, body: dict[str, Any]) -> dict[str, Any]:
        """The plan with its checks: problems refuse, warnings need "anyway", notes just say."""
        from api.pot import is_held  # noqa: PLC0415 - pot imports this module

        position = str(body.get("position") or "")
        rows = self.trades(position)
        held_rows = [r for r in rows if r["status"] == "open"]
        if not held_rows:
            raise Refused("That position holds nothing to sell yet.")
        coin = held_rows[0]["coin"]
        held = self._held(rows)
        all_now = body.get("market") is True and str(body.get("pct") or "100") == "100"
        reserved = ZERO if all_now else self._reserved(position)
        paid = sum((Decimal(r["fill_quote"]) for r in held_rows), ZERO)
        bought = sum((Decimal(r["fill_qty"]) for r in held_rows), ZERO)
        seen = plan_sells(
            body,
            coin=coin,
            rules=self._pot.rules_of(coin),
            now=self._pot.price_now(coin),
            avg=paid / bought if bought else ZERO,
            held=held,
            free=held - reserved,
            days=lambda: self._binance.klines(f"{coin}{QUOTE}", "1d", 400),
        )
        notes = seen["notes"]
        if reserved > ZERO:
            notes.append(f"{plain(reserved)} {coin} is already in take-profit orders.")
        if any(not is_held(r) for r in held_rows):
            notes.append("Its stop and target come off Binance: these sells replace them.")
        waiting = [r for r in rows if r["status"] in ("placing", "waiting")]
        if waiting and seen["sellsAll"] and reserved <= ZERO:
            these = "limit is" if len(waiting) == 1 else "limits are"
            notes.append(f"Its {len(waiting)} waiting buy {these} cancelled too.")
        return {"position": position, **seen}

    @locked
    def place(self, body: dict[str, Any]) -> dict[str, Any]:
        """The plan's sells on Binance, after its checks."""
        position = str(body.get("position") or "")
        if body.get("market") is True and str(body.get("pct") or "100") == "100":
            for o in self.live(position):  # selling it all: its take-profit orders come off
                self._cancel(o)
        seen = self.preview(body)
        if seen["problems"]:
            raise Refused(seen["problems"][0])
        if seen["warnings"] and body.get("anyway") is not True:
            raise Refused("Read the warnings, then sell anyway: " + " ".join(seen["warnings"]))
        self._free_coins(self.trades(position), seen)
        failed: list[str] = []
        for lv in seen["levels"]:
            try:
                self._send(position, seen["coin"], lv)
            except BinanceError as error:
                failed.append(f"{lv['price'] or 'market'}: {error.message}")
        self._pot.audit.record(
            "pot", f"{position}: take profit", f"{len(seen['levels'])} sells, {seen['pct']}%"
        )
        if failed:
            raise Refused("Binance refused " + "; ".join(failed))
        return self._pot.view()

    def _free_coins(self, rows: list[dict[str, Any]], seen: dict[str, Any]) -> None:
        """The position's coins free on Binance: any stop and target come off first, and its
        waiting buys too when the plan sells it all."""
        from api.pot import HELD  # noqa: PLC0415 - pot imports this module

        for r in rows:
            if r["status"] == "open" and r["exit_kind"] != HELD:
                self._pot.pull_exit(r)
                self._pot.save_trade(self._pot.trade(r["ref"]), {"exit_kind": HELD})
                self._pot.log(r["ref"], "Its stop and target came off for take-profit sells.")
        if seen["sellsAll"]:
            for r in rows:
                if r["status"] in ("placing", "waiting"):
                    with contextlib.suppress(Refused, BinanceError):
                        self._pot.cancel(r["ref"])

    def _send(self, position: str, coin: str, level: dict[str, Any]) -> None:
        made = [o for o in self._store.pot_orders() if o["trade_ref"] == position]
        n = 1 + sum(1 for o in made if o["role"] == "tp")
        order: dict[str, Any] = {
            "ref": f"{position}-P{n}",
            "trade_ref": position,
            "role": "tp",
            "kind": "market" if level["price"] is None else "limit",
            "side": "sell",
            "price": level["price"],
            "stop": None,
            "qty": level["qty"],
            "spend": None,
            "created": self._pot.now_ms(),
        }
        self._store.add_pot_order(order)
        saved = self._pot.order(order["ref"])
        symbol, qty = f"{coin}{QUOTE}", Decimal(level["qty"])
        what = (
            f"take profit: sell {level['qty']} at market"
            if level["price"] is None
            else f"take profit: limit sell {level['qty']} at {level['price']}"
        )
        self._pot.log(position, what[0].upper() + what[1:] + ".")
        try:
            if level["price"] is None:
                sent = self._binance.sell_market(symbol, qty, order["ref"])
            else:
                sent = self._binance.limit_sell(symbol, qty, Decimal(level["price"]), order["ref"])
        except BinanceError as error:
            from api.pot import unknown  # noqa: PLC0415 - pot imports this module

            if not unknown(error):  # unknown: the next sync looks it up by its id
                self._pot.save_order(saved, {"status": "cancelled"})
                raise
            return
        self.follow(saved, sent)

    # Following and booking.

    def follow(self, order: dict[str, Any], sent: dict[str, Any]) -> None:
        """A take-profit order's latest state from Binance; once it's done, what it sold is
        booked across the position's buys."""
        state, executed = binance_state(sent)
        quote = Decimal(str(sent.get("cummulativeQuoteQty", "0")))
        order_id = int(sent.get("orderId") or 0) or order["order_id"]
        changes: dict[str, Any] = {
            "order_id": order_id,
            "status": state,
            "executed_qty": plain(executed),
            "executed_quote": plain(quote),
        }
        if state == "open":
            self._pot.save_order(order, changes)
            return
        coin = self._pot.trade(order["trade_ref"])["coin"]
        self._pot.rules_of(coin)  # read before any save, as in Pot._follow
        fee = ZERO
        if executed > ZERO and order_id:
            fee, in_coin = self._pot.fees(coin, int(order_id))
            fee += in_coin * quote / executed
        self._pot.save_order(order, changes | {"fee_usd": plain(fee)})
        if executed > ZERO:
            self._book(order, executed, quote, fee)

    def _book(self, order: dict[str, Any], qty: Decimal, quote: Decimal, fee: Decimal) -> None:
        kind = "target" if order["kind"] == "limit" else "market"
        left = qty
        for r in self.trades(order["trade_ref"]):
            if left <= ZERO:
                break
            if r["status"] != "open":
                continue
            take = min(Decimal(r["fill_qty"]) - Decimal(r["exit_qty"]), left)
            if take <= ZERO:
                continue
            share = take / qty
            self._pot.close_part(r, take, quote * share, Decimal(r["fees_usd"]) + fee * share, kind)
            left -= take
        at = plain(round(quote / qty, 8))
        self._pot.log(
            order["trade_ref"],
            f"Take profit {order['ref']} sold {plain(qty)} at {at}"
            + (f"; {plain(left)} more than the position held." if left > ZERO else "."),
        )

    def _cancel(self, order: dict[str, Any]) -> None:
        coin = self._pot.trade(order["trade_ref"])["coin"]
        symbol = f"{coin}{QUOTE}"
        if order["order_id"] is None:
            self._pot.refresh(order)
            order = self._pot.order(order["ref"])
            if order["status"] not in LIVE:
                return
            if order["order_id"] is None:
                raise Refused("Binance hasn't confirmed that take-profit order yet. Try again.")
        with contextlib.suppress(BinanceError):  # filled meanwhile: its state says so
            self._binance.cancel(symbol, int(order["order_id"]))
        self.follow(order, self._binance.order(symbol, int(order["order_id"])))

    @locked
    def cancel(self, ref: object) -> dict[str, Any]:
        order = self._store.pot_order(str(ref or ""))
        if order is None or order["role"] != "tp":
            raise Refused("There's no take-profit order with that reference.")
        if order["status"] not in LIVE:
            raise Refused("That take-profit order isn't waiting any more.")
        self._cancel(order)
        self._pot.log(order["trade_ref"], f"Take profit {order['ref']} cancelled.")
        return self._pot.view()

    def views(self) -> list[dict[str, Any]]:
        """Every take-profit order, for the Positions table."""
        return [
            {
                "ref": o["ref"],
                "position": o["trade_ref"],
                "kind": o["kind"],
                "price": o["price"],
                "qty": o["qty"],
                "executedQty": o["executed_qty"],
                "executedQuote": o["executed_quote"],
                "status": o["status"],
                "created": o["created"],
            }
            for o in self._store.pot_orders()
            if o["role"] == "tp" and not (o["status"] == "cancelled" and o["order_id"] is None)
        ]
