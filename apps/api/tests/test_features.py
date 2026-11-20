"""Feature flags (decision 85): the owner's on and off choices, kept in the store."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from api import features
from api.store import Store
from api.trading import Refused


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    kept = Store(tmp_path / "desk.sqlite")
    yield kept
    kept.close()


def test_nothing_switched_yet_leaves_every_feature_to_the_desk(store: Store) -> None:
    assert features.view(store) == {"flags": {}}


def test_a_switch_is_kept_and_survives_a_new_store(store: Store, tmp_path: Path) -> None:
    features.switch(store, {"id": "journal", "on": False})
    assert features.switch(store, {"id": "risk", "on": False})["flags"] == {
        "journal": False,
        "risk": False,
    }
    assert features.switch(store, {"id": "journal", "on": True})["flags"]["journal"] is True
    again = Store(tmp_path / "desk.sqlite")
    assert features.view(again)["flags"] == {"journal": True, "risk": False}
    again.close()


@pytest.mark.parametrize(
    "body",
    [
        {"id": "Journal", "on": False},
        {"id": "", "on": False},
        {"id": "x" * 41, "on": False},
        {"id": "../etc", "on": False},
        {"id": "journal", "on": "false"},
        {"id": "journal"},
        {"on": True},
    ],
)
def test_a_bad_switch_is_refused(store: Store, body: dict[str, object]) -> None:
    with pytest.raises(Refused):
        features.switch(store, body)
    assert features.view(store)["flags"] == {}


@pytest.mark.parametrize("feature", ["dashboard", "settings"])
def test_dashboard_and_settings_cannot_be_switched_off(store: Store, feature: str) -> None:
    with pytest.raises(Refused):
        features.switch(store, {"id": feature, "on": False})
    assert features.switch(store, {"id": feature, "on": True})["flags"][feature] is True


def test_the_number_of_flags_is_capped(store: Store) -> None:
    for n in range(features.MAX_FLAGS):
        features.switch(store, {"id": f"f{n}", "on": True})
    with pytest.raises(Refused):
        features.switch(store, {"id": "one-more", "on": True})
    features.switch(store, {"id": "f0", "on": False})  # changing a kept one is fine


def test_a_damaged_value_reads_as_nothing_switched(store: Store) -> None:
    store.set_setting(features.KEY, "not json")
    assert features.view(store)["flags"] == {}
    store.set_setting(features.KEY, '{"journal": false, "risk": "off", "7": 1}')
    assert features.view(store)["flags"] == {"journal": False}
