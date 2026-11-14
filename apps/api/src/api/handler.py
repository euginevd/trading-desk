"""Lambda-style handler: /health, the portfolio and the trade terminal (decision 10)."""

import json
import os
import re
from collections.abc import Callable, Generator
from contextlib import AbstractContextManager, contextmanager
from pathlib import Path
from typing import Any, cast

import httpx

from api import demo
from api.audit import Audit
from api.binance import Binance, BinanceError
from api.service import fetch
from api.store import Store
from api.trading import Refused, Trading

TIMEOUT_SECONDS = 10
BINANCE_URL = "https://api.binance.com"

Portfolio = Callable[[], dict[str, Any]]
TradingFactory = Callable[[], AbstractContextManager[Trading]]


def _reply(status: int, body: object) -> dict[str, object]:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json", "cache-control": "no-store"},
        "body": json.dumps(body),
    }


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


def live_portfolio() -> dict[str, Any]:
    fx_transport = httpx.MockTransport(demo.fx) if _demo() else None
    with _binance() as binance, httpx.Client(timeout=TIMEOUT_SECONDS, transport=fx_transport) as fx:
        portfolio = fetch(binance, fx)
    if _demo():
        portfolio["demo"] = True
    return portfolio


def store_path() -> Path:
    name = "demo.sqlite" if _demo() else "desk.sqlite"
    return Path(os.environ.get("DESK_DB_DIR", "local")) / name


@contextmanager
def live_trading() -> Generator[Trading]:
    store = Store(store_path())
    try:
        with _binance() as binance:
            yield Trading(binance, store, _audit())
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
    ("GET", "/trade"): lambda desk, q, _: desk.terminal(q.get("symbol", "")),
    ("GET", "/settings"): lambda desk, _q, _b: desk.settings(),
    ("PUT", "/limits"): lambda desk, _, b: desk.set_limits(b.get("perOrder"), b.get("perDay")),
    ("PUT", "/trading"): lambda desk, _, b: desk.set_trading(b.get("on") is True),
    ("POST", "/trades"): lambda desk, _, b: desk.place(b),
}


def _trading_route(
    method: str, path: str, event: dict[str, object], trading: TradingFactory
) -> dict[str, object] | None:
    query = event.get("queryStringParameters")
    params = cast(dict[str, str], query) if isinstance(query, dict) else {}
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


def handler(
    event: dict[str, object],
    context: object,
    portfolio: Portfolio = live_portfolio,
    trading: TradingFactory = live_trading,
) -> dict[str, object]:
    del context
    path = str(event.get("rawPath", "/health"))
    request = cast(dict[str, Any], event.get("requestContext") or {})
    http = cast(dict[str, Any], request.get("http") or {})
    method = str(http.get("method", "GET"))
    if path == "/health":
        return _reply(200, {"status": "ok"})
    try:
        if method == "GET" and path == "/portfolio":
            return _reply(200, portfolio())
        routed = _trading_route(method, path, event, trading)
    except LookupError:
        return _reply(503, {"error": "Add BINANCE_API_KEY and BINANCE_API_SECRET to .env."})
    except Refused as refusal:
        return _reply(400, {"error": str(refusal)})
    except BinanceError as error:
        return _reply(502, {"error": f"Binance said: {error.message}"})
    return routed or _reply(404, {"error": "Not found."})
