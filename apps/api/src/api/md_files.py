"""`local/profile.md` and `local/trade.md` are the source of truth (decision 61): the owner
changes them through Claude Code, and the desk only reads them. On each request the desk checks
whether a file changed since it last read or wrote it; a change that parses is saved as a new
version, so history, rule checks and Out of date marks follow the file. One that doesn't parse
leaves the last good version in force, and the page says what to fix.
"""

import hashlib
from typing import Any

from api import profile, profile_md, trading_agent
from api.audit import Audit
from api.store import Store
from api.trading import Refused

HASH = {"profile": "profile_md_hash", "agent": "trade_md_hash"}
ERROR = {"profile": "profile_md_error", "agent": "trade_md_error"}
FROM_FILE = "Edited in the file"


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def written(store: Store, kind: str, text: str) -> None:
    """The file now holds `text`, read or written by the desk: no change to pick up."""
    store.set_setting(HASH[kind], _digest(text))
    store.set_setting(ERROR[kind], "")


def _changed(store: Store, kind: str, text: str) -> bool:
    return _digest(text) != store.setting(HASH[kind], "")


def sync_profile(store: Store, audit: Audit, now_ms: int) -> None:
    path = store.profile_md
    n, doc = profile.current(store)
    if not path.exists():
        if n:  # the file went missing: write the version in force back
            text = profile_md.export(doc, n, now_ms)
            path.write_text(text, encoding="utf-8")
            written(store, "profile", text)
        return
    text = path.read_text(encoding="utf-8")
    if not _changed(store, "profile", text):
        return
    try:
        found = profile_md.parse(text)
    except Refused as error:
        store.set_setting(HASH["profile"], _digest(text))  # don't parse it again until it changes
        store.set_setting(ERROR["profile"], str(error))
        audit.record("profile", "profile.md not read", str(error))
        return
    if profile.changes(doc, found):
        profile.save(
            store, audit, found, author=profile.OWNER, now=now_ms, reason=FROM_FILE, write=False
        )
    written(store, "profile", text)


def sync_agent(store: Store, audit: Audit, now_ms: int) -> None:
    path = store.trade_md
    n, doc = trading_agent.current(store)
    if not path.exists():
        text = trading_agent.export(doc, n, now_ms)
        path.write_text(text, encoding="utf-8")
        written(store, "agent", text)
        return
    text = path.read_text(encoding="utf-8")
    if not _changed(store, "agent", text):
        return
    try:
        found = trading_agent.parse(text)
    except Refused as error:
        store.set_setting(HASH["agent"], _digest(text))
        store.set_setting(ERROR["agent"], str(error))
        audit.record("agent", "trade.md not read", str(error))
        return
    if trading_agent.changes(doc, found):
        trading_agent.save(store, audit, found, now=now_ms, write=False)
    written(store, "agent", text)


def sync(store: Store, audit: Audit, now_ms: int) -> None:
    """Both files, before a request reads either."""
    sync_profile(store, audit, now_ms)
    sync_agent(store, audit, now_ms)


def file_view(store: Store, kind: str) -> dict[str, Any]:
    """The file as it stands, for the reader, with the version in force and any problem."""
    path = store.profile_md if kind == "profile" else store.trade_md
    n, _ = profile.current(store) if kind == "profile" else trading_agent.current(store)
    row = store.latest_profile() if kind == "profile" else store.latest_agent()
    return {
        "markdown": path.read_text(encoding="utf-8") if path.exists() else "",
        "version": n,
        "time": int(row["time"]) if row else None,
        "error": store.setting(ERROR[kind], "") or None,
    }
