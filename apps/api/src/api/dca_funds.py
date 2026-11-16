"""Add funds and Remove funds on the DCA book (TODO 11): the owner names an amount, dca-agent
splits it into one limit order per coin, and the owner adjusts it by hand or by chatting.

The desk works out every figure the agent reasons from: each coin's 24-hour fill odds (how
often, over the last year, the coin traded that far from where it started within 24 hours) and
how overheated it is. The agent picks the split, the prices and the reasons; the desk checks
them, recomputes the odds and fills any gap. Without the model, the desk's own plan stands."""

import json
from decimal import ROUND_DOWN, ROUND_FLOOR, Decimal
from typing import Any, cast

from api import my_agents
from api.ai_signal import MODELS, SignalError, Signals
from api.binance import plain
from api.dca_book import DAY_MS, MIN_ORDER, DcaBook, positions
from api.indicators import rsi, sma
from api.market import QUOTE
from api.trading import Refused, number

ZERO = Decimal(0)
CENT = Decimal("0.01")
TARGET_ODDS = 80  # the owner's choice: a limit that fills within 24 hours four times in five
WINDOW = 6  # 24 hours of 4-hour candles
YEAR_MS = 365 * DAY_MS
MAX_TRIM = Decimal("0.25")  # never sell more than a quarter of a position
HOT_RSI = 75
HOT_STRETCH = 2  # ATRs over the 20-day average
HOT_RUN = Decimal(30)  # % in 14 days
ATR_DAYS = 14
RUN_DAYS = 14
MAX_CHAT = 12
CHAT_LENGTH = 500
MAX_AMOUNT = Decimal(1_000_000)
AGENT = "dca-agent"
SIDES = {"add": "buy", "remove": "sell"}


# The desk's 24-hour odds, from a year of 4-hour candles.


def moves(candles: list[list[Any]]) -> tuple[list[Decimal], list[Decimal]]:
    """For each 4-hour start, how far price fell and how far it rose within the next 24 hours."""
    rows = [(Decimal(str(c[1])), Decimal(str(c[2])), Decimal(str(c[3]))) for c in candles]
    downs: list[Decimal] = []
    ups: list[Decimal] = []
    for i in range(len(rows) - WINDOW + 1):
        start = rows[i][0]
        if start <= ZERO:
            continue
        window = rows[i : i + WINDOW]
        downs.append(1 - min(low for _, _, low in window) / start)
        ups.append(max(high for _, high, _ in window) / start - 1)
    return downs, ups


def chance(found: list[Decimal], need: Decimal) -> dict[str, Any]:
    hit = sum(1 for d in found if d >= need)
    total = len(found)
    return {"hit": hit, "windows": total, "pct": round(hit * 100 / total) if total else None}


def depth(found: list[Decimal], pct: int) -> Decimal:
    """The move reached in pct% of windows."""
    if not found:
        return ZERO
    ranked = sorted(found, reverse=True)
    k = min(max(1, int(len(ranked) * pct / 100 + 0.5)), len(ranked))
    return max(ranked[k - 1], ZERO)


def off_round(price: Decimal, tick: Decimal, side: str) -> Decimal:
    """Just above a round number for a buy, just below one for a sell: orders crowd there."""
    if price <= ZERO:
        return price
    step = Decimal(10) ** (int(price.log10().to_integral_value(rounding=ROUND_FLOOR)) - 2)
    rest = price % step
    if side == "buy" and rest < step * Decimal("0.3"):
        price = price - rest + step * Decimal("0.37")
    if side == "sell" and rest > step * Decimal("0.7"):
        price = price - rest + step * Decimal("0.63")
    return (price // tick) * tick if tick > ZERO else price


def heat(daily: list[list[Any]], now: Decimal) -> dict[str, Any]:
    """How stretched a coin is, from its daily candles: the agent's overheating signs."""
    closes = [Decimal(str(c[4])) for c in daily]
    highs = [Decimal(str(c[2])) for c in daily]
    lows = [Decimal(str(c[3])) for c in daily]
    ranges = [
        max(h - lo, abs(h - pc), abs(lo - pc))
        for h, lo, pc in zip(highs[1:], lows[1:], closes[:-1], strict=True)
    ]
    atr = sum(ranges[-ATR_DAYS:], ZERO) / ATR_DAYS if len(ranges) >= ATR_DAYS else None
    average = sma(closes, 20)
    strength = rsi(closes)
    run = None
    if len(closes) > RUN_DAYS and closes[-RUN_DAYS - 1] > ZERO:
        run = (now / closes[-RUN_DAYS - 1] - 1) * 100
    low30, high30 = min(lows[-30:], default=now), max(highs[-30:], default=now)
    stretch = (now - average) / atr if atr and average is not None and atr > ZERO else None
    signs = [
        stretch is not None and stretch >= HOT_STRETCH,
        strength is not None and strength >= HOT_RSI,
        run is not None and run >= HOT_RUN,
    ]
    span = high30 - low30
    return {
        "rsi14": plain(round(strength, 1)) if strength is not None else None,
        "atrPct": plain(round(atr / now * 100, 2)) if atr and now > ZERO else None,
        "aboveAverage20InAtr": plain(round(stretch, 2)) if stretch is not None else None,
        "change14dPct": plain(round(run, 1)) if run is not None else None,
        "range30d": {"low": plain(low30), "high": plain(high30)},
        "inRange30dPct": plain(((now - low30) * 100 / span).quantize(Decimal(1)))
        if span > ZERO
        else None,
        "lows7d": [plain(v) for v in lows[-7:]],
        "highs7d": [plain(v) for v in highs[-7:]],
        "overheatedSigns": sum(signs),
    }


def _side(value: object) -> str:
    side = SIDES.get(str(value))
    if side is None:
        raise Refused("Add funds or remove funds.")
    return side


def _amount(value: object) -> Decimal:
    amount = number(value, "Amount")
    if amount > MAX_AMOUNT:
        raise Refused("That amount is too large.")
    if amount < MIN_ORDER:
        raise Refused(f"The smallest order is {MIN_ORDER} {QUOTE}.")
    return amount


class Funds:
    def __init__(self, book: DcaBook, signals: Signals | None) -> None:
        self._book = book
        self._signals = signals
        self._binance = book.binance
        self._store = book.store
        self._moves: dict[str, tuple[list[Decimal], list[Decimal]]] = {}

    def _moves_of(self, coin: str) -> tuple[list[Decimal], list[Decimal]]:
        if coin not in self._moves:
            since = self._book.now_ms() - YEAR_MS
            self._moves[coin] = moves(self._binance.klines_since(f"{coin}{QUOTE}", "4h", since))
        return self._moves[coin]

    def _odds(self, coin: str, side: str, now: Decimal, price: Decimal) -> dict[str, Any]:
        downs, ups = self._moves_of(coin)
        if side == "sell":
            return chance(ups, price / now - 1)
        return chance(downs, 1 - price / now)

    def odds(self, coin: str, price: object, side: str) -> dict[str, Any]:
        coin = coin.upper()
        if coin not in self._book.coins():
            raise Refused(f"{coin} isn't in your DCA plan.")
        limit = number(price, "Price")
        now = self._book.prices([coin]).get(coin)
        if now is None:
            raise Refused(f"There's no {coin}/{QUOTE} price on Binance.")
        return self._odds(coin, _side(side), now, limit) | {"now": plain(now)}

    # The facts the agent reasons from, all worked out here.

    def facts(self, side: str) -> dict[str, Any]:
        plan = self._book.plan()
        if not plan:
            raise Refused("Set your weekly plan first.")
        coins = self._book.coins()
        prices = self._book.prices(coins)
        held = positions(self._store.dca_orders(), coins)
        weights: dict[str, Decimal] = {}
        for slot in plan["orders"]:
            weights[slot["coin"]] = weights.get(slot["coin"], ZERO) + Decimal(slot["spend"])
        total = sum(weights.values(), ZERO)
        value = sum((held[c].qty * prices.get(c, ZERO) for c in coins), ZERO)
        rows: list[dict[str, Any]] = []
        for coin in coins:
            now = prices.get(coin)
            if now is None:
                continue
            downs, ups = self._moves_of(coin)
            tick = self._binance.filters(f"{coin}{QUOTE}").tick
            moved = depth(downs if side == "buy" else ups, TARGET_ODDS)
            raw = now * (1 - moved) if side == "buy" else now * (1 + moved)
            price = off_round(raw, tick, side)
            mine = held[coin]
            rows.append(
                {
                    "coin": coin,
                    "now": plain(now),
                    "tick": plain(tick),
                    "targetPct": plain(round(weights[coin] * 100 / total, 1)) if total else "0",
                    "bookPct": plain(round(mine.qty * now * 100 / value, 1)) if value else "0",
                    "held": plain(mine.qty),
                    "heldValue": plain(round(mine.qty * now, 2)),
                    "avgCost": plain(round(mine.cost / mine.qty, 8)) if mine.qty > ZERO else None,
                    "deskPrice": plain(price),
                    "deskOdds": self._odds(coin, side, now, price),
                    "heat": heat(self._binance.klines(f"{coin}{QUOTE}", "1d", 60), now),
                }
            )
        return {"side": side, "quote": QUOTE, "targetOdds": TARGET_ODDS, "coins": rows}

    # The desk's own plan: what stands when the model can't be reached.

    @staticmethod
    def desk_plan(facts: dict[str, Any], amount: Decimal) -> list[dict[str, Any]]:
        rows = facts["coins"]
        shares: dict[str, Decimal] = {}
        if facts["side"] == "buy":
            shares = {r["coin"]: amount * Decimal(r["targetPct"]) / 100 for r in rows}
        else:  # the hottest first, then the most over target; at most a quarter of each
            ranked = sorted(
                rows,
                key=lambda r: (
                    -int(r["heat"]["overheatedSigns"]),
                    -(Decimal(r["bookPct"]) - Decimal(r["targetPct"])),
                ),
            )
            left = amount
            for r in ranked:
                take = min(Decimal(r["heldValue"]) * MAX_TRIM, left)
                if take >= MIN_ORDER:
                    shares[r["coin"]] = take
                    left -= take
        return [
            {
                "coin": r["coin"],
                "usdc": plain(shares[r["coin"]]),
                "price": r["deskPrice"],
                "reason": "The desk's price: it was reached within 24 hours in "
                f"{r['deskOdds']['pct']}% of the last year's windows, just past a round number.",
            }
            for r in rows
            if shares.get(r["coin"], ZERO) > ZERO
        ]

    # The checks every plan passes, whoever wrote it.

    @staticmethod
    def _clean(item: dict[str, Any], fact: dict[str, Any], side: str) -> dict[str, Any] | None:
        """One proposed order to the pair's tick, never past market, or None if unreadable."""
        now, tick = Decimal(fact["now"]), Decimal(fact["tick"])
        try:
            price = Decimal(str(item.get("price")))
            usdc = Decimal(str(item.get("usdc")))
        except ArithmeticError:
            return None
        if not price.is_finite() or price <= ZERO or not usdc.is_finite() or usdc <= ZERO:
            return None
        price = (price // tick) * tick
        if (side == "buy" and price > now) or (side == "sell" and price < now):
            price = (now // tick) * tick
        return {"coin": fact["coin"], "usdc": usdc, "price": price, "reason": item.get("reason")}

    @staticmethod
    def _fit(rows: dict[str, dict[str, Any]], amount: Decimal, side: str, said: list[str]) -> None:
        """Buys add up to the amount exactly; sells never past it."""
        total = sum((r["usdc"] for r in rows.values()), ZERO)
        if side == "sell" and total < amount:
            said.append(f"The book can raise {plain(total.quantize(CENT))} of it within the rules.")
            return
        scale = amount / total
        for r in rows.values():
            r["usdc"] = (r["usdc"] * scale).quantize(CENT, rounding=ROUND_DOWN)
        gap = amount - sum((r["usdc"] for r in rows.values()), ZERO)
        max(rows.values(), key=lambda r: r["usdc"])["usdc"] += gap

    def settle(
        self, facts: dict[str, Any], amount: Decimal, proposed: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], list[str]]:
        side = facts["side"]
        by_coin = {r["coin"]: r for r in facts["coins"]}
        said: list[str] = []
        rows: dict[str, dict[str, Any]] = {}
        for item in proposed:
            coin = str(item.get("coin", "")).upper()
            clean = self._clean(item, by_coin[coin], side) if coin in by_coin else None
            if clean is None or coin in rows:
                continue
            room = Decimal(by_coin[coin]["heldValue"]) * MAX_TRIM
            if side == "sell" and clean["usdc"] > room:
                said.append(f"{coin} is capped at a quarter of its position.")
                clean["usdc"] = room
            rows[coin] = clean
        for coin in [c for c, r in rows.items() if r["usdc"] < MIN_ORDER]:
            said.append(f"{coin} left out: under {MIN_ORDER} {QUOTE}.")
            del rows[coin]
        if not rows:
            raise Refused(
                "There's nothing to sell in the book yet."
                if side == "sell"
                else f"That's too little to place: {MIN_ORDER} {QUOTE} a coin at least."
            )
        self._fit(rows, amount, side, said)
        placed = sum((r["usdc"] for r in rows.values()), ZERO)
        settled: list[dict[str, Any]] = []
        for r in rows.values():
            now = Decimal(by_coin[r["coin"]]["now"])
            settled.append(
                {
                    "coin": r["coin"],
                    "pct": plain(round(r["usdc"] * 100 / placed, 1)),
                    "usdc": plain(r["usdc"].quantize(CENT)),
                    "price": plain(r["price"]),
                    "now": plain(now),
                    "qty": plain(
                        (r["usdc"] / r["price"]).quantize(
                            Decimal("0.00000001"), rounding=ROUND_DOWN
                        )
                    ),
                    "odds": self._odds(r["coin"], side, now, r["price"]),
                    "reason": str(r.get("reason") or "")[:240],
                }
            )
        return settled, said

    @staticmethod
    def left_out(
        facts: dict[str, Any], settled: list[dict[str, Any]], proposed: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Every plan coin not in the orders, with why, at the desk's price, so the owner can
        bring it back by giving it a share."""
        placed = {r["coin"] for r in settled}
        asked = {str(i.get("coin", "")).upper(): str(i.get("reason") or "") for i in proposed}
        found: list[dict[str, Any]] = []
        for fact in facts["coins"]:
            coin = fact["coin"]
            if coin in placed:
                continue
            if facts["side"] == "sell" and Decimal(fact["heldValue"]) <= ZERO:
                why = "Nothing held in the book yet."
            elif coin in asked:
                why = asked[coin] or f"Under the {MIN_ORDER} {QUOTE} minimum."
            else:
                why = "dca-agent left it out this time."
            found.append(
                {
                    "coin": coin,
                    "pct": "0",
                    "usdc": "0",
                    "price": fact["deskPrice"],
                    "now": fact["now"],
                    "qty": "0",
                    "odds": fact["deskOdds"],
                    "reason": why[:240],
                }
            )
        return found

    # The agent.

    def _ask(self, prompt: str, shape: dict[str, Any], label: str) -> dict[str, Any] | None:
        if self._signals is None:
            return None
        agent = my_agents.file(self._store, AGENT)
        listing = cast(list[dict[str, Any]], my_agents.listing(self._store)["agents"])
        none: dict[str, Any] = {}
        mine = next((a for a in listing if a["slug"] == AGENT), none)
        found: dict[str, Any] = mine.get("model") or {}
        model = str(found.get("id") or "")
        if model not in MODELS:
            model = "claude-opus-5-5"
        system = (
            (agent.get("markdown") or "You are dca-agent, the owner's patient DCA buyer.")
            + "\n\nYou are placing money the owner names now, not the Friday buy. Use only the "
            "desk's figures; never invent a price, level or odds. One order per coin; a coin "
            "you leave out goes in with usdc 0 and a reason saying why. Each "
            "reason is one plain sentence naming the level or fact the price rests on; don't "
            "repeat the odds or window counts, the desk shows those. The note "
            "is at most 50 words: what you did and why, in plain words."
        )
        try:
            reply, _cost, _name = self._signals.step(
                system, prompt, shape, label, model=model, searches=0
            )
        except SignalError:
            return None
        return reply

    SHAPE: dict[str, Any] = {
        "type": "object",
        "properties": {
            "note": {"type": "string"},
            "orders": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "coin": {"type": "string"},
                        "usdc": {"type": "string"},
                        "price": {"type": "string"},
                        "reason": {"type": "string"},
                    },
                    "required": ["coin", "usdc", "price", "reason"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["note", "orders"],
        "additionalProperties": False,
    }

    def _brief(self, facts: dict[str, Any], amount: Decimal) -> str:
        if facts["side"] == "buy":
            task = (
                f"The owner is adding {plain(amount)} {QUOTE}. Split it across the coins (about "
                "their targetPct, tilting a little to any coin near the low of its range), with "
                f"one limit buy each that fills within 24 hours with about {TARGET_ODDS}% odds: "
                "start from deskPrice and move it only to sit just above a real level from "
                "lows7d. Every order at least 10."
            )
        else:
            task = (
                f"The owner is removing {plain(amount)} {QUOTE}. Choose which coins to sell: "
                "those likeliest to dip soon so the owner can buy back lower (more "
                "overheatedSigns, high in the 30-day range, well above the 20-day average), "
                "then the most over target. One limit sell per coin that fills within 24 hours "
                f"with about {TARGET_ODDS}% odds, from deskPrice, just below a level from "
                "highs7d. At most a quarter of a position, at least 10 an order. Skip coins "
                "with nothing held."
            )
        return task + "\n\nDESK FIGURES:\n" + json.dumps(facts, indent=1)

    def analyse(self, side_word: object, amount_raw: object) -> dict[str, Any]:
        side, amount = _side(side_word), _amount(amount_raw)
        facts = self.facts(side)
        reply = self._ask(self._brief(facts, amount), self.SHAPE, f"Funds: {side_word}")
        proposed = reply["orders"] if reply else self.desk_plan(facts, amount)
        try:
            rows, said = self.settle(facts, amount, proposed)
        except Refused:
            if reply is None:
                raise
            proposed = self.desk_plan(facts, amount)
            reply, (rows, said) = None, self.settle(facts, amount, proposed)
        note = (
            str(reply.get("note") or "")[:700]
            if reply
            else "dca-agent couldn't be reached, so this is the desk's own plan."
        )
        return {
            "side": side,
            "amount": plain(amount),
            "quote": QUOTE,
            "orders": rows,
            "note": note,
            "said": said,
            "skipped": self.left_out(facts, rows, proposed),
            "by": AGENT if reply else "desk",
        }

    # The book's chat: one place to ask dca-agent to add, take out, change or cancel. It answers
    # in words and with actions; the desk checks each action and works out its odds, and the
    # owner places them after a review.

    AGENT_SHAPE: dict[str, Any] = {
        "type": "object",
        "properties": {
            "reply": {"type": "string"},
            "actions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "enum": ["buy", "sell", "change", "cancel"]},
                        "coin": {"type": "string"},
                        "ref": {"type": "string"},
                        "usdc": {"type": "string"},
                        "price": {"type": "string"},
                        "reason": {"type": "string"},
                    },
                    "required": ["type", "coin", "ref", "usdc", "price", "reason"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["reply", "actions"],
        "additionalProperties": False,
    }

    def open_orders(self) -> list[dict[str, Any]]:
        return [
            {
                "ref": r["ref"],
                "coin": r["coin"],
                "side": r["side"],
                "price": r["price"],
                "usdc": r["spend"] or plain(Decimal(r["qty"] or "0") * Decimal(r["price"] or "0")),
                "source": r["source"],
            }
            for r in self._store.dca_orders()
            if r["status"] in ("open", "placing") and r["kind"] == "limit"
        ]

    def check_action(
        self,
        item: dict[str, Any],
        facts: dict[str, dict[str, Any]],
        opened: dict[str, dict[str, Any]],
    ) -> dict[str, Any] | None:
        """One proposed action, checked; None when it can't stand."""
        kind = str(item.get("type"))
        if kind in ("change", "cancel"):
            order = opened.get(str(item.get("ref")))
            if order is None:
                return None
            if kind == "cancel":
                return {
                    "type": "cancel",
                    "coin": order["coin"],
                    "ref": order["ref"],
                    "side": order["side"],
                    "was": order["price"],
                    "usdc": order["usdc"],
                    "reason": str(item.get("reason") or "")[:240],
                }
            side, coin = order["side"], order["coin"]
        else:
            side = "sell" if kind == "sell" else "buy"
            coin = str(item.get("coin", "")).upper()
            order = None
        fact = next((c for c in facts[side]["coins"] if c["coin"] == coin), None)
        if fact is None:
            return None
        clean = self._clean(item, fact, side)
        if clean is None or clean["usdc"] < MIN_ORDER:
            return None
        if side == "sell" and kind == "sell":
            room = Decimal(fact["heldValue"]) * MAX_TRIM
            if room < MIN_ORDER:
                return None
            clean["usdc"] = min(clean["usdc"], room)
        now = Decimal(fact["now"])
        return {
            "type": kind,
            "coin": coin,
            "ref": order["ref"] if order else "",
            "side": side,
            "was": order["price"] if order else None,
            "price": plain(clean["price"]),
            "usdc": plain(clean["usdc"].quantize(CENT)),
            "now": fact["now"],
            "odds": self._odds(coin, side, now, clean["price"]),
            "reason": str(item.get("reason") or "")[:240],
        }

    def agent(self, body: dict[str, Any]) -> dict[str, Any]:
        text = " ".join(str(body.get("message") or "").split())[:CHAT_LENGTH]
        if not text:
            raise Refused("Type what you'd like first.")
        raw = body.get("history")
        history = cast(list[Any], raw)[-MAX_CHAT:] if isinstance(raw, list) else []
        opened = {o["ref"]: o for o in self.open_orders()}
        facts = {"buy": self.facts("buy")}
        if any(Decimal(c["held"]) > ZERO for c in facts["buy"]["coins"]) or any(
            o["side"] == "sell" for o in opened.values()
        ):
            facts["sell"] = self.facts("sell")
        limits = self._book.limits()
        prompt = (
            "The owner is talking to you about the DCA book. Answer in plain words and, when "
            "they ask for it, propose actions: buy (a new limit buy: coin, usdc, price), sell "
            "(a limit sell that trims a position: coin, usdc, price), change (an open order by "
            "ref: its new price and usdc) or cancel (an open order by ref). Leave unused fields "
            "as empty strings. Only propose what was asked; a question gets an answer and no "
            "actions. Rules: one order per coin per request; at least "
            f"{MIN_ORDER} {QUOTE} each; a buy at or under the price now, a sell at or over it; "
            "never sell more than a quarter of a position; stay within the limits below; aim "
            f"for about {TARGET_ODDS}% odds of a fill within 24 hours unless asked otherwise. "
            "The reply is at most 70 words.\n\n"
            "LIMITS:\n"
            + json.dumps(limits)
            + "\n\nOPEN ORDERS:\n"
            + json.dumps(list(opened.values()), indent=1)
            + "\n\nDESK FIGURES:\n"
            + json.dumps(list(facts.values()), indent=1)
            + "\n\nTHE CONVERSATION SO FAR:\n"
            + json.dumps(history, indent=1)
            + "\n\nTHE OWNER NOW SAYS:\n"
            + text
        )
        reply = self._ask(prompt, self.AGENT_SHAPE, "DCA book: chat")
        if reply is None:
            raise Refused("dca-agent couldn't be reached. Try again in a minute.")
        actions: list[dict[str, Any]] = []
        dropped = 0
        seen: set[str] = set()
        for item in reply.get("actions", []):
            found = self.check_action(item, facts, opened)
            key = f"{found['type']}:{found['ref'] or found['coin']}" if found else ""
            if found is None or key in seen:
                dropped += 1
                continue
            seen.add(key)
            actions.append(found)
        said = (
            [f"{dropped} of dca-agent's actions broke a rule and were left out."] if dropped else []
        )
        return {
            "reply": str(reply.get("reply") or "")[:700],
            "actions": actions,
            "said": said,
            "quote": QUOTE,
        }

    def chat(self, body: dict[str, Any]) -> dict[str, Any]:
        side, amount = _side(body.get("side")), _amount(body.get("amount"))
        text = " ".join(str(body.get("message") or "").split())[:CHAT_LENGTH]
        if not text:
            raise Refused("Type what to change first.")
        raw_history = body.get("history")
        history = cast(list[Any], raw_history)[-MAX_CHAT:] if isinstance(raw_history, list) else []
        raw_orders = body.get("orders")
        current = cast(list[Any], raw_orders) if isinstance(raw_orders, list) else []
        facts = self.facts(side)
        shape = {
            **self.SHAPE,
            "properties": {**self.SHAPE["properties"], "reply": {"type": "string"}},
            "required": ["note", "orders", "reply"],
        }
        prompt = (
            self._brief(facts, amount)
            + "\n\nTHE ORDERS NOW:\n"
            + json.dumps(current, indent=1)
            + "\n\nTHE CONVERSATION SO FAR:\n"
            + json.dumps(history, indent=1)
            + "\n\nTHE OWNER NOW SAYS:\n"
            + text
            + "\n\nReturn the whole set of orders after the change, and a reply of at most 60 "
            "words saying what changed and why, or why not if it breaks a rule."
        )
        reply = self._ask(prompt, shape, "Funds: chat")
        if reply is None:
            raise Refused("dca-agent couldn't be reached. Adjust the orders by hand.")
        rows, said = self.settle(facts, amount, reply["orders"])
        return {
            "side": side,
            "amount": plain(amount),
            "quote": QUOTE,
            "orders": rows,
            "note": str(reply.get("note") or "")[:700],
            "said": said,
            "skipped": self.left_out(facts, rows, reply["orders"]),
            "reply": str(reply.get("reply") or "")[:600],
            "by": AGENT,
        }
