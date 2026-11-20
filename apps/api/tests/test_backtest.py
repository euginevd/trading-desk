import importlib.util
import json
import sys
import zipfile
from datetime import date
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from api import backtest_report
from api.backtest import Backtests
from api.backtest_runs import STYLES, BadRun, Run, check, commands
from api.handler import handler

TODAY = date(2026, 11, 20)
DAY = 86_400_000


def _trade(n: int, setup: str, profit: float, reason: str) -> dict[str, Any]:
    # Bought 10 at 100 with the stop at 90: 100 at risk, plus fees.
    return {
        "pair": "SOL/USDT",
        "amount": 10.0,
        "open_rate": 100.0,
        "close_rate": 100.0 + profit / 10,
        "profit_abs": profit,
        "exit_reason": reason,
        "enter_tag": f"{setup}|100|90|120",
        "open_date": f"202{4 + n // 2}-01-0{n + 1} 00:00:00+00:00",
        "open_timestamp": 1_700_000_000_000 + n * DAY,
        "close_timestamp": 1_700_000_000_000 + (n + 1) * DAY,
    }


RESULT = {
    "strategy": {
        "DeskSwingAI": {
            "trades": [
                _trade(0, "Sweep and reclaim", 200.0, "roi"),
                _trade(1, "Trend pullback", -101.9, "stop_loss"),
                _trade(2, "Trend pullback", -101.9, "trailing_stop_loss"),
                {**_trade(3, "x", 1.0, "roi"), "enter_tag": "no tag"},
            ],
            "backtest_start_ts": 1_700_000_000_000,
            "backtest_end_ts": 1_710_000_000_000,
            "pairlist": ["SOL/USDT", "BTC/USDT"],
        }
    }
}


def _zip(folder: Path, name: str = "backtest-result-2026-11-20_06-48-02") -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{name}.zip"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(f"{name}.json", json.dumps(RESULT))
        z.writestr(f"{name}_config.json", "{}")
    return path


def test_each_trade_is_measured_in_r_by_setup_exit_and_year() -> None:
    s = backtest_report.summary(RESULT)
    assert s is not None
    assert (s["style"], s["ai"], s["pairs"]) == ("swing", True, 2)
    assert s["all"]["trades"] == 3  # the untagged trade can't be measured
    assert s["all"]["total"] == pytest.approx(200 / 101.9 - 2, abs=0.01)
    assert [r["name"] for r in s["bySetup"]] == ["Trend pullback", "Sweep and reclaim"]
    assert {r["name"] for r in s["byExit"]} == {"Target", "Stop"}
    assert [r["name"] for r in s["byYear"]] == ["2024", "2025"]
    assert s["worstRun"] == pytest.approx(-2.0, abs=0.01)
    assert s["curve"][-1][1] == pytest.approx(s["all"]["total"], abs=0.01)
    assert s["trades"][0]["setup"] == "Trend pullback"  # newest first
    assert "Worst run from a high" in backtest_report.text(RESULT)


def test_a_run_is_checked_before_it_is_queued() -> None:
    ok = check({"style": "swing", "ai": True, "from": "2024-01-01", "to": "2026-11-19"}, TODAY)
    assert ok.strategy == "DeskSwingAI"
    bad = [
        {"style": "rm -rf", "from": "2024-01-01", "to": "2025-01-01"},
        {"style": "position", "ai": True, "from": "2024-01-01", "to": "2025-01-01"},
        {"style": "swing", "ai": "yes", "from": "2024-01-01", "to": "2025-01-01"},
        {"style": "swing", "from": "2024-01-01; ls", "to": "2025-01-01"},
        {"style": "swing", "from": "2024-02-30", "to": "2025-01-01"},
        {"style": "swing", "from": "2016-01-01", "to": "2025-01-01"},
        {"style": "swing", "from": "2024-01-01", "to": "2026-11-20"},
        {"style": "swing", "from": "2025-01-01", "to": "2024-01-01"},
        {"style": "scalp", "ai": True, "from": "2017-09-01", "to": "2026-11-19"},  # too long
    ]
    for body in bad:
        with pytest.raises(BadRun):
            check(body, TODAY)


def test_the_commands_match_run_sh() -> None:
    run = Run(STYLES["swing"], True, date(2024, 1, 1), date(2025, 1, 1))
    download, older, test = commands(run)
    assert download[:2] == ["freqtrade", "download-data"]
    assert "/freqtrade/config/ai-swing.json" in download
    assert older[-1] == "--prepend"
    assert test[test.index("--strategy") + 1] == "DeskSwingAI"
    assert test[test.index("--timerange") + 1] == "20240101-20250101"
    assert download[download.index("--timerange") + 1].startswith("2020")  # FreqAI's history


def test_the_page_lists_runs_queues_one_at_a_time_and_cancels(tmp_path: Path) -> None:
    _zip(tmp_path / "backtest_results")
    (tmp_path / "backtest_results" / "not-ours.zip").write_text("x")
    desk = Backtests(tmp_path, now=lambda: 1_795_000_000_000)
    view = desk.view()
    assert [r["id"] for r in view["runs"]] == ["backtest-result-2026-11-20_06-48-02"]
    assert view["job"] is None
    assert view["worker"]["on"] is False
    assert {s["key"] for s in view["styles"]} == {"scalp", "day", "swing", "position"}

    yesterday = view["styles"][2]["to"]
    view = desk.start({"style": "swing", "from": "2024-01-01", "to": yesterday})
    job = view["job"]
    assert job["state"] == "queued"
    assert job["style"] == "swing"
    with pytest.raises(BadRun, match="already going"):
        desk.start({"style": "day", "from": "2025-01-01", "to": yesterday})
    assert desk.cancel({"id": job["id"]})["job"]["state"] == "cancelled"
    with pytest.raises(BadRun):
        desk.cancel({"id": "../../etc/passwd"})


def test_a_run_the_worker_dropped_shows_as_failed_and_frees_the_queue(tmp_path: Path) -> None:
    jobs = tmp_path / "jobs"
    jobs.mkdir()
    job = "job-20261120-070402-58edab"
    (jobs / f"{job}.request.json").write_text(json.dumps({"style": "swing"}))
    (jobs / f"{job}.status.json").write_text(json.dumps({"state": "running"}))
    (jobs / "worker.json").write_text(json.dumps({"seen": 1}))  # long ago
    desk = Backtests(tmp_path, now=lambda: 1_800_000_000_000)  # after the dropped job
    shown = desk.view()["job"]
    assert shown["state"] == "failed"
    assert "stopped mid-run" in shown["error"]
    yesterday = desk.view()["styles"][2]["to"]
    assert desk.start({"style": "swing", "from": "2024-01-01", "to": yesterday})["job"]["id"] != job


def test_a_cut_off_result_is_skipped_not_fatal(tmp_path: Path) -> None:
    results = tmp_path / "backtest_results"
    _zip(results)
    (results / "backtest-result-2026-11-21_00-00-00.zip").write_bytes(b"PK\x03\x04 cut off")
    assert len(Backtests(tmp_path).runs()) == 1


def test_a_run_is_read_only_by_its_own_id(tmp_path: Path) -> None:
    _zip(tmp_path / "backtest_results")
    desk = Backtests(tmp_path)
    assert desk.run("backtest-result-2026-11-20_06-48-02")["all"]["trades"] == 3
    with pytest.raises(BadRun):
        desk.run("../desk.sqlite")
    with pytest.raises(LookupError):
        desk.run("backtest-result-2020-01-01_00-00-00")


def test_the_routes_answer_and_refuse_a_bad_run(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DESK_DB_DIR", str(tmp_path))
    _zip(tmp_path / "backtest" / "backtest_results")

    def call(method: str, path: str, body: object = None, query: object = None) -> Any:
        event = {
            "rawPath": path,
            "requestContext": {"http": {"method": method}},
            "body": json.dumps(body or {}),
            "queryStringParameters": query,
        }
        reply = handler(event, None)
        return reply["statusCode"], json.loads(str(reply["body"]))

    status, view = call("GET", "/backtest")
    assert status == 200
    assert len(view["runs"]) == 1
    status, run = call("GET", "/backtest/run", query={"id": view["runs"][0]["id"]})
    assert status == 200
    assert run["strategy"] == "DeskSwingAI"
    assert (
        call("GET", "/backtest/run", query={"id": "backtest-result-2020-01-01_00-00-00"})[0] == 404
    )
    status, reply = call("POST", "/backtest/jobs", {"style": "nope"})
    assert status == 400
    assert "Pick" in reply["error"]


def _worker(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    monkeypatch.setenv("BACKTEST_DIR", str(tmp_path))
    path = Path(__file__).parents[2] / "backtest" / "worker.py"
    spec = importlib.util.spec_from_file_location("backtest_worker", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["backtest_worker"] = module
    spec.loader.exec_module(module)
    return module


def test_the_worker_runs_a_job_and_records_its_result(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    worker = _worker(tmp_path, monkeypatch)
    worker.JOBS.mkdir(parents=True)
    _zip(worker.RESULTS)
    # Stand-ins for Freqtrade: two downloads, then a backtest that writes .last_result.json.
    last = worker.RESULTS / ".last_result.json"
    write_last = (
        f"open(r'{last}', 'w').write('{{\"latest_backtest\": "
        '"backtest-result-2026-11-20_06-48-02.zip"}\')'
    )
    fake = [[sys.executable, "-c", "print('ok')"]] * 2 + [[sys.executable, "-c", write_last]]
    monkeypatch.setattr(worker, "commands", lambda _run: fake)  # pyright: ignore[reportUnknownLambdaType, reportUnknownArgumentType]
    monkeypatch.setattr(worker, "POLL_SECONDS", 0.01)
    yesterday = Backtests(tmp_path).view()["styles"][0]["to"]
    # The stand-in result is DeskSwingAI's, so the run asks for swing with the AI filter.
    request = {"style": "swing", "ai": True, "from": "2024-01-01", "to": yesterday}
    (worker.JOBS / "job-20261120-000000-abcdef.request.json").write_text(json.dumps(request))
    (worker.JOBS / "job-20261120-000001-abcdef.request.json").write_text(
        json.dumps({**request, "style": "$(reboot)"})
    )
    (worker.JOBS / "job-20261120-000002-abcdef.request.json").write_text("[1, 2]")
    for job in worker.pending():
        worker.run(job)
    done = json.loads((worker.JOBS / "job-20261120-000000-abcdef.status.json").read_text())
    assert done["state"] == "done"
    assert done["result"] == "backtest-result-2026-11-20_06-48-02"
    refused = json.loads((worker.JOBS / "job-20261120-000001-abcdef.status.json").read_text())
    assert refused["state"] == "failed"
    assert "Pick" in refused["error"]
    garbled = json.loads((worker.JOBS / "job-20261120-000002-abcdef.status.json").read_text())
    assert garbled["state"] == "failed"
    assert worker.pending() == []
