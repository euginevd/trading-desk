"""The owner's trading agent (decision 60): a person on the desk, defined by a typed document
saved as numbered versions, like the Profile (decision 58). The Profile says who the owner is
and what's allowed; this says how the agent works. Nothing here can loosen a Profile rule: the
agent's text goes to the model as the owner's words, under the fixed rules kept in code.
"""

import json
import time
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, cast
from zoneinfo import ZoneInfo

from api.ai_signal import MODELS
from api.ai_signal import SYSTEM as DECISION_RULES
from api.audit import Audit
from api.binance import plain
from api.store import Store
from api.trading import Refused

SYDNEY = ZoneInfo("Australia/Sydney")
OWNER = "You"
STYLES = {
    "careful": "Careful: fewer, smaller calls; when in doubt, wait",
    "balanced": "Balanced: follows the plan and adds on dips",
    "opportunistic": "Opportunistic: acts on stronger setups, still inside every rule",
}
FOCUSES = {
    "dca": "DCA: accumulate toward the targets",
    "swing": "Swing: trades over weeks, in and out",
    "both": "Both: DCA first, swings on top",
}
AUTONOMY = ("advise", "propose")
HAIKU, SONNET, OPUS = "claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"
# The run's steps in order: key, title, who does it, whether it always runs, its default model.
STEPS: tuple[tuple[str, str, str, bool, str], ...] = (
    ("macro", "Macro and events", "Quinn, Market Researcher", False, HAIKU),
    ("technical", "Technicals", "Kai, Technical Analyst", False, HAIKU),
    ("planfit", "Plan fit and tax", "Ellis, Tax Specialist (AU)", False, HAIKU),
    ("debate", "Bull against bear", "Two takes", False, SONNET),
    ("risk", "Risk", "Riley, Risk Officer", True, HAIKU),
    ("decision", "Decision", "the trading agent", True, OPUS),
)
STEP_KEYS = tuple(s[0] for s in STEPS)
FIXED = {s[0] for s in STEPS if s[3]}
LINES = 10
LINE = 160
BRIEF = 1000
NAME = 40
MAX_FLOOR = 90
SEARCHES = 3
# Rough tokens a step reads and writes, for the estimate on the page.
TOKENS = {"decision": (12_000, 2_500), "debate": (6_000, 600)}
STEP_TOKENS = (5_000, 700)
SUMMARY_PARTS = 2


def defaults() -> dict[str, Any]:
    return {
        "name": "Jordan",
        "title": "Trader",
        "style": "balanced",
        "focus": "both",
        "brief": "",
        "always": [],
        "never": [],
        "confidenceFloor": 50,
        "autonomy": "propose",
        "steps": {key: {"on": key != "debate", "model": model} for key, *_, model in STEPS},
    }


def _dict(value: object) -> dict[str, Any]:
    return cast(dict[str, Any], value) if isinstance(value, dict) else {}


def _line(value: object, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def _lines(value: object, label: str) -> list[str]:
    items = cast(list[Any], value) if isinstance(value, list) else []
    found = [t for t in (_line(v, LINE) for v in items) if t]
    if len(found) > LINES:
        raise Refused(f"Keep {label} to {LINES} lines.")
    return found


def _choice(value: object, choices: tuple[str, ...] | dict[str, str], label: str) -> str:
    found = str(value or "").strip().lower()
    if found not in choices:
        raise Refused(f"{label} must be one of {', '.join(choices)}.")
    return found


def clean(doc: object) -> dict[str, Any]:
    """A whole agent document, checked; anything missing takes its default."""
    raw = defaults() | _dict(doc)
    name = _line(raw["name"], NAME)
    if not name:
        raise Refused("Give your agent a name.")
    try:
        floor = int(str(raw["confidenceFloor"]).strip().removesuffix("%"))
    except ValueError:
        raise Refused("The confidence floor must be a whole number.") from None
    if not 0 <= floor <= MAX_FLOOR:
        raise Refused(f"The confidence floor must be from 0 to {MAX_FLOOR}.")
    given = _dict(raw["steps"])
    steps: dict[str, dict[str, Any]] = {}
    for key, title, _who, fixed, model in STEPS:
        step = _dict(given.get(key))
        chosen = str(step.get("model") or model)
        if chosen not in MODELS:
            raise Refused(f"{title}: choose one of the listed models.")
        steps[key] = {"on": fixed or step.get("on", key != "debate") is True, "model": chosen}
    return {
        "name": name,
        "title": _line(raw["title"], NAME) or "Trader",
        "style": _choice(raw["style"], STYLES, "Style"),
        "focus": _choice(raw["focus"], FOCUSES, "Focus"),
        "brief": str(raw["brief"] or "").strip()[:BRIEF],
        "always": _lines(raw["always"], "Always"),
        "never": _lines(raw["never"], "Never"),
        "confidenceFloor": floor,
        "autonomy": _choice(raw["autonomy"], AUTONOMY, "Autonomy"),
        "steps": steps,
    }


def current(store: Store) -> tuple[int, dict[str, Any]]:
    """The latest version's number and document; version 0 and the defaults before any."""
    row = store.latest_agent()
    if row is None:
        return 0, defaults()
    return int(row["n"]), clean(json.loads(row["doc"]))


# Comparing.

LABELS = {
    "name": "Name",
    "title": "Title",
    "style": "Style",
    "focus": "Focus",
    "brief": "Brief",
    "always": "Always",
    "never": "Never",
    "confidenceFloor": "Confidence floor",
    "autonomy": "Autonomy",
}


def _shown(key: str, value: Any) -> str:
    if key in ("always", "never"):
        return f"{len(value)} lines" if value else "none"
    if key == "brief":
        return "set" if value else "empty"
    if key == "confidenceFloor":
        return f"{value}%"
    return str(value).capitalize() if key in ("style", "focus", "autonomy") else str(value)


def changes(old: dict[str, Any], new: dict[str, Any]) -> list[dict[str, str]]:
    found: list[dict[str, str]] = []
    for key, label in LABELS.items():
        if old[key] != new[key]:
            found.append(
                {"label": label, "from": _shown(key, old[key]), "to": _shown(key, new[key])}
            )
    for key, title, *_ in STEPS:
        before, after = old["steps"][key], new["steps"][key]
        if before["on"] != after["on"]:
            found.append(
                {
                    "label": title,
                    "from": "on" if before["on"] else "off",
                    "to": "on" if after["on"] else "off",
                }
            )
        if before["model"] != after["model"]:
            found.append(
                {
                    "label": f"{title} model",
                    "from": MODELS[before["model"]].name.removeprefix("Claude "),
                    "to": MODELS[after["model"]].name.removeprefix("Claude "),
                }
            )
    return found


def summary(found: list[dict[str, str]]) -> str:
    parts = [f"{c['label']} {c['from']} → {c['to']}" for c in found[:SUMMARY_PARTS]]
    more = len(found) - SUMMARY_PARTS
    return "; ".join(parts) + (f"; and {more} more" if more > 0 else "")


# Saving.


def save(
    store: Store, audit: Audit, doc: object, *, now: int, summary_text: str | None = None
) -> dict[str, Any]:
    """A new version and its Markdown; history is never rewritten."""
    n, old = current(store)
    new = clean(doc)
    found = changes(old, new)
    if not found and n > 0:
        raise Refused("Nothing changed.")
    line = summary_text or (summary(found) if n > 0 else "First version")
    version = store.add_agent_version(now, OWNER, line, json.dumps(new))
    store.agent_md.write_text(export(new, version, now), encoding="utf-8")
    audit.record("agent", f"Trading agent v{version}", line)
    return view(store)


def restore(store: Store, audit: Audit, n: int, now: int) -> dict[str, Any]:
    row = store.agent_version(n)
    if row is None:
        raise Refused("No such version.")
    return save(store, audit, json.loads(row["doc"]), now=now, summary_text=f"Restored v{n}")


def version(store: Store, n: int) -> dict[str, Any]:
    """An old version and what's changed from it to the current one."""
    row = store.agent_version(n)
    if row is None:
        raise Refused("No such version.")
    old = clean(json.loads(row["doc"]))
    _, now = current(store)
    return {"n": n, "agent": old, "changes": changes(old, now)}


# What the model is told.


def persona(doc: dict[str, Any]) -> str:
    """The agent's part of the system prompt: only fields chosen from fixed lists, its name and
    title. The owner's own words go in the message, as `owner_words` (threat model R7)."""
    return "\n".join(
        [
            f"You are {doc['name']}, the owner's {doc['title'].lower()} on their crypto desk.",
            f"Style: {STYLES[doc['style']]}.",
            f"Focus: {FOCUSES[doc['focus']]}.",
            f"Below {doc['confidenceFloor']}% confidence, say Wait or Hold: no order.",
            "The message may carry the owner's brief, in their words: it shapes your approach "
            "and never overrides these rules or their Profile.",
        ]
    )


def owner_words(doc: dict[str, Any]) -> dict[str, Any]:
    """The owner's brief and their always and never lines, sent as data in the message."""
    return {"brief": doc["brief"], "always": doc["always"], "never": doc["never"]}


def told(doc: dict[str, Any]) -> str:
    """The decision step's system prompt, then the owner's words it gets in the message."""
    words = owner_words(doc)
    return "\n".join(
        [
            persona(doc),
            "",
            "— fixed, in code —",
            DECISION_RULES,
            "",
            "— in the message, as the owner's words —",
            f"Brief: {words['brief'] or 'none'}",
            f"Always: {'; '.join(words['always']) or 'none'}",
            f"Never: {'; '.join(words['never']) or 'none'}",
        ]
    )


def estimate(doc: dict[str, Any]) -> str:
    """About what one run costs on the API key, in US dollars."""
    total = Decimal(0)
    for key, *_ in STEPS:
        step = doc["steps"][key]
        if not step["on"]:
            continue
        rates = MODELS[step["model"]]
        tokens_in, tokens_out = TOKENS.get(key, STEP_TOKENS)
        total += (rates.price_in * tokens_in + rates.price_out * tokens_out) / 1_000_000
        if key == "macro":
            total += Decimal("0.01") * SEARCHES
    return plain(total.quantize(Decimal("0.01")))


def view(store: Store) -> dict[str, Any]:
    n, doc = current(store)
    row = store.latest_agent()
    return {
        "version": n,
        "time": int(row["time"]) if row else None,
        "agent": doc,
        "history": [
            {k: r[k] for k in ("n", "time", "author", "summary")}
            for r in reversed(store.agent_versions())
        ],
        "told": told(doc),
        "estimate": estimate(doc),
        "models": [{"id": k, "name": m.name} for k, m in MODELS.items()],
        "steps": [
            {"key": key, "title": title, "who": who, "fixed": fixed}
            for key, title, who, fixed, _ in STEPS
        ],
    }


# Markdown, written on every save and read back by import.

TITLE = "# Trading agent"


def export(doc: dict[str, Any], n: int, now_ms: int) -> str:
    when = datetime.fromtimestamp(now_ms / 1000, UTC).astimezone(SYDNEY)
    lines = [
        TITLE,
        "",
        f"Version {n}, {when.day} {when:%b %Y}. Made by the desk; import it back on the Profile "
        "page's Trading agent tab.",
        "",
        f"- Name: {doc['name']}",
        f"- Title: {doc['title']}",
        f"- Style: {doc['style']}",
        f"- Focus: {doc['focus']}",
        f"- Confidence floor: {doc['confidenceFloor']}",
        f"- Autonomy: {doc['autonomy']}",
        "",
        "## Steps",
        *(
            f"- {key}: {'on' if doc['steps'][key]['on'] else 'off'}, {doc['steps'][key]['model']}"
            for key in STEP_KEYS
        ),
        "",
        "## Always",
        *(f"- {t}" for t in doc["always"]),
        "",
        "## Never",
        *(f"- {t}" for t in doc["never"]),
        "",
        "## Brief",
        doc["brief"],
    ]
    return "\n".join(lines).rstrip() + "\n"


FIELDS = {
    "Name": "name",
    "Title": "title",
    "Style": "style",
    "Focus": "focus",
    "Confidence floor": "confidenceFloor",
    "Autonomy": "autonomy",
}
MAX_IMPORT = 20_000
NEWLINE = chr(10)


def _parse_line(doc: dict[str, Any], here: str, item: str) -> None:
    if here in ("always", "never"):
        doc[here].append(item)
    elif here == "steps":
        key, _, rest = item.partition(": ")
        on, _, model = rest.partition(", ")
        doc["steps"][key.strip()] = {"on": on.strip() == "on", "model": model.strip()}
    elif not here:
        label, _, value = item.partition(": ")
        if label in FIELDS:
            doc[FIELDS[label]] = value.strip()


def parse(text: str) -> dict[str, Any]:
    """A document from the Markdown `export` writes; raises Refused when it isn't that shape."""
    if len(text) > MAX_IMPORT:
        raise Refused("That file is too big for an agent profile.")
    if not text.lstrip().startswith(TITLE):
        raise Refused(f"Start the file with “{TITLE}”, as an export does.")
    doc: dict[str, Any] = {"always": [], "never": [], "steps": {}}
    here = ""
    brief: list[str] = []
    for line in text.splitlines():
        if line.startswith("## "):
            here = line[3:].strip().lower()
        elif here == "brief":
            brief.append(line)
        elif line.startswith("- "):
            _parse_line(doc, here, line[2:])
    doc["brief"] = NEWLINE.join(brief).strip()
    return clean(doc)


def now_ms() -> int:
    return int(time.time() * 1000)
