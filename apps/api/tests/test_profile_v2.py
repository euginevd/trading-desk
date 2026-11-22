"""profile.md v2 (decision 62): the owner's own Markdown is the Profile, its figures feed the
four widgets, and the command bar changes it through a diff and Accept. Made-up figures only."""

import json
from collections.abc import Generator, Iterator
from contextlib import contextmanager
from datetime import date
from decimal import Decimal as D
from pathlib import Path
from typing import Any

import httpx
import pytest
from api import demo, handler, md_files, profile, profile_board, profile_md, profile_v2
from api.ai_signal import Signals
from api.audit import Audit
from api.binance import Binance
from api.handler import Services
from api.store import Store
from api.trading import Refused, Trading

NOW = 1_794_000_000_000
TODAY = date(2026, 11, 16)  # a Monday
SAMPLE = """# Profile
- Name: Sam | Born 01-02-1990 (age 36)
- Version: v1 | Last updated: 1 Nov 2026
- For agents: this is the source of truth.

## 1. Income (monthly)
1. **Available to invest: ~A$4K**

## 2. Goals
1. **US$1M by 31 Dec 2030** (age 40), then never drop below it
2. **US$5M by 31 Dec 2050** (age 60): retirement
4. Milestones: US$150K by 31 Dec 2027 | US$400K by 31 Dec 2028
3. Counts toward goals: TAO + Binance crypto + emergency fund

## 3. Risk profile
1. Overall: **Aggressive** | high risk
2. Guardrail: **Rules (6) and automation decide** | no panic

## 4. Foundations
1. Emergency fund (6 months): **~A$12K of A$20K**
2. Parked company money: tax ~A$5K pa | **~A$8K**
3. Minimum cash (1 + 2): **~A$20K of A$40K** | savings 5.0% | ~A$1K pa interest

## 5. Strategy
### 5.1 Overall
1. **A$40K minimum cash first.**
2. Monthly: **up to A$3K invested** | ~A$1K to savings until A$40K
3. Focus: **crypto only** for now | patient

### 5.2 Weekly DCA
1. **A$500 every Friday evening**: bank → Binance
2. Limit orders first
3. Not filled by Monday: market buy
4. Fear & Greed below 40: extra A$250, 2 days after | **max A$750 a week, A$3K a month**

### 5.3 Portfolio
1. TAO: ~70% of crypto | no new money, not rebalanced
2. High-conviction holds: **BTC (target 1 BTC)** | ETH
3. 2026 split: **BTC 60%** | ETH, SOL 20% each → weekly A$300 BTC + A$100 each
4. Rebalance: weekly | quarterly check, ±5 point bands

## 6. Rules
1. **No leverage, futures or margin**
2. **Sell only on a written thesis break** | never on a red day
3. **Take profit at US$500K and US$1M** | move 20% of the portfolio each time
4. **Self-custody** | a coin moves to the Ledger once it's over A$2K
5. **Speculation max 5%** | written exit first

## 8. Holdings (1 Nov 2026)
1. TAO: invested ~A$30K | now ~A$21K
2. Binance crypto: invested ~A$9K | now ~A$7K
3. **Counts toward goals: ~A$40K (~US$26K)**
4. Super (locked, not counted): **~A$50K**

## 9. Lessons
1. **2018 First cycle:** bought the top → buy in steps
2. **2020 Panic:** sold the dip → hold
3. **2021 Peak:** no profit taken → take profit at milestones

## 10. Open items
1. Exit trigger per coin: **not set**
2. Health cover: **not chosen**

---

## Appendix: Notes
- Notes the desk doesn't read
"""


def portfolio() -> dict[str, Any]:
    return {
        "total": {"value": "30000", "rates": {"AUD": "1.5"}, "audDate": "2026-11-16"},
        "holdings": [
            {"asset": "TAO", "source": "Ledger", "value": "14000", "price": "400"},
            {
                "asset": "BTC",
                "source": "Binance",
                "amount": "0.2",
                "value": "12000",
                "price": "60000",
            },
            {"asset": "ETH", "source": "Binance", "amount": "1", "value": "4000", "price": "4000"},
        ],
    }


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    kept = Store(tmp_path / "desk.sqlite")
    yield kept
    kept.close()


@pytest.fixture
def audit(tmp_path: Path) -> Audit:
    return Audit(tmp_path / "audit.jsonl")


def test_the_file_reads_into_figures_and_the_typed_profile() -> None:
    v = profile_v2.values(SAMPLE)
    assert (v["name"], v["born"], v["risk"]) == ("Sam", date(1990, 2, 1), "Aggressive")
    assert v["cash"] | {"rate": None} == {
        "emergency": D(12000),
        "emergencyTarget": D(20000),
        "parked": D(8000),
        "floor": D(40000),
        "monthlyIn": D(1000),
        "rate": None,
    }
    assert v["dca"] == {
        "weekly": D(500),
        "day": "Friday",
        "extra": D(250),
        "fearGreedBelow": 40,
        "maxWeek": D(750),
        "maxMonth": D(3000),
        "investMonthly": D(3000),
        "btcWeekly": D(300),
        "extraAfterDays": 2,
    }
    assert v["split"] == ["BTC 60%", "ETH, SOL 20% each"]
    assert v["chips"] == [
        "No leverage",
        "Sell only on thesis break",
        "Take 20% at 500K and 1M",
        "Memes max 5%",
        "Ledger over A$2K",
    ]
    assert (len(v["openItems"]), v["lessons"][2]["title"]) == (2, "2021 Peak")
    doc = profile_md.parse(SAMPLE)  # through the same door as the file and import
    assert doc["markdown"] == SAMPLE
    assert doc["rules"]["monthly_deposit_cap_aud"] == "3000"
    assert doc["rules"]["per_trade_aud"] == "500"
    assert doc["strategy"]["targets"] == [
        {"coin": "BTC", "pct": "60"},
        {"coin": "ETH", "pct": "20"},
        {"coin": "SOL", "pct": "20"},
    ]
    counted = [h["name"] for h in doc["holdings"] if h["counts"]]
    assert counted == ["Ledger", "Binance", "Emergency fund"]  # never parked tax or super


def test_agents_get_the_file_with_an_age_not_a_birthday() -> None:
    text = profile_v2.for_agents(SAMPLE, TODAY)
    assert "- Name: Sam | age 36" in text
    assert "1990" not in text
    assert text.replace("- Name: Sam | age 36", "") == SAMPLE.replace(
        "- Name: Sam | Born 01-02-1990 (age 36)", ""
    )


def test_a_file_that_lost_its_shape_is_refused() -> None:
    with pytest.raises(Refused, match="numbered sections"):
        profile_v2.parse("# Profile\nJust notes.")
    with pytest.raises(Refused, match="No goal"):
        profile_v2.parse(SAMPLE.replace("US$1M by 31 Dec 2030", "a million").replace("US$5M", "x"))


def test_the_board_works_out_the_four_widgets() -> None:
    b = profile_board.board(profile_v2.values(SAMPLE), portfolio(), D("1.5"), TODAY, bought=True)
    road = b["road"]
    # TAO A$21,000 + Binance A$24,000 + emergency A$12,000 = A$57,000 = US$38,000
    assert (road["totalAud"], road["totalUsd"], road["pct"]) == ("57000", "38000", "3.8")
    assert road["onTrack"] is True  # the path from US$26K on 1 Nov 2026 to US$150K is ~US$30.4K
    assert road["leg"] == {
        "fromUsd": "0",
        "toUsd": "150000",
        "year": 2027,
        "pct": "25.3",
        "toGoUsd": "112000",
        "monthsLeft": 13,
    }
    assert [(t["usd"], t["state"]) for t in road["ticks"]] == [
        ("150000", "next"),
        ("400000", ""),
        ("1000000", ""),
    ]
    assert len(profile_v2.values(SAMPLE)["goals"]) == 2  # the milestones line isn't a goal
    assert road["path"] == [
        {"date": "2026-11-01", "usd": "26000"},
        {"date": "2027-12-31", "usd": "150000"},
        {"date": "2028-12-31", "usd": "400000"},
        {"date": "2030-12-31", "usd": "1000000"},
    ]
    assert road["today"] == "2026-11-16"
    assert (road["then"], road["thenPct"]) == ({"usd": "5000000", "year": 2050}, "0.8")
    stack = b["stack"]
    assert (stack["held"], stack["pct"], stack["valueAud"]) == ("0.2", "20", "18000")
    assert stack["leg"] == {
        "from": "0.1",
        "to": "0.25",
        "pct": "66.7",
        "toGo": "0.05",
        "weeksLeft": 15,  # 0.05 BTC at A$90,000 is A$4,500: 15 Fridays at A$300
    }
    assert stack["projected"] == "2031-06-20"  # 240 Fridays from 20 Nov 2026
    cash = b["cash"]
    assert (cash["totalAud"], cash["pct"], cash["shortAud"], cash["full"]) == (
        "20000",
        "50",
        "20000",
        False,
    )
    assert cash["projected"] == "2028-07"  # A$20K short at A$1K a month
    assert cash["emergency"] == {"targetAud": "20000", "pct": "60", "toGoAud": "8000", "months": 8}
    s = b["summary"]
    assert (s["name"], s["age"], s["subline"]) == (
        "Sam",
        36,
        "Crypto only for now · rules and automation decide",
    )
    assert (s["goalPct"], s["cash"]["below"], s["lesson"]["title"]) == ("3.8", True, "2021 Peak")


def test_the_board_without_live_figures_still_shows_the_plan() -> None:
    b = profile_board.board(profile_v2.values(SAMPLE), None, D("1.5"), TODAY, bought=None)
    assert (b["road"]["known"], b["stack"]["known"]) == (False, False)
    assert b["cash"]["totalAud"] == "20000"  # cash comes from the file


def test_an_edit_to_the_file_is_a_version_with_a_line_summary(store: Store, audit: Audit) -> None:
    store.profile_md.write_text(SAMPLE, encoding="utf-8")
    md_files.sync(store, audit, NOW)
    n, doc = profile.current(store)
    assert (n, doc["identity"]["name"]) == (1, "Sam")
    edited = store.profile_md.read_text(encoding="utf-8").replace(
        "~A$12K of A$20K", "~A$15K of A$20K"
    )
    store.profile_md.write_text(edited, encoding="utf-8")
    md_files.sync(store, audit, NOW + 1)
    assert profile.current(store)[0] == 2  # noqa: PLR2004
    summary = profile.history(store)[0]["summary"]
    assert summary == "Emergency fund (6 months) ~A$12K of A$20K → ~A$15K of A$20K"
    assert "- Version: v2 |" in store.profile_md.read_text(encoding="utf-8")  # stamped
    md_files.sync(store, audit, NOW + 2)
    assert profile.current(store)[0] == 2  # noqa: PLR2004 - its own write isn't a change


def test_a_v1_profile_moves_to_v2_when_the_file_is_replaced(store: Store, audit: Audit) -> None:
    old = profile.empty()
    old["identity"]["name"] = "Sam"
    profile.save(store, audit, old, author=profile.OWNER, now=NOW)
    md_files.sync(store, audit, NOW)
    store.profile_md.write_text(SAMPLE, encoding="utf-8")
    md_files.sync(store, audit, NOW + 1)
    n, doc = profile.current(store)
    assert (n, bool(doc["markdown"])) == (2, True)
    assert profile.history(store)[0]["summary"] == "profile.md rewritten"


@pytest.fixture
def call(store: Store, audit: Audit, monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setattr(demo, "EXCHANGE", demo.Exchange())
    binance = Binance(
        httpx.Client(base_url="https://binance.test", transport=httpx.MockTransport(demo.binance)),
        ("k", "s"),
        audit,
    )
    replies: list[dict[str, Any]] = []

    def ask(_s: str, text: str, _shape: dict[str, Any]) -> tuple[dict[str, Any], D]:
        assert "1990" not in text  # the model never sees the date of birth
        return replies.pop(0), D(0)

    @contextmanager
    def services() -> Generator[Services]:
        yield Services(binance, store, Signals(ask, store, audit), audit, portfolio=portfolio)

    @contextmanager
    def trading() -> Generator[Trading]:
        yield Trading(binance, store, audit)

    def send(method: str, path: str, body: object = None) -> tuple[int, Any]:
        event: dict[str, object] = {
            "rawPath": path,
            "requestContext": {"http": {"method": method}},
            "queryStringParameters": {},
            "body": json.dumps(body) if body is not None else "",
        }
        result = handler.handler(
            event, None, portfolio=portfolio, trading=trading, services=services
        )
        return int(str(result["statusCode"])), json.loads(str(result["body"]))

    send.replies = replies  # type: ignore[attr-defined]
    return send


def test_the_command_bar_changes_a_figure_through_a_diff_and_accept(
    call: Any, store: Store, audit: Audit
) -> None:
    profile.save(store, audit, profile_v2.parse(SAMPLE), author=profile.OWNER, now=NOW)
    status, page = call("GET", "/profile")
    assert (status, page["board"]["cash"]["emergencyAud"]) == (200, "12000")
    call.replies.append(
        {
            "kind": "change",
            "answer": "",
            "edits": [{"find": "~A$12K of A$20K", "replace": "~A$15K of A$20K"}],
            "reason": "Bonus came in",
        }
    )
    status, reply = call("POST", "/profile/command", {"text": "Emergency fund is 15K now"})
    assert status == 200  # noqa: PLR2004
    s = reply["suggestion"]
    assert s["summary"] == "Emergency fund (6 months) ~A$12K of A$20K → ~A$15K of A$20K"
    assert {"kind": "del", "text": "1. Emergency fund (6 months): **~A$12K of A$20K**"} in s["diff"]
    assert {"kind": "add", "text": "1. Emergency fund (6 months): **~A$15K of A$20K**"} in s["diff"]
    assert profile.current(store)[0] == 1  # nothing saved before Accept
    status, page = call("POST", f"/profile/suggestions/{s['id']}/accept", {})
    assert (status, page["version"]) == (200, 2)
    assert call("GET", "/profile")[1]["board"]["cash"]["emergencyAud"] == "15000"
    assert "~A$15K of A$20K" in store.profile_md.read_text(encoding="utf-8")
    version = call("GET", "/profile/versions/2")[1]
    assert {"kind": "add", "text": "1. Emergency fund (6 months): **~A$15K of A$20K**"} in version[
        "diff"
    ]
    status, page = call("POST", "/profile/restore", {"n": "1"})
    assert (status, page["version"]) == (200, 3)
    assert call("GET", "/profile")[1]["board"]["cash"]["emergencyAud"] == "12000"


def test_an_edit_that_misses_the_file_or_breaks_it_is_refused(
    call: Any, store: Store, audit: Audit
) -> None:
    profile.save(store, audit, profile_v2.parse(SAMPLE), author=profile.OWNER, now=NOW)
    call.replies.append(
        {"kind": "change", "answer": "", "edits": [{"find": "A$99K", "replace": "x"}], "reason": ""}
    )
    status, reply = call("POST", "/profile/command", {"text": "Change something"})
    assert (status, "exactly" in reply["error"]) == (400, True)
    call.replies.append(
        {
            "kind": "change",
            "answer": "",
            "edits": [{"find": "## 6. Rules", "replace": "## Rules"}],
            "reason": "",
        }
    )
    status, reply = call("POST", "/profile/command", {"text": "Drop the rules"})
    assert (status, reply["error"]) == (400, "Section 6 is missing from profile.md")
    call.replies.append({"kind": "answer", "answer": "A$12K of A$20K.", "edits": [], "reason": ""})
    status, reply = call("POST", "/profile/command", {"text": "How's my emergency fund?"})
    assert (status, reply["answer"]) == (200, "A$12K of A$20K.")


def test_the_deposit_cap_can_stand_without_an_extra_buy() -> None:
    text = SAMPLE.replace(
        "4. Fear & Greed below 40: extra A$250, 2 days after | **max A$750 a week, A$3K a month**",
        "4. No extra buys on fear | **deposit cap A$7K a month**, tracked, never blocks a buy",
    )
    dca = profile_v2.values(text)["dca"]
    assert dca["maxMonth"] == D(7000)
    assert dca["extra"] is None
    assert dca["extraAfterDays"] is None
