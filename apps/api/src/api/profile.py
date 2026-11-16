"""The owner's Profile, their Investment Policy Statement (decision 58): one typed document,
saved as numbered versions in SQLite, and the source every agent reads as Markdown.

A rule left empty is `None`: shown as "Not set" and enforced nowhere. Goals, minimum cash and
the deposit cap can be locked, and then only the owner can change them; a proposal from the
command bar or an agent that touches one is refused.
"""

import json
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, cast

from api.audit import Audit
from api.binance import plain
from api.store import Store
from api.trading import Refused

SECTIONS = (
    "identity",
    "income",
    "goals",
    "foundations",
    "strategy",
    "rules",
    "holdings",
    "lessons",
    "quotes",
    "additional_info",
)
TITLES = {
    "identity": "Identity",
    "income": "Income",
    "goals": "Goals",
    "foundations": "Foundations",
    "strategy": "Strategy",
    "rules": "Rules",
    "holdings": "Holdings",
    "lessons": "Lessons",
    "quotes": "Quotes",
    "additional_info": "Additional info",
}
OWNER = "You"
LOCKS = ("goals", "min_cash", "deposit_cap")
LOCK_LABELS = {"goals": "Goals", "min_cash": "Minimum cash", "deposit_cap": "Deposit cap"}
COIN = re.compile(r"[A-Z0-9]{1,15}")
DAY = re.compile(r"\d{4}-\d{2}-\d{2}")
PLAIN_NUMBER = re.compile(r"-?\d{1,15}(\.\d{1,15})?")
SUMMARY_PARTS = 2
MAX_MONEY = Decimal(1_000_000_000)


@dataclass(frozen=True)
class Field:
    """One typed field: its key, its label for people and agents, and what it holds."""

    key: str
    label: str
    kind: str  # text, money, pct, num, date, choice, texts, bool, coinpct, year
    limit: int = 200
    choices: tuple[str, ...] = ()
    low: Decimal = Decimal(0)
    high: Decimal = MAX_MONEY


def _pct(key: str, label: str, low: int = 1, high: int = 100) -> Field:
    return Field(key, label, "pct", low=Decimal(low), high=Decimal(high))


# Sections that are one record, in the order they're shown.
RECORDS: dict[str, tuple[Field, ...]] = {
    "identity": (
        Field("name", "Name", "text", 60),
        Field("date_of_birth", "Date of birth", "date"),
    ),
    "income": (
        Field("gross_monthly_aud", "Earnings a month (A$)", "money"),
        Field("after_tax_monthly_aud", "After tax a month (A$)", "money"),
        Field("living_monthly_aud", "Living costs a month (A$)", "money"),
        Field("available_monthly_aud", "Available to invest a month (A$)", "money"),
        Field("notes", "Notes", "text", 2000),
    ),
    "foundations": (
        Field("emergency_fund_aud", "Emergency fund (A$)", "money"),
        Field("emergency_months", "Emergency fund (months)", "num", high=Decimal(60)),
        Field("parked_funds_aud", "Parked funds (A$)", "money"),
        Field("min_cash_aud", "Minimum cash (A$)", "money"),
        Field("insurance", "Insurance", "texts", 200),
        Field(
            "health_cover_status", "Health cover", "choice", choices=("none", "parked", "active")
        ),
        Field("health_cover_monthly_aud", "Health cover a month (A$)", "money"),
        Field("debt", "Debt", "text", 200),
        Field("wills", "Wills", "text", 200),
    ),
    "strategy": (
        Field("text", "Strategy", "text", 4000),
        Field("focus", "Focus", "text", 300),
        Field("targets", "Target allocation", "coinpct"),
    ),
    "rules": (
        Field("monthly_deposit_cap_aud", "Monthly deposit cap (A$)", "money"),
        Field(
            "deposit_cadence",
            "Deposit cadence",
            "choice",
            choices=("weekly", "fortnightly", "monthly"),
        ),
        _pct("max_pct_per_coin", "Max % per coin"),
        Field("per_trade_aud", "Per-trade size (A$)", "money"),
        _pct("max_loss_pct", "Max loss a position (%)"),
        _pct("rebalance_band", "Rebalance band (± points)", 1, 50),
        Field("take_profit_rule", "Take-profit rule", "text", 500),
        Field("entry_strategy", "Entry strategy", "text", 500),
        Field("behaviour_rules", "Behaviour rules", "texts", 160),
    ),
}
# Sections that are a list of records.
LISTS: dict[str, tuple[Field, ...]] = {
    "goals": (
        Field("label", "Goal", "text", 120),
        Field("amount", "Amount", "money"),
        Field("currency", "Currency", "choice", choices=("AUD", "USD")),
        Field("date", "By", "date"),
        Field("then_rule", "Then", "text", 200),
    ),
    "holdings": (
        Field("name", "Holding", "text", 60),
        Field("source", "Source", "choice", choices=("binance", "taostats", "manual")),
        Field("invested_aud", "Invested (A$)", "money"),
        Field("value_aud", "Value (A$, manual only)", "money"),
        Field("cash", "Counts as cash", "bool"),
        Field("counts", "Counts toward goals", "bool"),
    ),
    "lessons": (
        Field("year", "Year", "year", low=Decimal(1900), high=Decimal(2200)),
        Field("text", "Lesson", "text", 400),
    ),
    "quotes": (Field("text", "Quote", "text", 200), Field("author", "By", "text", 60)),
}
LIST_LIMITS = {"goals": 10, "holdings": 30, "lessons": 100, "quotes": 50}
REQUIRED = {"goals": "amount", "holdings": "name", "lessons": "text", "quotes": "text"}
MORE_TEXT_LIMIT = 10_000
LOCKED_PATHS = {
    "goals": ("goals",),
    "min_cash": ("foundations", "min_cash_aud"),
    "deposit_cap": ("rules", "monthly_deposit_cap_aud"),
}


def empty() -> dict[str, Any]:
    """A profile with nothing set: every field null, every list empty, nothing locked."""
    doc: dict[str, Any] = {
        name: {f.key: [] if f.kind in ("texts", "coinpct") else None for f in fields}
        for name, fields in RECORDS.items()
    }
    doc |= {name: [] for name in LISTS}
    doc["additional_info"] = ""
    doc["locks"] = dict.fromkeys(LOCKS, False)
    return doc


# Checking a document.


def _dict(item: object) -> dict[str, Any]:
    return cast(dict[str, Any], item) if isinstance(item, dict) else {}


def _blank(value: object) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def number(  # noqa: PLR0913 - the value, how it reads, and its bounds
    value: object, label: str, low: Decimal, high: Decimal, places: int = 2
) -> Decimal:
    """A number as the owner might type it: commas, A$ and a K or M suffix are fine. Plain
    digits only, at most `places` decimals: an exponent such as 1e-200000 would save a string
    of 200,000 characters."""
    text = str(value).strip().upper().replace(",", "").replace("A$", "").replace("US$", "")
    text = text.removeprefix("$").removesuffix("%").strip()
    scale = Decimal(1)
    if text.endswith("K"):
        text, scale = text[:-1], Decimal(1000)
    elif text.endswith("M"):
        text, scale = text[:-1], Decimal(1_000_000)
    if not PLAIN_NUMBER.fullmatch(text):
        raise Refused(f"{label} must be a number.")
    found = Decimal(text) * scale
    if not low <= found <= high:
        raise Refused(f"{label} must be from {plain(low)} to {plain(high)}.")
    if found != found.quantize(Decimal(1).scaleb(-places)):
        raise Refused(
            f"{label} takes {'whole numbers' if places == 0 else f'up to {places} decimals'}."
        )
    return found


def _field(f: Field, value: object) -> Any:  # noqa: PLR0911 - one return per kind
    if f.kind == "texts":
        items = cast(list[Any], value) if isinstance(value, list) else []
        texts = [" ".join(str(v).split())[: f.limit] for v in items]
        return [t for t in texts if t][:30]
    if f.kind == "coinpct":
        return _targets(value)
    if f.kind == "bool":
        return value is True
    if _blank(value):
        return None
    if f.kind == "text":
        return str(value).strip()[: f.limit]
    if f.kind in ("money", "pct", "num", "year"):
        return plain(number(value, f.label, f.low, f.high, 0 if f.kind == "year" else 2))
    if f.kind == "date":
        return _day(f, value)
    choice = str(value).strip().lower() if f.key != "currency" else str(value).strip().upper()
    if choice not in f.choices:
        raise Refused(f"{f.label} must be one of {', '.join(f.choices)}.")
    return choice


def _day(f: Field, value: object) -> str:
    day = str(value).strip()
    try:
        date.fromisoformat(day)
    except ValueError:
        raise Refused(f"{f.label} must be a date, such as 2030-12-31.") from None
    if not DAY.fullmatch(day):
        raise Refused(f"{f.label} must be a date, such as 2030-12-31.")
    return day


def _targets(value: object) -> list[dict[str, str]]:
    items = cast(list[Any], value) if isinstance(value, list) else []
    found: list[dict[str, str]] = []
    for raw in items[:20]:
        item = _dict(raw)
        coin = str(item.get("coin", "")).strip().upper()
        if not COIN.fullmatch(coin):
            raise Refused("Each target needs a coin, such as BTC.")
        pct = number(item.get("pct"), f"{coin}'s target", Decimal(0), Decimal(100))
        found.append({"coin": coin, "pct": plain(pct)})
    return found


def clean_section(name: str, value: object) -> Any:
    """One section, checked against its fields; raises Refused when it doesn't fit."""
    if name == "additional_info":
        return str(value or "").strip()[:MORE_TEXT_LIMIT]
    if name in RECORDS:
        raw = _dict(value)
        return {f.key: _field(f, raw.get(f.key)) for f in RECORDS[name]}
    if name in LISTS:
        if not isinstance(value, list):
            raise Refused(f"{TITLES[name]} must be a list.")
        items = cast(list[Any], value)
        if len(items) > LIST_LIMITS[name]:
            raise Refused(f"Keep {TITLES[name].lower()} to {LIST_LIMITS[name]}.")
        rows = [{f.key: _field(f, _dict(item).get(f.key)) for f in LISTS[name]} for item in items]
        need = REQUIRED[name]
        if any(row[need] is None for row in rows):
            label = next(f.label for f in LISTS[name] if f.key == need)
            raise Refused(f"Each of your {TITLES[name].lower()} needs its {label.lower()}.")
        return rows
    raise Refused("No such section of the profile.")


def clean(doc: object) -> dict[str, Any]:
    """A whole document, checked; missing sections are empty."""
    raw = _dict(doc)
    base = empty()
    found = {name: clean_section(name, raw.get(name, base[name])) for name in SECTIONS}
    locks = _dict(raw.get("locks"))
    found["locks"] = {name: locks.get(name) is True for name in LOCKS}
    return found


# Reading and comparing versions.


def current(store: Store) -> tuple[int, dict[str, Any]]:
    """The latest version's number and document; version 0 and an empty one before any."""
    row = store.latest_profile()
    if row is None:
        return 0, empty()
    return int(row["n"]), clean(json.loads(row["doc"]))


def _shown(f: Field, value: object) -> str:  # noqa: PLR0911 - one return per kind
    if value is None or value in ([], ""):
        return "Not set"
    if f.kind == "money":
        return f"A${Decimal(str(value)):,.0f}"
    if f.kind == "pct":
        return f"{value}%"
    if f.kind == "texts":
        return "; ".join(cast(list[str], value))
    if f.kind == "coinpct":
        return ", ".join(f"{t['coin']} {t['pct']}%" for t in cast(list[dict[str, str]], value))
    if f.kind == "bool":
        return "yes" if value else "no"
    return str(value)


def _row_name(section: str, row: dict[str, Any]) -> str:
    if section == "goals":
        currency = "US$" if row["currency"] == "USD" else "A$"
        amount = Decimal(row["amount"])
        return f"{currency}{amount:,.0f}" + (f" by {row['date'][:4]}" if row["date"] else "")
    if section == "lessons":
        return f"{row['year'] or 'undated'} lesson"
    if section == "quotes":
        return f"quote “{str(row['text'])[:30]}”"
    return str(row["name"])


def changes(old: dict[str, Any], new: dict[str, Any]) -> list[dict[str, str]]:
    """Every difference, as section, label, from and to, for summaries and the diff on a card."""
    found: list[dict[str, str]] = []
    for name in SECTIONS:
        if old[name] == new[name]:
            continue
        if name in RECORDS:
            for f in RECORDS[name]:
                before, after = old[name][f.key], new[name][f.key]
                if before != after:
                    found.append(
                        {
                            "section": name,
                            "key": f.key,
                            "label": f.label,
                            "from": _shown(f, before),
                            "to": _shown(f, after),
                        }
                    )
        elif name in LISTS:
            found += _list_changes(name, old[name], new[name])
        else:
            found.append(
                {"section": name, "key": name, "label": TITLES[name], "from": "", "to": "edited"}
            )
    for lock in LOCKS:
        if old["locks"][lock] != new["locks"][lock]:
            state = "locked" if new["locks"][lock] else "unlocked"
            found.append(
                {
                    "section": "locks",
                    "key": lock,
                    "label": LOCK_LABELS[lock],
                    "from": "",
                    "to": state,
                }
            )
    return found


def _list_changes(
    name: str, old: list[dict[str, Any]], new: list[dict[str, Any]]
) -> list[dict[str, str]]:
    before = _named_rows(name, old)
    after = _named_rows(name, new)
    found: list[dict[str, str]] = []
    for key, row in after.items():
        if key not in before:
            found.append(_item(name, key, "", "added"))
        elif before[key] != row:
            found.append(_item(name, key, "", "changed"))
    found += [_item(name, key, "", "removed") for key in before if key not in after]
    if not found:  # only the order changed
        found.append(_item(name, TITLES[name], "", "reordered"))
    return found


def _named_rows(name: str, rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Each row by its name, with a count for a second row of the same name."""
    found: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = base = _row_name(name, row)
        n = 2
        while key in found:
            key, n = f"{base} ({n})", n + 1
        found[key] = row
    return found


def _item(section: str, label: str, before: str, after: str) -> dict[str, str]:
    return {"section": section, "key": label, "label": label, "from": before, "to": after}


def summary(found: list[dict[str, str]]) -> str:
    """One line for the history: the first two changes and how many more."""
    parts: list[str] = []
    for c in found[:SUMMARY_PARTS]:
        if c["from"]:
            parts.append(f"{c['label']} {c['from']} → {c['to']}")
        elif c["section"] in LISTS:
            parts.append(f"{c['to'].capitalize()} {c['label']}")
        else:
            parts.append(f"{c['label']} {c['to']}")
    more = len(found) - SUMMARY_PARTS
    return "; ".join(parts) + (f"; and {more} more" if more > 0 else "")


def locked_touched(old: dict[str, Any], new: dict[str, Any]) -> list[str]:
    """The locked fields a change would alter, by name."""
    touched: list[str] = []
    for lock, path in LOCKED_PATHS.items():
        if not old["locks"][lock]:
            continue
        before: Any = old
        after: Any = new
        for part in path:
            before, after = before[part], after[part]
        if before != after or not new["locks"][lock]:
            touched.append(LOCK_LABELS[lock])
    return touched


# Saving.


def save(  # noqa: PLR0913 - each is a separate fact about the save
    store: Store,
    audit: Audit,
    doc: object,
    *,
    author: str,
    now: int,
    reason: str = "",
    summary_text: str | None = None,
    write: bool = True,
) -> dict[str, Any]:
    """Saves a new version and, unless it came from the file, its Markdown. Only the owner may
    change a locked field."""
    from api.md_files import written  # noqa: PLC0415 - the files read this module
    from api.profile_md import export  # noqa: PLC0415 - the Markdown reads this module

    _, old = current(store)
    new = clean(doc)
    found = changes(old, new)
    if not found:
        raise Refused("Nothing changed.")
    if author != OWNER:
        touched = locked_touched(old, new)
        if touched:
            raise Refused(f"{', '.join(touched)} locked: unlock on the card first.")
    line = summary_text or summary(found)
    why = " ".join(str(reason or "").split())[:200]
    version = store.add_profile_version(now, author[:40], line, why, json.dumps(new))
    if write:
        text = export(new, version, now)
        store.profile_md.write_text(text, encoding="utf-8")
        written(store, "profile", text)
    audit.record("profile", f"Profile v{version} by {author}", line)
    return view(store)


def save_section(  # noqa: PLR0913 - each is a separate fact about the edit
    store: Store, audit: Audit, section: str, value: object, *, now: int, reason: str = ""
) -> dict[str, Any]:
    """The owner's own edit of one card."""
    if section not in SECTIONS and section != "locks":
        raise Refused("No such section of the profile.")
    _, doc = current(store)
    return save(store, audit, doc | {section: value}, author=OWNER, now=now, reason=reason)


def restore(store: Store, audit: Audit, n: int, now: int) -> dict[str, Any]:
    """Brings back an old version as a new one; history is never rewritten."""
    row = store.profile_version(n)
    if row is None:
        raise Refused("No such version.")
    return save(
        store,
        audit,
        json.loads(row["doc"]),
        author=OWNER,
        now=now,
        summary_text=f"Restored v{n}",
    )


# What the page shows.


def section_times(store: Store) -> dict[str, int | None]:
    """When each section last changed, from the versions."""
    times: dict[str, int | None] = dict.fromkeys(SECTIONS)
    previous = empty()
    for row in store.profile_versions():
        doc = clean(json.loads(row["doc"]))
        for name in SECTIONS:
            if doc[name] != previous[name]:
                times[name] = int(row["time"])
        previous = doc
    return times


def history(store: Store) -> list[dict[str, Any]]:
    """Every version, newest first, without its document."""
    return [
        {k: row[k] for k in ("n", "time", "author", "summary", "reason")}
        for row in reversed(store.profile_versions())
    ]


def view(store: Store) -> dict[str, Any]:
    row = store.latest_profile()
    n, doc = current(store)
    return {
        "version": n,
        "time": int(row["time"]) if row else None,
        "profile": doc,
        "updated": section_times(store),
    }


def age(doc: dict[str, Any], today: date | None = None) -> int | None:
    born = doc["identity"]["date_of_birth"]
    if not born:
        return None
    day = date.fromisoformat(born)
    now = today or date.today()  # noqa: DTZ011 - a birthday is a calendar day, not a moment
    return now.year - day.year - ((now.month, now.day) < (day.month, day.day))


def for_model(doc: dict[str, Any]) -> dict[str, Any]:
    """Identity as the model reads it: the name and an age, never the date of birth."""
    return {"name": doc["identity"]["name"], "age": age(doc)}


def rule(doc: dict[str, Any], key: str) -> Decimal | None:
    """A rule's number, or None when the owner hasn't set it."""
    raw = doc["rules"].get(key)
    return Decimal(raw) if raw is not None else None
