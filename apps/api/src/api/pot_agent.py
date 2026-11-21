"""trading-agent on the trading pot (docs/plan-trade.md): Scan now and its chat. The desk works
out every figure the agent reads (regime, averages, ATR, strength against BTC, ranges, funding)
and checks everything it proposes: the agent names a setup's entry, stop and target, the desk
sizes it and drops whatever breaks a rule. Nothing is placed without the owner's review."""

import contextlib
import json
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any, cast
from zoneinfo import ZoneInfo

import httpx

from api import macro, my_agents, scan_progress, screener
from api.advisor import FUTURES_URL, futures
from api.ai_signal import MODELS, SignalError, Signals
from api.binance import BinanceError, plain
from api.market import QUOTE
from api.pot import AGENT, LIVE, Pot, sma
from api.sentiment import SentimentError, fear_and_greed, market_global
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
SYDNEY = ZoneInfo("Australia/Sydney")
VERDICTS = ("take", "wait", "pass")
# Each style's longest hold in days: a macro event inside it is named to the AI and the owner.
HOLD_DAYS = {"scalp": 1 / 24, "day": 0.5, "swing": 21.0, "position": 42.0}
MACRO_MODEL = "claude-haiku-5-5"  # the calendar lookup: one small call a day
DOMINANCE_KEY = "btc_dominance_days"  # BTC's share by Sydney day, for its 7-day change
GATE_DAYS = 14  # the macro events the scan's gates show
SEARCH: dict[str, Any] = {
    "type": "array",
    "items": {
        "type": "object",
        "properties": {"query": {"type": "string"}, "found": {"type": "string"}},
        "required": ["query", "found"],
        "additionalProperties": False,
    },
}


def clip(text: object, limit: int) -> str:
    """Words up to the limit, never cut mid-word; an ellipsis when something was left out."""
    words = " ".join(str(text or "").split())
    if len(words) <= limit:
        return words
    return words[: limit - 1].rsplit(" ", 1)[0].rstrip(",;:·-") + "…"


def _points(raw: object, most: int) -> list[str]:
    items = cast(list[Any], raw) if isinstance(raw, list) else []
    return [p for p in (clip(x, 70) for x in items) if p][:most]


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
        self._spend: dict[str, Any] = {"calls": 0, "searches": 0, "usd": ZERO}
        self._ctx: dict[str, Any] | None = None

    def _crowding(self, coin: str) -> str:
        if self._client is None:
            return "Not checked"
        found = futures(self._client, coin)
        if found is None:
            return "No futures market"
        rate = Decimal(found["fundingPct"])
        oi = self._oi_change(coin)
        tail = f"; open interest {oi:+}% in 7 days" if oi is not None else ""
        if rate > FUNDING_HOT:
            return f"Crowded: funding {rate}% per 8 hours{tail}"
        if rate < 0:
            return f"Shorts crowded: funding {rate}%{tail}"
        return f"Clear: funding {rate}% per 8 hours{tail}"

    def _oi_change(self, coin: str) -> Decimal | None:
        """Open interest on Binance's USDT perpetual over 7 days, in percent; public data."""
        if self._client is None:
            return None
        try:
            response = self._client.get(
                f"{FUTURES_URL}/futures/data/openInterestHist",
                params={"symbol": f"{coin}USDT", "period": "1d", "limit": 8},
            )
            rows = cast(list[dict[str, Any]], response.json()) if response.is_success else []
            first = Decimal(str(rows[0]["sumOpenInterestValue"]))
            last = Decimal(str(rows[-1]["sumOpenInterestValue"]))
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError, ArithmeticError):
            return None
        return _pct(last, first) if first else None

    # The market around a scan (owner, 21 Nov 2026): Fear & Greed, BTC's dominance and its
    # 7-day change, and the US macro calendar. Context for the AI and the owner, never a rule.

    def _macro_ask(self, prompt: str, shape: dict[str, Any]) -> dict[str, Any] | None:
        if self._signals is None:
            return None
        try:
            reply, cost, _name = self._signals.step(
                "You read official economic calendars and answer only from what you find.",
                prompt,
                shape,
                "Macro calendar",
                model=MACRO_MODEL,
                searches=1,
            )
        except SignalError:
            return None
        self._spent(cost, 1)
        return reply

    def _spent(self, cost: Decimal, searches: int) -> None:
        self._spend["calls"] += 1
        self._spend["searches"] += searches
        self._spend["usd"] += cost

    def context(self) -> dict[str, Any]:
        """Read once a scan: the mood, BTC's share, and the macro events of the next 3 weeks."""
        if self._ctx is not None:
            return self._ctx
        pot = self._pot
        now = pot.now_ms()
        ctx: dict[str, Any] = {"fearGreed": None, "dominance": None, "macro": []}
        if self._client is not None:
            with contextlib.suppress(SentimentError):
                mood = fear_and_greed(self._client)
                ctx["fearGreed"] = {"value": mood["value"], "label": mood["label"]}
            share = market_global(self._client).get("btcShare")
            if share:
                ctx["dominance"] = self._dominance(Decimal(str(share)), now)
        ask = self._macro_ask if self._signals is not None else None
        ctx["macro"] = macro.events(pot.store, self._client, ask, now)
        self._ctx = ctx
        return ctx

    def _dominance(self, share: Decimal, now_ms: int) -> dict[str, str | None]:
        """BTC's share of the market, kept a day at a time so its 7-day change can be told."""
        today = datetime.fromtimestamp(now_ms / 1000, SYDNEY)
        store = self._pot.store
        raw = store.setting(DOMINANCE_KEY, "")
        days = cast(dict[str, str], json.loads(raw) if raw else {})
        tenth = Decimal("0.1")
        days[today.strftime("%Y-%m-%d")] = plain(share.quantize(tenth))
        kept = dict(sorted(days.items())[-15:])
        store.set_setting(DOMINANCE_KEY, json.dumps(kept))
        week_ago = (today - timedelta(days=7)).strftime("%Y-%m-%d")
        older = [v for d, v in kept.items() if d <= week_ago]
        change = share - Decimal(older[-1]) if older else None
        return {
            "share": plain(share.quantize(tenth)),
            "change7d": plain(change.quantize(tenth)) if change is not None else None,
        }

    def _market_for(self, style: screener.Style, seen: dict[str, Any]) -> dict[str, Any]:
        """MARKET for a prompt: the regime and timing, then the context."""
        ctx = self.context()
        now = self._pot.now_ms()
        events = cast(list[dict[str, Any]], ctx["macro"])
        hold = macro.inside(events, now, HOLD_DAYS[style.key])
        return {
            "regime": seen["regime"],
            "warnings": seen["warnings"],
            "fearGreed": ctx["fearGreed"],
            "btcDominance": ctx["dominance"],
            "macroInsideHold": [{"title": e["title"], "when": e["when"]} for e in hold],
            "macroNext": [{"title": e["title"], "when": e["when"]} for e in events[:4]],
        }

    def _given(self, style: screener.Style, seen: dict[str, Any]) -> list[str]:
        """What the AI was handed, in short lines for the scan's report."""
        ctx = self.context()
        regime = cast(dict[str, Any], seen.get("regime") or {})
        lines = [f"Regime {str(regime.get('state') or 'unknown').title()}"]
        lines += [str(w) for w in cast(list[Any], seen.get("warnings") or [])][:2]
        for f in cast(list[dict[str, Any]], seen.get("shortlist") or [])[:4]:
            odds = cast(dict[str, Any], f.get("odds") or {})
            lean = f", odds {odds['lean']}" if odds.get("lean") else ""
            lines.append(
                f"{f['coin']}: {f['setup']}, entry {f['entry']}, stop {f['stop']}, "
                f"target {f['target']}{lean}"
            )
            if f.get("crowding"):
                lines.append(f"{f['coin']}: {f['crowding']}")
        if not seen.get("shortlist"):
            misses = cast(list[dict[str, Any]], seen.get("misses") or [])
            lines += [f"{m['coin']}: {m['why']}" for m in misses]
        now = self._pot.now_ms()
        hold = macro.inside(cast(list[dict[str, Any]], ctx["macro"]), now, HOLD_DAYS[style.key])
        if hold:
            lines.append(
                "Macro in the hold: " + ", ".join(f"{e['title']} {e['when']}" for e in hold[:3])
            )
        mood = cast(dict[str, Any] | None, ctx["fearGreed"])
        dom = cast(dict[str, Any] | None, ctx["dominance"])
        if mood:
            words = f"Fear & Greed {mood['value']}, {mood['label']}"
            if dom:
                change = f" ({dom['change7d']:+} in 7 days)" if dom.get("change7d") else ""
                words += f"; BTC dominance {dom['share']}%{change}"
            lines.append(words)
        return lines

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
        view = pot.book_view()  # no balance read for the model
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

    def _ask(
        self,
        prompt: str,
        shape: dict[str, Any],
        label: str,
        style: screener.Style | None = None,
    ) -> dict[str, Any] | None:
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
            reply, cost, _name = self._signals.step(
                system,
                prompt,
                shape,
                label,
                model=style.model if style else model if model in MODELS else MODEL,
                searches=style.searches if style else 0,
            )
        except SignalError:
            return None
        self._spent(cost, len(cast(list[Any], reply.get("searches") or [])))
        return reply

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

    def scan(self, every: bool = False) -> dict[str, Any]:
        """The daily-close scan (11:15am Sydney): swing every day and position on Mondays.
        Scan now (every) runs all four styles. Each goes through the screener and
        trading-agent; a take the desk can place becomes a proposal, waiting for the owner on
        the desk and in Telegram, and each style leaves a card: its take, or the closest coin
        and what it's missing."""
        pot = self._pot
        now = pot.now_ms()
        monday = datetime.fromtimestamp(now / 1000, SYDNEY).weekday() == 0
        found: list[dict[str, Any]] = []
        said: list[str] = []
        cards: list[dict[str, Any]] = []
        judged = 0
        self._ctx = None
        self._spend = {"calls": 0, "searches": 0, "usd": ZERO}
        keys = tuple(screener.STYLES) if every else ("swing", "position") if monday else ("swing",)
        # Scan now's steps panel (scan_progress): nothing is recorded unless Scan now began it.
        scan_progress.plan([(k, screener.STYLES[k].name) for k in keys])
        for key in keys:
            try:
                seen = self.judge({"style": key})
            except Refused as why:  # one style failing leaves the others standing
                name = screener.STYLES[key].name
                said.append(f"{name}: {why}")
                cards.append({"style": key, "name": name, "line": str(why)[:200]})
                scan_progress.step(key, "failed", str(why))
                continue
            scan_progress.step(key, "done", _judged_words(seen))
            judged += 1
            misses = cast(list[dict[str, str]], seen.get("misses") or [])
            closest = "; ".join(f"{m['coin']} {m['why']}" for m in misses)
            said.append(
                f"{seen['name']}: {seen['line']}"
                + (f" Closest: {closest}." if closest and not seen["picks"] else "")
            )
            take: dict[str, Any] | None = None
            for n, pick in enumerate(seen["picks"]):
                if pick["problem"] or pick["verdict"] != "take":
                    continue
                kept = {k: v for k, v in pick.items() if k != "facts"}
                proposal = kept | {
                    "id": f"P{now}{key}{n}",  # the whole key: scalp and swing share an s
                    "created": now,
                    "expires": seen["expires"],
                }
                found.append(proposal)
                take = take or proposal
            cards.append(_card(key, seen, take, misses) | _report(seen, misses) | {"at": now})
        if not judged:  # nothing was judged: the proposals waiting stay, and the owner hears why
            raise Refused(" ".join(said)[:300])
        kept_ids = {p["id"] for p in found[:MAX_PROPOSALS]}
        for card in cards:  # a take past the proposal cap has nothing to review
            if card.get("take") and card["take"]["id"] not in kept_ids:
                card.pop("take")
        pot.set_proposals(found[:MAX_PROPOSALS])
        # A daily scan runs one or two styles: the others keep their last report.
        before = cast(list[dict[str, Any]], (pot.last_scan() or {}).get("styles") or [])
        ran = {c["style"] for c in cards}
        order = list(screener.STYLES)
        merged = sorted(
            cards + [c for c in before if c.get("style") not in ran],
            key=lambda c: order.index(c["style"]) if c.get("style") in order else 9,
        )
        spend = self._spend
        cost = {
            "calls": spend["calls"],
            "searches": spend["searches"],
            "usd": plain(cast(Decimal, spend["usd"]).quantize(Decimal("0.01"))),
        }
        pot.set_last_scan(" ".join(said)[:600], merged, {"gates": self.gates(), "cost": cost})
        return pot.view()

    def gates(self) -> dict[str, Any]:
        """Before any coin: the regime and its two tests, BTC's trend for scalps and day
        trades, the macro calendar, the mood and BTC's share."""
        pot = self._pot
        now = pot.now_ms()
        ctx = self.context()
        intraday: dict[str, Any] = {}
        for key in ("scalp", "day"):
            with contextlib.suppress(BinanceError):
                intraday[key] = screener.btc_gate(pot.binance, key, now)
        events = cast(list[dict[str, Any]], ctx["macro"])
        return {
            "regime": pot.regime_view(),
            **intraday,
            "macro": [e for e in events if e["inDays"] <= GATE_DAYS][:6],
            "fearGreed": ctx["fearGreed"],
            "dominance": ctx["dominance"],
            "weekend": datetime.fromtimestamp(now / 1000, SYDNEY).weekday() >= 5,  # noqa: PLR2004
        }

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

    # New trade by style (local/agents/trading-agent.md): the screener first, in code, then
    # trading-agent on its shortlist only, then the desk sizes and checks each pick.

    def styles(self) -> dict[str, Any]:
        return screener.styles_view(self._pot.regime())

    def screen(self, body: dict[str, Any]) -> dict[str, Any]:
        """The style's screen: no model, a few seconds; kept briefly for judge."""
        pot = self._pot
        key = str(body.get("style") or "")

        def crowding(coin: str) -> str:
            # The screener asks for funding once the shortlist is in, just before its odds.
            scan_progress.step(key, "checking odds")
            return self._crowding(coin)

        try:
            return screener.screen(
                key,
                binance=pot.binance,
                store=pot.store,
                http=self._client,
                regime=pot.regime(),
                fallback=pot.coins(),
                now_ms=pot.now_ms(),
                crowding=crowding,
            )
        except ValueError as error:
            raise Refused(str(error)) from error
        except BinanceError as error:
            raise Refused(f"Binance didn't answer the screen: {error.message}") from error

    PICK: dict[str, Any] = {
        "type": "object",
        "properties": {
            "coin": {"type": "string"},
            "setup": {"type": "string"},
            "grade": {"type": "string", "enum": ["A", "B", "C"]},
            "score": {"type": "number"},
            "verdict": {"type": "string", "enum": ["take", "wait", "pass"]},
            "entry": {"type": "string"},
            "stop": {"type": "string"},
            "target": {"type": "string"},
            "confluence": {"type": "array", "items": {"type": "string"}},
            "against": {"type": "array", "items": {"type": "string"}},
            "catalyst": {"type": "string"},
            "crowding": {"type": "string"},
            "news": {"type": "string"},
            "flows": {"type": "string"},
            "reason": {"type": "string"},
        },
        "required": [
            "coin",
            "setup",
            "grade",
            "score",
            "verdict",
            "entry",
            "stop",
            "target",
            "confluence",
            "against",
            "catalyst",
            "crowding",
            "news",
            "flows",
            "reason",
        ],
        "additionalProperties": False,
    }
    JUDGE: dict[str, Any] = {
        "type": "object",
        "properties": {
            "line": {"type": "string"},
            "picks": {"type": "array", "items": PICK},
            "searches": SEARCH,
        },
        "required": ["line", "picks", "searches"],
        "additionalProperties": False,
    }

    def judge(self, body: dict[str, Any]) -> dict[str, Any]:
        """trading-agent on the style's shortlist: confluence, catalysts online, a grade and
        the levels; then each pick sized by the desk at the style's risk."""
        key = str(body.get("style") or "")
        style = screener.STYLES.get(key)
        if style is None:
            raise Refused("Pick scalp, day, swing or position.")
        pot = self._pot
        scan_progress.step(key, "screening")
        seen = screener.last_screen(key, pot.now_ms()) or self.screen(body)
        scan_progress.step(key, None, _screened_words(seen))
        keys = (
            "style",
            "name",
            "regime",
            "warnings",
            "counts",
            "allowed",
            "misses",
            "block",
            "funnel",
        )
        out = {k: seen.get(k) for k in keys}
        out |= {"note": seen["note"], "riskPct": seen["riskPct"], "picks": [], "line": ""}
        out["expires"] = pot.now_ms() + style.expiry_s * 1000
        if not seen["allowed"] or not seen["shortlist"]:
            out["line"] = (
                seen["note"]
                if not seen["allowed"]
                else f"No {style.name.lower()} setups right now."
            )
            if seen["allowed"] and seen.get("misses"):
                out |= self._watch(style, seen, key)
                out |= {"given": self._given(style, seen), "model": MODELS[style.model].name}
            return out
        scan_progress.step(key, "judging")
        reply = self._ask(self._judge_prompt(style, seen), self.JUDGE, f"Pot: {key} picks", style)
        if reply is None:
            raise Refused("trading-agent couldn't be reached. Try again in a minute.")
        out["line"] = str(reply.get("line") or "")[:300]
        out["searches"] = _searches(reply)
        out |= {"given": self._given(style, seen), "model": MODELS[style.model].name}
        scan_progress.step(key, "sizing")
        out["picks"] = self._checked_picks(style, seen, reply)
        return out

    WATCH: dict[str, Any] = {
        "type": "object",
        "properties": {
            "line": {"type": "string"},
            "watch": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "coin": {"type": "string"},
                        "verdict": {"type": "string", "enum": ["wait", "pass"]},
                        "watchFor": {"type": "string"},
                        "reason": {"type": "string"},
                    },
                    "required": ["coin", "verdict", "watchFor", "reason"],
                    "additionalProperties": False,
                },
            },
            "searches": SEARCH,
        },
        "required": ["line", "watch", "searches"],
        "additionalProperties": False,
    }

    def _watch(self, style: screener.Style, seen: dict[str, Any], key: str) -> dict[str, Any]:
        """No setup: trading-agent judges the screener's near misses, watch only (decision 95).
        It says Wait or Pass and what would make a setup, never Take: a trade still needs the
        rules to pass. If it can't be reached, the screener's own reasons stand."""
        misses = cast(list[dict[str, str]], seen["misses"])
        scan_progress.step(key, "judging")
        prompt = (
            f"{style.name} style ({style.line}). The desk's screener found NO setup by the rules "
            "below; these are the closest coins and what each is missing. Judge each, watch "
            "only: verdict 'wait' if it's worth watching for the setup to form, 'pass' if not. "
            "You can't take a trade here; the rules must pass first. watchFor: what would turn "
            "it into a setup, at most 12 words, with a price or level where you can (e.g. "
            "'A close back over 2.95 on the 4-hour'). Reason: at most 20 words. Order closest "
            "first. Line: at most 15 words.\n" + CONTEXT_RULES + "\n"
            f"THE RULES: your file's 'Rules for every style' and '{screener.HEADING[style.key]}' "
            "sections.\n\nMARKET:\n"
            + json.dumps(self._market_for(style, seen))
            + "\n\nNEAR MISSES:\n"
            + json.dumps(misses, indent=1)
        )
        reply = self._ask(prompt, self.WATCH, f"Pot: {key} watch", style)
        if reply is None:
            return {}
        named = {m["coin"] for m in misses}
        watch: list[dict[str, str]] = []
        for item in cast(list[dict[str, Any]], reply.get("watch") or []):
            coin = str(item.get("coin") or "").upper()
            if coin not in named or any(w["coin"] == coin for w in watch):
                continue
            verdict = "wait" if item.get("verdict") == "wait" else "pass"
            watch.append(
                {
                    "coin": coin,
                    "verdict": verdict,
                    "watchFor": clip(item.get("watchFor"), 100),
                    "reason": clip(item.get("reason"), 160),
                }
            )
        line = clip(reply.get("line"), 200)
        found = {"watch": watch[:3], "searches": _searches(reply)}
        return found | ({"line": line} if line else {})

    def judge_one(self, body: dict[str, Any]) -> dict[str, Any]:
        """trading-agent on one setup the paper bot found (apps/backtest): New trade's prompt
        and rules, for one coin. Nothing is sized or placed; the bot trades only a take."""
        key = str(body.get("style") or "")
        style = screener.STYLES.get(key)
        if style is None:
            raise Refused("Pick scalp, day, swing or position.")
        coin = str(body.get("coin") or "").upper()
        if not screener.PLAIN.fullmatch(coin):
            raise Refused("Name the coin.")
        levels = {k: str(body.get(k) or "") for k in ("entry", "stop", "target")}
        try:
            entry, stop, target = (float(levels[k]) for k in ("entry", "stop", "target"))
        except ValueError as error:
            raise Refused("Give the entry, stop and target as numbers.") from error
        if not 0 < stop < entry < target:
            raise Refused("The stop goes under the entry and the target over it.")
        found: dict[str, Any] = {
            "coin": coin,
            "setup": clip(body.get("setup"), 60),
            **levels,
            "stopPct": f"{(entry - stop) / entry * 100:.2f}",
            "facts": {"price": str(body.get("price") or levels["entry"])},
        }
        # The desk's own screen gives the facts (trend, levels, strength against BTC) and the
        # odds when it finds the same coin; without them the model would guess at the trend.
        seen_now: dict[str, Any]
        try:
            seen_now = screener.last_screen(key, self._pot.now_ms()) or self.screen({"style": key})
        except Refused:  # Binance didn't answer: judge on the levels and the web
            seen_now = {"shortlist": cast(list[dict[str, Any]], [])}
        listed = cast(list[dict[str, Any]], seen_now["shortlist"])
        mine = next((f for f in listed if f["coin"] == coin), None)
        if mine:
            found["facts"] = mine["facts"]
        else:
            found["facts"]["note"] = "Not on the desk's shortlist now: judge from the web"
        found["crowding"] = self._crowding(coin)
        found["odds"] = screener.odds_for(key, coin, **levels)
        state, words = self._pot.regime()
        seen = {
            "regime": {"state": state, "words": words},
            "warnings": screener.timing(style, self._pot.now_ms()),
            "shortlist": [found],
        }
        reply = self._ask(
            self._judge_prompt(style, seen), self.JUDGE, f"Paper: {key} {coin}", style
        )
        if reply is None:
            raise Refused("trading-agent couldn't be reached. Try again in a minute.")
        picks = cast(list[dict[str, Any]], reply.get("picks") or [])
        item = next((p for p in picks if str(p.get("coin") or "").upper() == coin), None)
        if item is None:
            return {
                "coin": coin,
                "verdict": "pass",
                "grade": "C",
                "reason": clip(reply.get("line"), 220),
            }
        verdict, grade = item.get("verdict"), item.get("grade")
        return {
            "coin": coin,
            "verdict": verdict if verdict in VERDICTS else "pass",
            "grade": grade if grade in ("A", "B", "C") else "C",
            "score": round(min(max(float(item.get("score") or 0), 0.0), 10.0), 1),
            "reason": clip(item.get("reason"), 220),
            "confluence": _points(item.get("confluence"), 4),
            "against": _points(item.get("against"), 2),
            "catalyst": clip(item.get("catalyst"), 100),
        }

    def _judge_prompt(self, style: screener.Style, seen: dict[str, Any]) -> str:
        searching = (
            f"You may run up to {style.searches} web searches: look for catalysts due within "
            f"the hold ({style.hold}): token unlocks, listings or delistings, upgrades, "
            "hacks, and high-impact US events (CPI, jobs, the Fed). Name what you found and "
            "its date, or say none found."
            if style.searches
            else "No web search for this style: judge catalysts from the facts only."
        )
        return (
            f"New trade, {style.name} style ({style.line}). The desk's screener found these "
            "setups among the top 100 coins on Binance, by the rules below. For each, check "
            "confluence (how many separate reasons line up at the entry: levels, trend, volume, "
            f"strength against BTC), then catalysts. {searching} Grade each A (strong "
            "confluence, nothing against it), B (good) or C (weak), score it 0 to 10, and "
            "give a verdict: take, wait or pass. Keep the screener's entry, stop and target "
            "unless confluence gives a better level by the same rules; the entry stays at or "
            "under the price now. Order the picks best first, at most four.\n"
            "WRITE SHORT: the owner reads this on a card. Figures, not prose; no repeating the "
            "entry, stop or target (the card shows them). Confluence: two to four points for "
            "the trade, at most 8 words each (e.g. 'Holding the 20-week SMA', 'Beats BTC: "
            "+101% vs +4% in 13 weeks'). Against: up to two points, at most 8 words each "
            "(e.g. 'Deep pullback: under the 10-week'). Catalyst: at most 12 words, or 'None "
            "in the next two weeks'. Crowding: at most 8 words, from the funding given. "
            "Reason: the thesis, one sentence of at most 25 words: why it should work and "
            "what would prove it wrong. Line: at most 15 words.\n"
            "ODDS: each setup carries the desk's odds check, in code: 'past' is this rule "
            "re-run on the coin's own past candles, 'sim' is paths drawn from them; 'needed' is "
            "the share of decided trades the target must win to break even, and 'lean' the "
            "verdict. A coin flip or a lean no is a point against; a strong no is a reason to "
            "wait or pass. Don't repeat its numbers (the card shows them).\n"
            + CONTEXT_RULES
            + "News: from your coin search, the week's headline tone, 'Positive', 'Neutral' "
            "or 'Negative', a colon, then at most 8 words. Flows: only for BTC or ETH in a "
            "swing or position trade, one search for the week's spot ETF flows and exchange "
            "balances, at most 12 words; otherwise an empty string.\n\n"
            f"THE RULES: your file's 'Rules for every style' and '{screener.HEADING[style.key]}' "
            "sections (what the desk has built), not its 'Not built yet' lists.\n\n"
            "MARKET:\n"
            + json.dumps(self._market_for(style, seen))
            + "\n\nSHORTLIST:\n"
            + json.dumps(seen["shortlist"], indent=1)
        )

    def _checked_picks(
        self, style: screener.Style, seen: dict[str, Any], reply: dict[str, Any]
    ) -> list[dict[str, Any]]:
        """Only coins on the shortlist, each sized by the desk at the style's risk; a pick the
        rules refuse stays in the list with the reason, so the owner sees why."""
        listed = {c["coin"]: c for c in seen["shortlist"]}
        picks: list[dict[str, Any]] = []
        for item in cast(list[dict[str, Any]], reply.get("picks") or [])[:4]:
            coin = str(item.get("coin") or "").upper()
            if coin not in listed or any(p["coin"] == coin for p in picks):
                continue
            picks.append(self._checked_pick(style, item, listed[coin]))
        return picks

    def _checked_pick(
        self, style: screener.Style, item: dict[str, Any], found: dict[str, Any]
    ) -> dict[str, Any]:
        coin = found["coin"]
        grade, verdict = item.get("grade"), item.get("verdict")
        pick: dict[str, Any] = {
            "coin": coin,
            "setup": found["setup"],  # the screener's own name for it, always short
            "grade": grade if grade in ("A", "B", "C") else "C",
            "score": round(min(max(float(item.get("score") or 0), 0.0), 10.0), 1),
            "verdict": verdict if verdict in VERDICTS else "pass",
            "confluence": _points(item.get("confluence"), 4),
            "against": _points(item.get("against"), 2),
            "catalyst": clip(item.get("catalyst"), 100),
            "crowding": clip(item.get("crowding") or found.get("crowding"), 70),
            "news": clip(item.get("news"), 90),
            "flows": clip(item.get("flows"), 110),
            "reason": clip(item.get("reason"), 220),
            "facts": found["facts"],
            "problem": None,
        }
        levels = {k: str(item.get(k) or found[k]) for k in ("entry", "stop", "target")}
        same = all(levels[k] == found[k] for k in levels)
        # The screen's own levels when trading-agent moved them, so the one-tap says so (audit 21).
        pick["screened"] = None if same else {k: found[k] for k in levels}
        pick["odds"] = found.get("odds") if same else screener.odds_for(style.key, coin, **levels)
        try:
            sized = self._pot.size({"coin": coin, "style": style.key, **levels})
            self._pot.check_rules(sized)
        except Refused as why:
            pick |= levels | {"problem": str(why)}
        else:
            pick |= sized
        return pick


CONTEXT_RULES = (
    "CONTEXT: MARKET holds Fear & Greed, BTC's dominance with its 7-day change, and the US "
    "macro calendar (macroInsideHold: the releases inside this style's hold). They are "
    "context, never a reason on their own: name a macro release inside the hold as a point "
    "against, and don't search for macro dates. Searches: list every web search you ran, its "
    "query and what it found in at most 12 words (an empty list if none).\n"
)


def _searches(reply: dict[str, Any]) -> list[dict[str, str]]:
    rows = cast(list[dict[str, Any]], reply.get("searches") or [])
    return [
        {"query": clip(r.get("query"), 90), "found": clip(r.get("found"), 120)}
        for r in rows[:6]
        if r.get("query")
    ]


def _report(seen: dict[str, Any], misses: list[dict[str, Any]]) -> dict[str, Any]:
    """One style's scan, step by step, for the Trade page: the funnel, what the AI saw, did
    and said, and the near misses with the price that would make each a setup."""
    watch = {w["coin"]: w for w in cast(list[dict[str, Any]], seen.get("watch") or [])}
    near = [
        m | {k: watch[m["coin"]][k] for k in ("verdict", "watchFor") if m["coin"] in watch}
        for m in misses
    ]
    picks = [
        {
            k: p.get(k)
            for k in (
                "coin",
                "setup",
                "verdict",
                "grade",
                "score",
                "confluence",
                "against",
                "catalyst",
                "crowding",
                "news",
                "flows",
                "reason",
                "problem",
                "entry",
                "stop",
                "target",
            )
        }
        for p in cast(list[dict[str, Any]], seen.get("picks") or [])
    ]
    return {
        "funnel": seen.get("funnel") or [],
        "block": seen.get("block") or "",
        "warnings": seen.get("warnings") or [],
        "near": near,
        "ai": {
            "model": seen.get("model") or "",
            "given": seen.get("given") or [],
            "searches": seen.get("searches") or [],
            "picks": picks,
        }
        if seen.get("given")
        else None,
    }


def _n(count: int, one: str, many: str) -> str:
    return f"{count} {one if count == 1 else many}"


def _screened_words(seen: dict[str, Any]) -> str:
    """The screen's counts for the steps panel: '8 coins passed the filters, 2 setups'."""
    if not seen.get("allowed"):
        return str(seen.get("note") or "Off for now")
    none: dict[str, Any] = {}
    counts = cast(dict[str, Any], seen.get("counts") or none)
    liquid, setups = int(counts.get("liquid") or 0), int(counts.get("setups") or 0)
    passed = f"{_n(liquid, 'coin', 'coins')} passed the filters"
    return f"{passed}, {_n(setups, 'setup', 'setups')}"


def _judged_words(seen: dict[str, Any]) -> str:
    """What trading-agent said of the shortlist, counted: 'trading-agent: 1 take, 1 wait'."""
    picks = cast(list[dict[str, Any]], seen.get("picks") or [])
    watch = cast(list[dict[str, str]], seen.get("watch") or [])
    if not picks and watch:
        waits = [w["coin"] for w in watch if w["verdict"] == "wait"]
        return "trading-agent: no setup; " + (
            f"wait on {', '.join(waits)}" if waits else "nothing worth watching"
        )
    if not picks:
        return "" if not seen.get("allowed") else "No setup to judge"
    said = [
        f"{n} {verdict}"
        for verdict in VERDICTS
        if (n := sum(1 for p in picks if p.get("verdict") == verdict))
    ]
    refused = sum(1 for p in picks if p.get("problem"))
    words = "trading-agent: " + ", ".join(said)
    return words + (f"; the rules refused {refused}" if refused else "")


def _card(
    key: str,
    seen: dict[str, Any],
    take: dict[str, Any] | None,
    misses: list[dict[str, str]],
) -> dict[str, Any]:
    """One style's line on the scan: its take, else the coin closest to one and what it's
    missing (trading-agent's wait, a take the rules refused, or the screener's near miss)."""
    card: dict[str, Any] = {"style": key, "name": seen["name"], "line": str(seen["line"])[:200]}
    if not seen.get("allowed"):  # the style is off (a weekend, the regime): its note says why
        return card
    if take:
        card["take"] = {k: take.get(k) for k in ("id", "coin", "setup", "grade", "entry", "rr")}
        return card
    picks = cast(list[dict[str, Any]], seen["picks"])
    near = next((p for p in picks if p["verdict"] == "take" and p["problem"]), None) or next(
        (p for p in picks if p["verdict"] == "wait"), None
    )
    watch = cast(list[dict[str, str]], seen.get("watch") or [])
    if near:
        card["close"] = {
            "coin": near["coin"],
            "why": clip(near["problem"] or near["reason"], 160),
            "verdict": "wait",
        }
    elif watch:  # trading-agent judged the near misses: its first wait, else its first pass
        w = next((x for x in watch if x["verdict"] == "wait"), watch[0])
        miss = next((m for m in misses if m["coin"] == w["coin"]), None)
        card["close"] = {
            "coin": w["coin"],
            "why": clip(miss["why"] if miss else w["reason"], 160),
            "verdict": w["verdict"],
            "watchFor": w["watchFor"],
        }
    elif misses:
        card["close"] = {"coin": misses[0]["coin"], "why": clip(misses[0]["why"], 160)}
    return card
