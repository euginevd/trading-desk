"""The owner's files are the source (decision 61): a change to profile.md or trade.md becomes a
version, a broken one leaves the last good version in force. Made-up figures only."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from api import md_files, profile, trading_agent
from api.audit import Audit
from api.store import Store

NOW = 1_794_000_000_000


@pytest.fixture
def store(tmp_path: Path) -> Iterator[Store]:
    kept = Store(tmp_path / "desk.sqlite")
    yield kept
    kept.close()


@pytest.fixture
def audit(tmp_path: Path) -> Audit:
    return Audit(tmp_path / "audit.jsonl")


def test_an_edit_to_profile_md_becomes_a_version(store: Store, audit: Audit) -> None:
    doc = profile.empty()
    doc["identity"]["name"] = "Sam"
    profile.save(store, audit, doc, author=profile.OWNER, now=NOW)
    md_files.sync(store, audit, NOW)
    assert profile.current(store)[0] == 1  # the desk's own write isn't read back as a change
    text = store.profile_md.read_text(encoding="utf-8")
    store.profile_md.write_text(text.replace("Name: Sam", "Name: Alex"), encoding="utf-8")
    md_files.sync(store, audit, NOW)
    n, now = profile.current(store)
    assert (n, now["identity"]["name"]) == (2, "Alex")
    assert profile.history(store)[0]["reason"] == md_files.FROM_FILE
    view = md_files.file_view(store, "profile")
    assert (view["version"], view["error"]) == (2, None)
    assert "Name: Alex" in view["markdown"]


def test_a_broken_file_keeps_the_last_good_version(store: Store, audit: Audit) -> None:
    profile.save(store, audit, profile.empty() | {"additional_info": "x"}, author="You", now=NOW)
    store.profile_md.write_text("not a profile", encoding="utf-8")
    md_files.sync(store, audit, NOW)
    assert profile.current(store)[0] == 1
    assert "# Profile" in str(md_files.file_view(store, "profile")["error"])


def test_trade_md_is_written_from_the_defaults_then_read(store: Store, audit: Audit) -> None:
    md_files.sync(store, audit, NOW)
    text = store.trade_md.read_text(encoding="utf-8")
    assert text.startswith("# Trading agent")
    assert trading_agent.current(store)[0] == 0
    store.trade_md.write_text(text.replace("Name: Jordan", "Name: Avery"), encoding="utf-8")
    md_files.sync(store, audit, NOW)
    n, doc = trading_agent.current(store)
    assert (n, doc["name"]) == (1, "Avery")
    assert store.trade_md.name == "trade.md"
