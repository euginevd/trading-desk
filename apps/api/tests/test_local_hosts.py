"""The api answers its own host names only; DESK_HOSTS may add the compose service name and
nothing else, so the paper bot can ask trading-agent without opening the api to other names."""

import importlib

import pytest
from api import local


def test_only_the_api_service_name_can_be_added(monkeypatch: pytest.MonkeyPatch) -> None:
    json = {"content-type": "application/json"}
    assert local.allowed("POST", {"host": "api:8000"} | json) is not None
    monkeypatch.setenv("DESK_HOSTS", "api:8000, evil.example:8000")
    again = importlib.reload(local)
    try:
        assert again.allowed("POST", {"host": "api:8000"} | json) is None
        assert again.allowed("POST", {"host": "evil.example:8000"} | json) is not None
    finally:
        monkeypatch.delenv("DESK_HOSTS")
        importlib.reload(local)
