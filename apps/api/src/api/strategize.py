"""Strategize with the agent (owner, 21 Nov 2026): a chat in Add funds and Take profit, on the
Trade page (trading-agent) and the DCA book (dca-agent). The agent is given everything the desk
knows about the coin and the position, so the owner needn't explain: the holding, the coin's
levels, the fill odds at each price, the market, and the plan on screen. It answers in a few
words and hands back the whole plan, which the panel shows for the owner to place; the agent
never places an order."""

import contextlib
import json
from decimal import Decimal
from typing import Any, cast

import httpx

from api import my_agents, screener
from api.ai_signal import MODELS, SignalError, Signals
from api.binance import plain
from api.dca_book import DcaBook, positions
from api.market import QUOTE
from api.pot import Pot, position_key, touch_odds
from api.pot_agent import PotAgent
from api.trading import Refused, Trading

ZERO = Decimal(0)
MAX_HISTORY = 10
LENGTH = 500
AGENTS = {"trade": "trading-agent", "dca": "dca-agent"}

SHAPE: dict[str, Any] = {
    "type": "object",
    "properties": {
        "reply": {"type": "string"},
        "rows": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "price": {"type": "string"},
                    "amount": {"type": "string"},
                    "why": {"type": "string"},
                },
                "required": ["price", "amount", "why"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["reply", "rows"],
    "additionalProperties": False,
}


def _f(value: float) -> str:
    return plain(Decimal(str(value)).quantize(Decimal("0.00000001")).normalize())


def levels_of(rows: list[list[Any]], now: float) -> dict[str, Any]:
    """The coin's chart in figures: its daily swing, the named levels under and over the
    price, the 30-day range and the 20 and 50-day averages."""
    a = screener.atr(rows) or now * 0.04
    zones = screener.levels(rows, a)
    under = [z for z in zones if z["price"] < now][-5:]
    over = [z for z in zones if z["price"] > now][:5]
    closes = [float(r[4]) for r in rows]
    month = rows[-30:]
    return {
        "dailyMovePct": round(a / now * 100, 1),
        "support": [{"price": _f(z["price"]), "names": z["names"][:3]} for z in reversed(under)],
        "resistance": [{"price": _f(z["price"]), "names": z["names"][:3]} for z in over],
        "low30d": _f(min(float(r[3]) for r in month)) if month else None,
        "high30d": _f(max(float(r[2]) for r in month)) if month else None,
        "sma20": _f(s) if (s := screener.sma(closes, 20)) else None,
        "sma50": _f(s) if (s := screener.sma(closes, 50)) else None,
    }


def odds_ladder(rows: list[list[Any]], now: float, *, selling: bool) -> list[dict[str, Any]]:
    """How often, over the year, the price reached each step from here within a week."""
    found: list[dict[str, Any]] = []
    for pct in (1, 2, 3, 5, 8, 12, 16, 20, 25, 30):
        ratio = 1 + pct / 100 if selling else 1 - pct / 100
        if selling:
            highs = [float(r[2]) for r in rows]
            closes = [float(r[4]) for r in rows]
            starts = range(len(rows) - 7)
            hits = sum(1 for t in starts if max(highs[t + 1 : t + 8]) >= closes[t] * ratio)
            odds = round(hits * 100 / len(starts)) if len(starts) > 0 else 0
        else:
            odds = touch_odds(rows, ratio)
        found.append({"pct": pct, "price": _f(now * ratio), "oddsIn7Days": odds})
    return found


class Strategist:
    def __init__(
        self, desk: Trading, signals: Signals | None, client: httpx.Client | None = None
    ) -> None:
        self._desk = desk
        self._signals = signals
        self._client = client  # the market's mood and calendar; none in tests
        self._pot = Pot(desk)

    def _position(self, book: str, coin: str, key: str) -> dict[str, Any]:
        """The holding the plan is for, as the panel shows it."""
        if book == "dca":
            store = self._pot.store
            pos = positions(store.dca_orders(), [coin])[coin]
            waiting = [
                {"price": r["price"], "usdc": r["spend"]}
                for r in store.dca_orders()
                if r["coin"] == coin and r["side"] == "buy" and r["status"] in ("placing", "open")
            ]
            selling = [
                {"price": r["price"], "qty": r["qty"]}
                for r in store.dca_orders()
                if r["coin"] == coin and r["side"] == "sell" and r["status"] in ("placing", "open")
            ]
            return {
                "kind": "a lifelong DCA position, bought weekly",
                "held": plain(pos.qty),
                "average": plain(round(pos.cost / pos.qty, 8)) if pos.qty > ZERO else None,
                "putIn": plain(round(pos.added, 2)),
                "waitingBuys": waiting,
                "waitingSells": selling,
            }
        rows = [r for r in self._pot.store.pot_trades() if position_key(r) == key]
        held = [r for r in rows if r["status"] == "open"]
        qty = sum((Decimal(r["fill_qty"]) - Decimal(r["exit_qty"]) for r in held), ZERO)
        paid = sum((Decimal(r["fill_quote"]) for r in held), ZERO)
        bought = sum((Decimal(r["fill_qty"]) for r in held), ZERO)
        return {
            "kind": "a trading position, bought in a ladder, no stop",
            "held": plain(qty),
            "average": plain(round(paid / bought, 8)) if bought else None,
            "invested": plain(round(paid, 2)),
            "waitingBuys": [
                {"price": r["entry"], "usdc": r["spend"]}
                for r in rows
                if r["status"] in ("placing", "waiting")
            ],
        }

    def _market(self) -> dict[str, Any]:
        found: dict[str, Any] = {}
        try:
            found["regime"] = self._pot.regime_view()
        except Exception:  # noqa: BLE001 - context only; the chat goes on without it
            found["regime"] = None
        # Context only; the chat goes on without it.
        if self._client is not None:
            with contextlib.suppress(Exception):
                found |= PotAgent(self._pot, None, self._client).context()
        return found

    def _ask(self, slug: str, prompt: str) -> dict[str, Any]:
        if self._signals is None:
            raise Refused("No AI is set up. Settings, AI, to choose one.")
        store = self._pot.store
        agent = my_agents.file(store, slug)
        listing = cast(list[dict[str, Any]], my_agents.listing(store)["agents"])
        none: dict[str, Any] = {}
        mine = next((a for a in listing if a["slug"] == slug), none)
        found: dict[str, Any] = mine.get("model") or {}
        model = str(found.get("id") or "")
        if model not in MODELS:
            model = "claude-sonnet-5-5"
        system = (
            (agent.get("markdown") or f"You are {slug}, the owner's trading helper.")
            + "\n\nYou are helping the owner plan orders for one coin, in the desk's Add funds "
            "or Take profit panel. Use only the desk's figures given here; never invent a "
            "price, level or odds. Name the level a price rests on. Every order is at least "
            "10 USDC. You only propose: the owner places. Your reply is at most 70 words, "
            "plain, no headings; then the whole plan as rows, changed or not, each row's why at "
            "most 8 words."
        )
        try:
            reply, _cost, _name = self._signals.step(
                system, prompt, SHAPE, "Strategize", model=model, searches=0
            )
        except SignalError as error:
            raise Refused(f"{slug} couldn't be reached: {error}") from error
        return reply

    def chat(self, body: dict[str, Any]) -> dict[str, Any]:
        book = "dca" if body.get("book") == "dca" else "trade"
        selling = body.get("mode") == "sell"
        coin = str(body.get("coin") or "").upper()
        text = " ".join(str(body.get("message") or "").split())[:LENGTH]
        if not coin or not text:
            raise Refused("Ask something first.")
        if book == "dca" and coin not in DcaBook(self._desk).coins():
            raise Refused(f"{coin} isn't in your DCA plan.")
        now = self._pot.price_now(coin)
        days = self._pot.binance.klines(f"{coin}{QUOTE}", "1d", 400)
        raw_history = body.get("history")
        history = (
            cast(list[Any], raw_history)[-MAX_HISTORY:] if isinstance(raw_history, list) else []
        )
        raw_rows = body.get("rows")
        current = cast(list[Any], raw_rows) if isinstance(raw_rows, list) else []
        amount_word = (
            "pct (share of the position to sell, all rows together at most 100)"
            if selling
            else "usdc"
        )
        facts = {
            "coin": coin,
            "priceNow": plain(now),
            "doing": "take profit: limit sells above the price"
            if selling
            else (f"add funds: limit buys under the price, about {body.get('total') or '?'} USDC"),
            "position": self._position(book, coin, str(body.get("position") or "")),
            "chart": levels_of(days, float(now)),
            "oddsFromHere": odds_ladder(days, float(now), selling=selling),
            "market": self._market(),
        }
        prompt = (
            "THE DESK'S FIGURES:\n"
            + json.dumps(facts, indent=1, default=str)
            + "\n\nTHE PLAN ON SCREEN (amount is "
            + amount_word
            + "):\n"
            + json.dumps(current, indent=1)
            + "\n\nTHE CONVERSATION SO FAR:\n"
            + json.dumps(history, indent=1)
            + "\n\nTHE OWNER NOW SAYS:\n"
            + text
            + f"\n\nAnswer, then return the whole plan; each row's amount is {amount_word}."
        )
        reply = self._ask(AGENTS[book], prompt)
        rows = [
            {
                "price": str(r.get("price") or ""),
                "amount": str(r.get("amount") or ""),
                "why": str(r.get("why") or "")[:80],
            }
            for r in cast(list[dict[str, Any]], reply.get("rows") or [])[:6]
        ]
        return {"reply": str(reply.get("reply") or "")[:700], "rows": rows, "by": AGENTS[book]}
