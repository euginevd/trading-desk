import hashlib
import hmac
import json
from pathlib import Path
from urllib.parse import parse_qs

import httpx
import pytest
from api.audit import Audit
from api.binance import TRADES_PAGE, Binance, BinanceError

KEY = "test-key"
SECRET = "test-secret"  # noqa: S105 - made up for the test


def client(reply: httpx.MockTransport) -> httpx.Client:
    return httpx.Client(base_url="https://binance.test", transport=reply)


def binance(transport: httpx.MockTransport, log: Path) -> Binance:
    return Binance(client(transport), (KEY, SECRET), Audit(log), clock=lambda: 1700000000.0)


def test_signed_calls_carry_the_key_and_a_valid_signature(tmp_path: Path) -> None:
    seen: list[httpx.Request] = []

    def reply(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            200, json={"balances": [{"asset": "BTC", "free": "1", "locked": "0"}]}
        )

    balances = binance(httpx.MockTransport(reply), tmp_path / "audit.jsonl").balances()
    assert balances[0]["asset"] == "BTC"
    request = seen[0]
    assert request.headers["X-MBX-APIKEY"] == KEY
    query = request.url.query.decode()
    signed, signature = query.rsplit("&signature=", 1)
    assert signature == hmac.new(SECRET.encode(), signed.encode(), hashlib.sha256).hexdigest()
    assert parse_qs(signed)["timestamp"] == ["1700000000000"]


def test_the_audit_log_records_each_call_without_secrets(tmp_path: Path) -> None:
    log = tmp_path / "audit.jsonl"

    def reply(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[])

    binance(httpx.MockTransport(reply), log).open_orders()
    text = log.read_text()
    entry = json.loads(text)
    assert entry["kind"] == "exchange"
    assert entry["action"] == "Binance: open orders"
    assert entry["result"].startswith("OK")
    assert SECRET not in text
    assert KEY not in text
    assert "signature" not in text


def test_a_refusal_raises_binances_message(tmp_path: Path) -> None:
    def reply(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401, json={"code": -2015, "msg": "Invalid API-key, IP, or permissions."}
        )

    with pytest.raises(BinanceError, match="Invalid API-key"):
        binance(httpx.MockTransport(reply), tmp_path / "audit.jsonl").balances()


def test_no_answer_is_a_plain_error(tmp_path: Path) -> None:
    def reply(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    with pytest.raises(BinanceError, match="didn't answer"):
        binance(httpx.MockTransport(reply), tmp_path / "audit.jsonl").symbols()


def test_trades_follow_every_page(tmp_path: Path) -> None:
    pages = [
        [{"id": i, "time": i} for i in range(TRADES_PAGE)],
        [{"id": TRADES_PAGE, "time": TRADES_PAGE}],
    ]
    asked: list[str] = []

    def reply(request: httpx.Request) -> httpx.Response:
        asked.append(parse_qs(request.url.query.decode())["fromId"][0])
        return httpx.Response(200, json=pages[len(asked) - 1])

    trades = binance(httpx.MockTransport(reply), tmp_path / "audit.jsonl").trades("BTCUSDT")
    assert len(trades) == TRADES_PAGE + 1
    assert asked == ["0", str(TRADES_PAGE)]


def test_tickers_ask_for_the_symbols_as_a_list(tmp_path: Path) -> None:
    def reply(request: httpx.Request) -> httpx.Response:
        symbols = json.loads(parse_qs(request.url.query.decode())["symbols"][0])
        return httpx.Response(200, json=[{"symbol": s, "lastPrice": "1"} for s in symbols])

    tickers = binance(httpx.MockTransport(reply), tmp_path / "a.jsonl").tickers(
        ["BTCUSDT", "ETHUSDT"]
    )
    assert set(tickers) == {"BTCUSDT", "ETHUSDT"}
    assert binance(httpx.MockTransport(reply), tmp_path / "a.jsonl").tickers([]) == {}
