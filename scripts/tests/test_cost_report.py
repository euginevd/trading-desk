import json
import pathlib
from types import ModuleType

import pytest

TF = 'resource "aws_nat_gateway" "main" {\n}\n'


def write(path: pathlib.Path, data: object) -> str:
    path.write_text(json.dumps(data), encoding="utf-8")
    return str(path)


def infracost(past: float, now: float) -> dict[str, object]:
    return {
        "currency": "USD",
        "pastTotalMonthlyCost": str(past),
        "totalMonthlyCost": str(now),
        "projects": [
            {
                "pastBreakdown": {"resources": []},
                "breakdown": {
                    "resources": [{"name": "aws_nat_gateway.main", "monthlyCost": str(now)}]
                },
            }
        ],
    }


def test_parse_finds_driver_hint_and_line(
    cost: ModuleType, tmp_path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    (tmp_path / "main.tf").write_text(TF, encoding="utf-8")
    plan = {"resource_changes": [{"address": "aws_nat_gateway.main", "change": {"after": {}}}]}
    out = tmp_path / "cost-api.json"
    cost.parse(
        "api",
        write(tmp_path / "ic.json", infracost(0, 32.85)),
        write(tmp_path / "p.json", plan),
        str(out),
    )
    s = json.loads(out.read_text(encoding="utf-8"))
    assert s["before"] == 0
    assert s["after"] == 32.85
    assert s["drivers"][0]["hint"].startswith("one shared NAT gateway")
    warning = capsys.readouterr().out
    assert warning.startswith("::warning file=infra/aws/api/main.tf,line=1,")


def test_parse_error_on_bad_input(cost: ModuleType, tmp_path: pathlib.Path) -> None:
    out = tmp_path / "cost-api.json"
    cost.parse("api", str(tmp_path / "missing.json"), str(tmp_path / "p.json"), str(out))
    assert json.loads(out.read_text(encoding="utf-8")) == {"unit": "api", "error": True}


def test_hints_skip_configs_that_already_save(cost: ModuleType) -> None:
    assert cost.hint("aws_instance", {"instance_type": "t4g.small"}) == ""
    assert cost.hint("aws_instance", {"instance_type": "t3.small"}).startswith("a Graviton")
    assert cost.hint("aws_ebs_volume", {"type": "gp3"}) == ""
    assert cost.hint("aws_unknown", {}) == ""


@pytest.mark.parametrize(
    ("value", "currency", "sign", "expected"),
    [
        (3.5, "USD", False, "$3.50"),
        (1234.4, "AUD", True, "+A$1,234"),
        (-2, "EUR", True, "-2.00 EUR"),
        (0, "USD", True, "$0.00"),
    ],
)
def test_money(cost: ModuleType, value: float, currency: str, sign: bool, expected: str) -> None:
    assert cost.money(value, currency, sign=sign) == expected


def summary(after: float, before: float = 0, delta: float | None = None) -> dict[str, object]:
    d = after - before if delta is None else delta
    return {
        "unit": "api",
        "error": False,
        "currency": "USD",
        "before": before,
        "after": after,
        "drivers": [{"address": "aws_nat_gateway.main", "delta": d, "hint": "share it"}],
    }


def test_comment_warns_above_limit(
    cost: ModuleType, tmp_path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    write(tmp_path / "cost-api.json", summary(120))
    cost.comment(str(tmp_path), "abcdef1234", "100")
    text = capsys.readouterr().out
    assert "⚠️ $120/month, above the $100 limit" in text
    assert "🔴 +$120 `aws_nat_gateway.main`. Consider: share it" in text


def test_comment_no_change(
    cost: ModuleType, tmp_path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    write(tmp_path / "cost-api.json", summary(5, before=5, delta=0))
    cost.comment(str(tmp_path), "abcdef1234")
    assert "✅ no cost change, $5.00/month" in capsys.readouterr().out


def test_comment_silent_without_summaries(
    cost: ModuleType, tmp_path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    cost.comment(str(tmp_path), "abcdef1234")
    assert capsys.readouterr().out == ""


def test_comment_reports_error(
    cost: ModuleType, tmp_path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    write(tmp_path / "cost-api.json", {"unit": "api", "error": True})
    cost.comment(str(tmp_path), "abcdef1234")
    assert "❌ didn't finish" in capsys.readouterr().out
