"""The Profile as Markdown (decision 58): written from the data on every save, read by every
agent, and read back by import. One fixed shape, so import is exact: a heading per section,
`- Label: value` per field, `|` between a list item's fields, "Not set" for an empty one. A
backslash keeps a value's own `|`, `;` or "Not set" from reading as the shape's."""

import re
import time
from datetime import UTC, datetime
from typing import Any, cast
from zoneinfo import ZoneInfo

from api import profile_v2
from api.profile import (
    LISTS,
    LOCK_LABELS,
    LOCKS,
    RECORDS,
    SECTIONS,
    TITLES,
    Field,
    age,
    clean,
    current,
)
from api.store import Store
from api.trading import Refused

SYDNEY = ZoneInfo("Australia/Sydney")
NOT_SET = "Not set"
LOCKED_TITLE = "Locked"
NEWLINE = chr(10)
BLOCK = 500  # a text field longer than this is written as a quoted block
MAX_IMPORT = 200_000


ESCAPED = re.compile(r"\\(.)")


def _escape(text: str) -> str:
    """One line, with the shape's own marks kept as text."""
    kept = " ".join(text.split()).replace("\\", "\\\\").replace("|", "\\|").replace(";", "\\;")
    return "\\" + kept if kept == NOT_SET else kept


def _unescape(text: str) -> str:
    return ESCAPED.sub(lambda m: m.group(1), text)


def _split_on(text: str, mark: str) -> list[str]:
    """Split where `mark` isn't escaped."""
    parts: list[str] = []
    here, i = "", 0
    while i < len(text):
        if text[i] == "\\" and i + 1 < len(text):
            here, i = here + text[i : i + 2], i + 2
        elif text.startswith(mark, i):
            parts, here, i = [*parts, here], "", i + len(mark)
        else:
            here, i = here + text[i], i + 1
    return [*parts, here]


def _value(f: Field, value: Any) -> str:
    if value is None or value in ([], ""):
        return NOT_SET
    if f.kind == "texts":
        return "; ".join(_escape(t) for t in cast(list[str], value))
    if f.kind == "coinpct":
        return ", ".join(f"{t['coin']} {t['pct']}%" for t in cast(list[dict[str, str]], value))
    if f.kind == "bool":
        return "yes" if value else "no"
    return _escape(str(value))


def _record(fields: tuple[Field, ...], data: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    for f in fields:
        value = data[f.key]
        if f.kind == "text" and f.limit > BLOCK and value:
            lines.append(f"- {f.label}:")
            lines += [f"  > {line}".rstrip() for line in str(value).splitlines()]
        else:
            lines.append(f"- {f.label}: {_value(f, value)}")
    return lines


def export(doc: dict[str, Any], version: int, now_ms: int, *, age_only: bool = False) -> str:
    """The whole Profile; `age_only` gives an age in place of the date of birth, for a model.
    A v2 document is its own file (decision 62)."""
    if doc.get("markdown"):
        if age_only:
            return profile_v2.for_agents(doc["markdown"], datetime.now(SYDNEY).date())
        return str(doc["markdown"])
    when = datetime.fromtimestamp(now_ms / 1000, UTC).astimezone(SYDNEY)
    lines = [
        "# Profile",
        "",
        f"Version {version}, {when.day} {when:%b %Y}. Made by the desk from the Profile page; "
        "import it back there. A rule marked Not set is no rule: nothing enforces it.",
    ]
    for name in SECTIONS[:-1]:  # Additional info goes last, after Locked: it holds any Markdown
        lines += ["", f"## {TITLES[name]}"]
        if name == "identity" and age_only:
            years = age(doc)
            lines += [f"- Name: {_value(RECORDS[name][0], doc[name]['name'])}"]
            lines += [f"- Age: {years if years is not None else NOT_SET}"]
        elif name in RECORDS:
            lines += _record(RECORDS[name], doc[name])
        else:
            rows = cast(list[dict[str, Any]], doc[name])
            lines += [
                "- " + " | ".join(f"{f.label}: {_value(f, row[f.key])}" for f in LISTS[name])
                for row in rows
            ] or ["- None"]
    lines += ["", f"## {LOCKED_TITLE}"]
    lines += [f"- {LOCK_LABELS[k]}: {'yes' if doc['locks'][k] else 'no'}" for k in LOCKS]
    lines += ["", f"## {TITLES['additional_info']}", str(doc["additional_info"]) or NOT_SET]
    return "\n".join(lines).rstrip() + "\n"


# Reading it back.


def _split(text: str) -> tuple[dict[str, list[str]], str]:
    """Each section's lines by title; Additional info runs to the end of the file."""
    found: dict[str, list[str]] = {}
    more: list[str] = []
    here: str | None = None
    titles = {title: name for name, title in TITLES.items()} | {LOCKED_TITLE: "locks"}
    for line in text.splitlines():
        if here == "additional_info":
            more.append(line)
            continue
        if line.startswith("## "):
            here = titles.get(line[3:].strip())
            if here is None:
                raise Refused(
                    f"Unknown section “{line[3:].strip()[:40]}”: export first to see the shape."
                )
            found[here] = []
        elif here is not None:
            found[here].append(line)
    text_more = "\n".join(more).strip()
    return found, "" if text_more == NOT_SET else text_more


def _pairs(fields: tuple[Field, ...], line: str, *, row: bool = True) -> dict[str, str]:
    """A list row's fields, split on its unescaped bars; a record's one field, whole."""
    labels = {f.label: f for f in fields}
    found: dict[str, str] = {}
    for part in _split_on(line, " | ") if row else [line]:
        label, sep, value = part.partition(": ")
        if not sep:
            label, value = part.rstrip(":"), ""
        f = labels.get(label.strip())
        if f is None:
            raise Refused(f"Unknown field “{label.strip()[:40]}”.")
        found[f.key] = value.strip()
    return found


def _typed(f: Field, raw: str | None) -> Any:
    if raw is None or raw == NOT_SET:
        return [] if f.kind in ("texts", "coinpct") else None
    if f.kind == "texts":
        return [_unescape(t.strip()) for t in _split_on(raw, "; ") if t.strip()]
    if f.kind == "coinpct":
        targets: list[dict[str, str]] = []
        for part in raw.split(","):
            coin, _, pct = part.strip().partition(" ")
            targets.append({"coin": coin, "pct": pct.removesuffix("%")})
        return targets
    if f.kind == "bool":
        return raw.lower() == "yes"
    return _unescape(raw)


def _read_record(fields: tuple[Field, ...], lines: list[str]) -> dict[str, Any]:
    raw: dict[str, str] = {}
    blocks: set[str] = set()  # written as quoted lines, as they are: read back as they are
    block: str | None = None
    for line in lines:
        if line.startswith("  > ") or line.rstrip() == "  >":
            if block is not None:
                raw[block] = (raw[block] + NEWLINE + line[4:]).lstrip(NEWLINE)
            continue
        if not line.startswith("- "):
            continue
        pair = _pairs(fields, line[2:], row=False)
        key, value = next(iter(pair.items()))
        raw[key] = value
        block = key if value == "" else None
        if block:
            blocks.add(block)
    return {f.key: raw[f.key] if f.key in blocks else _typed(f, raw.get(f.key)) for f in fields}


def parse(text: str) -> dict[str, Any]:
    """A document from the Markdown `export` writes; raises Refused when it isn't that shape."""
    if len(text) > MAX_IMPORT:
        raise Refused("That file is too big for a profile.")
    if profile_v2.is_v2(text):
        return clean(profile_v2.parse(text))
    if not text.lstrip().startswith("# Profile"):
        raise Refused("Start the file with “# Profile”, as an export does.")
    found, more = _split(text)
    doc: dict[str, Any] = {"additional_info": more}
    for name, fields in RECORDS.items():
        doc[name] = _read_record(fields, found.get(name, []))
    for name, fields in LISTS.items():
        rows = [line[2:] for line in found.get(name, []) if line.startswith("- ")]
        doc[name] = [
            {f.key: _typed(f, pair.get(f.key)) for f in fields}
            for pair in (_pairs(fields, row) for row in rows if row != "None")
        ]
    labels = {label: key for key, label in LOCK_LABELS.items()}
    locks: dict[str, bool] = {}
    for line in found.get("locks", []):
        label, _, value = line[2:].partition(": ")
        if line.startswith("- ") and label in labels:
            locks[labels[label]] = value.strip().lower() == "yes"
    doc["locks"] = locks
    return clean(doc)


def for_agents(store: Store) -> str:
    """The latest version as every agent reads it."""
    n, doc = current(store)
    return export(doc, n, int(time.time() * 1000), age_only=True)
