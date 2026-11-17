from datetime import datetime
from pathlib import Path

from api import my_agents
from api.store import Store

SAMPLE = """# weekly-buyer

Buys a little every week.

- Purpose: buys the weekly amount
- Model: claude-opus-5-5, effort high
- Autonomy: propose
- Cost: about $0.20 a week
- Icon: DCA
- Persona: The patient buyer: steady, never chases
- Coins: BTC, ETH

## Schedule (Sydney time)

1. **Friday 5pm, deposit day:** remind the owner.
2. **When the money lands:** propose orders.
3. **Monday 6:30pm:** The close-out for anything unfilled. Then stop.

## Never

- Sell.
"""


def _store(tmp_path: Path) -> Store:
    return Store(tmp_path / "desk.sqlite")


def test_parse_reads_the_header_and_the_schedule() -> None:
    found = my_agents.parse(SAMPLE)
    assert found["title"] == "weekly-buyer"
    assert found["about"] == "Buys a little every week."
    assert found["facts"]["purpose"] == "buys the weekly amount"
    assert found["schedule"] == [
        {"day": 4, "minute": 17 * 60, "label": "deposit day"},
        {"day": None, "minute": None, "label": "When the money lands"},
        {"day": 0, "minute": 18 * 60 + 30, "label": "The close-out for anything unfilled"},
    ]


def test_next_run_is_the_soonest_timed_item() -> None:
    schedule = my_agents.parse(SAMPLE)["schedule"]
    saturday = datetime(2026, 11, 21, 12, 0, tzinfo=my_agents.SYDNEY)
    found = my_agents.next_run(schedule, saturday)
    assert found is not None
    assert found["label"] == "The close-out for anything unfilled"
    assert datetime.fromtimestamp(found["at"] / 1000, my_agents.SYDNEY) == datetime(
        2026, 11, 23, 18, 30, tzinfo=my_agents.SYDNEY
    )
    friday_late = datetime(2026, 11, 20, 18, 0, tzinfo=my_agents.SYDNEY)
    later = my_agents.next_run(schedule, friday_late)
    assert later is not None
    assert later["label"] == "The close-out for anything unfilled"


def test_a_daily_item_runs_every_day() -> None:
    schedule = my_agents.parse("# a\n\n## Schedule\n\n1. **Daily 11:15am, scan:** read.\n")[
        "schedule"
    ]
    assert schedule == [{"day": -1, "minute": 11 * 60 + 15, "label": "scan"}]
    noon = datetime(2026, 11, 18, 12, 0, tzinfo=my_agents.SYDNEY)
    found = my_agents.next_run(schedule, noon)
    assert found is not None
    assert datetime.fromtimestamp(found["at"] / 1000, my_agents.SYDNEY) == datetime(
        2026, 11, 19, 11, 15, tzinfo=my_agents.SYDNEY
    )


def test_listing_versions_each_change(tmp_path: Path) -> None:
    store = _store(tmp_path)
    assert my_agents.listing(store)["agents"] == []
    where = my_agents.folder(store)
    assert where == tmp_path / "agents"
    where.mkdir()
    (where / "weekly-buyer.md").write_text(SAMPLE, encoding="utf-8")
    (where / "Not An Agent.md").write_text(SAMPLE, encoding="utf-8")
    first = my_agents.listing(store)["agents"]
    assert [a["slug"] for a in first] == ["weekly-buyer"]
    agent = first[0]
    assert agent["model"] == {"id": "claude-opus-5-5", "name": "Claude Opus 5.5", "effort": "high"}
    assert agent["coins"] == ["BTC", "ETH"]
    assert agent["cost"] == "about $0.20 a week"
    assert agent["icon"] == "dca"
    assert agent["persona"] == {"title": "The patient buyer", "traits": "steady, never chases"}
    assert agent["version"] == 1
    assert my_agents.listing(store)["agents"][0]["version"] == 1
    (where / "weekly-buyer.md").write_text(SAMPLE + "\n- Buy.\n", encoding="utf-8")
    assert my_agents.listing(store)["agents"][0]["version"] == 2
    # Each version's text is kept, so an earlier one can be read or restored.
    kept = my_agents.history(store)
    assert (kept / "weekly-buyer.v1.md").read_text(encoding="utf-8") == SAMPLE
    assert (kept / "weekly-buyer.v2.md").read_text(encoding="utf-8").endswith("- Buy.\n")
    assert [a["slug"] for a in my_agents.listing(store)["agents"]] == ["weekly-buyer"]


def test_file_reads_only_a_listed_agent(tmp_path: Path) -> None:
    store = _store(tmp_path)
    where = my_agents.folder(store)
    where.mkdir()
    (where / "weekly-buyer.md").write_text(SAMPLE, encoding="utf-8")
    assert my_agents.file(store, "weekly-buyer")["markdown"] == SAMPLE
    assert my_agents.file(store, "../desk")["error"] == "There's no agent called ../desk."


def test_a_demo_database_has_its_own_folder(tmp_path: Path) -> None:
    store = Store(tmp_path / "demo.sqlite")
    assert my_agents.folder(store) == tmp_path / "demo-agents"
