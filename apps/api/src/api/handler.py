"""The api's routes: /health, the portfolio, the watchlist, AI signals and orders (decision 14)."""

import base64
import json
import os
import re
import time
from collections.abc import Callable, Generator
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, cast
from zoneinfo import ZoneInfo

import httpx

from api import (
    account_coins,
    agents,
    ai_client,
    analyse,
    backtest,
    coach,
    coach_week,
    demo,
    env_file,
    features,
    journal,
    ledger,
    ledger_wallet,
    md_files,
    my_agents,
    profile,
    profile_ai,
    profile_live,
    profile_routes,
    profile_v2,
    rebalance,
    risk,
    risk_big,
    scan_progress,
    schedule,
    screener,
    staking_income,
    tax,
    telegram,
    trading_agent,
)
from api.advisor import futures, gather, rules_of
from api.ai_client import capped, subscription, switched
from api.ai_signal import Ask, SignalError, Signals, claude
from api.ai_signin import SignIn
from api.audit import Audit
from api.backtest_runs import BadRun
from api.binance import Binance, BinanceError, plain
from api.bots import Bots
from api.dca_book import DcaBook
from api.dca_funds import Funds
from api.dca_moves import DcaMoves
from api.deposits import amount_key
from api.deposits import report as deposit_report
from api.grid import Grids
from api.icons import Icons
from api.market import QUOTE, MarketError, coin_symbol, market
from api.pot import Pot
from api.pot_agent import PotAgent
from api.pot_tp import TakeProfit
from api.profile_md import for_agents
from api.sentiment import SentimentError, fear_and_greed, fear_and_greed_detail, market_global
from api.service import CostRules, TradeCache, Wallet, fetch
from api.store import Store
from api.strategize import Strategist
from api.tao import TAOSTATS_URL, TaoError, balance
from api.trading import Refused, Trading
from api.watchlist import Watchlist

TIMEOUT_SECONDS = 10
SIGNAL_TIMEOUT_SECONDS = 180
BINANCE_URL = "https://api.binance.com"
SYDNEY = ZoneInfo("Australia/Sydney")
HISTORY_DAYS = 30

Portfolio = Callable[[], dict[str, Any]]
TradingFactory = Callable[[], AbstractContextManager[Trading]]
BotsFactory = Callable[[], AbstractContextManager["Bots"]]
GridsFactory = Callable[[], AbstractContextManager["Grids"]]


class MissingKey(LookupError):
    """The Binance key or secret isn't in the environment; the only error that asks for them."""


@dataclass
class Services:
    """What the watchlist, market and signal routes need, opened per request."""

    binance: Binance
    store: Store
    signals: Signals
    audit: Audit
    # The portfolio for the AI plan; None reads it live. Tests pass their own, with no calls out.
    portfolio: Callable[[], dict[str, Any]] | None = None

    def watchlist(self) -> Watchlist:
        return Watchlist(self.binance, self.store, self.signals, self.audit)


ServicesFactory = Callable[[], AbstractContextManager[Services]]


def _reply(status: int, body: object) -> dict[str, object]:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json", "cache-control": "no-store"},
        "body": json.dumps(body),
    }


def _image(found: tuple[bytes, str] | None) -> dict[str, object]:
    """A coin logo, base64 in the reply as Lambda's shape has it; 404 when there's none."""
    if found is None:
        return _reply(404, {"error": "No logo."})
    data, kind = found
    return {
        "statusCode": 200,
        "headers": {"content-type": kind, "cache-control": "public, max-age=604800"},
        "body": base64.b64encode(data).decode(),
        "isBase64Encoded": True,
    }


def live_sentiment() -> dict[str, Any]:
    """The Crypto Fear & Greed Index (decision 36); made up in demo mode."""
    if _demo():
        return {"value": 42, "label": "Fear", "yesterday": 38, "updated": 1_794_000_000_000}
    with httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False) as client:
        return fear_and_greed(client)


def live_sentiment_detail() -> dict[str, Any]:
    """The Fear & Greed details (decision 42); made up in demo mode."""
    if _demo():
        return demo.sentiment_detail()
    with httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False) as client:
        return fear_and_greed_detail(client)


def live_global() -> dict[str, Any]:
    """The whole market's size, change and dominance for the header; made up in demo mode."""
    if _demo():
        return {
            "cap": "2268170000000",
            "capChange": "-2.79",
            "volume": "73870000000",
            "btcShare": "57.1",
            "ethShare": "11.2",
        }
    with httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False) as client:
        return market_global(client)


def live_icon(coin: str) -> tuple[bytes, str] | None:
    if _demo():
        return None  # demo stays offline: letters only
    folder = Path(os.environ.get("DESK_DB_DIR", "local")) / "icons"
    with httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False) as client:
        return Icons(folder, client).get(coin)


def _audit() -> Audit:
    return Audit(Path(os.environ.get("AUDIT_LOG_PATH", "local/audit.jsonl")))


def _demo() -> bool:
    return os.environ.get("DEMO") == "1"


@contextmanager
def _binance() -> Generator[Binance]:
    """The demo exchange or the real one; the key comes from the environment, never logged."""
    if _demo():
        transport = httpx.MockTransport(demo.binance)
        with httpx.Client(base_url=BINANCE_URL, transport=transport) as client:
            yield Binance(client, ("demo", "demo"), _audit())
        return
    key = os.environ.get("BINANCE_API_KEY", "")
    secret = os.environ.get("BINANCE_API_SECRET", "")
    if not key or not secret:
        raise MissingKey
    base = os.environ.get("BINANCE_BASE_URL", BINANCE_URL)
    with httpx.Client(base_url=base, timeout=TIMEOUT_SECONDS) as client:
        yield Binance(client, (key, secret), _audit())


def store_path() -> Path:
    name = "demo.sqlite" if _demo() else "desk.sqlite"
    return Path(os.environ.get("DESK_DB_DIR", "local")) / name


def _wallet(client: httpx.Client) -> Wallet | None:
    """TAO on the Ledger, read by its coldkey, or None when .env doesn't name one (17, 99)."""
    if _demo():
        return lambda: balance(client, "demo", demo.TAO_ADDRESS, _audit())
    address = os.environ.get("TAO_COLDKEY", "").strip()
    if not address:
        return None
    key = os.environ.get("TAOSTATS_API_KEY", "").strip()

    def read() -> dict[str, Decimal]:
        if not key:
            raise TaoError("Add TAOSTATS_API_KEY to .env to read TAO on the Ledger.")
        return balance(client, key, address, _audit())

    return read


def _ledger_read(client: httpx.Client, store: Store) -> Any:
    """The Ledger's coins by its saved public addresses (decision 99), or None with none saved.
    One address that can't be read leaves the others standing; the status says which."""
    addresses = [a for a in store.ledger_addresses() if a["network"] in ledger_wallet.NETWORKS]
    if not addresses or _demo():
        return None

    def read() -> tuple[dict[str, Decimal], dict[str, Any]]:
        coins: dict[str, Decimal] = {}
        errors: list[str] = []
        failed: list[str] = []
        stale: list[str] = []
        oldest: float | None = None
        for a in addresses:
            try:
                found = ledger_wallet.read(client, ledger_wallet.Watch.of(a), _audit())
            except ledger_wallet.LedgerError as error:
                errors.append(str(error))
                failed.append(a["network"])
                continue
            if found.stale:
                stale.append(a["network"])
            oldest = found.read_at if oldest is None else min(oldest, found.read_at)
            for coin, amount in found.coins.items():
                coins[coin] = coins.get(coin, Decimal(0)) + amount
        # Which networks failed or fell back to their last reading, so the page can say so
        # rather than show a smaller Ledger as if it were whole (audit, 22 Nov 2026).
        status: dict[str, Any] = {
            "status": "error" if errors and not coins else "connected",
            "readAt": int(oldest * 1000) if oldest else None,
            "stale": bool(stale),
            "staleNetworks": stale,
            "failedNetworks": failed,
            "addresses": len(addresses),
        }
        if errors:
            status["error"] = errors[0]
        return coins, status

    return read


# Lives as long as the api: trade histories don't change while balances stay put.
TRADE_CACHE = TradeCache()


COST_FROM_DEFAULT = "2026-07-01"


def cost_from_ms() -> int:
    """Where average cost starts counting trades (decision 34): DESK_COST_FROM, a date in Sydney
    time, or 1 Jul 2026, the start of FY 2026-27."""
    raw = os.environ.get("DESK_COST_FROM", COST_FROM_DEFAULT).strip() or COST_FROM_DEFAULT
    try:
        day = datetime.fromisoformat(raw).replace(tzinfo=SYDNEY)
    except ValueError:
        day = datetime.fromisoformat(COST_FROM_DEFAULT).replace(tzinfo=SYDNEY)
    return int(day.timestamp() * 1000)


def live_portfolio() -> dict[str, Any]:
    fx_transport = httpx.MockTransport(demo.fx) if _demo() else None
    tao_transport = httpx.MockTransport(demo.taostats) if _demo() else None
    store = Store(store_path())
    try:
        with (
            _binance() as binance,
            httpx.Client(timeout=TIMEOUT_SECONDS, transport=fx_transport) as fx,
            httpx.Client(
                base_url=TAOSTATS_URL, timeout=TIMEOUT_SECONDS, transport=tao_transport
            ) as tao,
            httpx.Client(timeout=TIMEOUT_SECONDS) as chain,
        ):
            rules = CostRules(store.costs(), cost_from_ms())
            portfolio = fetch(
                binance, fx, _wallet(tao), TRADE_CACHE, rules, _ledger_read(chain, store)
            )
        today = datetime.now(SYDNEY).date().isoformat()
        store.record_value(today, portfolio["total"]["value"])
        profile_live.remember_rate(store, portfolio)  # the bots' pre-trade check reads it
        if _demo():
            demo.history(store, today, portfolio["total"]["value"])
        portfolio["history"] = [
            {"day": day, "value": value} for day, value in store.history(HISTORY_DAYS)
        ]
    finally:
        store.close()
    if _demo():
        portfolio["demo"] = True
    return portfolio


@contextmanager
def live_trading() -> Generator[Trading]:
    store = Store(store_path())
    try:
        with _binance() as binance:
            yield Trading(binance, store, _audit())
    finally:
        store.close()


@contextmanager
def live_bots() -> Generator[Bots]:
    store = Store(store_path())
    try:
        with _binance() as binance:
            yield Bots(binance, store, _audit())
    finally:
        store.close()


def _set_trading(desk: Trading, on: bool) -> dict[str, Any]:
    """The kill switch: off stops every bot too, and cancels their open buys (spec 10)."""
    settings = desk.set_trading(on)
    if on:
        return settings
    # Both always run, the grids even if the bots fail; a buy Binance still has live is retried
    # by each step while trading is off.
    try:
        live = Bots(*desk.parts()).stop_all("Stopped by the kill switch.")
    finally:
        grids = Grids(*desk.parts()).stop_all("Stopped by the kill switch.")
    live += grids
    if live:
        audit = desk.parts()[2]
        audit.record("settings", "Kill switch", f"{live} bot and grid buys still live; retrying")
    return settings | {"stillLive": live}


BOT_ROUTES: dict[tuple[str, str], Callable[[Bots, dict[str, Any]], dict[str, Any]]] = {
    ("GET", "/bots"): lambda bots, _: bots.view(),
    ("POST", "/bots"): lambda bots, b: bots.create(b),
    ("POST", "/bots/preview"): lambda bots, b: bots.preview(b),
    ("POST", "/bots/suggest"): lambda bots, b: bots.suggest(b),
    ("GET", "/smart"): lambda bots, _: bots.view("trade"),
}


def _bot_route(
    method: str, path: str, event: dict[str, object], factory: BotsFactory, portfolio: Portfolio
) -> dict[str, object] | None:
    """DCA bots (decision 37): the list, the wizard's preview, and each bot's changes."""
    one = re.fullmatch(r"/bots/(\d{1,9})(/switch|/close)?", path)
    route = BOT_ROUTES.get((method, path))
    if route is None and one is None:
        return None
    body = _body(event)
    with factory() as bots:
        if route is not None:
            return _reply(200, route(bots, body))
        assert one is not None  # noqa: S101 - checked above
        bot_id = int(one.group(1))
        if one.group(2) == "/close" and method == "POST":
            done = bots.close_now(bot_id)
        elif one.group(2) and method == "POST":
            held, past_rules = _trade_bot_check(bots, bot_id, body, portfolio)
            if held is not None:
                return held
            done = bots.switch(bot_id, body.get("on") is True, body.get("confirmed") is True)
            if body.get("on") is True:  # only once it's on, and only past a rule really broken
                bots.allow_past_rules(bot_id, allowed=past_rules)
        elif not one.group(2) and method == "GET":
            done = bots.detail(bot_id)
        elif not one.group(2) and method == "PUT":
            done = bots.edit(bot_id, body)
        elif not one.group(2) and method == "DELETE":
            done = bots.delete(bot_id)
        else:
            return _reply(404, {"error": "Not found."})
        return _reply(200, done)


def _trade_bot_check(
    bots: Bots, bot_id: int, body: dict[str, Any], portfolio: Portfolio
) -> tuple[dict[str, object] | None, bool]:
    """Switching on a smart trade is the owner placing it: the same pre-trade check as an order,
    on its whole ladder. Returns the 409, if held, and whether it goes past a broken rule."""
    if body.get("on") is not True:
        return None, False
    found = bots.trade_budget(bot_id)
    if found is None:  # a recurring DCA bot: its buys wait on a broken rule instead
        return None, False
    coin, spend = found
    store, audit = bots.store_and_audit()
    override = body.get("override") is True
    held, broke = _rule_check(store, audit, coin, spend, override, portfolio)
    return held, held is None and override and bool(broke)


@contextmanager
def live_grids() -> Generator[Grids]:
    store = Store(store_path())
    try:
        with _binance() as binance:
            yield Grids(binance, store, _audit())
    finally:
        store.close()


GRID_ROUTES: dict[tuple[str, str], Callable[[Grids, dict[str, Any]], dict[str, Any]]] = {
    ("GET", "/grids"): lambda grids, _: grids.view(),
    ("POST", "/grids"): lambda grids, b: grids.create(b),
    ("POST", "/grids/preview"): lambda grids, b: grids.preview(b),
    ("POST", "/grids/suggest"): lambda grids, b: grids.suggest(b),
}


def _grid_route(
    method: str, path: str, event: dict[str, object], factory: GridsFactory
) -> dict[str, object] | None:
    """Grid bots (decision 38): the list, the wizard's preview, and each grid's changes."""
    one = re.fullmatch(r"/grids/(\d{1,9})(/switch)?", path)
    route = GRID_ROUTES.get((method, path))
    if route is None and one is None:
        return None
    body = _body(event)
    with factory() as grids:
        if route is not None:
            return _reply(200, route(grids, body))
        assert one is not None  # noqa: S101 - checked above
        grid_id = int(one.group(1))
        if one.group(2) and method == "POST":
            done = grids.switch(grid_id, body.get("on") is True, body.get("confirmed") is True)
        elif not one.group(2) and method == "GET":
            done = grids.detail(grid_id)
        elif not one.group(2) and method == "PUT":
            done = grids.edit(grid_id, body)
        elif not one.group(2) and method == "DELETE":
            done = grids.delete(grid_id)
        else:
            return _reply(404, {"error": "Not found."})
        return _reply(200, done)


SIGNIN = SignIn()  # one subscription sign-in at a time, held between its two requests


def _save_key(s: Services, body: dict[str, Any]) -> dict[str, Any]:
    env_file.save("ANTHROPIC_API_KEY", str(body.get("key", "")))
    s.audit.record("settings", "Anthropic API key", "Saved to .env")
    return ai_client.view(s.store, s.signals)


def _signin_start(s: Services) -> dict[str, Any]:
    url = SIGNIN.start()
    s.audit.record("settings", "Claude subscription sign-in", "Started")
    return {"url": url}


def _signin_finish(s: Services, body: dict[str, Any]) -> dict[str, Any]:
    try:
        token = SIGNIN.finish(str(body.get("code", "")))
    except Refused as error:
        s.audit.record("settings", "Claude subscription sign-in", f"Failed: {error}")
        raise
    env_file.save("CLAUDE_CODE_OAUTH_TOKEN", token)
    s.audit.record("settings", "Claude subscription sign-in", "Signed in; token saved to .env")
    return ai_client.view(s.store, s.signals)


def _ask(store: Store | None = None) -> Ask:
    """The plan's Ask: an API key or the owner's Claude subscription, by `AI_AUTH_MODE`."""
    if _demo():

        def demo_ask(
            system: str, text: str, shape: dict[str, Any]
        ) -> tuple[dict[str, Any], Decimal]:
            reply, cost = demo.ask(system, text, shape)
            return reply | {"_via": "Demo"}, cost

        return demo_ask
    chosen = lambda: ai_client.model(store)  # noqa: E731 - read at each run
    level = lambda: ai_client.effort(store)  # noqa: E731 - read at each run
    return switched(
        lambda: _api_ask(chosen, level), subscription(model=chosen, effort=level), store
    )


def _api_ask(
    model: Callable[[], str] = ai_client.model, effort: Callable[[], str] = ai_client.effort
) -> Ask:
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:

        def missing(
            _system: str, _prompt: str, _shape: dict[str, Any]
        ) -> tuple[dict[str, Any], Decimal]:
            raise SignalError("Add ANTHROPIC_API_KEY to .env to get AI signals.")

        return missing
    import anthropic  # noqa: PLC0415 - loaded only when a key is set

    # A key that isn't scoped to one workspace must name the workspace on every request.
    workspace = os.environ.get("ANTHROPIC_WORKSPACE_ID", "").strip()
    headers = {"anthropic-workspace-id": workspace} if workspace else None
    client = anthropic.Anthropic(
        api_key=key, timeout=SIGNAL_TIMEOUT_SECONDS, default_headers=headers
    )
    return claude(client, model, effort)


def _cap() -> Decimal:
    try:
        cap = Decimal(os.environ.get("AI_MONTHLY_CAP_USD", "20"))
    except InvalidOperation:
        return Decimal(20)
    return cap if cap.is_finite() and cap >= 0 else Decimal(20)


@contextmanager
def live_services() -> Generator[Services]:
    store = Store(store_path())
    audit = _audit()
    try:
        md_files.sync(store, audit, _now_ms())  # the owner's files are the source (decision 61)
        with _binance() as binance:
            signals = Signals(_ask(store), store, audit, _cap(), capped=lambda: capped(store))
            yield Services(binance, store, signals, audit)
    finally:
        store.close()


def _body(event: dict[str, object]) -> dict[str, Any]:
    raw = event.get("body") or "{}"
    try:
        body = json.loads(str(raw))
    except json.JSONDecodeError:
        return {}
    return cast(dict[str, Any], body) if isinstance(body, dict) else {}


Route = Callable[[Trading, dict[str, str], dict[str, Any]], dict[str, Any]]
# The DCA book (TODO 11): five lifelong positions, fed only by orders placed here.
DCA_ROUTES: dict[tuple[str, str], Route] = {
    ("GET", "/dca"): lambda desk, _q, _b: DcaBook(desk).view(),
    ("PUT", "/dca/plan"): lambda desk, _q, b: DcaBook(desk).set_plan(b),
    ("GET", "/dca/suggest"): lambda desk, _q, _b: DcaBook(desk).suggest(),
    ("GET", "/dca/odds"): lambda desk, q, _b: DcaBook(desk).odds(
        str(q.get("coin", "")), q.get("price")
    ),
    ("POST", "/dca/orders"): lambda desk, _q, b: DcaBook(desk).place(b),
    ("POST", "/dca/orders/cancel"): lambda desk, _q, b: DcaBook(desk).cancel(b.get("ref")),
    ("POST", "/dca/orders/amend"): lambda desk, _q, b: DcaBook(desk).amend(b),
    ("POST", "/dca/sell/preview"): lambda desk, _q, b: DcaMoves(DcaBook(desk)).sell_preview(b),
    ("POST", "/dca/sell"): lambda desk, _q, b: DcaMoves(DcaBook(desk)).sell(b),
    ("POST", "/dca/add/preview"): lambda desk, _q, b: DcaMoves(DcaBook(desk)).add_preview(b),
    ("POST", "/dca/add"): lambda desk, _q, b: DcaMoves(DcaBook(desk)).add(b),
    ("POST", "/dca/close-out"): lambda desk, _q, b: DcaBook(desk).close_out(b.get("week")),
    ("POST", "/dca/skip"): lambda desk, _q, b: DcaBook(desk).skip(b.get("week")),
    ("GET", "/dca/check"): lambda desk, _q, _b: DcaBook(desk).check(),
    ("POST", "/dca/check/fix"): lambda desk, _q, _b: DcaBook(desk).repair(),
}
# The trading pot (docs/plan-trade.md): trading-agent's book, every trade by its reference.
POT_ROUTES: dict[tuple[str, str], Route] = {
    ("GET", "/pot"): lambda desk, _q, _b: Pot(desk).view(),
    ("PUT", "/pot/config"): lambda desk, _q, b: Pot(desk).set_config(b),
    ("POST", "/pot/put-in"): lambda desk, _q, b: Pot(desk).put_in(b),
    ("POST", "/pot/trades"): lambda desk, _q, b: Pot(desk).place(b),
    ("POST", "/pot/preview"): lambda desk, _q, b: Pot(desk).preview(b),
    ("POST", "/pot/ladders/preview"): lambda desk, _q, b: Pot(desk).ladder_preview(b),
    ("POST", "/pot/ladders"): lambda desk, _q, b: Pot(desk).place_ladder(b),
    ("POST", "/pot/trades/cancel"): lambda desk, _q, b: Pot(desk).cancel(b.get("ref")),
    ("POST", "/pot/trades/stop"): lambda desk, _q, b: Pot(desk).move_stop(b),
    ("POST", "/pot/trades/close"): lambda desk, _q, b: Pot(desk).close(b.get("ref")),
    ("POST", "/pot/trades/keep"): lambda desk, _q, b: Pot(desk).keep(b.get("ref")),
    ("POST", "/pot/trades/hold"): lambda desk, _q, b: Pot(desk).hold(b.get("ref")),
    ("POST", "/pot/trades/enter-now"): lambda desk, _q, b: Pot(desk).enter_now(b.get("ref")),
    ("POST", "/pot/trades/add"): lambda desk, _q, b: Pot(desk).add(b),
    ("POST", "/pot/trades/reduce"): lambda desk, _q, b: Pot(desk).reduce(b),
    ("POST", "/pot/trades/target"): lambda desk, _q, b: Pot(desk).move_target(b),
    ("POST", "/pot/trades/note"): lambda desk, _q, b: Pot(desk).note(b),
    ("POST", "/pot/take-profit/preview"): lambda desk, _q, b: TakeProfit(Pot(desk)).preview(b),
    ("POST", "/pot/take-profit"): lambda desk, _q, b: TakeProfit(Pot(desk)).place(b),
    ("POST", "/pot/take-profit/cancel"): lambda desk, _q, b: TakeProfit(Pot(desk)).cancel(
        b.get("ref")
    ),
    ("POST", "/pot/proposals/dismiss"): lambda desk, _q, b: Pot(desk).dismiss(b),
    ("GET", "/pot/check"): lambda desk, _q, _b: Pot(desk).check(),
    ("GET", "/pot/coins"): lambda desk, _q, _b: account_coins.snapshot(Pot(desk)),
}
ROUTES: dict[tuple[str, str], Route] = {
    ("GET", "/settings"): lambda desk, _q, _b: desk.settings(),
    ("PUT", "/limits"): lambda desk, _, b: desk.set_limits(b.get("perOrder"), b.get("perDay")),
    ("PUT", "/trading"): lambda desk, _, b: _set_trading(desk, b.get("on") is True),
    ("POST", "/orders/edit"): lambda desk, _, b: desk.edit_order(b),
    ("POST", "/orders/cancel"): lambda desk, _, b: desk.cancel_order(
        b.get("symbol"), b.get("orderId")
    ),
    **DCA_ROUTES,
    **POT_ROUTES,
}


COST_SOURCES = ("Binance", "Ledger")


def ledger_view(store: Store) -> dict[str, Any]:
    """Settings › Ledger: each saved address with its balances and when they were read, and
    tokens found on it but not counted (decision 99). Reads are the kept ones where fresh."""
    rows: list[dict[str, Any]] = []
    with httpx.Client(timeout=TIMEOUT_SECONDS) as client:
        for a in store.ledger_addresses():
            row: dict[str, Any] = {k: a[k] for k in ("id", "coin", "network", "address", "tokens")}
            if a["network"] not in ledger_wallet.NETWORKS or _demo():
                rows.append(row | {"status": "not_read"})
                continue
            try:
                found = ledger_wallet.read(client, ledger_wallet.Watch.of(a), _audit())
            except ledger_wallet.LedgerError as error:
                rows.append(row | {"status": "error", "error": str(error)})
                continue
            rows.append(
                row
                | {
                    "status": "connected",
                    "coins": {c: plain(v) for c, v in found.coins.items()},
                    "unknown": {m: plain(v) for m, v in found.unknown.items()},
                    "readAt": int(found.read_at * 1000),
                    "stale": found.stale,
                }
            )
    return {"addresses": rows, "networks": sorted(ledger_wallet.NETWORKS)}


def ledger_route(method: str, path: str, body: dict[str, Any]) -> dict[str, Any]:
    """GET /ledger; POST /ledger/address {coin, network, address}; POST /ledger/remove {id};
    POST /ledger/token {id, mint, coin} counts a token, {id, mint, coin: null} stops."""
    store = Store(store_path())
    try:
        if method == "POST" and path == "/ledger/address":
            coin = str(body.get("coin") or "").strip().upper()
            network = str(body.get("network") or "")
            address = str(body.get("address") or "").strip()
            if network not in ledger_wallet.NETWORKS:
                raise Refused(
                    "The desk reads Solana, Ethereum, HyperEVM, Sui, NEAR and Bitcoin (by xpub)."
                )
            if not ledger_wallet.valid_coin(coin) or not ledger_wallet.valid_address(
                network, address
            ):
                raise Refused(f"That isn't a {network} address. Copy it from Ledger Live.")
            store.add_ledger_address(coin, network, address, int(time.time() * 1000))
        elif method == "POST" and path == "/ledger/remove":
            if not store.remove_ledger_address(_id(body)):
                raise Refused("That address isn't saved.")
        elif method == "POST" and path == "/ledger/token":
            _count_token(store, body)
        elif not (method == "GET" and path == "/ledger"):
            raise LookupError(path)
        return ledger_view(store)
    finally:
        store.close()


def _id(body: dict[str, Any]) -> int:
    """A record's id from a request body, refused unless it's a whole number."""
    try:
        return int(str(body.get("id") or "0"))
    except ValueError:
        raise Refused("Name the record by its id.") from None


def _ledger_http(method: str, path: str, event: dict[str, object]) -> dict[str, object] | None:
    if not path.startswith("/ledger"):
        return None
    return _reply(200, ledger_route(method, path, _body(event) if method != "GET" else {}))


def _count_token(store: Store, body: dict[str, Any]) -> None:
    saved = {a["id"]: a for a in store.ledger_addresses()}
    found = saved.get(_id(body))
    mint = str(body.get("mint") or "").strip()
    if found is None or found["network"] not in ledger_wallet.TOKEN_NETWORKS:
        raise Refused("Tokens are counted on Solana, Ethereum and HyperEVM addresses.")
    if not ledger_wallet.valid_address(found["network"], mint):
        raise Refused("Name the token's mint or contract, as the explorer shows it.")
    tokens = dict(found["tokens"])
    coin = body.get("coin")
    if coin is None:
        tokens.pop(mint, None)
    elif ledger_wallet.valid_coin(str(coin).strip().upper()):
        tokens[mint] = str(coin).strip().upper()
    else:
        raise Refused("Name the coin, such as PUMP.")
    store.set_ledger_tokens(found["id"], tokens)


MAX_COST = Decimal(10_000_000)


def live_set_cost(body: dict[str, Any]) -> dict[str, Any]:
    """Saves, or clears with null, the owner's average cost for a holding (decision 27)."""
    source = body.get("source")
    asset = str(body.get("asset") or "").upper()
    if source not in COST_SOURCES or not re.fullmatch(r"[A-Z0-9]{1,15}", asset):
        raise Refused("Name a holding: its source and coin.")
    raw = body.get("averageCost")
    average: str | None = None
    if raw is not None and str(raw).strip() != "":
        try:
            value = Decimal(str(raw).strip())
        except InvalidOperation:
            raise Refused("Average cost must be a number.") from None
        if not value.is_finite() or value <= 0 or value > MAX_COST:
            raise Refused("Average cost must be more than 0.")
        average = format(value.normalize(), "f")
    store = Store(store_path())
    try:
        store.set_cost(str(source), asset, average)
    finally:
        store.close()
    _audit().record("cost", f"set {source} {asset}", average or "cleared")
    return {"source": source, "asset": asset, "averageCost": average}


# The Trading account's trades are the owner's own buys too (decision 78); the DCA close-out is
# not, as it finishes a week the owner already approved. A DCA change is checked when it raises a
# buy (audit 9).
BUYS = (
    "/dca/orders",
    "/dca/orders/amend",
    "/pot/trades",
    "/pot/trades/add",
    "/pot/trades/enter-now",
    "/pot/ladders",
    "/dca/add",
)
PRETRADE_RULES = ("monthly_deposit_cap_aud", "per_trade_aud", "max_pct_per_coin")


def _spend_of(path: str, body: dict[str, Any]) -> Decimal | None:
    """What a buy request would spend, in the quote; None when it isn't a buy or can't be read
    (the order itself then refuses it)."""
    try:
        if path == "/dca/orders" and body.get("side", "buy") != "buy":
            return None
        if path in ("/pot/ladders", "/dca/add"):
            rungs = cast(list[dict[str, Any]], body.get("rungs") or [])
            return sum((Decimal(str(r.get("spend"))) for r in rungs), Decimal(0))
        return Decimal(str(body.get("spend")))
    except (InvalidOperation, ValueError):
        return None


def _pretrade(
    desk: Trading, path: str, body: dict[str, Any], portfolio: Portfolio
) -> dict[str, object] | None:
    """The pre-trade check (decision 58): a buy that breaks a set Profile rule goes only once the
    owner confirms past it, and that override is logged. A 409 names each rule broken."""
    if path not in BUYS:
        return None
    if path == "/pot/trades":  # sized by the account's own rules first; a refusal there stands
        sized = Pot(desk).size(body)
        _, store, audit, _ = desk.parts()
        override = body.get("override") is True
        spend = Decimal(str(sized["spend"]))
        return _rule_check(store, audit, str(sized["coin"]), spend, override, portfolio)[0]
    if path in ("/pot/trades/add", "/pot/trades/enter-now"):
        return _pretrade_add(desk, body, portfolio)
    if path == "/dca/orders/amend":
        return _pretrade_amend(desk, body, portfolio)
    spend = _spend_of(path, body)
    if spend is None or not spend.is_finite() or spend <= 0:
        return None
    _, store, audit, _ = desk.parts()
    symbol = coin_symbol(body.get("symbol") or body.get("coin", ""))
    if path not in ("/dca/orders", "/dca/add") and symbol.endswith(
        QUOTE
    ):  # the DCA book guards its own buys
        Pot(desk).guard(spend)
    coin = symbol.removesuffix(QUOTE)
    return _rule_check(store, audit, coin, spend, body.get("override") is True, portfolio)[0]


def _pretrade_add(
    desk: Trading, body: dict[str, Any], portfolio: Portfolio
) -> dict[str, object] | None:
    """Adding to a Trading account trade, or entering a waiting one now at market (about its
    planned spend): the account's own money, so no ring-fence warning."""
    _, store, audit, _ = desk.parts()
    trade = store.pot_trade(str(body.get("ref") or ""))
    try:
        spend = Decimal(str(body.get("usdc") or (trade or {}).get("spend")))
    except (InvalidOperation, ValueError):
        return None
    if trade is None or not spend.is_finite() or spend <= 0:
        return None
    override = body.get("override") is True
    return _rule_check(store, audit, str(trade["coin"]), spend, override, portfolio)[0]


def _pretrade_amend(
    desk: Trading, body: dict[str, Any], portfolio: Portfolio
) -> dict[str, object] | None:
    """A DCA change that raises a buy (audit 9): the per-trade size is judged on the new
    order, the monthly cap and the coin's share on what the raise adds, as the old order's
    unfilled part already counts. A new price, or the same or a smaller amount, adds nothing."""
    _, store, audit, clock = desk.parts()
    row = store.dca_order(str(body.get("ref") or ""))
    if row is None or row["side"] != "buy" or body.get("raise") is not True:
        return None
    try:
        spend = Decimal(str(body.get("spend")))
        left = Decimal(row["spend"] or "0") - Decimal(row["executed_quote"])
    except (InvalidOperation, ValueError):
        return None
    if not spend.is_finite() or spend <= left:
        return None
    now = datetime.fromtimestamp(clock(), SYDNEY)
    counted = left if int(row["created"]) >= profile_live.month_start_ms(now) else Decimal(0)
    override = body.get("override") is True
    coin = str(row["coin"])
    return _rule_check(store, audit, coin, spend, override, portfolio, credit=counted)[0]


def _rule_check(  # noqa: PLR0913, PLR0917 - each is a separate fact about the buy
    store: Store,
    audit: Audit,
    coin: str,
    spend: Decimal,
    override: bool,
    portfolio: Portfolio,
    *,
    credit: Decimal = Decimal(0),
) -> tuple[dict[str, object] | None, list[dict[str, str]]]:
    """A 409 naming each set Profile rule the buy breaks, or None when it may go; and the rules
    it breaks, whether or not the owner confirmed past them. credit: what an order this buy
    replaces already counts this month, so the cap and the coin's share see only what it adds."""

    _, doc = profile.current(store)
    if all(profile.rule(doc, key) is None for key in PRETRADE_RULES):
        return None, []
    try:
        held: dict[str, Any] | None = portfolio()
    except profile_routes.LIVE_ERRORS:
        held = None
    rate = (
        profile_live.remember_rate(store, held)
        if held
        else Decimal(store.setting(profile_live.RATE_KEY, "1.5"))
    )
    found = profile_live.breaks(
        doc,
        spend_aud=spend * rate,
        month_aud=profile_live.month_spent_aud(store, rate, datetime.now(SYDNEY)) - credit * rate,
        share_after=profile_live.share_after(held, coin, spend - credit) if held else None,
        coin=coin,
    )
    if held is None and profile.rule(doc, "max_pct_per_coin") is not None:
        found.append(  # fail closed: a set rule that can't be checked counts as broken
            {
                "rule": "max_pct_per_coin",
                "label": "Max % per coin",
                "message": "Your portfolio couldn't be read, so this coin's share wasn't checked.",
            }
        )
    if not found:
        return None, []
    if override:
        profile_ai.record_override(store, audit, found, coin, spend * rate)
        return None, found
    audit.record(
        "profile", f"Pre-trade check on {coin}", "Held: " + "; ".join(b["label"] for b in found)
    )
    reply = {"error": f"This buy breaks your rule: {found[0]['label']}.", "ruleBreaks": found}
    return _reply(409, reply), found


def _trading_route(  # noqa: PLR0913, PLR0917 - each factory is a seam the tests replace
    method: str,
    path: str,
    params: dict[str, str],
    event: dict[str, object],
    trading: TradingFactory,
    portfolio: Portfolio,
) -> dict[str, object] | None:
    route = ROUTES.get((method, path))
    if route is None:
        return None
    with trading() as desk:
        held = _pretrade(desk, path, _body(event), portfolio)
        if held is not None:
            return held
        return _reply(200, route(desk, params, _body(event)))


def _tickers(binance: Binance, coins: str) -> dict[str, Any]:
    """Prices for the top bar, at most ten coins, in the order asked."""
    wanted = [coin_symbol(c) for c in coins.split(",")[:10]]
    listed = binance.symbols()
    found = binance.tickers([c for c in wanted if c in listed])
    return {
        "tickers": [
            {
                "coin": c.removesuffix(QUOTE),
                "price": found[c]["lastPrice"],
                "change24h": found[c]["priceChangePercent"],
            }
            for c in wanted
            if c in found
        ]
    }


def _facts(s: Services, coin: str) -> dict[str, Any]:
    """Every number the AI plan rests on (decision 46), worked out in code."""
    previous = s.signals.last(coin)
    outside = s.portfolio is None  # a test's own portfolio means no calls out
    try:
        mood = live_sentiment() if outside else None
    except SentimentError:
        mood = None
    if _demo() or not outside:
        perp = None
    else:
        with httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False) as client:
            perp = futures(client, coin)
    extras = {
        "fearGreed": {"value": mood["value"], "label": mood["label"]} if mood else None,
        "futures": perp,
        "previous": {
            "action": previous.get("action", previous.get("verdict")),
            "confidence": previous["confidence"],
            "price": previous["price"],
            "hoursAgo": round((time.time() * 1000 - previous["ranAt"]) / 3_600_000),
        }
        if previous
        else None,
    }
    return gather(s.binance, s.store, (s.portfolio or live_portfolio)(), coin, extras)


def _coin(raw: object) -> str:
    return coin_symbol(raw).removesuffix(QUOTE)


def _dated_signal(s: Services, signal: dict[str, Any] | None) -> dict[str, Any] | None:
    """A signal, marked out of date once the Profile has moved past the version it read."""
    if signal is None:
        return None
    n, _ = profile.current(s.store)
    return signal | {"outOfDate": signal.get("profileVersion") not in (None, n)}


def _add_alert(s: Services, b: dict[str, Any]) -> dict[str, Any]:
    coin = _coin(b.get("coin"))
    direction = str(b.get("direction", ""))
    if direction not in ("above", "below"):
        raise Refused("An alert is for a price above or below.")
    try:
        at = Decimal(str(b.get("price")))
    except InvalidOperation:
        raise Refused("The alert's price must be a number.") from None
    if not at.is_finite() or at <= 0:
        raise Refused("The alert's price must be more than zero.")
    note = " ".join(str(b.get("note") or "").split())[:80]
    s.store.add_alert(coin, direction, format(at.normalize(), "f"), note, int(time.time() * 1000))
    s.audit.record("alert", f"Alert set on {coin}", f"{direction} {at}")
    return {"alerts": s.store.alerts(coin)}


def _strategize(s: Services, body: dict[str, Any]) -> dict[str, Any]:
    """Strategize with the agent: the market's mood and calendar read through one client."""
    with httpx.Client(timeout=TIMEOUT_SECONDS) as client:
        return Strategist(Trading(s.binance, s.store, s.audit), s.signals, client).chat(body)


def _funds(s: Services) -> Funds:
    """Add and Remove funds on the DCA book, with dca-agent on the desk's AI provider."""
    return Funds(DcaBook(Trading(s.binance, s.store, s.audit)), s.signals)


def risk_board(s: Services, now: datetime | None = None) -> dict[str, Any]:
    """risk-agent's board: every limit from the desk's own figures, by area. A source that
    can't be read is named, and its limits left out rather than shown as kept."""
    now = now or datetime.now(SYDNEY)
    desk = Trading(s.binance, s.store, s.audit)
    rows: list[dict[str, Any]] = []
    missing: list[str] = []
    book = DcaBook(desk)
    read_once: dict[str, Any] = {}

    def portfolio() -> dict[str, Any]:
        if "p" not in read_once:
            read_once["p"] = (s.portfolio or live_portfolio)()
        return cast(dict[str, Any], read_once["p"])

    sources: list[tuple[str, Callable[[], list[dict[str, Any]]]]] = [
        ("the trading pot", lambda: risk.pot_limits(Pot(desk).view())),
        ("the DCA book", lambda: risk.dca_limits(book.view(), len(book.open_week()), now)),
        ("deposits", lambda: risk.deposit_limits(_coach(s, write=False)["deposits"])),
        ("the portfolio", lambda: risk.portfolio_limits(portfolio())),
        (
            "custody and TAO",
            lambda: risk_big.big_four(
                portfolio(),
                book.plan(),
                risk_big.checks_of(s.store),
                int(now.timestamp() * 1000),
            ),
        ),
    ]
    for name, read in sources:
        try:
            rows += read()
        except Exception as error:  # noqa: BLE001 - one source down must not hide the rest
            missing.append(name)
            s.audit.record("risk", f"Board: {name}", f"Not read: {type(error).__name__}")
    plan = schedule.view(s.store, now)
    return {
        "sentence": risk_big.lead(rows) or risk.sentence(rows),
        "limits": rows,
        "missing": missing,
        "review": risk.last_review(s.store),
        "checkedAt": int(now.timestamp() * 1000),
        "jobs": [j for j in plan["jobs"] if j["agent"] == risk.AGENT],
        "scheduleOn": plan["on"],
    }


def risk_model(s: Services) -> str:
    listing = cast(list[dict[str, Any]], my_agents.listing(s.store)["agents"])
    none: dict[str, Any] = {}
    mine = next((a for a in listing if a["slug"] == risk.AGENT), none)
    return str(cast(dict[str, Any], mine.get("model") or {}).get("id") or "")


def _risk_mark(s: Services, body: dict[str, Any]) -> dict[str, Any]:
    """A backup check done today, or TAO's thesis still holding: the date only."""
    try:
        risk_big.mark(s.store, body.get("key"), int(datetime.now(SYDNEY).timestamp() * 1000))
    except ValueError as error:
        raise Refused(str(error)) from None
    s.audit.record("risk", "Checked", str(body.get("key")))
    return risk_board(s)


def _risk_review(s: Services) -> dict[str, Any]:
    """risk-agent writes the weekly review now, from the board."""
    board = risk_board(s)
    try:
        risk.review(s.store, s.signals, board["limits"], board["checkedAt"], lambda: risk_model(s))
    except LookupError as error:
        raise Refused(str(error)) from None
    return risk_board(s)


def _schedule_on(s: Services, body: dict[str, Any]) -> dict[str, Any]:
    """Agents running on their own, on or off: off, nothing wakes them; the desk still works."""
    on = body.get("on")
    if not isinstance(on, bool):
        raise Refused("Say on or off.")
    schedule.set_on(s.store, on)
    s.audit.record("agents", "Scheduler", "On" if on else "Off")
    return schedule.view(s.store, datetime.now(SYDNEY))


def _pot_agent(s: Services, body: dict[str, Any] | None, job: str = "chat") -> dict[str, Any]:
    """trading-agent's scan (no body), chat or one coin's analysis, with Binance's public
    futures data for crowding; the demo has none."""
    pot = Pot(Trading(s.binance, s.store, s.audit))

    def run(agent: PotAgent) -> dict[str, Any]:
        if body is None:
            # Scan now reports its steps (GET /pot/scan/progress); the scan that began the
            # record ends it, whatever happened.
            mine = job == "scan-now" and scan_progress.begin()
            try:
                return agent.scan(every=job == "scan-now")
            finally:
                if mine:
                    scan_progress.finish()
        jobs: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
            "analyse": agent.analyse,
            "styles": lambda _b: agent.styles(),
            "screen": agent.screen,
            "judge": agent.judge,
            "judge-one": agent.judge_one,
        }
        return jobs.get(job, agent.chat)(body)

    if _demo():
        return run(PotAgent(pot, s.signals))
    with httpx.Client(timeout=TIMEOUT_SECONDS) as futures:
        return run(PotAgent(pot, s.signals, futures))


ServiceRoute = Callable[[Services, dict[str, str], dict[str, Any]], object]


def _deposits(s: Services, q: dict[str, str]) -> dict[str, Any]:
    """USDC deposits for a financial year, by month, in AUD (decision 31)."""
    fx_transport = httpx.MockTransport(demo.fx) if _demo() else None
    year = q.get("fy", "")
    with httpx.Client(timeout=TIMEOUT_SECONDS, transport=fx_transport) as fx:
        return deposit_report(
            s.binance,
            s.store.deposits_paid(),
            fx,
            datetime.now(SYDNEY).date(),
            int(year) if year.isdigit() and len(year) == 4 else None,  # noqa: PLR2004
        )


def _deposit_paid(s: Services, b: dict[str, Any]) -> dict[str, Any]:
    """Records, or clears with null, what a USDC deposit cost in AUD (decision 31)."""
    key = amount_key(b.get("amount"))
    if not key or Decimal(key) <= 0:
        raise Refused("Name the deposit by its USDC amount.")
    raw = b.get("aud")
    aud: str | None = None
    if raw is not None:
        try:
            value = Decimal(str(raw))
        except InvalidOperation:
            raise Refused("AUD paid must be a number.") from None
        if not value.is_finite() or value <= 0 or value > MAX_COST:
            raise Refused("AUD paid must be more than 0.")
        aud = format(value.normalize(), "f")
    s.store.set_deposit_paid(key, aud)
    s.audit.record("deposit", f"paid {key} USDC", aud or "cleared")
    return {"amount": key, "aud": aud}


def _coins(raw: object, s: Services) -> list[str]:
    asked = [_coin(c) for c in str(raw or "").split(",") if c.strip()][:20]
    return asked or sorted(s.store.watched_coins())


def _lots(s: Services, coin: str) -> list[dict[str, Any]]:
    """The coin's tax lots for Ellis, read only when Plan fit runs; none when the ledger
    can't be read, since only that step needs them."""
    if not trading_agent.current(s.store)[1]["steps"]["planfit"]["on"]:
        return []
    try:
        return [lot for lot in _tax(s)["lots"] if lot["coin"] == coin]
    except (Refused, SignalError, BinanceError, MarketError, httpx.HTTPError, KeyError):
        return []
    except InvalidOperation:
        return []


def _sellable(s: Services, facts: dict[str, Any]) -> str:
    """The coin on Binance, less what open sells already hold: the most a sell ticket asks."""
    coin = facts["coin"]
    on_binance = sum(
        (
            Decimal(str(h.get("amount") or "0"))
            for h in (s.portfolio or live_portfolio)()["holdings"]
            if h["asset"] == coin and h.get("source", "Binance") == "Binance"
        ),
        Decimal(0),
    )
    selling = sum(
        (Decimal(o["amount"]) for o in facts.get("openOrders", []) if o["side"] == "sell"),
        Decimal(0),
    )
    return plain(max(on_binance - selling, Decimal(0)))


def _analyse(s: Services, b: dict[str, Any]) -> dict[str, Any]:
    coin = _coin(b.get("coin"))
    facts = _facts(s, coin)
    facts["sellable"] = _sellable(s, facts)
    return analyse.start(s.store, s.audit, facts, _lots(s, coin), _now_ms())


def _calls(s: Services, q: dict[str, str]) -> dict[str, Any]:
    def dated(coin: str) -> dict[str, Any] | None:
        return _dated_signal(s, s.signals.last(coin))

    return {"calls": analyse.calls(_coins(q.get("coins"), s), dated)}


def _rank(s: Services, b: dict[str, Any]) -> dict[str, Any]:
    coins = _coins(",".join(map(str, b.get("coins") or [])), s)
    prices = {t["coin"]: t for t in _tickers(s.binance, ",".join(coins))["tickers"]}
    portfolio = (s.portfolio or live_portfolio)()
    total = Decimal(portfolio["total"]["value"] or "0")
    rows: list[dict[str, Any]] = []
    for coin in coins:
        last = _dated_signal(s, s.signals.last(coin))
        value = sum(
            (Decimal(h.get("value") or "0") for h in portfolio["holdings"] if h["asset"] == coin),
            Decimal(0),
        )
        rows.append(
            {
                "coin": coin,
                "change24h": prices.get(coin, {}).get("change24h"),
                "sharePct": plain((value / total * 100).quantize(Decimal("0.1")))
                if total
                else None,
                "lastCall": {
                    "action": last["action"],
                    "hoursAgo": round((_now_ms() - last["ranAt"]) / 3_600_000),
                    "outOfDate": last["outOfDate"],
                }
                if last
                else None,
            }
        )
    return analyse.rank(s.signals, s.store, rows)


def _agent_version(s: Services, q: dict[str, str]) -> dict[str, Any]:
    try:
        n = int(q.get("n", ""))
    except ValueError:
        raise Refused("No such version.") from None
    return trading_agent.version(s.store, n)


def _restore_agent(s: Services, b: dict[str, Any]) -> dict[str, Any]:
    try:
        n = int(str(b.get("n")))
    except ValueError:
        raise Refused("No such version.") from None
    return trading_agent.restore(s.store, s.audit, n, _now_ms())


def _import_agent(s: Services, b: dict[str, Any]) -> dict[str, Any]:
    doc = trading_agent.parse(str(b.get("markdown") or ""))
    return trading_agent.save(s.store, s.audit, doc, now=_now_ms(), summary_text="Imported")


def _agent_markdown(s: Services) -> str:
    n, doc = trading_agent.current(s.store)
    return trading_agent.export(doc, n, _now_ms())


def _now_ms() -> int:
    return int(time.time() * 1000)


SERVICE_ROUTES: dict[tuple[str, str], ServiceRoute] = {
    ("GET", "/agent"): lambda s, _q, _b: trading_agent.view(s.store),
    ("GET", "/agent/file"): lambda s, _q, _b: md_files.file_view(s.store, "agent"),
    ("PUT", "/agent"): lambda s, _, b: trading_agent.save(
        s.store, s.audit, b.get("agent"), now=_now_ms()
    ),
    ("GET", "/agent/version"): lambda s, q, _b: _agent_version(s, q),
    ("POST", "/agent/restore"): lambda s, _, b: _restore_agent(s, b),
    ("GET", "/agent/export"): lambda s, _q, _b: {"markdown": _agent_markdown(s)},
    ("POST", "/agent/import"): lambda s, _, b: _import_agent(s, b),
    ("POST", "/analyse"): lambda s, _, b: _analyse(s, b),
    ("POST", "/analyse/next"): lambda s, _, b: analyse.advance(
        s.store, s.audit, s.signals, b.get("id"), _now_ms()
    ),
    ("GET", "/analyse/last"): lambda s, q, _b: {"run": analyse.last(s.store, _coin(q.get("coin")))},
    ("GET", "/analyse/calls"): lambda s, q, _b: _calls(s, q),
    ("POST", "/analyse/ask"): lambda s, _, b: analyse.ask(
        s.store, s.signals, b.get("id"), b.get("question")
    ),
    ("POST", "/analyse/choice"): lambda s, _, b: analyse.choose(
        s.store, s.audit, b.get("id"), b.get("choice")
    ),
    ("POST", "/analyse/rank"): lambda s, _, b: _rank(s, b),
    ("GET", "/deposits"): lambda s, q, _: _deposits(s, q),
    ("PUT", "/deposits/paid"): lambda s, _, b: _deposit_paid(s, b),
    ("GET", "/tickers"): lambda s, q, _: _tickers(s.binance, q.get("coins", "BTC,ETH,TAO")),
    ("GET", "/market"): lambda s, q, _: market(
        s.binance, coin_symbol(q.get("symbol", "BTC")), q.get("interval", "4h")
    ),
    ("GET", "/watchlist"): lambda s, q, _: s.watchlist().view(q.get("list")),
    ("POST", "/watchlist"): lambda s, _, b: s.watchlist().add(b.get("coin"), b.get("list")),
    ("POST", "/watchlists"): lambda s, _, b: s.watchlist().create(b.get("name")),
    ("GET", "/signal"): lambda s, q, _: {
        "signal": _dated_signal(
            s, s.signals.last(coin_symbol(q.get("coin", "")).removesuffix(QUOTE))
        )
    },
    ("GET", "/risk"): lambda s, _q, _b: rules_of(s.store).view(),
    ("GET", "/alerts"): lambda s, q, _: {
        "alerts": s.store.alerts(_coin(q["coin"]) if q.get("coin") else None)
    },
    ("POST", "/alerts"): lambda s, _, b: _add_alert(s, b),
    ("GET", "/settings/ai"): lambda s, _q, _b: ai_client.view(s.store, s.signals),
    ("PUT", "/settings/ai"): lambda s, _, b: ai_client.choose(s.store, s.audit, s.signals, b),
    ("PUT", "/settings/ai/key"): lambda s, _, b: _save_key(s, b),
    ("GET", "/coach"): lambda s, _q, _b: _coach(s, write=False),
    ("POST", "/coach/message"): lambda s, _q, _b: _coach(s, write=True),
    ("GET", "/agents"): lambda _s, _q, _b: agents.listing(),
    ("GET", "/my-agents"): lambda s, _q, _b: my_agents.listing(s.store),
    ("POST", "/dca/funds/analyse"): lambda s, _q, b: _funds(s).analyse(
        b.get("side"), b.get("amount"), b.get("agent", True) is not False
    ),
    ("POST", "/dca/funds/chat"): lambda s, _q, b: _funds(s).chat(b),
    ("POST", "/strategize"): lambda s, _q, b: _strategize(s, b),
    ("POST", "/pot/scan"): lambda s, _q, _b: _pot_agent(s, None, "scan-now"),
    ("GET", "/pot/scan/progress"): lambda _s, _q, _b: scan_progress.view(),
    ("GET", "/risk-board"): lambda s, _q, _b: risk_board(s),
    ("POST", "/risk-board/review"): lambda s, _q, _b: _risk_review(s),
    ("POST", "/risk-board/check"): lambda s, _q, b: _risk_mark(s, b),
    ("GET", "/my-agents/schedule"): lambda s, _q, _b: schedule.view(s.store, datetime.now(SYDNEY)),
    ("PUT", "/my-agents/schedule"): lambda s, _q, b: _schedule_on(s, b),
    ("POST", "/pot/agent"): lambda s, _q, b: _pot_agent(s, b),
    ("POST", "/pot/analyse"): lambda s, _q, b: _pot_agent(s, b, "analyse"),
    ("GET", "/pot/styles"): lambda s, _q, _b: _pot_agent(s, {}, "styles"),
    ("POST", "/pot/screen"): lambda s, _q, b: _pot_agent(s, b, "screen"),
    ("POST", "/pot/judge"): lambda s, _q, b: _pot_agent(s, b, "judge"),
    ("POST", "/pot/judge-one"): lambda s, _q, b: _pot_agent(s, b, "judge-one"),
    ("POST", "/dca/agent"): lambda s, _q, b: _funds(s).agent(b),
    ("GET", "/dca/funds/odds"): lambda s, q, _b: _funds(s).odds(
        str(q.get("coin", "")), q.get("price"), str(q.get("side", "add"))
    ),
    ("GET", "/my-agents/file"): lambda s, q, _b: my_agents.file(s.store, str(q.get("slug", ""))),
    ("GET", "/tax"): lambda s, _q, _b: _tax(s),
    ("GET", "/tax/sell-check"): lambda s, q, _b: _sell_check(s, q),
    ("GET", "/tax/staking"): lambda s, _q, _b: staking_income.view(s.store, tax.today_sydney()),
    ("POST", "/tax/staking"): lambda s, _q, b: _add_staking(s, b),
    ("POST", "/tax/staking/remove"): lambda s, _q, b: _remove_staking(s, b),
    ("GET", "/rebalance"): lambda s, _q, _b: rebalance.drift(
        (s.portfolio or live_portfolio)(), profile.current(s.store)[1]
    ),
    ("GET", "/journal"): lambda s, _q, _b: _journal(s),
    ("PUT", "/journal/tags"): lambda s, _, b: journal.tag(s.store, b),
    ("PUT", "/journal/lists"): lambda s, _, b: journal.set_lists(s.store, b),
    ("GET", "/settings/features"): lambda s, _q, _b: features.view(s.store),
    ("PUT", "/settings/features"): lambda s, _, b: _switch_feature(s, b),
    ("GET", "/settings/telegram"): lambda s, _q, _b: telegram.view(s.store),
    ("PUT", "/settings/telegram"): lambda s, _, b: _telegram_time(s, b),
    ("PUT", "/settings/telegram/token"): lambda s, _, b: _telegram_token(s, b),
    ("POST", "/settings/telegram/test"): lambda s, _q, _b: _telegram_test(s),
    ("POST", "/settings/telegram/link"): lambda s, _q, _b: _telegram_link(s),
    ("POST", "/settings/ai/signin"): lambda s, _q, _b: _signin_start(s),
    ("POST", "/settings/ai/signin/finish"): lambda s, _, b: _signin_finish(s, b),
}


def _service_route(
    method: str,
    path: str,
    params: dict[str, str],
    event: dict[str, object],
    services: ServicesFactory,
) -> dict[str, object] | None:
    alert = re.fullmatch(r"/alerts/(\d{1,9})", path)
    if alert and method == "DELETE":
        with services() as s:
            s.store.delete_alert(int(alert.group(1)))
            return _reply(200, {"alerts": s.store.alerts()})
    named = _named_route(method, path)
    if named is not None:
        with services() as s:
            return _reply(200, named(s, _body(event)))
    removing = re.fullmatch(r"/watchlist/([A-Za-z0-9]{1,16})", path)
    dropping = re.fullmatch(r"/watchlists/(\d{1,9})", path)
    route = SERVICE_ROUTES.get((method, path))
    if route is None and not (method == "DELETE" and (removing or dropping)):
        return None
    with services() as s:
        if route is not None:
            return _reply(200, route(s, params, _body(event)))
        if dropping:
            return _reply(200, s.watchlist().delete(dropping.group(1)))
        assert removing is not None  # noqa: S101 - checked above
        return _reply(200, s.watchlist().remove(removing.group(1), params.get("list")))


def _profile_route(
    method: str, path: str, event: dict[str, object], services: ServicesFactory
) -> dict[str, object] | None:
    """The Profile's routes (decision 58)."""
    if not path.startswith(("/profile", "/recaps")):
        return None
    with services() as s:
        found = profile_routes.route(
            method, path, _body(event), s, s.portfolio or live_portfolio, lambda: _journal(s)
        )
        return _reply(200, found) if found is not None else None


def _named_route(
    method: str, path: str
) -> Callable[[Services, dict[str, Any]], dict[str, Any]] | None:
    """Routes with a name in the path: an agent's thread."""
    agent = re.fullmatch(r"/agents/([a-z]{1,12})", path)
    if agent and method == "GET":
        return lambda s, _b: agents.thread(s.store, agent.group(1))
    if agent and method == "POST":
        return lambda s, b: agents.send(s.store, s.audit, agent.group(1), b)
    return None


def _coach(s: Services, *, write: bool) -> dict[str, Any]:
    """The Dashboard: facts from code, and the message kept for today and this mood. GET is
    quick, with the plain wording until the model's is kept; POST has the model write it."""
    n, plan = profile.current(s.store)
    try:
        report: dict[str, Any] | None = _deposits(s, {})
    except (BinanceError, httpx.HTTPError, LookupError, ValueError):
        report = None  # the coach still shows; the card says deposits couldn't be read
    facts = coach.facts(
        portfolio=(s.portfolio or live_portfolio)(),
        history=[(day, Decimal(value)) for day, value in s.store.history(coach.STREAK_DAYS + 1)],
        report=report,
        plan=plan,
        now=datetime.now(SYDNEY),
        name=plan["identity"]["name"] or "",  # the Profile's Name line (decision 65)
        last_plan=s.signals.last,
    )
    facts["week"] = _week(s, plan)
    raw = s.store.setting(coach.CACHE_KEY, "")
    kept: dict[str, Any] | None = json.loads(raw) if raw else None
    # Only the model's words are kept: the plain ones are tried again next time.
    if kept and kept.get("message", {}).get("source") != "model":
        kept = None
    fresh = bool(kept and kept.get("key") == coach.cache_key(facts))
    if not write:
        message = coach.message(facts, plan, "", kept, None)
        return facts | {"message": _dated_message(message, kept, n), "pending": not fresh}

    def ask(system: str, text: str, shape: dict[str, Any]) -> dict[str, Any]:
        return s.signals.write(system, text, shape, "coach message")

    message = coach.message(facts, plan, for_agents(s.store), kept, ask)
    if message["source"] == "model" and not (fresh and kept):
        kept = {"key": coach.cache_key(facts), "message": message, "profileVersion": n}
        s.store.set_setting(coach.CACHE_KEY, json.dumps(kept))
    return facts | {"message": _dated_message(message, kept, n), "pending": False}


def _week(s: Services, plan: dict[str, Any]) -> dict[str, Any] | None:
    """The week rail (decision 63), from profile.md v2's weekly buy and this week's Binance buys;
    None before the Profile is v2."""
    if not plan["markdown"]:
        return None
    today = tax.today_sydney()
    try:
        portfolio = (s.portfolio or live_portfolio)()
        coins = ledger.coins_seen(s.store, set(tax.held_of(portfolio)))
        fx_transport = httpx.MockTransport(demo.fx) if _demo() else None
        with httpx.Client(timeout=TIMEOUT_SECONDS, transport=fx_transport) as fx:
            fills = ledger.fills(s.binance, fx, coins, coach_week.start_ms(today), today)
        buys: list[tuple[date, Decimal]] | None = [(f.day, f.aud) for f in fills if f.buy]
    except (BinanceError, httpx.HTTPError, LookupError, ValueError):
        buys = None  # the rail still shows the plan; nothing is marked done or missed
    rail = coach_week.week(profile_v2.values(plan["markdown"])["dca"], buys, today)
    raw = s.store.setting("dca_plan", "")
    book_plan = json.loads(raw) if raw else None
    return coach_week.with_book(rail, book_plan, s.store.dca_orders(), QUOTE)


def _dated_message(message: dict[str, Any], kept: dict[str, Any] | None, n: int) -> dict[str, Any]:
    """The model's words are out of date once the Profile moves past the version they read."""
    read = kept.get("profileVersion") if kept and message.get("source") == "model" else None
    return message | {"outOfDate": read is not None and read != n}


def _ledger(s: Services) -> tuple[list[ledger.Fill], dict[str, Any], date]:
    """The fills behind the Tax tab and the Journal, with the portfolio they're held against."""
    portfolio = (s.portfolio or live_portfolio)()
    today = tax.today_sydney()
    coins = ledger.coins_seen(s.store, set(tax.held_of(portfolio)))
    fx_transport = httpx.MockTransport(demo.fx) if _demo() else None
    with httpx.Client(timeout=TIMEOUT_SECONDS, transport=fx_transport) as fx:
        fills = ledger.fills(s.binance, fx, coins, cost_from_ms(), today)
    return fills, portfolio, today


def _add_staking(s: Services, body: dict[str, Any]) -> dict[str, Any]:
    staking_income.add(s.store, body, tax.today_sydney(), int(time.time() * 1000))
    return staking_income.view(s.store, tax.today_sydney())


def _remove_staking(s: Services, body: dict[str, Any]) -> dict[str, Any]:
    if not s.store.remove_staking_claim(_id(body)):
        raise Refused("That claim isn't recorded.")
    return staking_income.view(s.store, tax.today_sydney())


def _tax(s: Services) -> dict[str, Any]:
    fills, portfolio, today = _ledger(s)
    return tax.report(fills, portfolio, today)


def _sell_check(s: Services, q: dict[str, str]) -> dict[str, Any]:
    coin = _coin(q.get("coin", ""))
    try:
        qty = Decimal(q.get("qty", ""))
    except InvalidOperation:
        raise Refused("The amount must be a number.") from None
    if not qty.is_finite() or qty <= 0:
        raise Refused("The amount must be more than zero.")
    fills, portfolio, today = _ledger(s)
    return tax.sell_check(fills, portfolio, coin, qty, today)


def _journal(s: Services) -> dict[str, Any]:
    fills, portfolio, today = _ledger(s)
    _, sales = tax.build(fills, tax.held_of(portfolio))
    _, plan = profile.current(s.store)
    total = Decimal(portfolio["total"]["value"] or "0")
    cap = profile.rule(plan, "max_pct_per_coin")
    over = {
        r["coin"]
        for r in coach.coins_held(portfolio)
        if cap is not None and total and r["value"] / total * 100 > cap
    }

    try:
        report = _deposits(s, {})
        months = {m["month"]: Decimal(m["aud"]) for m in report["months"]}
    except (BinanceError, httpx.HTTPError, LookupError, ValueError):
        months = {}
    return journal.view(s.store, fills, sales, plan, over, months, today)


def _telegram_token(s: Services, body: dict[str, Any]) -> dict[str, Any]:
    env_file.save("TELEGRAM_BOT_TOKEN", str(body.get("token", "")))
    telegram.new_link(s.store)  # a new bot links afresh, by the code shown in Settings
    s.audit.record("settings", "Telegram bot token", "Saved to .env")
    return telegram.view(s.store)


def _telegram_time(s: Services, body: dict[str, Any]) -> dict[str, Any]:
    done = telegram.set_time(s.store, body)
    s.audit.record("settings", "Morning summary time", str(done["time"]))  # audit 23
    return done


def _switch_feature(s: Services, body: dict[str, Any]) -> dict[str, Any]:
    done = features.switch(s.store, body)
    said = "On" if body.get("on") is True else "Off"
    s.audit.record("settings", f"Page or feature: {body.get('id')}", said)  # audit 23
    return done


def _telegram_link(s: Services) -> dict[str, Any]:
    """Looks for the code the owner sent the bot, and links that chat."""
    with telegram.client() as client:
        found = telegram.find_chat(s.store, client)
    if found:
        s.audit.record("settings", "Telegram chat", "Linked")
    return telegram.view(s.store)


def _telegram_test(s: Services) -> dict[str, Any]:
    text = telegram.summary(_coach(s, write=False))
    with telegram.client() as client:
        telegram.send(s.store, client, text)
    s.audit.record("telegram", "Test summary", "Sent")
    return telegram.view(s.store)


def morning_summary(s: Services, now: datetime | None = None) -> bool:
    """Sends today's summary once it's due (decision 57). One try a day: a failure is recorded
    in the audit log, not retried every 30 seconds."""
    now = now or datetime.now(SYDNEY)
    if not telegram.due(s.store, now):
        return False
    telegram.mark_sent(s.store, now)
    try:
        text = telegram.summary(_coach(s, write=False))
        with telegram.client() as client:
            telegram.send(s.store, client, text)
    except Exception as error:  # noqa: BLE001 - the watcher must keep running; no token in this
        said = (
            str(error)
            if isinstance(error, (telegram.TelegramError, Refused))
            else type(error).__name__
        )
        s.audit.record("telegram", "Morning summary", f"Failed: {said}")
        return False
    s.audit.record("telegram", "Morning summary", "Sent")
    return True


def weekly_recap(s: Services, now: datetime | None = None) -> bool:
    """Writes the Sunday recap once it's due (decision 58); a failure is in the audit log."""
    now = now or datetime.now(SYDNEY)
    if profile_ai.recap_due(s.store, now) is None:
        return False
    try:
        profile_routes.recap_now(s, s.portfolio or live_portfolio)
    except Exception as error:  # noqa: BLE001 - the watcher must keep running
        s.audit.record("profile", "Weekly recap", f"Failed: {type(error).__name__}")
        return False
    return True


def _failure(error: Exception) -> tuple[int, dict[str, str]]:
    """What the owner sees when a route can't finish, in words they can act on."""
    if isinstance(error, telegram.TelegramError):
        return 502, {"error": str(error)}
    if isinstance(error, BinanceError):
        return 502, {"error": f"Binance said: {error.message}"}
    if isinstance(error, (Refused, MarketError)):
        return 400, {"error": str(error)}
    if isinstance(error, SignalError):
        return 503, {"error": str(error)}
    if isinstance(error, MissingKey):
        return 503, {"error": "Add BINANCE_API_KEY and BINANCE_API_SECRET to .env."}
    # Any other lookup: a bot, grid or trade that isn't there, or a reply missing a field.
    return 404, {"error": "The desk couldn't find what it needed. Refresh and try again."}


def _open_route(method: str, path: str) -> dict[str, object] | None:
    """Routes that need no exchange: health, the Fear & Greed Index and coin logos."""
    if path == "/health":
        return _reply(200, {"status": "ok"})
    reads = {
        "/sentiment": live_sentiment,
        "/sentiment/detail": live_sentiment_detail,
        "/global": live_global,
    }
    if method == "GET" and path in reads:
        try:
            return _reply(200, reads[path]())
        except SentimentError as error:
            return _reply(502, {"error": str(error)})
    if method == "GET" and path.startswith("/coin-icon/"):
        return _image(live_icon(path.removeprefix("/coin-icon/")))
    return None


def _backtest_route(
    method: str, path: str, params: dict[str, str], event: dict[str, object]
) -> dict[str, object] | None:
    """The Backtest page (decision 87): Freqtrade's results and the worker's queue, no exchange."""
    route = backtest.ROUTES.get((method, path))
    if route is None:
        return None
    try:
        return _reply(200, route(backtest.Backtests(coins=_top_coins), params, _body(event)))
    except BadRun as error:
        return _reply(400, {"error": str(error)})


def _top_coins() -> list[str]:
    """Today's top 100 USDC coins as the screener last saved them, by volume (decision 80)."""
    store = Store(store_path())
    try:
        raw = store.setting(screener.UNIVERSE_KEY, "")
    finally:
        store.close()
    saved: dict[str, list[object]] = json.loads(raw) if raw else {}
    return [str(c) for c in saved.get("coins", [])]


def handler(  # noqa: PLR0913, PLR0917 - each factory is a seam the tests replace
    event: dict[str, object],
    context: object,
    portfolio: Portfolio = live_portfolio,
    trading: TradingFactory = live_trading,
    services: ServicesFactory = live_services,
    bots: BotsFactory = live_bots,
    grids: GridsFactory = live_grids,
) -> dict[str, object]:
    del context
    path = str(event.get("rawPath", "/health"))
    request = cast(dict[str, Any], event.get("requestContext") or {})
    http = cast(dict[str, Any], request.get("http") or {})
    method = str(http.get("method", "GET"))
    query = event.get("queryStringParameters")
    params = cast(dict[str, str], query) if isinstance(query, dict) else {}
    open_reply = _open_route(method, path)
    if open_reply is None:
        try:
            open_reply = _backtest_route(method, path, params, event)
        except LookupError as error:
            return _reply(*_failure(error))
    if open_reply is not None:
        return open_reply
    try:
        if method == "GET" and path == "/portfolio":
            return _reply(200, portfolio())
        if method == "PUT" and path == "/cost":
            return _reply(200, live_set_cost(_body(event)))
        routed = (
            _ledger_http(method, path, event)
            or _bot_route(method, path, event, bots, portfolio)
            or _grid_route(method, path, event, grids)
            or _trading_route(method, path, params, event, trading, portfolio)
            or _profile_route(method, path, event, services)
            or _service_route(method, path, params, event, services)
        )
    except (
        LookupError,
        Refused,
        MarketError,
        SignalError,
        BinanceError,
        telegram.TelegramError,
    ) as error:
        return _reply(*_failure(error))
    return routed or _reply(404, {"error": "Not found."})
