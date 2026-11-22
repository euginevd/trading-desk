from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from api import risk_big
from api.store import Store

# Made-up figures only (known-mistakes 7). Values are US$, at A$1.5.
NOW = 1_795_000_000_000  # Nov 2026
DAY = risk_big.DAY_MS
PLAN = {"orders": [{"coin": "BTC", "spend": "300"}, {"coin": "ETH", "spend": "100"}]}


def by_key(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {r["key"]: r for r in rows}


def folio(*holdings: dict[str, Any]) -> dict[str, Any]:
    return {"total": {"audRate": "1.5"}, "holdings": list(holdings)}


def h(asset: str, value: str, source: str = "Binance", **kw: Any) -> dict[str, Any]:
    return {"asset": asset, "source": source, "value": value, "price": "100", **kw}


def test_everything_on_binance_counts_and_one_move_meets_both_rules() -> None:
    rows = by_key(
        risk_big.big_four(
            folio(
                h("BTC", "6000"),  # A$9,000
                h("ETH", "2000"),  # A$3,000
                h("USDC", "1000"),  # A$1,500, counts too
                h("BTC", "400", "Ledger"),  # A$600
            ),
            PLAN,
            {},
            NOW,
        )
    )
    ex = rows["big-exchange"]
    assert ex["state"] == "broken"
    assert ex["figure"] == "A$13,500"
    assert ex["detail"]["stablesAud"] == "1500.00"
    # 70% of A$12,600 is A$8,820 on the Ledger: A$8,220 more, beyond the A$3,500 the cap needs.
    assert ex["detail"]["moveAud"] == "8300.00"
    assert [m["coin"] for m in ex["detail"]["moves"]] == ["BTC"]
    cold = rows["big-cold"]
    assert cold["state"] == "broken"
    assert cold["figure"] == "5%"


def test_no_ledger_yet_reads_as_not_set_up() -> None:
    rows = by_key(risk_big.big_four(folio(h("BTC", "1000")), PLAN, {}, NOW))
    assert rows["big-exchange"]["state"] == "kept"
    assert rows["big-cold"]["figure"] == "Not set up"
    assert rows["big-cold"]["state"] == "broken"
    assert (risk_big.lead(list(rows.values())) or "").startswith("No Ledger addresses yet")


def test_taos_glide_path_with_new_money_only_and_its_pnl() -> None:
    tao = h("TAO", "7000", "Ledger", profit="-3000")
    rows = by_key(risk_big.big_four(folio(tao, h("BTC", "3000")), PLAN, {}, NOW))
    t = rows["big-tao"]
    assert t["figure"] == "70%"
    # 60% needs A$7,000 of other coins for each A$10,500 of TAO: A$2,500 more, at A$600 a week.
    assert t["detail"]["weeks"] == 5
    assert t["detail"]["onTrack"] is True
    assert t["state"] == "near"
    assert t["detail"]["pnlAud"] == "-4500.00"
    assert t["detail"]["costAud"] == "15000.00"
    assert t["detail"]["thesisDue"] is True
    nothing = by_key(risk_big.big_four(folio(tao, h("BTC", "3000")), {"orders": []}, {}, NOW))
    assert nothing["big-tao"]["state"] == "broken"  # no new money: off its path


def test_backup_checks_keep_dates_only_and_fall_due(tmp_path: Path) -> None:
    store = Store(tmp_path / "desk.sqlite")
    try:
        rows = by_key(risk_big.big_four(folio(), PLAN, risk_big.checks_of(store), NOW))
        assert rows["big-backup"]["state"] == "broken"  # never confirmed
        for key in ("seed", "place", "pin", "heirs"):
            risk_big.mark(store, key, NOW - 200 * DAY)
        rows = by_key(risk_big.big_four(folio(), PLAN, risk_big.checks_of(store), NOW))
        backup = rows["big-backup"]
        assert backup["state"] == "near"
        assert backup["figure"] == "1 of 4"  # the inheritance plan doesn't expire
        risk_big.mark(store, "thesis", NOW)
        assert risk_big.checks_of(store)["thesis"] == NOW
        with pytest.raises(ValueError, match="Name a check"):
            risk_big.mark(store, "seed words", NOW)
    finally:
        store.close()


def test_the_lead_names_whats_broken_first() -> None:
    rows = risk_big.big_four(
        folio(h("BTC", "8000"), h("BTC", "100", "Ledger")), PLAN, {"seed": NOW}, NOW
    )
    said = risk_big.lead(rows) or ""
    assert said.startswith("A$2,000 over your Binance limit and ")
    assert Decimal(rows[0]["value"]) == Decimal("12000.00")
