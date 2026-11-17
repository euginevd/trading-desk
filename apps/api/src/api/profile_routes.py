"""The Profile's routes (decision 58): the page with its live figures, edits, versions, import
and export, the command bar, suggestions, the planner, the scorecard and the weekly recaps."""

import json
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import TYPE_CHECKING, Any
from zoneinfo import ZoneInfo

import httpx

from api import ledger, md_files, profile, profile_ai, profile_board, profile_live, profile_v2
from api.binance import BinanceError, plain
from api.profile_md import export, parse
from api.tao import TaoError
from api.tax import aud_rate
from api.trading import Refused

if TYPE_CHECKING:
    from api.handler import Services

SYDNEY = ZoneInfo("Australia/Sydney")
WINDOWS = (30, 90)
LIVE_ERRORS = (BinanceError, LookupError, httpx.HTTPError, TaoError)


@dataclass
class Live:
    """The Profile against today's portfolio; `portfolio` is None when it couldn't be read."""

    portfolio: dict[str, Any] | None
    rate: Decimal
    spent: Decimal
    rows: list[dict[str, Any]]
    strip: dict[str, Any]
    checks: dict[str, dict[str, str]]
    shares: dict[str, Decimal]

    def facts(self, doc: dict[str, Any]) -> dict[str, Any]:
        """What the model may read: figures from code, no ids, keys or addresses."""
        today = datetime.now(SYDNEY).date()
        total = Decimal(self.strip["totalAud"])
        return {
            "today": today.isoformat(),
            "topStrip": self.strip,
            "ruleChecks": self.checks,
            "coinSharesPct": {c: plain(s.quantize(Decimal("0.1"))) for c, s in self.shares.items()},
            "holdings": [
                {
                    k: r[k]
                    for k in ("name", "source", "invested_aud", "now_aud", "pnl_aud", "pnl_pct")
                }
                for r in self.rows
            ],
            "goalPaths": profile_ai.goal_paths(doc, total, self.rate, today),
        }


def _now_ms() -> int:
    return int(time.time() * 1000)


def live(s: "Services", read: Callable[[], dict[str, Any]], doc: dict[str, Any]) -> Live:
    try:
        portfolio: dict[str, Any] | None = read()
    except LIVE_ERRORS:
        portfolio = None
    rate = (
        profile_live.remember_rate(s.store, portfolio)
        if portfolio
        else Decimal(s.store.setting(profile_live.RATE_KEY, "1.5"))
    )
    now = datetime.now(SYDNEY)
    spent = profile_live.month_spent_aud(s.store, rate, now)
    rows = profile_live.holdings(doc, portfolio)
    return Live(
        portfolio=portfolio,
        rate=rate,
        spent=spent,
        rows=rows,
        strip=profile_live.strip(doc, rows, portfolio, spent, now.date()),
        checks=profile_live.rule_checks(doc, portfolio, spent),
        shares=profile_live.coin_shares(portfolio) if portfolio else {},
    )


def _dated(item: dict[str, Any] | None, version: int) -> dict[str, Any] | None:
    """An agent's output, marked out of date once the Profile has moved past what it read."""
    if item is None:
        return None
    return item | {"outOfDate": item.get("profileVersion") not in (None, version)}


def page(s: "Services", read: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    view = profile.view(s.store)
    doc, n = view["profile"], view["version"]
    found = live(s, read, doc)
    return view | {
        "live": {
            "known": found.portfolio is not None,
            "strip": found.strip,
            "holdings": found.rows,
            "checks": found.checks,
            "foundations": profile_live.foundations(doc, found.strip["cash"]["now"]),
        },
        "board": _board(s, doc, found) if doc["markdown"] else None,
        "suggestions": profile_ai.suggestions(s.store),
        "planner": _dated(profile_ai.last_planner(s.store), n),
        "recap": _dated(next(iter(profile_ai.recaps(s.store)), None), n),
    }


def _bought(s: "Services", day: str | None, today: Any) -> bool | None:
    """Whether BTC was bought since the latest DCA day; None when Binance can't say."""
    start = profile_board.week_start(today, day)
    from_ms = int(datetime.combine(start, datetime.min.time(), SYDNEY).timestamp() * 1000)
    try:
        return ledger.bought_since(s.binance, "BTC", from_ms)
    except LIVE_ERRORS:
        return None


def _board(s: "Services", doc: dict[str, Any], found: Live) -> dict[str, Any]:
    v = profile_v2.values(doc["markdown"])
    today = datetime.now(SYDNEY).date()
    bought = _bought(s, v["dca"]["day"], today) if found.portfolio is not None else None
    return profile_board.board(v, found.portfolio, found.rate, today, bought)


def _text(doc: dict[str, Any], n: int, time_ms: int) -> str:
    return doc["markdown"] or export(doc, n, time_ms)


def _version(s: "Services", n: str) -> dict[str, Any]:
    """One version, with its file and what changed from the version before."""
    row = s.store.profile_version(int(n))
    if row is None:
        raise Refused("No such version.")
    doc = profile.clean(json.loads(row["doc"]))
    text = _text(doc, int(row["n"]), int(row["time"]))
    before = s.store.profile_version(int(row["n"]) - 1)
    old = (
        _text(profile.clean(json.loads(before["doc"])), int(before["n"]), int(before["time"]))
        if before
        else ""
    )
    return {k: row[k] for k in ("n", "time", "author", "summary", "reason")} | {
        "markdown": text,
        "diff": profile_v2.diff(old, text),
    }


def _import(s: "Services", body: dict[str, Any]) -> dict[str, Any]:
    doc = parse(str(body.get("markdown", "")))
    return profile.save(
        s.store,
        s.audit,
        doc,
        author=profile.OWNER,
        now=_now_ms(),
        reason=str(body.get("reason", "")),
        summary_text="Imported from Markdown",
    )


def _export(s: "Services") -> dict[str, Any]:
    n, doc = profile.current(s.store)
    return {"markdown": export(doc, n, _now_ms()), "version": n}


def _restore(s: "Services", body: dict[str, Any]) -> dict[str, Any]:
    raw = str(body.get("n", ""))
    if not raw.isdigit():
        raise Refused("Pick a version to restore.")
    return profile.restore(s.store, s.audit, int(raw), _now_ms())


def write(s: "Services") -> profile_ai.Write:
    def ask(system: str, text: str, shape: dict[str, Any]) -> dict[str, Any]:
        return s.signals.write(system, text, shape, "profile")

    return ask


def _command(
    s: "Services", read: Callable[[], dict[str, Any]], body: dict[str, Any]
) -> dict[str, Any]:
    _, doc = profile.current(s.store)
    found = live(s, read, doc)
    return profile_ai.command(
        s.store,
        s.audit,
        write(s),
        text=body.get("text"),
        live=found.facts(doc),
        shares=found.shares,
    )


def _planner(s: "Services", read: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    n, doc = profile.current(s.store)
    found = live(s, read, doc)
    kept = profile_ai.planner(s.store, s.audit, write(s), found.facts(doc), found.shares)
    return {"planner": _dated(kept, n), "suggestions": profile_ai.suggestions(s.store)}


def recap_now(
    s: "Services", read: Callable[[], dict[str, Any]], *, worded: bool = True
) -> dict[str, Any]:
    _, doc = profile.current(s.store)
    found = live(s, read, doc)
    facts = profile_ai.recap_facts(s.store, found.strip, found.checks, datetime.now(SYDNEY).date())
    return profile_ai.make_recap(s.store, s.audit, write(s) if worded else None, facts)


def _recaps(s: "Services") -> dict[str, Any]:
    n, _ = profile.current(s.store)
    return {"recaps": [_dated(r, n) for r in profile_ai.recaps(s.store)]}


# The rule scorecard, from the journal's buys.

JOURNAL_LABELS: dict[str, Callable[[str], bool]] = {
    "per_trade_aud": lambda broke: broke == "Over per-trade size",
    "max_pct_per_coin": lambda broke: broke.endswith("over its cap"),
    "monthly_deposit_cap_aud": lambda broke: broke == "Deposits over cap that month",
}
RULE_NAMES = {
    "per_trade_aud": "Per-trade size",
    "max_pct_per_coin": "Max % per coin",
    "monthly_deposit_cap_aud": "Monthly deposit cap",
}


def scorecard(
    doc: dict[str, Any], entries: list[dict[str, Any]], prices: dict[str, Decimal], today: Any
) -> dict[str, Any]:
    """For each set rule, the buys that kept and broke it over 30 and 90 days, and how the
    buys that broke it have done since, at today's price."""
    windows: dict[str, list[dict[str, Any]]] = {}
    for days in WINDOWS:
        since = int(
            datetime.combine(today - timedelta(days=days), datetime.min.time(), SYDNEY).timestamp()
            * 1000
        )
        buys = [e for e in entries if e["side"] == "buy" and int(e["time"]) >= since]
        rows: list[dict[str, Any]] = []
        for key, matches in JOURNAL_LABELS.items():
            if profile.rule(doc, key) is None:
                continue
            broken = [b for b in buys if any(matches(w) for w in b["broke"])]
            moves = [
                (prices[b["coin"]] / Decimal(b["price"]) - 1) * 100
                for b in broken
                if b["coin"] in prices and Decimal(b["price"]) > 0
            ]
            rows.append(
                {
                    "rule": key,
                    "label": RULE_NAMES[key],
                    "kept": len(buys) - len(broken),
                    "broken": len(broken),
                    "brokenResultPct": plain(
                        (sum(moves, Decimal(0)) / len(moves)).quantize(Decimal("0.1"))
                    )
                    if moves
                    else None,
                }
            )
        windows[str(days)] = rows
    return {"windows": windows}


def _scorecard(
    s: "Services", read: Callable[[], dict[str, Any]], journal: Callable[[], dict[str, Any]]
) -> dict[str, Any]:
    _, doc = profile.current(s.store)
    portfolio = read()
    rate = aud_rate(portfolio)
    prices = {
        h["asset"]: Decimal(h["price"]) * rate for h in portfolio["holdings"] if h.get("price")
    }
    return scorecard(doc, journal()["entries"], prices, datetime.now(SYDNEY).date())


def route(  # noqa: PLR0911, PLR0913, PLR0917 - one return per route; each input a seam for tests
    method: str,
    path: str,
    body: dict[str, Any],
    s: "Services",
    read: Callable[[], dict[str, Any]],
    journal: Callable[[], dict[str, Any]],
) -> dict[str, Any] | None:
    """The Profile's routes; None for any other path."""
    now = _now_ms()
    simple: dict[tuple[str, str], Callable[[], dict[str, Any]]] = {
        ("GET", "/profile"): lambda: page(s, read),
        ("GET", "/profile/versions"): lambda: {"versions": profile.history(s.store)},
        ("POST", "/profile/restore"): lambda: _restore(s, body),
        ("POST", "/profile/import"): lambda: _import(s, body),
        ("GET", "/profile/export"): lambda: _export(s),
        ("GET", "/profile/file"): lambda: md_files.file_view(s.store, "profile"),
        ("POST", "/profile/command"): lambda: _command(s, read, body),
        ("POST", "/profile/planner"): lambda: _planner(s, read),
        ("GET", "/profile/scorecard"): lambda: _scorecard(s, read, journal),
        ("GET", "/recaps"): lambda: _recaps(s),
        ("POST", "/recaps"): lambda: {"recap": recap_now(s, read)},
    }
    found = simple.get((method, path))
    if found is not None:
        return found()
    version = re.fullmatch(r"/profile/versions/(\d{1,9})", path)
    if version and method == "GET":
        return _version(s, version.group(1))
    choice = re.fullmatch(r"/profile/suggestions/([0-9a-f]{12})/(accept|reject)", path)
    if choice and method == "POST":
        if choice.group(2) == "reject":
            return profile_ai.reject(s.store, s.audit, choice.group(1))
        return profile_ai.accept(
            s.store, s.audit, choice.group(1), str(body.get("reason", "")), now
        )
    return None
