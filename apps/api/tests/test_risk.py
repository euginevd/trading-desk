from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from api import my_agents, risk
from api.store import Store

# Made-up figures only (known-mistakes 7).
SYDNEY = my_agents.SYDNEY
TUESDAY = datetime(2026, 11, 17, 21, 0, tzinfo=SYDNEY)
MONDAY_LATE = datetime(2026, 11, 16, 17, 30, tzinfo=SYDNEY)


def by_key(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {r["key"]: r for r in rows}


def pot(**kw: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "putIn": "100",
        "value": "100",
        "openRisk": "0",
        "monthResult": "0",
        "config": {"mode": "test", "fixed": "10", "riskPct": "1"},
        "trades": [],
    }
    return base | kw


def test_the_pots_limits_are_kept_near_or_broken() -> None:
    assert risk.pot_limits(pot(putIn="0")) == []  # nothing put in: nothing to watch
    calm = by_key(risk.pot_limits(pot()))
    assert {r["state"] for r in calm.values()} == {"kept"}
    trades = [
        {"status": "open", "coin": "SOL", "risk": "0.9"},
        {"status": "waiting", "coin": "ETH", "risk": "1.2"},
    ]
    rows = by_key(risk.pot_limits(pot(value="95", openRisk="2.7", monthResult="-5", trades=trades)))
    assert rows["pot-trade-risk"]["state"] == "broken"  # 1.2 of 95 is over 1%
    assert rows["pot-open-risk"]["state"] == "near"  # 2.84%: past 2.55, under 3
    assert rows["pot-trades"]["figure"] == "2, 2 alts"
    assert rows["pot-month"]["state"] == "near"  # 5% lost: past 4.5, under 6
    assert rows["pot-drawdown"]["figure"] == "5.0%"
    assert rows["pot-drawdown"]["state"] == "kept"
    assert rows["pot-month"]["rule"] == "5.4.4"


def test_the_dca_book_watches_its_mix_and_mondays_close_out() -> None:
    dca = {
        "plan": {
            "orders": [
                {"coin": "BTC", "spend": "300"},
                {"coin": "ETH", "spend": "75"},
                {"coin": "SOL", "spend": "75"},
            ]
        },
        # BTC is 50% against a 66.7% target: 16.7 points off.
        "positions": [
            {"coin": "BTC", "value": "100"},
            {"coin": "ETH", "value": "50"},
            {"coin": "SOL", "value": "50"},
        ],
    }
    rows = by_key(risk.dca_limits(dca, 2, TUESDAY))
    assert rows["dca-mix"]["state"] == "near"
    assert rows["dca-mix"]["figure"] == "BTC 16.7 points off"
    assert rows["dca-week"]["state"] == "kept"  # Tuesday: they have till Monday
    assert by_key(risk.dca_limits(dca, 2, MONDAY_LATE))["dca-week"]["state"] == "near"
    assert by_key(risk.dca_limits(dca, 0, MONDAY_LATE))["dca-week"]["figure"] == "All filled"


def test_deposits_and_the_portfolio() -> None:
    assert risk.deposit_limits({"capAud": None}) == []
    near = risk.deposit_limits({"monthAud": "6500", "capAud": "7000"})[0]
    assert near["state"] == "near"
    assert risk.deposit_limits({"monthAud": "7500", "capAud": "7000"})[0]["state"] == "broken"
    portfolio = {
        "total": {"value": "480000", "audRate": "1.5"},
        "holdings": [
            {"asset": "TAO", "source": "TAO wallet", "value": "8000"},
            {"asset": "BTC", "source": "Binance", "value": "4000"},
            {"asset": "USDC", "source": "Binance", "value": "9000"},
        ],
    }
    rows = by_key(risk.portfolio_limits(portfolio))
    assert rows["tao-share"]["figure"] == "66.7%"  # stablecoins aren't crypto here
    assert rows["custody"]["figure"] == "BTC A$6,000"
    assert rows["custody"]["state"] == "near"  # over A$5K on Binance
    assert rows["take-profit"]["state"] == "near"  # US$480K is within 5% of US$500K
    assert rows["take-profit"]["of"] == "US$500,000: move 20% out"


def test_the_sentence_and_alerts_only_when_worse(tmp_path: Path) -> None:
    store = Store(tmp_path / "desk.sqlite")
    try:
        kept = risk.deposit_limits({"monthAud": "1000", "capAud": "7000"})
        near = risk.deposit_limits({"monthAud": "6500", "capAud": "7000"})
        over = risk.deposit_limits({"monthAud": "7500", "capAud": "7000"})
        assert risk.sentence(kept) == "Every rule kept."
        assert risk.sentence(near) == "Every rule kept; 1 near a limit: deposits this month."
        names = [{**near[0], "name": "Largest coin on Binance"}, {**near[0], "name": "TAO's share"}]
        assert risk.sentence(names) == (
            "Every rule kept; 2 near a limit: largest coin on Binance, TAO's share."
        )
        assert risk.sentence(over) == "1 broken: deposits this month."
        assert risk.changes(store, kept) == []
        assert [r["state"] for r in risk.changes(store, near)] == ["near"]
        assert risk.changes(store, near) == []  # said once, not every evening
        text = risk.alert_text(risk.changes(store, over))
        assert text.startswith("risk-agent:\nRule broken: Deposits this month: A$7,500")
        assert "(Profile 5.2.4)" in text
        assert risk.changes(store, kept) == []
        assert risk.changes(store, near)  # slipped back: warns again
    finally:
        store.close()


class Fake:
    def __init__(self, reply: dict[str, Any]) -> None:
        self.reply = reply
        self.asked: list[str] = []

    def step(self, _system: str, prompt: str, *_a: object, **_k: object) -> Any:
        self.asked.append(prompt)
        return self.reply, Decimal(0), "fake"


def test_the_weekly_review_is_written_from_the_board_and_kept(tmp_path: Path) -> None:
    store = Store(tmp_path / "desk.sqlite")
    try:
        rows = risk.deposit_limits({"monthAud": "6500", "capAud": "7000"})
        fake = Fake(
            {
                "headline": "Deposits are near the cap.",
                "sections": [{"title": "Deposits", "text": "A$6,500 of A$7,000."}],
                "action": "Hold deposits till the 1st.",
            }
        )
        kept = risk.review(store, fake, rows, 1, None)  # type: ignore[arg-type]
        assert kept["headline"] == "Deposits are near the cap."
        assert risk.last_review(store) == kept
        assert "A$6,500" in fake.asked[0]
        with pytest.raises(LookupError):
            risk.review(store, None, rows, 1)
    finally:
        store.close()
