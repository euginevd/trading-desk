"""trading-agent on the trading pot (docs/plan-trade.md): Scan now and its chat. The desk works
out every figure the agent reads (regime, averages, ATR, strength against BTC, ranges, funding)
and checks everything it proposes: the agent names a setup's entry, stop and target, the desk
sizes it and drops whatever breaks a rule. Nothing is placed without the owner's review."""

import json
from decimal import Decimal
from typing import Any, cast

import httpx

from api import my_agents
from api.advisor import futures
from api.ai_signal import MODELS, SignalError, Signals
from api.binance import BinanceError, plain
from api.market import QUOTE
from api.pot import AGENT, LIVE, Pot, sma
from api.trading import Refused, number

ZERO = Decimal(0)
DAYS = 210
ATR_DAYS = 14
RANGE_DAYS = 21
RECENT = 10
MAX_PROPOSALS = 3
CHAT_LENGTH = 600
MAX_CHAT = 12
FUNDING_HOT = Decimal("0.05")  # % per 8 hours: longs crowded
MODEL = "claude-opus-5-5"


def atr(rows: list[list[Any]], days: int = ATR_DAYS) -> Decimal | None:
    """The average true range over the last `days` daily candles."""
    if len(rows) <= days:
        return None
    ranges: list[Decimal] = []
    for before, row in zip(rows[-days - 1 : -1], rows[-days:], strict=True):
        high, low, prior = Decimal(str(row[2])), Decimal(str(row[3])), Decimal(str(before[4]))
        ranges.append(max(high - low, abs(high - prior), abs(low - prior)))
    return sum(ranges, ZERO) / days


def _pct(now: Decimal, then: Decimal) -> Decimal:
    return ((now / then - 1) * 100).quantize(Decimal("0.1")) if then else ZERO


def _p(value: Decimal | None) -> str | None:
    return plain(value.quantize(Decimal("0.0001"))) if value is not None else None


def coin_facts(coin: str, rows: list[list[Any]], btc_month: Decimal | None) -> dict[str, Any]:
    """One coin's daily picture, worked out here."""
    closes = [Decimal(str(r[4])) for r in rows]
    now = closes[-1]
    month = _pct(now, closes[-31]) if len(closes) > 30 else None  # noqa: PLR2004
    span = rows[-RANGE_DAYS:]
    volumes = [Decimal(str(r[7])) for r in rows[-20:]]
    return {
        "coin": coin,
        "price": plain(now),
        "sma20": _p(sma(closes, 20)),
        "sma50": _p(sma(closes, 50)),
        "sma200": _p(sma(closes, 200)),
        "atr14": _p(atr(rows)),
        "change30dPct": plain(month) if month is not None else None,
        "strongerThanBtc30d": None
        if month is None or btc_month is None or coin == "BTC"
        else month > btc_month,
        "range21d": {
            "high": plain(max(Decimal(str(r[2])) for r in span)),
            "low": plain(min(Decimal(str(r[3])) for r in span)),
        },
        "volumeVs20dAvg": plain(
            (volumes[-1] / (sum(volumes, ZERO) / len(volumes))).quantize(Decimal("0.01"))
        )
        if volumes and sum(volumes, ZERO)
        else None,
        "last10Days": [
            {"o": str(r[1]), "h": str(r[2]), "l": str(r[3]), "c": str(r[4])} for r in rows[-RECENT:]
        ],
    }


class PotAgent:
    def __init__(
        self, pot: Pot, signals: Signals | None, client: httpx.Client | None = None
    ) -> None:
        self._pot = pot
        self._signals = signals
        self._client = client  # Binance futures, public: funding and open interest

    def _crowding(self, coin: str) -> str:
        if self._client is None:
            return "Not checked"
        found = futures(self._client, coin)
        if found is None:
            return "No futures market"
        rate = Decimal(found["fundingPct"])
        if rate > FUNDING_HOT:
            return f"Crowded: funding {rate}% per 8 hours"
        if rate < 0:
            return f"Shorts crowded: funding {rate}%"
        return "Clear"

    def facts(self, only: str | None = None) -> dict[str, Any]:
        """The desk's figures for the model: BTC and every coin, or BTC and `only`."""
        pot = self._pot
        coins: list[dict[str, Any]] = []
        btc_month: Decimal | None = None
        wanted = [c for c in pot.coins() if c != "BTC" and (only is None or c == only)]
        for coin in ["BTC", *wanted]:
            try:
                rows = pot.binance.klines(f"{coin}{QUOTE}", "1d", DAYS)
            except BinanceError:
                continue
            if len(rows) < 31:  # noqa: PLR2004
                continue
            found = coin_facts(coin, rows, btc_month)
            if coin == "BTC" and found["change30dPct"] is not None:
                btc_month = Decimal(found["change30dPct"])
            found["crowding"] = self._crowding(coin)
            coins.append(found)
        view = pot.view()
        state, words = pot.regime()
        live = [
            {k: t[k] for k in ("ref", "coin", "status", "entry", "stop", "target", "now", "r")}
            for t in view["trades"]
            if t["status"] in LIVE
        ]
        return {
            "regime": {"state": state, "words": words},
            "pot": {
                k: view[k]
                for k in ("putIn", "value", "cash", "openRisk", "monthResult", "monthLimit")
            },
            "sizing": view["config"],
            "openTrades": live,
            "coins": coins,
        }

    def _rules(self) -> str:
        config = self._pot.config()
        if config["mode"] == "test":
            allowed = self._pot.allowed(self._pot.equity())
            fixed = Decimal(config["fixed"])
            widest = (
                (allowed / fixed * 100 - Decimal("0.3")).quantize(Decimal("0.1")) if fixed else ZERO
            )
            sizing = (
                f"Test phase: every trade is {config['fixed']} {QUOTE}, so the stop must be "
                f"within {widest}% of the entry."
            )
        else:
            allowed = self._pot.allowed(self._pot.equity())
            sizing = (
                f"Each trade risks {config['riskPct']}% of the pot, at most "
                f"{allowed:.2f} {QUOTE}; the desk sizes it from the stop, and a position is at "
                "most 25% of the pot."
            )
        return (
            f"{sizing} Reward to risk at least 2 : 1 after fees (0.1% a side). Entries by limit "
            "order at or under the price now. Long only, spot only. The desk sizes every trade "
            "and checks every rule; you give coin, setup, entry, stop and target, and a reason "
            "of at most two sentences naming the levels it rests on. Use only the figures given; "
            "never invent a price or level."
        )

    def _ask(self, prompt: str, shape: dict[str, Any], label: str) -> dict[str, Any] | None:
        if self._signals is None:
            return None
        store = self._pot.store
        listing = cast(list[dict[str, Any]], my_agents.listing(store)["agents"])
        none: dict[str, Any] = {}
        mine = next((a for a in listing if a["slug"] == AGENT), none)
        chosen: dict[str, Any] = mine.get("model") or {}
        model = str(chosen.get("id") or "")
        system = (
            (
                my_agents.file(store, AGENT)["markdown"]
                or "You are trading-agent, a disciplined trend trader running a small spot pot."
            )
            + "\n\n"
            + self._rules()
        )
        try:
            reply, _cost, _name = self._signals.step(
                system, prompt, shape, label, model=model if model in MODELS else MODEL, searches=0
            )
        except SignalError:
            return None
        return reply

    TRADE: dict[str, Any] = {
        "type": "object",
        "properties": {
            "coin": {"type": "string"},
            "setup": {"type": "string"},
            "entry": {"type": "string"},
            "stop": {"type": "string"},
            "target": {"type": "string"},
            "reason": {"type": "string"},
        },
        "required": ["coin", "setup", "entry", "stop", "target", "reason"],
        "additionalProperties": False,
    }
    SCAN: dict[str, Any] = {
        "type": "object",
        "properties": {"line": {"type": "string"}, "proposals": {"type": "array", "items": TRADE}},
        "required": ["line", "proposals"],
        "additionalProperties": False,
    }

    def _sized(self, item: dict[str, Any]) -> dict[str, Any]:
        """A proposed trade, sized and checked by the desk; Refused says why it can't go."""
        sized = self._pot.size(item)
        self._pot.check_rules(sized)
        setup = str(item.get("setup") or "Setup")[:60]
        return {
            **sized,
            "setup": setup,
            "reason": str(item.get("reason") or "")[:400],
            "crowding": self._crowding(sized["coin"]),
        }

    def scan(self) -> dict[str, Any]:
        """The daily-close scan, on demand: the regime, then any setup, checked and sized."""
        facts = self.facts()
        prompt = (
            "Run your daily-close scan now: the regime first, then any setup in the coins below "
            "that meets your file's rules. Most days there is none; say so in the line. The line "
            "is one sentence of at most 25 words. Propose at most three trades, only real "
            "setups, none in a coin with a trade already on.\n\nDESK FIGURES:\n"
            + json.dumps(facts, indent=1)
        )
        reply = self._ask(prompt, self.SCAN, "Pot: scan")
        if reply is None:
            raise Refused("trading-agent couldn't be reached. Try again in a minute.")
        found: list[dict[str, Any]] = []
        said: list[str] = []
        now = self._pot.now_ms()
        for n, item in enumerate(
            cast(list[dict[str, Any]], reply.get("proposals") or [])[:MAX_PROPOSALS]
        ):
            try:
                sized = self._sized(item)
            except Refused as why:
                said.append(f"{str(item.get('coin', '')).upper()} left out: {why}")
                continue
            found.append({"id": f"P{now}{n}", "created": now, **sized})
        line = str(reply.get("line") or "No setup today.")
        if said:
            line = f"{line} {' '.join(said)}"
        self._pot.set_proposals(found)
        self._pot.set_last_scan(line)
        return self._pot.view()

    ANALYSIS: dict[str, Any] = {
        "type": "object",
        "properties": {
            "verdict": {"type": "string", "enum": ["take", "wait", "pass"]},
            "headline": {"type": "string"},
            "points": {"type": "array", "items": {"type": "string"}},
            "setup": {"type": "string"},
            "entry": {"type": "string"},
            "stop": {"type": "string"},
            "target": {"type": "string"},
            "why": {"type": "string"},
            "wrongIf": {"type": "string"},
            "watch": {"type": "string"},
        },
        "required": [
            "verdict",
            "headline",
            "points",
            "setup",
            "entry",
            "stop",
            "target",
            "why",
            "wrongIf",
            "watch",
        ],
        "additionalProperties": False,
    }

    def analyse(self, body: dict[str, Any]) -> dict[str, Any]:
        """One coin read against the file's rules for New trade: a verdict, the reasons, and
        the trade filled in (setup, entry, stop, target, why, wrong if), sized and checked by
        the desk. The owner's own draft, if any, is reviewed too."""
        coin = str(body.get("coin", "")).upper()
        if coin not in self._pot.coins():
            raise Refused(f"{coin or 'That coin'} isn't one trading-agent trades.")
        facts = self.facts(only=coin)
        draft = {k: str(body.get(k) or "") for k in ("entry", "stop", "target")}
        mine = (
            "\n\nTHE OWNER'S DRAFT (review it in your points; keep it if it's sound): "
            + json.dumps(draft)
            if all(draft.values())
            else ""
        )
        prompt = (
            f"Analyse {coin} now for a long trade by your file's method: the regime first, then "
            f"{coin}'s trend, the levels it rests on, momentum and volume, and crowding. "
            "Verdict: take (a setup by the rules now), wait (close: say in watch what would "
            "make it a take), or pass (say why). Headline: one sentence of at most 20 words. "
            "Points: three to five short sentences, each naming its figure. Always give the "
            "trade you would place (setup, entry at or under the price now, stop, target), even "
            "for wait or pass, so the owner sees the levels; why is at most two sentences, "
            "wrongIf one short clause such as 'it closes a day under 61,200'."
            + mine
            + "\n\nDESK FIGURES:\n"
            + json.dumps(facts, indent=1)
        )
        reply = self._ask(prompt, self.ANALYSIS, f"Pot: analyse {coin}")
        if reply is None:
            raise Refused("trading-agent couldn't be reached. Try again in a minute.")
        verdict = str(reply.get("verdict"))
        plan: dict[str, Any] | None = {
            "setup": str(reply.get("setup") or "")[:60],
            "entry": str(reply.get("entry") or ""),
            "stop": str(reply.get("stop") or ""),
            "target": str(reply.get("target") or ""),
            "why": str(reply.get("why") or "")[:240],
            "wrongIf": str(reply.get("wrongIf") or "")[:100],
        }
        try:
            checked = self._pot.preview({"coin": coin, **(plan or {})})
        except Refused:
            checked = None
        if checked is None or checked["trade"] is None:
            plan = None  # levels the desk can't size are not offered as a trade
        else:
            trade = checked["trade"]
            plan = (plan or {}) | {k: trade[k] for k in ("entry", "stop", "target")}
        return {
            "coin": coin,
            "verdict": verdict if verdict in ("take", "wait", "pass") else "pass",
            "headline": str(reply.get("headline") or "")[:200],
            "points": [str(x)[:240] for x in cast(list[Any], reply.get("points") or [])][:5],
            "watch": str(reply.get("watch") or "")[:240],
            "plan": plan,
            "regime": facts["regime"],
        }

    ACTION: dict[str, Any] = {
        "type": "object",
        "properties": {
            "type": {"type": "string", "enum": ["open", "stop", "close", "cancel"]},
            "ref": {"type": "string"},
            "coin": {"type": "string"},
            "setup": {"type": "string"},
            "entry": {"type": "string"},
            "stop": {"type": "string"},
            "target": {"type": "string"},
            "reason": {"type": "string"},
        },
        "required": ["type", "ref", "coin", "setup", "entry", "stop", "target", "reason"],
        "additionalProperties": False,
    }
    CHAT: dict[str, Any] = {
        "type": "object",
        "properties": {"reply": {"type": "string"}, "actions": {"type": "array", "items": ACTION}},
        "required": ["reply", "actions"],
        "additionalProperties": False,
    }

    def check_action(self, item: dict[str, Any]) -> dict[str, Any]:
        """One proposed action, checked against the pot as it is; Refused says why not."""
        kind = str(item.get("type") or "")
        blank: dict[str, Any] = dict.fromkeys(
            ("ref", "coin", "setup", "entry", "stop", "target", "qty", "spend", "risk", "rr")
        )
        reason = str(item.get("reason") or "")[:300]
        if kind == "open":
            sized = self._sized(item)
            return blank | {k: sized.get(k) for k in blank} | {"type": kind, "reason": reason}
        trade = self._pot.store.pot_trade(str(item.get("ref") or ""))
        if trade is None:
            raise Refused("there's no trade with that reference")
        wanted = {"stop": ("open",), "close": ("open",), "cancel": ("placing", "waiting")}.get(kind)
        if wanted is None or trade["status"] not in wanted:
            raise Refused(f"{trade['ref']} can't be changed that way now")
        found = blank | {"type": kind, "ref": trade["ref"], "coin": trade["coin"], "reason": reason}
        if kind == "stop":
            stop = number(item.get("stop"), "Stop")
            if stop <= Decimal(trade["stop"]):
                raise Refused("a stop only moves toward profit")
            found["stop"] = plain(stop)
        return found

    def chat(self, body: dict[str, Any]) -> dict[str, Any]:
        text = " ".join(str(body.get("message") or "").split())[:CHAT_LENGTH]
        if not text:
            raise Refused("Type what you'd like first.")
        raw = body.get("history")
        history = cast(list[Any], raw)[-MAX_CHAT:] if isinstance(raw, list) else []
        prompt = (
            "The owner is talking to you about the trading pot. Answer in plain words, at most "
            "70 words. When they ask for it, propose actions: open (a new trade: coin, setup, "
            "entry, stop, target), stop (move an open trade's stop by ref, only toward profit), "
            "close (an open trade at market, by ref) or cancel (an entry not yet filled, by ref). "
            "Leave unused fields as empty strings. A question gets an answer and no actions.\n\n"
            "DESK FIGURES:\n"
            + json.dumps(self.facts(), indent=1)
            + "\n\nTHE CONVERSATION SO FAR:\n"
            + json.dumps(history, indent=1)
            + "\n\nTHE OWNER NOW SAYS:\n"
            + text
        )
        reply = self._ask(prompt, self.CHAT, "Pot: chat")
        if reply is None:
            raise Refused("trading-agent couldn't be reached. Try again in a minute.")
        actions: list[dict[str, Any]] = []
        said: list[str] = []
        for item in cast(list[dict[str, Any]], reply.get("actions") or [])[:MAX_PROPOSALS]:
            try:
                actions.append(self.check_action(item))
            except Refused as why:
                said.append(
                    f"Left out {item.get('type')} {item.get('ref') or item.get('coin')}: {why}"
                )
        return {"reply": str(reply.get("reply") or "")[:700], "actions": actions, "said": said}
