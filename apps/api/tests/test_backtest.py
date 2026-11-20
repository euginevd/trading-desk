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
from api.backtest_runs import STYLES, BadRun, Run, check, commands, default, months_before
from api.handler import handler

TODAY = date(2026, 11, 20)
DAY = 86_400_000
TOP = ["BTC", "ETH", "SOL"]
JOB = "job-20261120-070402-58edab"


def _trade(n: int, setup: str, profit: float, reason: str) -> dict[str, Any]:
    # Bought 10 at 100 with the stop at 90: 100 at risk, plus fees.
    return {
        "pair": "SOL/USDC",
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
            "pairlist": ["SOL/USDC"],
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


def _job(jobs: Path, job: str, request: dict[str, Any], status: dict[str, Any] | None) -> None:
    jobs.mkdir(parents=True, exist_ok=True)
    (jobs / f"{job}.request.json").write_text(json.dumps(request))
    if status is not None:
        (jobs / f"{job}.status.json").write_text(json.dumps(status))


def test_each_trade_is_measured_in_r_by_setup_exit_and_year() -> None:
    s = backtest_report.summary(RESULT)
    assert s is not None
    assert (s["style"], s["ai"], s["coin"]) == ("swing", True, "SOL")
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
    good = {"style": "swing", "coin": "SOL", "from": "2026-10-19", "to": "2026-11-19"}
    ok = check({**good, "from": "2026-08-19"}, TOP, TODAY)
    assert (ok.strategy, ok.pair) == ("DeskSwing", "SOL/USDC")
    bad = [
        {**good, "style": "rm -rf"},
        {**good, "coin": None},
        {**good, "coin": "SOL/USDT; ls"},
        {**good, "coin": "PEPE"},  # not in today's top 100
        {**good, "style": "position", "ai": True},
        {**good, "ai": "yes"},
        {**good, "from": "2026-10-19; ls"},
        {**good, "from": "2026-02-30"},
        {**good, "to": "2026-11-20"},  # today's candles aren't closed
        {**good, "from": "2026-11-19", "to": "2026-10-19"},
        {**good, "from": "2026-08-01"},  # over 3 months
    ]
    for body in bad:
        with pytest.raises(BadRun):
            check(body, TOP, TODAY)
    # The worker can't read the top 100, so it checks the coin's form only.
    assert check({**good, "coin": "PEPE"}, None, TODAY).coin == "PEPE"


def test_a_run_defaults_to_the_last_month() -> None:
    assert default(TODAY) == ("2026-10-19", "2026-11-19")
    assert months_before(date(2026, 3, 31), 1) == date(2026, 2, 28)
    assert months_before(date(2026, 1, 15), 6) == date(2025, 7, 15)


def test_the_commands_test_one_usdc_pair_with_btc_beside_it() -> None:
    run = Run(STYLES["swing"], "SOL", date(2026, 8, 19), date(2026, 11, 19))
    download, older, test = commands(run)
    assert download[:2] == ["freqtrade", "download-data"]
    assert "/freqtrade/config/usdc.json" in download
    pairs = download[download.index("--pairs") + 1 : download.index("--timerange")]
    assert pairs == ["SOL/USDC", "BTC/USDC"]
    assert older[-1] == "--prepend"
    assert test[test.index("--strategy") + 1] == "DeskSwing"
    assert test[test.index("--pairs") + 1] == "SOL/USDC"
    assert test[test.index("--timerange") + 1] == "20260819-20261119"
    btc = commands(Run(STYLES["day"], "BTC", date(2026, 10, 19), date(2026, 11, 19)))[0]
    assert btc[btc.index("--pairs") + 1 : btc.index("--timerange")] == ["BTC/USDC"]


def test_only_the_desks_own_runs_are_listed(tmp_path: Path) -> None:
    _zip(tmp_path / "backtest_results")
    _zip(tmp_path / "backtest_results", "backtest-result-2026-11-19_01-00-00")  # run.sh's
    _job(
        tmp_path / "jobs",
        JOB,
        {"style": "swing", "coin": "SOL"},
        {"state": "done", "result": "backtest-result-2026-11-20_06-48-02"},
    )
    runs = Backtests(tmp_path).runs()
    assert [r["id"] for r in runs] == ["backtest-result-2026-11-20_06-48-02"]
    assert runs[0]["coin"] == "SOL"


def test_the_page_queues_one_run_at_a_time_and_cancels(tmp_path: Path) -> None:
    desk = Backtests(tmp_path, now=lambda: 1_795_000_000_000, coins=lambda: TOP)
    view = desk.view()
    assert view["runs"] == []
    assert view["job"] is None
    assert view["worker"]["on"] is False
    assert view["coins"] == TOP
    assert view["quote"] == "USDC"
    assert {s["key"] for s in view["styles"]} == {"scalp", "day", "swing", "position"}

    run = {"style": "swing", "coin": "ETH", "from": view["from"], "to": view["to"]}
    job = desk.start(run)["job"]
    assert (job["state"], job["coin"]) == ("queued", "ETH")
    with pytest.raises(BadRun, match="already going"):
        desk.start({**run, "style": "day"})
    assert desk.cancel({"id": job["id"]})["job"]["state"] == "cancelled"
    with pytest.raises(BadRun):
        desk.cancel({"id": "../../etc/passwd"})


def test_no_run_before_the_desk_knows_the_top_100(tmp_path: Path) -> None:
    desk = Backtests(tmp_path)
    with pytest.raises(BadRun, match="scan on the Trade page"):
        desk.start({"style": "swing", "coin": "SOL", "from": "2026-10-19", "to": "2026-11-19"})


def test_a_run_the_worker_dropped_shows_as_failed_and_frees_the_queue(tmp_path: Path) -> None:
    _job(tmp_path / "jobs", JOB, {"style": "swing", "coin": "SOL"}, {"state": "running"})
    (tmp_path / "jobs" / "worker.json").write_text(json.dumps({"seen": 1}))  # long ago
    desk = Backtests(tmp_path, now=lambda: 1_800_000_000_000, coins=lambda: TOP)  # after it
    shown = desk.view()["job"]
    assert shown["state"] == "failed"
    assert "stopped mid-run" in shown["error"]
    view = desk.view()
    run = {"style": "swing", "coin": "SOL", "from": view["from"], "to": view["to"]}
    assert desk.start(run)["job"]["id"] != JOB


def test_a_run_is_read_only_by_its_own_id(tmp_path: Path) -> None:
    results = tmp_path / "backtest_results"
    _zip(results)
    (results / "backtest-result-2026-11-21_00-00-00.zip").write_bytes(b"PK\x03\x04 cut off")
    desk = Backtests(tmp_path)
    assert desk.run("backtest-result-2026-11-20_06-48-02")["all"]["trades"] == 3
    with pytest.raises(BadRun):
        desk.run("../desk.sqlite")
    with pytest.raises(LookupError):
        desk.run("backtest-result-2020-01-01_00-00-00")
    with pytest.raises(LookupError):  # cut off mid-write: skipped, not fatal
        desk.run("backtest-result-2026-11-21_00-00-00")


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
    assert view["runs"] == []
    status, run = call("GET", "/backtest/run", query={"id": "backtest-result-2026-11-20_06-48-02"})
    assert status == 200
    assert run["strategy"] == "DeskSwingAI"
    assert (
        call("GET", "/backtest/run", query={"id": "backtest-result-2020-01-01_00-00-00"})[0] == 404
    )
    status, reply = call("POST", "/backtest/jobs", {"style": "nope"})
    assert status == 400
    assert "top 100" in reply["error"]  # no screener list saved in this empty store


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
    marker = json.dumps({"latest_backtest": "backtest-result-2026-11-20_06-48-02.zip"})
    write_last = f"open({str(last)!r}, 'w').write({marker!r})"
    fake = [[sys.executable, "-c", "print('ok')"]] * 2 + [[sys.executable, "-c", write_last]]
    monkeypatch.setattr(worker, "commands", lambda _run: fake)  # pyright: ignore[reportUnknownLambdaType, reportUnknownArgumentType]
    monkeypatch.setattr(worker, "POLL_SECONDS", 0.01)
    start, end = default()
    # The stand-in result is DeskSwingAI's, so the run asks for swing with the AI filter.
    request = {"style": "swing", "coin": "SOL", "ai": True, "from": start, "to": end}
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
