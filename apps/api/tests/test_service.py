import json
import os
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
from api.audit import Audit
from api.binance import Binance
from api.handler import cost_from_ms, handler
from api.local import load_env
from api.service import TradeCache, aud_rate, fetch, usd_rates


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


def test_a_refresh_reuses_trade_history_until_the_balance_moves(tmp_path: Path) -> None:
    held = {"BTC": "1"}
    asked: list[str] = []

    def replies(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.path)
        if request.url.path == "/api/v3/account":
            return httpx.Response(
                200, json={"balances": [{"asset": "BTC", "free": held["BTC"], "locked": "0"}]}
            )
        return binance_replies(request)

    client = httpx.Client(base_url="https://binance.test", transport=httpx.MockTransport(replies))
    binance = Binance(client, ("k", "s"), Audit(tmp_path / "audit.jsonl"))
    fx = httpx.Client(transport=httpx.MockTransport(fx_replies))
    cache = TradeCache()
    first = fetch(binance, fx, cache=cache)
    assert asked.count("/api/v3/myTrades") == 1
    again = fetch(binance, fx, cache=cache)
    assert asked.count("/api/v3/myTrades") == 1  # nothing traded: history reused
    assert again["total"]["profit"] == first["total"]["profit"]
    held["BTC"] = "2"
    fetch(binance, fx, cache=cache)
    assert asked.count("/api/v3/myTrades") == 2  # the balance moved: fetched again


def test_no_aud_rate_when_the_source_fails() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    assert aud_rate(httpx.Client(transport=httpx.MockTransport(down))) is None
    assert (
        aud_rate(httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500)))) is None
    )


def test_aud_rate_is_live_and_falls_back_to_the_ecb() -> None:
    def live(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.coingecko.com":
            return httpx.Response(
                200,
                json={"tether": {"aud": 1.481135, "inr": 84.5, "last_updated_at": 1794647394}},
            )
        return httpx.Response(200, json={"date": "2026-11-13", "rates": {"AUD": 1.4738}})

    assert aud_rate(httpx.Client(transport=httpx.MockTransport(live))) == (
        Decimal("1.481135"),
        "2026-11-14",
    )

    def ecb_only(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.coingecko.com":
            return httpx.Response(429)
        return httpx.Response(200, json={"date": "2026-11-13", "rates": {"AUD": 1.4738}})

    assert aud_rate(httpx.Client(transport=httpx.MockTransport(ecb_only))) == (
        Decimal("1.4738"),
        "2026-11-13",
    )

    def silly(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.coingecko.com":
            return httpx.Response(200, json={"tether": {"aud": 900, "last_updated_at": 1}})
        return httpx.Response(200, json={"date": "2026-11-13", "rates": {"AUD": 1.4738}})

    assert aud_rate(httpx.Client(transport=httpx.MockTransport(silly))) == (
        Decimal("1.4738"),
        "2026-11-13",
    )


def test_rupees_fall_back_to_the_ecb_alone_when_coingecko_lacks_them() -> None:
    def partial(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.coingecko.com":
            return httpx.Response(200, json={"tether": {"aud": 1.48, "last_updated_at": 1}})
        return httpx.Response(200, json={"date": "2026-11-13", "rates": {"AUD": 1.47, "INR": 84.2}})

    rates = usd_rates(httpx.Client(transport=httpx.MockTransport(partial)))
    assert rates["AUD"][0] == Decimal("1.48")  # live wins
    assert rates["INR"] == (Decimal("84.2"), "2026-11-13")


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
    monkeypatch.setenv("DESK_DB_DIR", str(tmp_path))
    reply = handler({"rawPath": "/portfolio"}, None)
    assert reply["statusCode"] == 200
    body = str(reply["body"])
    assert '"demo": true' in body
    # Binance's 84,754.50 and the TAO wallet's 98.9 TAO (with 1.5 of rewards) at 412.50
    assert '"value": "125550.75"' in body
    assert '"source": "TAO wallet"' in body
    rates = json.loads(body)["total"]["rates"]
    assert rates["USD"] == "1"
    assert rates["AUD"] == "1.4738"
    assert rates["INR"] == "84.21"
    assert 0 < float(rates["BTC"]) < 1  # bitcoins per dollar
    assert body.count('"day"') == 30  # 30 days of account value


def _put_cost(body: dict[str, Any]) -> dict[str, object]:
    event: dict[str, object] = {
        "rawPath": "/cost",
        "requestContext": {"http": {"method": "PUT"}},
        "body": json.dumps(body),
    }
    return handler(event, None)


def test_an_entered_average_cost_gives_the_tao_wallet_its_pnl(
    tmp_path: Path, monkeypatch: Any
) -> None:
    monkeypatch.setenv("DEMO", "1")
    monkeypatch.setenv("AUDIT_LOG_PATH", str(tmp_path / "audit.jsonl"))
    monkeypatch.setenv("DESK_DB_DIR", str(tmp_path))
    saved = _put_cost({"source": "TAO wallet", "asset": "tao", "averageCost": "300"})
    assert saved["statusCode"] == 200
    holdings = json.loads(str(handler({"rawPath": "/portfolio"}, None)["body"]))["holdings"]
    tao = next(h for h in holdings if h["source"] == "TAO wallet")
    # 97.4 TAO bought at 300 and 1.5 TAO of rewards, now 412.50: the rewards cost nothing
    assert tao["amount"] == "98.9"
    assert tao["averageCost"] == "300"
    assert tao["costEntered"] is True
    assert tao["covered"] == "97.4"
    assert tao["profit"] == "11576.25"  # 98.9 x 412.5 - 97.4 x 300
    assert '"cost"' in (tmp_path / "audit.jsonl").read_text()
    assert (
        _put_cost({"source": "TAO wallet", "asset": "TAO", "averageCost": None})["statusCode"]
        == 200
    )
    holdings = json.loads(str(handler({"rawPath": "/portfolio"}, None)["body"]))["holdings"]
    assert next(h for h in holdings if h["source"] == "TAO wallet")["profit"] is None


def test_an_entered_cost_must_be_a_positive_number_for_a_real_holding(
    tmp_path: Path, monkeypatch: Any
) -> None:
    monkeypatch.setenv("AUDIT_LOG_PATH", str(tmp_path / "audit.jsonl"))
    monkeypatch.setenv("DESK_DB_DIR", str(tmp_path))
    for body in (
        {"source": "TAO wallet", "asset": "TAO", "averageCost": "-1"},
        {"source": "TAO wallet", "asset": "TAO", "averageCost": "abc"},
        {"source": "TAO wallet", "asset": "TAO", "averageCost": "NaN"},
        {"source": "Kraken", "asset": "TAO", "averageCost": "1"},
        {"source": "Binance", "asset": "../x", "averageCost": "1"},
    ):
        assert _put_cost(body)["statusCode"] == 400


def test_average_cost_starts_at_the_owners_date(monkeypatch: Any) -> None:
    monkeypatch.delenv("DESK_COST_FROM", raising=False)
    assert cost_from_ms() == 1_782_828_000_000  # 1 Jul 2026, Sydney
    monkeypatch.setenv("DESK_COST_FROM", "2025-07-01")
    assert cost_from_ms() == 1_751_292_000_000
    monkeypatch.setenv("DESK_COST_FROM", "not a date")
    assert cost_from_ms() == 1_782_828_000_000
