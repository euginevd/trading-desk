"""Take profit and add funds on a DCA book position (owner, 21 Nov 2026: the same as the Trade
page's). Take profit sells part or all of a coin as trims, at market or at limits the desk
suggests from resistance (pot_tp.plan_sells); add funds places buy limits the desk suggests
from support (pot.suggest_plan), and can re-plan the coin's waiting buy limits with them."""

import contextlib
from decimal import Decimal
from typing import Any, cast

from api.binance import BinanceError, plain
from api.dca_book import DcaBook, positions
from api.locks import locked
from api.market import QUOTE
from api.pot import (
    MIN_ORDER,
    Pot,
    given_rungs,
    rung_qty,
    smallest,
    suggest_plan,
    touch_odds,
)
from api.pot_tp import plan_sells
from api.trading import Refused, number

ZERO = Decimal(0)
HUNDRED = Decimal(100)
LIVE = ("placing", "open")


def _cents(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01")))


class DcaMoves:
    def __init__(self, book: DcaBook) -> None:
        self._book = book
        self._store = book.store
        self._binance = book.binance

    def _coin(self, body: dict[str, Any]) -> str:
        coin = str(body.get("coin", "")).upper()
        if coin not in self._book.coins():
            raise Refused(f"{coin or 'That coin'} isn't in your DCA plan.")
        return coin

    def _open(self, coin: str, side: str) -> list[dict[str, Any]]:
        return [
            r
            for r in self._store.dca_orders()
            if r["coin"] == coin and r["side"] == side and r["status"] in LIVE
        ]

    def _now(self, coin: str) -> Decimal:
        now = self._book.prices([coin]).get(coin)
        if now is None:
            raise Refused(f"There's no {coin}/{QUOTE} price on Binance.")
        return now

    # Take profit: trims.

    def sell_preview(self, body: dict[str, Any]) -> dict[str, Any]:
        coin = self._coin(body)
        pos = positions(self._store.dca_orders(), [coin])[coin]
        if pos.qty <= ZERO:
            raise Refused(f"The book holds no {coin} to sell.")
        all_now = body.get("market") is True and str(body.get("pct") or "100") == "100"
        reserved = (
            ZERO
            if all_now
            else sum(
                (
                    Decimal(r["qty"] or "0") - Decimal(r["executed_qty"])
                    for r in self._open(coin, "sell")
                ),
                ZERO,
            )
        )
        rules = self._binance.filters(f"{coin}{QUOTE}")
        seen = plan_sells(
            body,
            coin=coin,
            rules=rules,
            now=self._now(coin),
            avg=pos.cost / pos.qty,
            held=pos.qty,
            free=rules.amount(pos.qty - reserved),
            days=lambda: self._binance.klines(f"{coin}{QUOTE}", "1d", 400),
        )
        if reserved > ZERO:
            seen["notes"].append(f"{plain(reserved)} {coin} is already in sell orders.")
        seen["notes"].append("Each sell is a trim: buy it back later from its order.")
        return {"position": f"DCA-{coin}", **seen}

    @locked
    def sell(self, body: dict[str, Any]) -> dict[str, Any]:
        coin = self._coin(body)
        if body.get("market") is True and str(body.get("pct") or "100") == "100":
            for r in self._open(coin, "sell"):  # selling it all: its waiting sells come off
                self._book.cancel(r["ref"])
        seen = self.sell_preview(body)
        if seen["problems"]:
            raise Refused(seen["problems"][0])
        if seen["warnings"] and body.get("anyway") is not True:
            raise Refused("Read the warnings, then sell anyway: " + " ".join(seen["warnings"]))
        failed: list[str] = []
        for lv in seen["levels"]:
            order: dict[str, Any] = {
                "coin": coin,
                "side": "sell",
                "kind": "market" if lv["price"] is None else "limit",
                "source": "trim",
                "qty": lv["qty"],
            }
            if lv["price"] is not None:
                order["price"] = lv["price"]
            try:
                self._book.place(order)
            except (Refused, BinanceError) as error:
                words = error.message if isinstance(error, BinanceError) else str(error)
                failed.append(f"{lv['price'] or 'market'}: {words}")
        if failed:
            raise Refused("Not every sell was placed: " + "; ".join(failed))
        return self._book.view()

    # Add funds: buy limits, from support.

    def add_preview(self, body: dict[str, Any]) -> dict[str, Any]:  # noqa: PLR0914 - one plan
        coin = self._coin(body)
        now = self._now(coin)
        rules = self._binance.filters(f"{coin}{QUOTE}")
        rows = self._binance.klines(f"{coin}{QUOTE}", "1d", 400)
        replacing = (
            [r for r in self._open(coin, "buy") if r["kind"] == "limit"]
            if body.get("replace") is True
            else []
        )
        freed = sum(
            (Decimal(r["spend"] or "0") - Decimal(r["executed_quote"]) for r in replacing), ZERO
        )
        given = cast(list[dict[str, Any]], body.get("rungs") or [])
        plan = why_plan = ""
        if given:
            rungs = given_rungs(rules, given)
        else:
            total = number(body.get("total") or "0", "Amount") + freed
            if total < MIN_ORDER:
                raise Refused(smallest(rules.min_notional))
            five = self._binance.klines(f"{coin}{QUOTE}", "5m", 1000)
            plan, why_plan, rungs = suggest_plan(
                rows, five, now, total, rules, asked=body.get("plan")
            )
        problems: list[str] = []
        shown: list[dict[str, Any]] = []
        qty_all = spend_all = ZERO
        for r in rungs:
            price, spend = cast(Decimal, r["price"]), cast(Decimal, r["spend"])
            qty = rung_qty(rules, price, spend)
            if price > now:
                problems.append(f"{plain(price)} is above the price now ({plain(now)}).")
            if qty * price < max(rules.min_notional, MIN_ORDER):
                problems.append(f"At {plain(price)}: {smallest(rules.min_notional)}")
            qty_all += qty
            spend_all += qty * price
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
        problems += self._limits([Decimal(x["spend"]) for x in shown], spend_all, freed)
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
            "stop": None,
            "target": None,
            "risk": _cents(spend_all),
            "problems": problems,
            "warnings": [],
            "replacing": [
                {
                    "ref": r["ref"],
                    "price": r["price"],
                    "spend": _cents(Decimal(r["spend"] or "0") - Decimal(r["executed_quote"])),
                }
                for r in replacing
            ],
            "freed": _cents(freed),
        }

    def _limits(self, spends: list[Decimal], total: Decimal, freed: Decimal) -> list[str]:
        """Free USDC (the limits replaced give theirs back first), the kill switch and the
        desk's per-order and daily limits."""
        found: list[str] = []
        with contextlib.suppress(BinanceError):
            free = Pot(self._book.desk).free_quote() + freed
            if total > free:
                found.append(f"Binance has ${free:.2f} {QUOTE} free; these need ${total:.2f}.")
        settings = self._book.desk.settings()
        if not settings["tradingOn"]:
            found.append("Trading is off. Turn it on in the top bar to trade.")
        per_order, per_day = Decimal(settings["perOrder"]), Decimal(settings["perDay"])
        if spends and max(spends) > per_order:
            found.append(f"A limit order is over your per-order limit of ${per_order:,.2f}.")
        if Decimal(settings["spentToday"]) + total - freed > per_day:
            found.append(f"That would take today past your daily limit of ${per_day:,.2f}.")
        return found

    @locked
    def add(self, body: dict[str, Any]) -> dict[str, Any]:
        if not body.get("rungs"):
            raise Refused("Give the limits to place.")
        seen = self.add_preview(body)
        if seen["problems"]:
            raise Refused(seen["problems"][0])
        coin = seen["coin"]
        for old in seen["replacing"]:  # their USDC back before the new limits go on
            with contextlib.suppress(Refused):
                self._book.cancel(old["ref"])
        failed: list[str] = []
        for r in seen["rungs"]:
            try:
                self._book.place(
                    {
                        "coin": coin,
                        "side": "buy",
                        "kind": "limit",
                        "source": "desk",
                        "price": r["price"],
                        "spend": r["spend"],
                    }
                )
            except (Refused, BinanceError) as error:
                words = error.message if isinstance(error, BinanceError) else str(error)
                failed.append(f"{r['price']}: {words}")
        if failed:
            raise Refused("Not every limit was placed: " + "; ".join(failed))
        return self._book.view()
