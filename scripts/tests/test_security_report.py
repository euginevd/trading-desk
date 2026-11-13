import json
import pathlib
from types import ModuleType

import pytest


def write(path: pathlib.Path, data: object) -> str:
    path.write_text(json.dumps(data), encoding="utf-8")
    return str(path)


def summary(path: pathlib.Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


TRIVY = {
    "Results": [
        {
            "Target": "/repo/uv.lock",
            "Vulnerabilities": [
                {
                    "VulnerabilityID": "CVE-1",
                    "PkgName": "urllib3",
                    "InstalledVersion": "1.0",
                    "FixedVersion": "2.0",
                    "Severity": "HIGH",
                },
                {
                    "VulnerabilityID": "CVE-2",
                    "PkgName": "idna",
                    "InstalledVersion": "3.0",
                    "Severity": "LOW",
                },
            ],
            "Misconfigurations": [
                {
                    "ID": "AVD-1",
                    "Title": "Open bucket",
                    "Severity": "critical",
                    "CauseMetadata": {"StartLine": 7},
                }
            ],
        }
    ]
}


def test_trivy_sorts_by_severity_and_fixes_only_urgent(
    security: ModuleType, tmp_path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    out = tmp_path / "trivy.json"
    security.parse("trivy", write(tmp_path / "in.json", TRIVY), str(out))
    s = summary(out)
    assert s["count"] == 3
    assert s["severity"] == {"CRITICAL": 1, "HIGH": 1, "LOW": 1}
    top = s["top"]
    assert isinstance(top, list)
    assert "AVD-1" in top[0]
    assert "upgrade urllib3 to 2.0" in top[1]
    assert "Fix" not in top[2]
    lines = capsys.readouterr().out.splitlines()
    assert lines[0].startswith("::error file=uv.lock,line=7,")


def test_gitleaks_empty_report_is_clean(security: ModuleType, tmp_path: pathlib.Path) -> None:
    report = tmp_path / "gitleaks.json"
    report.write_text("", encoding="utf-8")
    out = tmp_path / "out.json"
    security.parse("gitleaks", str(report), str(out))
    assert summary(out) == {
        "tool": "gitleaks",
        "error": False,
        "count": 0,
        "severity": {},
        "top": [],
    }


def test_gitleaks_finding_is_critical_and_redacted(
    security: ModuleType, tmp_path: pathlib.Path
) -> None:
    findings = [{"File": "/repo/app.py", "StartLine": 3, "RuleID": "aws-key", "Secret": "AKIA"}]
    out = tmp_path / "out.json"
    security.parse("gitleaks", write(tmp_path / "in.json", findings), str(out))
    s = summary(out)
    assert s["severity"] == {"CRITICAL": 1}
    assert "AKIA" not in json.dumps(s)
    assert "rotate the secret" in str(s["top"])


def test_unreadable_report_is_an_error(security: ModuleType, tmp_path: pathlib.Path) -> None:
    out = tmp_path / "out.json"
    security.parse("semgrep", str(tmp_path / "missing.json"), str(out))
    assert summary(out)["error"] is True


def test_semgrep_and_checkov_map_their_fields(security: ModuleType, tmp_path: pathlib.Path) -> None:
    semgrep = {
        "results": [
            {
                "check_id": "python.lang.eval",
                "path": "/src/apps/api/x.py",
                "start": {"line": 4},
                "extra": {
                    "severity": "ERROR",
                    "message": "No eval\nmore",
                    "fix": "ast.literal_eval",
                },
            }
        ]
    }
    out = tmp_path / "s.json"
    security.parse("semgrep", write(tmp_path / "s-in.json", semgrep), str(out))
    assert summary(out)["severity"] == {"HIGH": 1}
    assert "replace with `ast.literal_eval`" in str(summary(out)["top"])

    checkov = [
        {
            "results": {
                "failed_checks": [
                    {
                        "check_id": "CKV_1",
                        "check_name": "Log it",
                        "file_path": "/infra/main.tf",
                        "file_line_range": [9, 12],
                    }
                ]
            }
        }
    ]
    out = tmp_path / "c.json"
    security.parse("checkov", write(tmp_path / "c-in.json", checkov), str(out))
    assert summary(out)["severity"] == {"UNKNOWN": 1}
    assert "(infra/main.tf:9)" in str(summary(out)["top"])


def test_annotation_values_are_escaped(security: ModuleType) -> None:
    assert security.esc_prop("a,b:c%\n") == "a%2Cb%3Ac%25%0A"


def test_comment_counts_findings_and_missing_reports(
    security: ModuleType, tmp_path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    security.parse("trivy", write(tmp_path / "in.json", TRIVY), str(tmp_path / "trivy.json"))
    clean = {"tool": "gitleaks", "error": False, "count": 0, "severity": {}, "top": []}
    write(tmp_path / "gitleaks.json", clean)
    capsys.readouterr()
    security.comment(str(tmp_path), "abcdef1234")
    text = capsys.readouterr().out
    assert text.startswith(security.MARKER)
    # Trivy has findings; Checkov and Semgrep never reported, so they count as failed too.
    assert "❌ 3 failed (abcdef1)" in text
    assert "Didn't finish" in text
    assert "<details open><summary>Fix first" in text


def test_comment_all_clean(
    security: ModuleType, tmp_path: pathlib.Path, capsys: pytest.CaptureFixture[str]
) -> None:
    for tool in security.CHECKS:
        write(tmp_path / f"{tool}.json", {"error": False, "count": 0, "severity": {}, "top": []})
    security.comment(str(tmp_path), "abcdef1234")
    text = capsys.readouterr().out
    assert "✅ all passed" in text
    assert "<details" not in text
