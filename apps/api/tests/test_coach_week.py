"""The Dashboard's week rail (decision 63): the plan's weekly buy and extra buy on their days, and
whether Binance shows them bought. Made-up figures only."""

from datetime import date
from decimal import Decimal as D
from typing import Any

from api import coach_week

DCA: dict[str, Any] = {
    "weekly": D(500),
    "day": "Friday",
    "extra": D(250),
    "fearGreedBelow": 40,
    "maxWeek": D(750),
    "maxMonth": D(3000),
    "extraAfterDays": 2,
}
MON, THU, FRI, SAT, SUN = (date(2026, 11, d) for d in (16, 19, 20, 21, 22))


def test_the_week_runs_monday_to_sunday_with_the_buys_on_their_days() -> None:
    w = coach_week.week(DCA, [], THU)
    assert [d["name"] for d in w["days"]] == ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    assert [d["kind"] for d in w["days"]] == ["", "", "", "", "buy", "", "extra"]
    assert w["buy"] == {"date": "2026-11-20", "aud": "500", "boughtAud": "0", "state": "upcoming"}
    assert w["extra"] == {
        "date": "2026-11-22",
        "aud": "250",
        "fearGreedBelow": 40,
        "state": "upcoming",
    }
    assert (w["maxWeekAud"], w["maxMonthAud"]) == ("750", "3000")


def test_the_buy_is_due_on_its_day_done_once_bought_and_missed_after() -> None:
    assert coach_week.week(DCA, [], FRI)["buy"]["state"] == "due"
    filled = [(FRI, D("490"))]  # a limit order a little short still counts
    assert coach_week.week(DCA, filled, FRI)["buy"]["state"] == "done"
    assert coach_week.week(DCA, [(MON, D(500))], SAT)["buy"]["state"] == "missed"  # before Friday
    w = coach_week.week(DCA, [(FRI, D(500)), (SUN, D(250))], SUN)
    assert (w["buy"]["state"], w["extra"]["state"], w["boughtAud"]) == ("done", "done", "750")


def test_without_binance_nothing_is_marked_done_or_missed() -> None:
    w = coach_week.week(DCA, None, SAT)
    assert (w["buy"]["state"], w["buy"]["boughtAud"], w["boughtAud"]) == ("unknown", None, None)


def test_an_extra_day_past_sunday_and_a_plan_without_a_day_leave_the_rail_plain() -> None:
    late = coach_week.week(DCA | {"extraAfterDays": 3}, [], MON)
    assert late["extra"] is None
    assert [d["kind"] for d in late["days"]].count("extra") == 0
    plain = coach_week.week(DCA | {"day": None}, [], MON)
    assert (plain["buy"], plain["extra"]) == (None, None)
