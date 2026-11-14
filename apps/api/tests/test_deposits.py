import json
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import pytest
from api.audit import Audit
from api.binance import Binance
from api.deposits import fy_of, report
from api.handler import handler

# Made-up deposits (known-mistakes 7): two in August, one in November, one before the year.
DAY = 86_400_000
AUG_3 = 1_785_715_200_000  # 2026-08-03 10:00 Sydney
ROWS: list[dict[str, Any]] = [
    {"coin": "USDC", "amount": "700.5", "network": "BASE", "insertTime": AUG_3},
    {"coin": "USDC", "amount": "690", "network": "BASE", "insertTime": AUG_3 + 5 * DAY},
    {"coin": "USDC", "amount": "680.25", "network": "BASE", "insertTime": AUG_3 + 100 * DAY},
    {"coin": "USDC", "amount": "999", "network": "BASE", "insertTime": AUG_3 - 60 * DAY},
]


def binance(tmp_path: Path, asked: list[dict[str, str]]) -> Binance:
    def reply(request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        asked.append(params)
        start, end = int(params["startTime"]), int(params["endTime"])
        return httpx.Response(200, json=[r for r in ROWS if start <= r["insertTime"] <= end])

    client = httpx.Client(base_url="https://binance.test", transport=httpx.MockTransport(reply))
    return Binance(client, ("k", "s"), Audit(tmp_path / "audit.jsonl"))


def fx() -> httpx.Client:
    rates = {"2026-07-31": {"AUD": 1.5}, "2026-08-07": {"AUD": 1.52}, "2026-11-10": {"AUD": 1.47}}
    return httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"rates": rates}))
    )


def test_financial_years_start_in_july() -> None:
    assert fy_of(date(2026, 7, 1)) == 2026
    assert fy_of(date(2027, 6, 30)) == 2026
    assert fy_of(date(2026, 6, 30)) == 2025


def test_deposits_by_month_paid_where_known_estimated_otherwise(tmp_path: Path) -> None:
    asked: list[dict[str, str]] = []
    got = report(binance(tmp_path, asked), {"700.5": "1000"}, fx(), date(2026, 11, 14))
    assert got["fy"] == "2026-27"
    assert all(a["coin"] == "USDC" and a["status"] == "1" for a in asked)
    assert len(asked) == 2  # 1 Jul to 14 Nov is two 90-day windows
    by_month = {m["month"]: m for m in got["months"]}
    assert [m["label"] for m in got["months"]][:2] == ["Jul", "Aug"]
    assert got["months"][-1]["month"] == "2027-06"
    assert by_month["2026-08"]["count"] == 2
    # 700.5 was paid A$1,000; 690 lands on Saturday 8 Aug: Friday's 1.52
    assert by_month["2026-08"]["aud"] == "2048.8"
    assert by_month["2026-11"]["aud"] == "999.97"  # 680.25 at 1.47
    assert by_month["2026-07"]["count"] == 0  # the June deposit is last year's
    basis = {d["amount"]: d["basis"] for d in got["deposits"]}
    assert basis == {"700.5": "paid", "690": "estimate", "680.25": "estimate"}
    assert got["total"]["paid"] == 1
    assert got["total"]["aud"] == "3048.77"


def test_the_paid_route_records_and_audits_and_refuses_nonsense(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DEMO", "1")
    monkeypatch.setenv("AUDIT_LOG_PATH", str(tmp_path / "audit.jsonl"))
    monkeypatch.setenv("DESK_DB_DIR", str(tmp_path))

    def put(body: dict[str, Any]) -> dict[str, object]:
        event: dict[str, object] = {
            "rawPath": "/deposits/paid",
            "requestContext": {"http": {"method": "PUT"}},
            "body": json.dumps(body),
        }
        return handler(event, None)

    assert put({"amount": "500.000", "aud": "720"})["statusCode"] == 200
    assert put({"amount": "500", "aud": "-1"})["statusCode"] == 400
    assert put({"amount": "abc", "aud": "1"})["statusCode"] == 400
    reply = handler({"rawPath": "/deposits"}, None)
    assert reply["statusCode"] == 200
    got = json.loads(str(reply["body"]))
    paid = [d for d in got["deposits"] if d["basis"] == "paid"]
    assert [(d["amount"], d["aud"]) for d in paid] == [("500", "720")]
    assert "deposit" in (tmp_path / "audit.jsonl").read_text()
