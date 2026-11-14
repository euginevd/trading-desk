import os
from pathlib import Path
from typing import Any

import httpx
from api.audit import Audit
from api.binance import Binance
from api.handler import handler
from api.local import load_env
from api.service import aud_rate, fetch


def binance_replies(request: httpx.Request) -> httpx.Response:
    """Recorded-style Binance replies for a small account (known-mistakes 29)."""
    path = request.url.path
    if path == "/api/v3/account":
        return httpx.Response(
            200,
            json={
                "balances": [
                    {"asset": "BTC", "free": "1", "locked": "0"},
                    {"asset": "USDT", "free": "50", "locked": "0"},
                ]
            },
        )
    if path == "/api/v3/ticker/price":
        return httpx.Response(200, json=[{"symbol": "BTCUSDT", "price": "200"}])
    if path == "/api/v3/ticker/24hr":
        return httpx.Response(
            200, json=[{"symbol": "BTCUSDT", "lastPrice": "200", "priceChangePercent": "0"}]
        )
    if path == "/api/v3/myTrades":
        return httpx.Response(
            200,
            json=[
                {
                    "symbol": "BTCUSDT",
                    "id": 1,
                    "time": 1,
                    "price": "100",
                    "qty": "1",
                    "quoteQty": "100",
                    "commission": "0",
                    "commissionAsset": "USDT",
                    "isBuyer": True,
                }
            ],
        )
    if path == "/api/v3/openOrders":
        return httpx.Response(200, json=[])
    return httpx.Response(404)


def fx_replies(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"date": "2026-11-13", "rates": {"AUD": 1.5}})


def test_fetch_puts_the_portfolio_together(tmp_path: Path) -> None:
    client = httpx.Client(
        base_url="https://binance.test", transport=httpx.MockTransport(binance_replies)
    )
    binance = Binance(client, ("k", "s"), Audit(tmp_path / "audit.jsonl"))
    fx = httpx.Client(transport=httpx.MockTransport(fx_replies))
    data = fetch(binance, fx)
    assert data["total"]["value"] == "250"
    assert data["total"]["aud"] == "375"
    assert data["total"]["profit"] == "100"
    assert "fetchedAt" in data
    assert len((tmp_path / "audit.jsonl").read_text().splitlines()) == 5


def test_no_aud_rate_when_the_source_fails() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    assert aud_rate(httpx.Client(transport=httpx.MockTransport(down))) is None
    assert (
        aud_rate(httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500)))) is None
    )


def test_portfolio_route_returns_the_data() -> None:
    reply = handler({"rawPath": "/portfolio"}, None, portfolio=lambda: {"total": {"value": "1"}})
    assert reply["statusCode"] == 200


def test_portfolio_route_asks_for_the_key_when_missing() -> None:
    def missing() -> dict[str, Any]:
        raise LookupError

    reply = handler({"rawPath": "/portfolio"}, None, portfolio=missing)
    assert reply["statusCode"] == 503
    assert ".env" in str(reply["body"])


def test_unknown_routes_are_not_found() -> None:
    assert handler({"rawPath": "/other"}, None)["statusCode"] == 404


def test_load_env_sets_only_what_is_unset(tmp_path: Path, monkeypatch: Any) -> None:
    env = tmp_path / ".env"
    env.write_text('# comment\nTD_ONE="first"\nTD_TWO=second\nnot a line\n')
    monkeypatch.setenv("TD_TWO", "kept")
    monkeypatch.delenv("TD_ONE", raising=False)
    load_env(env)
    assert os.environ["TD_ONE"] == "first"
    assert os.environ["TD_TWO"] == "kept"
    load_env(tmp_path / "missing")


def test_demo_mode_runs_the_whole_path(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setenv("DEMO", "1")
    monkeypatch.setenv("AUDIT_LOG_PATH", str(tmp_path / "audit.jsonl"))
    reply = handler({"rawPath": "/portfolio"}, None)
    assert reply["statusCode"] == 200
    assert '"demo": true' in str(reply["body"])
    assert '"value": "84754.5"' in str(reply["body"])
