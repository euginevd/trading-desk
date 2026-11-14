"""The api's routes: /health, the portfolio, the watchlist, AI signals and orders (decision 14)."""

import base64
import json
import os
import re
import time
from collections.abc import Callable, Generator
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, cast
from zoneinfo import ZoneInfo

import httpx

from api import demo
from api.advisor import futures, gather, history_candles, rules_of, set_rules
from api.ai_signal import Ask, SignalError, Signals, claude
from api.audit import Audit
from api.binance import Binance, BinanceError
from api.bots import Bots
from api.deposits import amount_key
from api.deposits import report as deposit_report
from api.grid import Grids
from api.icons import Icons
from api.market import QUOTE, MarketError, coin_symbol, market
from api.plan import track
from api.sentiment import SentimentError, fear_and_greed, fear_and_greed_detail, market_global
from api.service import CostRules, TradeCache, Wallet, fetch
from api.store import Store
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
        raise LookupError
    base = os.environ.get("BINANCE_BASE_URL", BINANCE_URL)
    with httpx.Client(base_url=base, timeout=TIMEOUT_SECONDS) as client:
        yield Binance(client, (key, secret), _audit())


def store_path() -> Path:
    name = "demo.sqlite" if _demo() else "desk.sqlite"
    return Path(os.environ.get("DESK_DB_DIR", "local")) / name


def _wallet(client: httpx.Client) -> Wallet | None:
    """The TAO wallet reader, or None when .env doesn't name a coldkey (decision 17)."""
    if _demo():
        return lambda: balance(client, "demo", demo.TAO_ADDRESS, _audit())
    address = os.environ.get("TAO_COLDKEY", "").strip()
    if not address:
        return None
    key = os.environ.get("TAOSTATS_API_KEY", "").strip()

    def read() -> dict[str, Decimal]:
        if not key:
            raise TaoError("Add TAOSTATS_API_KEY to .env to read the TAO wallet.")
        return balance(client, key, address, _audit())

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
        ):
            rules = CostRules(store.costs(), cost_from_ms())
            portfolio = fetch(binance, fx, _wallet(tao), TRADE_CACHE, rules)
        today = datetime.now(SYDNEY).date().isoformat()
        store.record_value(today, portfolio["total"]["value"])
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
    if not on:
        Bots(*desk.parts()).stop_all("Stopped by the kill switch.")
        Grids(*desk.parts()).stop_all("Stopped by the kill switch.")
    return settings


BOT_ROUTES: dict[tuple[str, str], Callable[[Bots, dict[str, Any]], dict[str, Any]]] = {
    ("GET", "/bots"): lambda bots, _: bots.view(),
    ("POST", "/bots"): lambda bots, b: bots.create(b),
    ("POST", "/bots/preview"): lambda bots, b: bots.preview(b),
    ("POST", "/bots/suggest"): lambda bots, b: bots.suggest(b),
    ("GET", "/smart"): lambda bots, _: bots.view("trade"),
}


def _bot_route(
    method: str, path: str, event: dict[str, object], factory: BotsFactory
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
            done = bots.switch(bot_id, body.get("on") is True, body.get("confirmed") is True)
        elif not one.group(2) and method == "GET":
            done = bots.detail(bot_id)
        elif not one.group(2) and method == "PUT":
            done = bots.edit(bot_id, body)
        elif not one.group(2) and method == "DELETE":
            done = bots.delete(bot_id)
        else:
            return _reply(404, {"error": "Not found."})
        return _reply(200, done)


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


def _ask() -> Ask:
    if _demo():
        return demo.ask
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
    return claude(client)


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
        with _binance() as binance:
            yield Services(binance, store, Signals(_ask(), store, audit, _cap()), audit)
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
ROUTES: dict[tuple[str, str], Route] = {
    ("GET", "/trade"): lambda desk, q, _: desk.terminal(coin_symbol(q.get("symbol") or "BTC")),
    ("GET", "/settings"): lambda desk, _q, _b: desk.settings(),
    ("PUT", "/limits"): lambda desk, _, b: desk.set_limits(b.get("perOrder"), b.get("perDay")),
    ("PUT", "/trading"): lambda desk, _, b: _set_trading(desk, b.get("on") is True),
    ("POST", "/trades"): lambda desk, _, b: desk.place(b),
    ("POST", "/orders"): lambda desk, _, b: desk.place_order(b),
    ("POST", "/orders/ladder"): lambda desk, _, b: desk.ladder_order(b),
    ("POST", "/orders/edit"): lambda desk, _, b: desk.edit_order(b),
    ("POST", "/orders/cancel"): lambda desk, _, b: desk.cancel_order(
        b.get("symbol"), b.get("orderId")
    ),
}


COST_SOURCES = ("Binance", "TAO wallet")
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


def _trading_route(
    method: str,
    path: str,
    params: dict[str, str],
    event: dict[str, object],
    trading: TradingFactory,
) -> dict[str, object] | None:
    action = re.fullmatch(r"/trades/(\d+)/(cancel|close)", path)
    route = ROUTES.get((method, path))
    if route is None and not (method == "POST" and action):
        return None
    with trading() as desk:
        if route is not None:
            data = route(desk, params, _body(event))
            if path == "/trade" and _demo():
                data["demo"] = True
            return _reply(200, data)
        assert action is not None  # noqa: S101 - checked above
        trade_id = int(action.group(1))
        done = desk.cancel(trade_id) if action.group(2) == "cancel" else desk.close(trade_id)
        return _reply(200, done)


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


def _run_signal(s: Services, body: dict[str, Any]) -> dict[str, Any]:
    facts = _facts(s, _coin(body.get("coin")))
    return {"signal": s.signals.run(facts, body.get("force") is True)}


def _plan(s: Services, q: dict[str, str]) -> dict[str, Any]:
    """The live half of the panel: position, what-if, rules, levels, track record, alerts."""
    coin = _coin(q.get("coin", "BTC"))
    facts = gather(s.binance, s.store, (s.portfolio or live_portfolio)(), coin)
    history = s.store.signal_history(coin)
    record = track(history, history_candles(s.binance, coin), int(time.time() * 1000))
    return {**facts, "track": record, "alerts": s.store.alerts(coin)}


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


SERVICE_ROUTES: dict[tuple[str, str], ServiceRoute] = {
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
        "signal": s.signals.last(coin_symbol(q.get("coin", "")).removesuffix(QUOTE))
    },
    ("POST", "/signal"): lambda s, _, b: _run_signal(s, b),
    ("GET", "/plan"): lambda s, q, _: _plan(s, q),
    ("GET", "/risk"): lambda s, _q, _b: rules_of(s.store).view(),
    ("PUT", "/risk"): lambda s, _, b: set_rules(s.store, b),
    ("GET", "/alerts"): lambda s, q, _: {
        "alerts": s.store.alerts(_coin(q["coin"]) if q.get("coin") else None)
    },
    ("POST", "/alerts"): lambda s, _, b: _add_alert(s, b),
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


def _failure(error: Exception) -> tuple[int, dict[str, str]]:
    """What the owner sees when a route can't finish, in words they can act on."""
    if isinstance(error, BinanceError):
        return 502, {"error": f"Binance said: {error.message}"}
    if isinstance(error, (Refused, MarketError)):
        return 400, {"error": str(error)}
    if isinstance(error, SignalError):
        return 503, {"error": str(error)}
    return 503, {"error": "Add BINANCE_API_KEY and BINANCE_API_SECRET to .env."}


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
    if open_reply is not None:
        return open_reply
    try:
        if method == "GET" and path == "/portfolio":
            return _reply(200, portfolio())
        if method == "PUT" and path == "/cost":
            return _reply(200, live_set_cost(_body(event)))
        routed = (
            _bot_route(method, path, event, bots)
            or _grid_route(method, path, event, grids)
            or _trading_route(method, path, params, event, trading)
            or _service_route(method, path, params, event, services)
        )
    except (LookupError, Refused, MarketError, SignalError, BinanceError) as error:
        return _reply(*_failure(error))
    return routed or _reply(404, {"error": "Not found."})
