"""The api answers its own host names only. DESK_HOSTS may add the compose service name, and
that name reaches one route, trading-agent's verdict on a setup, which places nothing."""

import importlib

import pytest
from api import local

JSON = {"content-type": "application/json"}


def test_the_service_name_reaches_only_the_judge(monkeypatch: pytest.MonkeyPatch) -> None:
    service = {"host": "api:8000"} | JSON
    assert local.allowed("POST", service, "/pot/judge-one") is not None  # off by default
    monkeypatch.setenv("DESK_HOSTS", "api:8000, evil.example:8000")
    again = importlib.reload(local)
    try:
        assert again.allowed("POST", service, "/pot/judge-one") is None
        assert again.allowed("POST", service, "/pot/trades") is not None  # never an order
        assert again.allowed("POST", service, "/pot/trades/close") is not None
        assert again.allowed("GET", service, "/settings") is not None
        from_a_page = service | {"origin": "http://evil.example"}
        assert again.allowed("POST", from_a_page, "/pot/judge-one") is not None
        assert again.allowed("POST", {"host": "evil.example:8000"} | JSON, "/pot/judge-one")
        assert again.allowed("POST", {"host": "127.0.0.1:8000"} | JSON, "/pot/trades") is None
    finally:
        monkeypatch.delenv("DESK_HOSTS")
        importlib.reload(local)
