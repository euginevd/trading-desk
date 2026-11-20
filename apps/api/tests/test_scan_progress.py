"""Scan now's steps (scan_progress): recorded only once Scan now begins, read without a scan."""

from collections.abc import Iterator

import pytest
from api import scan_progress

START = 1_794_000_000_000
STYLES = [("scalp", "Scalp"), ("swing", "Swing")]


@pytest.fixture(autouse=True)
def nothing_run() -> Iterator[None]:
    scan_progress.reset()
    yield
    scan_progress.reset()


def test_nothing_run_reads_as_an_empty_record() -> None:
    assert scan_progress.view() == {"running": False, "started": None, "ended": None, "steps": []}


def test_steps_are_ignored_unless_scan_now_began() -> None:
    scan_progress.plan(STYLES)
    scan_progress.step("swing", "judging", "8 coins passed the filters, 2 setups")
    scan_progress.finish(START)
    assert scan_progress.view() == {"running": False, "started": None, "ended": None, "steps": []}


def test_a_scan_moves_each_style_through_its_stages_in_order() -> None:
    assert scan_progress.begin(START) is True
    assert scan_progress.begin(START + 1) is False  # one scan owns the record
    scan_progress.plan(STYLES)
    scan_progress.step("scalp", "screening")
    scan_progress.step("scalp", None, "8 coins passed the filters, 2 setups")
    scan_progress.step("scalp", "judging")
    scan_progress.step("scalp", "done", "trading-agent: 1 take, 1 wait")
    scan_progress.step("scalp", "judging")  # nothing follows a style's end
    scan_progress.step("swing", "napping")  # not a stage
    scan_progress.step("day", "screening")  # not in this scan
    seen = scan_progress.view()
    assert seen["running"] is True
    assert seen["started"] == START
    assert seen["steps"] == [
        {
            "style": "scalp",
            "name": "Scalp",
            "state": "done",
            "notes": ["8 coins passed the filters, 2 setups", "trading-agent: 1 take, 1 wait"],
        },
        {"style": "swing", "name": "Swing", "state": "waiting", "notes": []},
    ]


def test_finishing_marks_a_style_left_under_way_as_failed_and_keeps_the_record() -> None:
    scan_progress.begin(START)
    scan_progress.plan(STYLES)
    scan_progress.step("scalp", "judging")
    scan_progress.finish(START + 5000)
    seen = scan_progress.view()
    assert (seen["running"], seen["ended"]) == (False, START + 5000)
    assert [s["state"] for s in seen["steps"]] == ["failed", "waiting"]
    scan_progress.step("swing", "screening")  # the scan is over
    assert scan_progress.view()["steps"][1]["state"] == "waiting"


def test_a_reader_cannot_change_the_record_and_a_note_is_kept_short() -> None:
    scan_progress.begin(START)
    scan_progress.plan(STYLES)
    scan_progress.step("swing", "failed", "x" * 500)
    seen = scan_progress.view()
    seen["steps"][1]["notes"].append("changed")
    seen["steps"].clear()
    kept = scan_progress.view()["steps"][1]["notes"]
    assert kept == ["x" * scan_progress.NOTE_LENGTH]
