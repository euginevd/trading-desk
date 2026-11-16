"""The DCA book (TODO 11): one lifelong position per coin (DCA-BTC and so on), fed by orders
placed from the desk only. Each order is a row with its own reference, fills and fees; a
position's average cost holds on a sell, which books realised P&L, and its buy-back lowers it.
Profit and loss is judged against the money put in, net of what sales took out."""

import json
import math
import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_FLOOR, Decimal
from typing import Any, cast
from zoneinfo import ZoneInfo

from api.binance import BinanceError, plain
from api.locks import locked
from api.market import QUOTE
from api.trading import Refused, Trading, number

SYDNEY = ZoneInfo("Australia/Sydney")
ZERO = Decimal(0)
PLAN_KEY = "dca_plan"
RATE_KEY = "aud_per_usd"  # the desk's remembered A$ per US$ (profile_live)
SOURCES = ("weekly", "named", "close-out", "trim", "buy-back", "desk")
DAY_MS = 86_400_000
WEEK_MS = 7 * DAY_MS
ODDS_WEEKS = 52
FEW_WEEKS = 26  # under this many weeks of history, the odds aren't worth much
WINDOW_HOURS = 72  # Friday 7pm to Monday 7pm, Sydney
CANDLE_HOURS = 4
COIN = re.compile(r"[A-Z0-9]{1,10}")
MAX_PLAN_ORDERS = 12
MAX_WEEKS = 520


# The DCA week runs from Friday 5pm, Sydney, to the next; it is named by that Friday.


def week_of(ms: int) -> tuple[str, datetime]:
    at = datetime.fromtimestamp(ms / 1000, SYDNEY)
    friday = (at - timedelta(days=(at.weekday() - 4) % 7)).replace(
        hour=17, minute=0, second=0, microsecond=0
    )
    if at < friday:
        friday -= timedelta(days=7)
    year, week, _ = friday.isocalendar()
    return f"{year % 100:02d}W{week:02d}", friday


def close_out_of(friday: datetime) -> datetime:
    """Monday 7pm after the week's Friday: unfilled limits are bought at market."""
    return (friday + timedelta(days=3)).replace(hour=19, minute=0)


# Fill odds: how often, in the last 52 weeks, the coin traded this far under its Friday
# evening price before Monday evening. The desk works them out, never the model.


def dips(candles: Iterable[list[Any]]) -> list[Decimal]:
    rows = [(int(c[0]), Decimal(str(c[1])), Decimal(str(c[3]))) for c in candles]
    found: list[Decimal] = []
    span = WINDOW_HOURS // CANDLE_HOURS
    for i, (opened, price, _) in enumerate(rows):
        at = datetime.fromtimestamp(opened / 1000, UTC)
        if at.weekday() != 4 or at.hour != 8:  # noqa: PLR2004 - 08:00 UTC, about 7pm Sydney
            continue
        window = rows[i : i + span]
        if len(window) < span or price <= ZERO:
            continue
        found.append(1 - min(low for _, _, low in window) / price)
    return found[-ODDS_WEEKS:]


def odds(found: list[Decimal], now: Decimal, price: Decimal) -> dict[str, Any]:
    need = 1 - price / now
    hit = sum(1 for d in found if d >= need)
    total = len(found)
    return {
        "hit": hit,
        "weeks": total,
        "pct": round(hit * 100 / total) if total else None,
        "few": total < FEW_WEEKS,
    }


def unround(price: Decimal, tick: Decimal) -> Decimal:
    """A limit just above a round number, not on it: orders crowd round numbers and fill first
    come, first served, so 63,800 becomes 63,837 (the agent's rule)."""
    if price <= ZERO:
        return price
    exponent = int(price.log10().to_integral_value(rounding=ROUND_FLOOR)) - 2
    step = Decimal(10) ** exponent
    rest = price % step
    if rest < step * Decimal("0.3"):
        price = price - rest + step * Decimal("0.37")
    return (price // tick) * tick if tick > ZERO else price


def target_price(found: list[Decimal], now: Decimal, pct: int) -> Decimal:
    """The price that filled in about pct% of past weeks."""
    if not found:
        return now
    ranked = sorted(found, reverse=True)
    k = min(max(1, math.floor(len(ranked) * pct / 100 + 0.5)), len(ranked))
    return now * (1 - max(ranked[k - 1], ZERO))


# The plan: the weekly orders, from the owner's settings (never in code: the repo is public).


def parse_plan(body: dict[str, Any]) -> dict[str, Any]:
    try:
        start = date.fromisoformat(str(body.get("start", "")))
    except ValueError:
        raise Refused("Start must be a date, like 2026-11-16.") from None
    weeks = body.get("weeks")
    if not isinstance(weeks, int) or not 1 <= weeks <= MAX_WEEKS:
        raise Refused(f"Weeks must be a whole number from 1 to {MAX_WEEKS}.")
    raw: object = body.get("orders")
    items = cast(list[object], raw) if isinstance(raw, list) else []
    if not 1 <= len(items) <= MAX_PLAN_ORDERS:
        raise Refused(f"The plan needs 1 to {MAX_PLAN_ORDERS} weekly orders.")
    orders: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            raise Refused("Each weekly order needs a coin, an amount and its odds.")
        slot = cast(dict[str, Any], item)
        coin = str(slot.get("coin", "")).upper()
        if not COIN.fullmatch(coin):
            raise Refused("Each weekly order needs a coin, like BTC.")
        spend = number(slot.get("spend"), "Each order's amount")
        pct = slot.get("odds")
        if not isinstance(pct, int) or not 5 <= pct <= 95:  # noqa: PLR2004
            raise Refused("Each order's fill odds must be a whole number from 5 to 95.")
        orders.append({"coin": coin, "spend": plain(spend), "odds": pct})
    return {"start": start.isoformat(), "weeks": weeks, "orders": orders}


# Positions, from the filled part of every order, oldest first.


@dataclass
class Position:
    coin: str
    qty: Decimal = ZERO
    cost: Decimal = ZERO
    added: Decimal = ZERO
    realised: Decimal = ZERO
    fees: Decimal = ZERO
    outside_fees: Decimal = ZERO  # paid in BNB or another coin: not in qty or cost
    since: int | None = None

    def take(self, row: dict[str, Any]) -> None:
        qty = Decimal(row["executed_qty"])
        if qty <= ZERO:
            return
        quote = Decimal(row["executed_quote"])
        fee_base, fee_quote = Decimal(row["fee_base"]), Decimal(row["fee_quote"])
        fee_usd = Decimal(row["fee_usd"])
        self.fees += fee_usd
        self.outside_fees += max(fee_usd - fee_base * quote / qty - fee_quote, ZERO)
        if row["side"] == "buy":
            self.since = self.since or int(row["updated"])
            self.qty += qty - fee_base
            self.cost += quote + fee_quote
            self.added += quote + fee_quote
            return
        sold = min(qty, self.qty)
        average = self.cost / self.qty if self.qty > ZERO else ZERO
        proceeds = quote - fee_quote
        self.realised += proceeds - average * sold
        self.cost -= average * sold
        self.qty -= sold + fee_base
        self.added -= proceeds

    def view(self, price: Decimal | None, rate: Decimal) -> dict[str, Any]:
        average = self.cost / self.qty if self.qty > ZERO else None
        value = self.qty * price if price is not None else None
        pnl = value - self.added - self.outside_fees if value is not None else None
        return {
            "coin": self.coin,
            "id": f"DCA-{self.coin}",
            "since": self.since,
            "qty": plain(self.qty),
            "avgCost": plain(round(average, 8)) if average is not None else None,
            "avgCostAud": plain(round(average * rate, 2)) if average is not None else None,
            "added": plain(round(self.added, 2)),
            "price": plain(price) if price is not None else None,
            "value": plain(round(value, 2)) if value is not None else None,
            "pnl": plain(round(pnl, 2)) if pnl is not None else None,
            "pnlPct": plain(round(pnl * 100 / self.added, 2))
            if pnl is not None and self.added > ZERO
            else None,
            "realised": plain(round(self.realised, 2)),
            "fees": plain(round(self.fees, 2)),
        }


def positions(rows: list[dict[str, Any]], coins: list[str]) -> dict[str, Position]:
    found = {c: Position(c) for c in coins}
    for row in rows:
        found.setdefault(row["coin"], Position(row["coin"])).take(row)
    return found


def order_view(row: dict[str, Any]) -> dict[str, Any]:
    qty = Decimal(row["executed_qty"])
    quote = Decimal(row["executed_quote"])
    return {
        "ref": row["ref"],
        "coin": row["coin"],
        "side": row["side"],
        "kind": row["kind"],
        "source": row["source"],
        "link": row["link"],
        "week": row["week"],
        "price": row["price"],
        "qty": row["qty"],
        "spend": row["spend"],
        "status": row["status"],
        "filledQty": plain(qty),
        "filledQuote": plain(quote),
        "avgPrice": plain(round(quote / qty, 8)) if qty > ZERO else None,
        "fee": plain(round(Decimal(row["fee_usd"]), 4)),
        "created": row["created"],
        "updated": row["updated"],
    }


class DcaBook:
    def __init__(self, desk: Trading) -> None:
        self._desk = desk
        self._binance, self._store, self._audit, self._clock = desk.parts()
        self._dips: dict[str, list[Decimal]] = {}

    def _now(self) -> int:
        return int(self._clock() * 1000)

    def plan(self) -> dict[str, Any] | None:
        raw = self._store.setting(PLAN_KEY, "")
        return json.loads(raw) if raw else None

    def set_plan(self, body: dict[str, Any]) -> dict[str, Any]:
        plan = parse_plan(body)
        self._store.set_setting(PLAN_KEY, json.dumps(plan))
        total = sum((Decimal(o["spend"]) for o in plan["orders"]), ZERO)
        self._audit.record("dca", "Plan", f"{plain(total)} a week for {plan['weeks']} weeks")
        return self.view()

    def coins(self) -> list[str]:
        plan = self.plan()
        if not plan:
            return []
        return list(dict.fromkeys(o["coin"] for o in plan["orders"]))

    def _rate(self) -> Decimal:
        return Decimal(self._store.setting(RATE_KEY, "1.5"))

    # Prices and the desk's fill odds.

    def _prices(self, coins: list[str]) -> dict[str, Decimal]:
        rows = self._binance.tickers([f"{c}{QUOTE}" for c in coins])
        return {
            c: Decimal(str(rows[f"{c}{QUOTE}"]["lastPrice"]))
            for c in coins
            if f"{c}{QUOTE}" in rows
        }

    def _dips_of(self, coin: str) -> list[Decimal]:
        if coin not in self._dips:
            since = self._now() - (ODDS_WEEKS + 2) * WEEK_MS
            self._dips[coin] = dips(self._binance.klines_since(f"{coin}{QUOTE}", "4h", since))
        return self._dips[coin]

    def odds(self, coin: str, price: object) -> dict[str, Any]:
        coin = coin.upper()
        if coin not in self.coins():
            raise Refused(f"{coin} isn't in your DCA plan.")
        limit = number(price, "Price")
        now = self._prices([coin]).get(coin)
        if now is None:
            raise Refused(f"There's no {coin}/{QUOTE} price on Binance.")
        return odds(self._dips_of(coin), now, limit) | {"now": plain(now)}

    def suggest(self) -> dict[str, Any]:
        """This week's orders from the plan, each at the price that filled in about its target
        share of the last 52 weeks, nudged off round numbers."""
        plan = self.plan()
        if not plan:
            raise Refused("Set your weekly plan first.")
        coins = self.coins()
        now = self._prices(coins)
        rows: list[dict[str, Any]] = []
        for slot in plan["orders"]:
            coin = slot["coin"]
            if coin not in now:
                raise Refused(f"There's no {coin}/{QUOTE} price on Binance.")
            found = self._dips_of(coin)
            tick = self._binance.filters(f"{coin}{QUOTE}").tick
            price = unround(target_price(found, now[coin], int(slot["odds"])), tick)
            price = min(price, (now[coin] // tick) * tick)
            rows.append(
                {
                    "coin": coin,
                    "spend": slot["spend"],
                    "price": plain(price),
                    "now": plain(now[coin]),
                    "target": slot["odds"],
                    "odds": odds(found, now[coin], price),
                }
            )
        key, friday = week_of(self._now())
        closes = int(close_out_of(friday).timestamp() * 1000)
        return {"week": key, "closeOut": closes, "orders": rows, "quote": QUOTE}

    # Orders.

    def _ref(self, coin: str, week: str) -> str:
        taken = {r["ref"] for r in self._store.dca_orders()}
        n = 1
        while f"DCA-{coin}-{week}-{n}" in taken:
            n += 1
        return f"DCA-{coin}-{week}-{n}"

    def _check_buy(self, spend: Decimal) -> None:
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

    def _held(self, coin: str) -> Decimal:
        return positions(self._store.dca_orders(), [coin])[coin].qty

    def _kind(self, body: dict[str, Any]) -> tuple[str, str, str, str, str | None]:
        """The order's coin, side, kind and source, and the trim a buy-back answers."""
        coin = str(body.get("coin", "")).upper()
        if coin not in self.coins():
            raise Refused(f"{coin or 'That coin'} isn't in your DCA plan.")
        side, kind = str(body.get("side", "buy")), str(body.get("kind", "limit"))
        source = str(body.get("source", "desk"))
        if side not in ("buy", "sell") or kind not in ("limit", "market"):
            raise Refused("An order is a buy or a sell, at a limit or at market.")
        if source not in SOURCES:
            raise Refused("Say where the order comes from.")
        if (side == "sell") != (source == "trim"):
            raise Refused("Only a trim sells from the book; everything else buys.")
        link = str(body.get("link") or "") or None
        if source == "buy-back":
            trim = self._store.dca_order(link or "")
            if not trim or trim["source"] != "trim" or trim["coin"] != coin:
                raise Refused("A buy-back needs the trim it buys back.")
        return coin, side, kind, source, link

    def _sized(
        self, body: dict[str, Any], coin: str, side: str, kind: str
    ) -> tuple[Decimal | None, Decimal | None, Decimal | None]:
        """Price, quantity and spend, to Binance's steps and inside the desk's limits."""
        rules = self._binance.filters(f"{coin}{QUOTE}")
        price = rules.price(number(body.get("price"), "Price")) if kind == "limit" else None
        smallest = f"That's under Binance's smallest order of {rules.min_notional}."
        if side == "sell":
            qty = rules.amount(number(body.get("qty"), "Quantity"))
            if qty > self._held(coin):
                raise Refused(f"The book holds less {coin} than that.")
            if qty <= ZERO or (price is not None and qty * price < rules.min_notional):
                raise Refused(smallest)
            return price, qty, None
        spend = number(body.get("spend"), "Amount")
        qty = rules.amount(spend / price) if price is not None else None
        if qty is not None and price is not None:
            spend = qty * price
        if spend < rules.min_notional or (qty is not None and qty <= ZERO):
            raise Refused(smallest)
        self._check_buy(spend)
        return price, qty, spend

    @locked
    def place(self, body: dict[str, Any]) -> dict[str, Any]:
        """One order into the book: a buy (limit or market, by USDC) or a trim's sell (by
        quantity). Recorded before it is sent, under an id Binance won't take twice."""
        coin, side, kind, source, link = self._kind(body)
        price, qty, spend = self._sized(body, coin, side, kind)
        now = self._now()
        week, _ = week_of(now)
        row = {
            "ref": self._ref(coin, week),
            "coin": coin,
            "side": side,
            "kind": kind,
            "source": source,
            "link": link,
            "week": week,
            "price": plain(price) if price is not None else None,
            "qty": plain(qty) if qty is not None else None,
            "spend": plain(spend) if spend is not None else None,
            "aud_rate": plain(self._rate()),
            "created": now,
        }
        row_id = self._store.add_dca_order(row)
        saved = self._row(row_id)
        try:
            order = self._send(saved, f"{coin}{QUOTE}")
        except BinanceError as error:
            if error.status != 0:  # refused: never placed
                self._store.save_dca_order(saved | {"status": "cancelled", "updated": now})
            raise
        self._record(saved, order)
        what = f"{side} {coin} {source}"
        self._audit.record("dca", f"{row['ref']}: {what}", f"{kind} {row['price'] or 'market'}")
        return order_view(self._row(row_id))

    def _send(self, row: dict[str, Any], symbol: str) -> dict[str, Any]:
        client_id = str(row["client_id"])
        if row["side"] == "buy":
            if row["kind"] == "market":
                return self._binance.buy_market(symbol, Decimal(row["spend"]), client_id)
            return self._binance.buy_limit(
                symbol, Decimal(row["qty"]), Decimal(row["price"]), client_id
            )
        if row["kind"] == "market":
            return self._binance.sell_market(symbol, Decimal(row["qty"]), client_id)
        return self._binance.limit_sell(
            symbol, Decimal(row["qty"]), Decimal(row["price"]), client_id
        )

    def _row(self, row_id: int) -> dict[str, Any]:
        return next(r for r in self._store.dca_orders() if r["id"] == row_id)

    def _record(self, row: dict[str, Any], order: dict[str, Any]) -> None:
        status = str(order.get("status", ""))
        done = status in ("FILLED", "CANCELED", "EXPIRED", "REJECTED", "EXPIRED_IN_MATCH")
        changes: dict[str, Any] = {"order_id": int(order.get("orderId") or 0) or row["order_id"]}
        if not done:
            if status == "PARTIALLY_FILLED":
                changes |= {
                    "executed_qty": plain(Decimal(str(order.get("executedQty", "0")))),
                    "executed_quote": plain(Decimal(str(order.get("cummulativeQuoteQty", "0")))),
                }
            self._store.save_dca_order(row | changes | {"status": "open", "updated": self._now()})
            return
        executed = Decimal(str(order.get("executedQty", "0")))
        quote = Decimal(str(order.get("cummulativeQuoteQty", "0")))
        fees = {"fee_base": "0", "fee_quote": "0", "fee_usd": "0"}
        if executed > ZERO and changes["order_id"]:
            fees = self._fees(row, int(changes["order_id"]), quote / executed)
        status_word = "filled" if status == "FILLED" or executed > ZERO else "cancelled"
        self._store.save_dca_order(
            row
            | changes
            | fees
            | {
                "status": status_word,
                "executed_qty": plain(executed),
                "executed_quote": plain(quote),
                "updated": self._now(),
            }
        )

    def _fees(self, row: dict[str, Any], order_id: int, fill_price: Decimal) -> dict[str, str]:
        """Each fill's commission: in the coin, in the quote, or in BNB (valued at today's
        price, as Binance doesn't say what it was worth)."""
        coin = str(row["coin"])
        fee_base = fee_quote = other = ZERO
        others: dict[str, Decimal] = {}
        for fill in self._binance.order_fills(f"{coin}{QUOTE}", order_id):
            amount = Decimal(str(fill["commission"]))
            asset = str(fill["commissionAsset"])
            if asset == coin:
                fee_base += amount
            elif asset == QUOTE:
                fee_quote += amount
            else:
                others[asset] = others.get(asset, ZERO) + amount
        if others:
            prices = self._prices(list(others))
            other = sum((q * prices.get(a, ZERO) for a, q in others.items()), ZERO)
        usd = fee_base * fill_price + fee_quote + other
        return {"fee_base": plain(fee_base), "fee_quote": plain(fee_quote), "fee_usd": plain(usd)}

    def _refresh(self, row: dict[str, Any]) -> None:
        symbol = f"{row['coin']}{QUOTE}"
        try:
            if row["status"] == "placing":  # sent, but the reply never came back
                order = self._binance.order_by_client(symbol, str(row["client_id"]))
            else:
                order = self._binance.order(symbol, int(row["order_id"]))
        except BinanceError as error:
            if row["status"] != "placing" or error.status == 0:
                raise
            order = {"orderId": 0, "status": "REJECTED"}  # Binance never took it
        self._record(row, order)

    @locked
    def sync(self) -> None:
        """Brings every open order up to date; the api runs it every 30 seconds."""
        for row in self._store.dca_orders():
            if row["status"] in ("placing", "open"):
                try:
                    self._refresh(row)
                except BinanceError:
                    continue

    def _cancel(self, row: dict[str, Any]) -> dict[str, Any]:
        if row["status"] == "placing":
            self._refresh(row)
            row = self._row(int(row["id"]))
        if row["status"] != "open":
            return row
        symbol = f"{row['coin']}{QUOTE}"
        try:
            order = self._binance.cancel(symbol, int(row["order_id"]))
        except BinanceError:
            order = self._binance.order(symbol, int(row["order_id"]))
        if str(order.get("status")) == "CANCELED":
            order = self._binance.order(symbol, int(row["order_id"]))  # its final fills
        self._record(row, order)
        return self._row(int(row["id"]))

    @locked
    def cancel(self, ref: object) -> dict[str, Any]:
        row = self._store.dca_order(str(ref or ""))
        if row is None:
            raise Refused("There's no order with that reference.")
        if row["status"] not in ("placing", "open"):
            raise Refused("Only an open order can be cancelled.")
        done = self._cancel(row)
        self._audit.record("dca", f"{row['ref']}: cancelled", done["status"])
        return order_view(done)

    @locked
    def close_out(self) -> dict[str, Any]:
        """This week's unfilled weekly limits: each cancelled, and what it didn't buy bought at
        market, so a week is never skipped."""
        week, _ = week_of(self._now())
        bought: list[str] = []
        for row in self._store.dca_orders():
            if row["week"] != week or row["source"] != "weekly" or row["side"] != "buy":
                continue
            if row["status"] not in ("placing", "open"):
                continue
            done = self._cancel(row)
            left = Decimal(done["spend"] or "0") - Decimal(done["executed_quote"])
            symbol = f"{done['coin']}{QUOTE}"
            if left < self._binance.filters(symbol).min_notional:
                continue
            market = {
                "ref": self._ref(done["coin"], week),
                "coin": done["coin"],
                "side": "buy",
                "kind": "market",
                "source": "close-out",
                "link": done["ref"],
                "week": week,
                "price": None,
                "qty": None,
                "spend": plain(round(left, 2)),
                "aud_rate": plain(self._rate()),
                "created": self._now(),
            }
            row_id = self._store.add_dca_order(market)
            saved = self._row(row_id)
            try:
                self._record(saved, self._send(saved, symbol))
            except BinanceError as error:
                if error.status != 0:
                    self._store.save_dca_order(
                        saved | {"status": "cancelled", "updated": self._now()}
                    )
                raise
            bought.append(f"{done['coin']} {plain(round(left, 2))}")
        self._audit.record("dca", f"Close-out {week}", ", ".join(bought) or "nothing left open")
        return {"closed": bought}

    # The page.

    def view(self) -> dict[str, Any]:
        plan = self.plan()
        coins = self.coins()
        rows = self._store.dca_orders()
        for row in rows:
            if row["coin"] not in coins:
                coins.append(row["coin"])
        rate = self._rate()
        price_error = None
        try:
            prices = self._prices(coins) if coins else {}
        except BinanceError as error:
            prices, price_error = {}, error.message
        held = positions(rows, coins)
        views = [held[c].view(prices.get(c), rate) for c in coins]
        totals = self._totals(held, prices)
        now = self._now()
        key, friday = week_of(now)
        return {
            "quote": QUOTE,
            "rate": plain(rate),
            "plan": plan,
            "positions": views,
            "totals": totals,
            "progress": self._progress(plan, rows, now),
            "week": {
                "key": key,
                "start": int(friday.timestamp() * 1000),
                "closeOut": int(close_out_of(friday).timestamp() * 1000),
                "orders": [order_view(r) for r in rows if r["week"] == key],
            },
            "orders": [order_view(r) for r in reversed(rows)],
            "priceError": price_error,
        }

    @staticmethod
    def _totals(held: dict[str, Position], prices: dict[str, Decimal]) -> dict[str, Any]:
        added = sum((p.added for p in held.values()), ZERO)
        realised = sum((p.realised for p in held.values()), ZERO)
        fees = sum((p.fees for p in held.values()), ZERO)
        priced = all(c in prices for c, p in held.items() if p.qty > ZERO)
        value = sum((p.qty * prices.get(c, ZERO) for c, p in held.items()), ZERO)
        outside = sum((p.outside_fees for p in held.values()), ZERO)
        pnl = value - added - outside if priced else None
        return {
            "added": plain(round(added, 2)),
            "value": plain(round(value, 2)) if priced else None,
            "pnl": plain(round(pnl, 2)) if pnl is not None else None,
            "pnlPct": plain(round(pnl * 100 / added, 2))
            if pnl is not None and added > ZERO
            else None,
            "realised": plain(round(realised, 2)),
            "fees": plain(round(fees, 2)),
        }

    @staticmethod
    def _progress(
        plan: dict[str, Any] | None, rows: list[dict[str, Any]], now: int
    ) -> dict[str, Any] | None:
        """The plan's weeks as ticks: bought, trimmed, missed, this week and to come."""
        if not plan:
            return None
        start = datetime.fromisoformat(plan["start"]).replace(tzinfo=SYDNEY)
        _, first = week_of(int(start.timestamp() * 1000))
        _, current = week_of(now)
        this = (current - first).days // 7
        weekly = sum((Decimal(o["spend"]) for o in plan["orders"]), ZERO)
        by_week: dict[str, dict[str, Decimal | bool]] = {}
        for row in rows:
            spent = Decimal(row["executed_quote"])
            entry = by_week.setdefault(row["week"], {"usdc": ZERO, "trim": False})
            if row["side"] == "buy" and row["source"] in ("weekly", "close-out"):
                entry["usdc"] = Decimal(entry["usdc"]) + spent
            if row["source"] == "trim" and Decimal(row["executed_qty"]) > ZERO:
                entry["trim"] = True
        ticks: list[dict[str, Any]] = []
        on_plan = ZERO
        for i in range(min(this + 1, plan["weeks"])):
            key, friday = week_of(int((first + timedelta(days=7 * i)).timestamp() * 1000))
            entry = by_week.get(key, {"usdc": ZERO, "trim": False})
            usdc = Decimal(entry["usdc"])
            on_plan += usdc
            state = "now" if i == this else "bought" if usdc > ZERO else "missed"
            ticks.append(
                {
                    "week": i + 1,
                    "key": key,
                    "friday": friday.date().isoformat(),
                    "state": state,
                    "trim": bool(entry["trim"]),
                    "usdc": plain(round(usdc, 2)),
                }
            )
        return {
            "week": min(this + 1, plan["weeks"]),
            "weeks": plan["weeks"],
            "weekly": plain(weekly),
            "onPlan": plain(round(on_plan, 2)),
            "planTotal": plain(weekly * plan["weeks"]),
            "ticks": ticks,
        }
