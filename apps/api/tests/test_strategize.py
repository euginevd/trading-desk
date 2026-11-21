"""Strategize with the agent (owner, 21 Nov 2026): the desk's figures in, the whole plan out."""

from collections.abc import Iterator
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest
from api import demo
from api.audit import Audit
from api.binance import Binance
from api.store import Store
from api.strategize import Strategist
from api.trading import Refused, Trading

NOW = 1_794_000_000.0


class Fake:
    def __init__(self, reply: dict[str, Any]) -> None:
        self.reply = reply
        self.asked: list[dict[str, Any]] = []

    def step(self, *args: object, **kw: Any) -> tuple[dict[str, Any], Decimal, str]:
        self.asked.append({"prompt": args[1], **kw})
        return self.reply, Decimal(0), "fake"


@pytest.fixture
def desk(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Trading]:
    monkeypatch.setattr(demo, "EXCHANGE", demo.Exchange())
    client = httpx.Client(
        base_url="https://binance.test", transport=httpx.MockTransport(demo.binance)
    )
    audit = Audit(tmp_path / "audit.jsonl")
    trading = Trading(
        Binance(client, ("k", "s"), audit), Store(tmp_path / "d.sqlite"), audit, clock=lambda: NOW
    )
    yield trading
    client.close()


def test_the_agent_is_given_the_coins_levels_and_hands_back_the_plan(desk: Trading) -> None:
    fake = Fake(
        {
            "reply": "Just above the 30-day low.",
            "rows": [{"price": "190", "amount": "10", "why": "30-day low"}],
        }
    )
    said = Strategist(desk, fake).chat(  # type: ignore[arg-type]
        {
            "book": "trade",
            "mode": "add",
            "coin": "SOL",
            "message": "Key support levels",
            "rows": [{"price": "200", "amount": "10", "why": "Entry"}],
            "history": [],
        }
    )
    assert said["rows"] == [{"price": "190", "amount": "10", "why": "30-day low"}]
    assert said["by"] == "trading-agent"
    prompt = str(fake.asked[0]["prompt"])
    assert '"support"' in prompt
    assert '"oddsFromHere"' in prompt
    assert "Key support levels" in prompt


def test_the_agent_needs_a_question_and_an_ai(desk: Trading) -> None:
    with pytest.raises(Refused, match="Ask something"):
        Strategist(desk, Fake({})).chat({"coin": "SOL", "message": ""})  # type: ignore[arg-type]
    with pytest.raises(Refused, match="No AI"):
        Strategist(desk, None).chat({"coin": "SOL", "message": "Why?"})
