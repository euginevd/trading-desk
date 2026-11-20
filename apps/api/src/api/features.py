"""Feature flags (decision 85): which of the desk's pages and features the owner has switched on.

The desk holds the list of features and whether each starts on; this keeps only the owner's
choices, one id to on or off, so a feature added later needs nothing here. Off only hides: no
order, bot, check or agent reads these.
"""

import json
import re
from typing import Any, cast

from api.store import Store
from api.trading import Refused

KEY = "feature_flags"
ID = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
ALWAYS_ON = frozenset({"dashboard", "settings"})  # the way back to the switches
MAX_FLAGS = 100


def _flags(store: Store) -> dict[str, bool]:
    try:
        kept = json.loads(store.setting(KEY, "{}"))
    except ValueError:
        return {}
    if not isinstance(kept, dict):
        return {}
    pairs = cast("dict[object, object]", kept).items()
    return {k: v for k, v in pairs if isinstance(k, str) and isinstance(v, bool)}


def view(store: Store) -> dict[str, Any]:
    return {"flags": _flags(store)}


def switch(store: Store, body: dict[str, Any]) -> dict[str, Any]:
    feature, on = body.get("id"), body.get("on")
    if not isinstance(feature, str) or not ID.match(feature):
        raise Refused("Name the feature by its id, such as journal.")
    if not isinstance(on, bool):
        raise Refused("Say on as true or false.")
    if feature in ALWAYS_ON and not on:
        raise Refused("Dashboard and Settings stay on, so you can always get back here.")
    flags = _flags(store)
    if feature not in flags and len(flags) >= MAX_FLAGS:
        raise Refused(f"At most {MAX_FLAGS} features can be switched.")
    flags[feature] = on
    store.set_setting(KEY, json.dumps(flags, sort_keys=True))
    return view(store)
