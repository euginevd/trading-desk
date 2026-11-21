import ipaddress
import json
from collections.abc import Generator, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import httpx
import pytest
from api import demo, local
from api.audit import Audit
from api.binance import Binance
from api.handler import handler
from api.local import allowed
from api.store import Store
from api.trading import Refused, Trading

NOW = 1_794_000_000.0


@pytest.fixture
def desk(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Trading]:
    monkeypatch.setattr(demo, "EXCHANGE", demo.Exchange())
    client = httpx.Client(
        base_url="https://binance.test", transport=httpx.MockTransport(demo.binance)
    )
    audit = Audit(tmp_path / "audit.jsonl")
    store = Store(tmp_path / "desk.sqlite")
    yield Trading(Binance(client, ("k", "s"), audit), store, audit, clock=lambda: NOW)
    store.close()


def ready(desk: Trading) -> Trading:
    desk.set_limits("100", "500")
    return desk


def change(**fields: Any) -> dict[str, Any]:
    """A change to the demo's standing BTC limit buy (order 1, 0.001 at 94,000)."""
    base: dict[str, Any] = {
        "symbol": "BTCUSDT",
        "orderId": "1",
        "price": "93000",
        "amount": "0.001",
        "clientId": "a1b2c3d4-0000-0000-0000-0000000000ed",
    }
    return {**base, **fields}


def test_nothing_changes_until_the_limits_are_set(desk: Trading) -> None:
    with pytest.raises(Refused, match="limits first"):
        desk.edit_order(change())


def test_the_limits_are_checked_and_kept(desk: Trading) -> None:
    with pytest.raises(Refused, match="can't be more than the daily"):
        desk.set_limits("600", "500")
    settings = ready(desk).settings()
    assert (settings["perOrder"], settings["perDay"], settings["leftToday"]) == (
        "100",
        "500",
        "500",
    )
    assert settings["tradingOn"] is True
    assert desk.set_trading(False)["tradingOn"] is False


def test_an_open_order_can_be_changed_in_one_step(desk: Trading) -> None:
    standing = demo.EXCHANGE.orders[1]
    done = ready(desk).edit_order(change())
    assert done["message"] == "Order changed: buy 0.001 BTC/USDT at 93000."
    assert standing["status"] == "CANCELED"
    new = demo.EXCHANGE.orders[done["orderId"]]
    assert (new["price"], new["origQty"], new["status"]) == ("93000", "0.001", "NEW")


def test_a_change_keeps_to_the_limits_and_the_kill_switch(desk: Trading) -> None:
    ready(desk)  # 100 an order
    with pytest.raises(Refused, match="per-order limit"):
        desk.edit_order(change(price="94000", amount="0.002"))
    desk.set_trading(False)
    with pytest.raises(Refused, match="Trading is off"):
        desk.edit_order(change())
    assert demo.EXCHANGE.orders[1]["status"] == "NEW"


def test_every_change_and_setting_is_in_the_audit_log(desk: Trading, tmp_path: Path) -> None:
    ready(desk).edit_order(change())
    kinds = [
        json.loads(line)["kind"] for line in (tmp_path / "audit.jsonl").read_text().splitlines()
    ]
    assert "settings" in kinds
    assert "order" in kinds


def test_the_routes_reply_in_plain_words(desk: Trading) -> None:
    @contextmanager
    def factory() -> Generator[Trading]:
        yield desk

    def call(method: str, path: str, body: object = None) -> dict[str, object]:
        event: dict[str, object] = {
            "rawPath": path,
            "requestContext": {"http": {"method": method}},
            "body": json.dumps(body) if body is not None else None,
        }
        return handler(event, None, trading=factory)

    assert call("POST", "/orders/edit", change())["statusCode"] == 400
    assert call("PUT", "/limits", {"perOrder": "100", "perDay": "500"})["statusCode"] == 200
    assert call("POST", "/orders/edit", change())["statusCode"] == 200
    assert call("GET", "/settings")["statusCode"] == 200
    off = call("PUT", "/trading", {"on": False})
    assert off["statusCode"] == 200
    assert json.loads(str(off["body"]))["stillLive"] == 0
    for gone in ("/trades", "/orders", "/orders/ladder", "/trades/1/close"):
        assert call("POST", gone, {})["statusCode"] == 404  # the old smart trades: deleted
    assert call("GET", "/trade")["statusCode"] == 404


def test_the_local_api_takes_changes_only_from_the_desk() -> None:
    desk_page = {"host": "127.0.0.1:5173", "origin": "http://127.0.0.1:5173"}
    assert allowed("POST", {**desk_page, "content-type": "application/json"}) is None
    assert allowed("GET", {"host": "127.0.0.1:8000"}) is None
    assert allowed("POST", {**desk_page, "content-type": "text/plain"}) == "Send JSON."
    other = {"host": "127.0.0.1:5173", "origin": "https://evil.example"}
    assert allowed("POST", {**other, "content-type": "application/json"}) == "Unknown origin."
    assert allowed("GET", {"host": "evil.example:8000"}) == "Unknown host."


def test_the_freqtrade_containers_reach_one_route_whatever_their_headers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Audit 18: a container can send the desk's own Host header; its network gives it away."""
    monkeypatch.setattr(local, "BOTS_NET", ipaddress.ip_network("172.30.250.0/24"))
    monkeypatch.setattr(local, "SERVICE_ON", True)
    posing = {"host": "127.0.0.1:8000", "content-type": "application/json"}
    bot = "172.30.250.7"
    assert allowed("POST", posing, "/dca/orders", bot) == "Unknown host."
    assert allowed("GET", posing, "/settings", bot) == "Unknown host."
    service = {"host": local.SERVICE, "content-type": "application/json"}
    assert allowed("POST", service, "/pot/judge-one", bot) is None
    assert allowed("POST", service, "/dca/orders", bot) == "Unknown host."
    assert allowed("POST", posing, "/dca/orders", "172.18.0.3") is None  # the desk's network
