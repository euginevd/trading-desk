"""Lambda-style handler: /health, and /portfolio for the desk (decision 10)."""

import json
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx

from api import demo
from api.audit import Audit
from api.binance import Binance, BinanceError
from api.service import fetch

TIMEOUT_SECONDS = 10
BINANCE_URL = "https://api.binance.com"

Portfolio = Callable[[], dict[str, Any]]


def _reply(status: int, body: object) -> dict[str, object]:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json", "cache-control": "no-store"},
        "body": json.dumps(body),
    }


def demo_portfolio() -> dict[str, Any]:
    """Made-up replies through the same code path (DEMO=1), for trying the desk without a key."""
    audit = Audit(Path(os.environ.get("AUDIT_LOG_PATH", "local/audit.jsonl")))
    with (
        httpx.Client(base_url=BINANCE_URL, transport=httpx.MockTransport(demo.binance)) as client,
        httpx.Client(transport=httpx.MockTransport(demo.fx)) as fx,
    ):
        portfolio = fetch(Binance(client, ("demo", "demo"), audit), fx)
    portfolio["demo"] = True
    return portfolio


def live_portfolio() -> dict[str, Any]:
    """Reads the key from the environment, which locally is the owner's .env; never logged."""
    if os.environ.get("DEMO") == "1":
        return demo_portfolio()
    key = os.environ.get("BINANCE_API_KEY", "")
    secret = os.environ.get("BINANCE_API_SECRET", "")
    if not key or not secret:
        raise LookupError
    audit = Audit(Path(os.environ.get("AUDIT_LOG_PATH", "local/audit.jsonl")))
    base = os.environ.get("BINANCE_BASE_URL", BINANCE_URL)
    with (
        httpx.Client(base_url=base, timeout=TIMEOUT_SECONDS) as client,
        httpx.Client(timeout=TIMEOUT_SECONDS) as fx,
    ):
        return fetch(Binance(client, (key, secret), audit), fx)


def handler(
    event: dict[str, object], context: object, portfolio: Portfolio = live_portfolio
) -> dict[str, object]:
    del context
    path = str(event.get("rawPath", "/health"))
    if path == "/portfolio":
        try:
            return _reply(200, portfolio())
        except LookupError:
            return _reply(503, {"error": "Add BINANCE_API_KEY and BINANCE_API_SECRET to .env."})
        except BinanceError as error:
            return _reply(502, {"error": f"Binance said: {error.message}"})
    if path == "/health":
        return _reply(200, {"status": "ok"})
    return _reply(404, {"error": "Not found."})
