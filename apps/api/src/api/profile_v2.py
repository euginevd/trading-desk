"""profile.md v2 (decision 62): the owner's own Markdown, numbered sections and all, kept word
for word as each version and given to agents unchanged but for the date of birth.

The desk reads three things from it: the figures its widgets need, taken from the file's own
lines (such as "Emergency fund (6 months): ~A$12K of A$20K"); the typed Profile the older checks
read (the pre-trade check, Analyse, the coach); and, for agents, the text with an age in place
of the date of birth. A line that can't be read leaves its figure empty, and the widget says so.
"""

import difflib
import re
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from api.binance import plain
from api.trading import Refused

SYDNEY = ZoneInfo("Australia/Sydney")
NEWLINE = chr(10)
MAX_TEXT = 200_000
MAX_EDITS = 20
SECTION = re.compile(r"^##\s+(\d+)\.\s+(.*)$")
SUBSECTION = re.compile(r"^###\s+(\d+\.\d+)\s+(.*)$")
ITEM = re.compile(r"^(\d+)\.\s+(.*)$")
MONEY = re.compile(r"(US|A)\$\s?(\d[\d,]*(?:\.\d+)?)\s*([KkMm](?![a-z]))?")
BOLD = re.compile(r"\*\*(.+?)\*\*")
DAY_TEXT = re.compile(r"(\d{1,2})\s+([A-Z][a-z]{2})[a-z]*\s+(\d{4})")
BORN = re.compile(r"Born\s+(\d{2})-(\d{2})-(\d{4})(\s*\(age\s+\d+\))?")
COINS = re.compile(r"\b[A-Z][A-Z0-9]{1,9}\b")
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
SCALE = {"K": Decimal(1000), "M": Decimal(1_000_000)}
LESSON_SHOWN = 3  # the biggest lesson: the 2021 peak
LABEL_MAX = 40


def is_v2(text: str) -> bool:
    """A v2 file: "# Profile" with numbered sections ("## 2. Goals")."""
    return text.lstrip().startswith("# Profile") and any(
        SECTION.match(line.strip()) for line in text.splitlines()
    )


# Reading the lines.


def plain_text(text: str) -> str:
    """A line without its Markdown marks."""
    return " ".join(BOLD.sub(r"\1", text).replace("`", "").split())


def amounts(text: str) -> list[tuple[str, Decimal]]:
    """Every A$ or US$ figure in a line, in order: ("AUD" or "USD", amount)."""
    found: list[tuple[str, Decimal]] = []
    for m in MONEY.finditer(text):
        value = Decimal(m.group(2).replace(",", "")) * SCALE.get((m.group(3) or "").upper(), 1)
        found.append(("USD" if m.group(1) == "US" else "AUD", value))
    return found


def _day(text: str) -> date | None:
    m = DAY_TEXT.search(text)
    if not m or m.group(2) not in MONTHS:
        return None
    try:
        return date(int(m.group(3)), MONTHS.index(m.group(2)) + 1, int(m.group(1)))
    except ValueError:
        return None


def sections(text: str) -> dict[str, list[str]]:
    """Each numbered section's items, by number ("2", "5.2"); "head" holds the lines above the
    first section, and "title:N" each section's title."""
    found: dict[str, list[str]] = {"head": []}
    key = "head"
    for raw in text.replace("\r\n", NEWLINE).split(NEWLINE):
        line = raw.strip()
        top, sub = SECTION.match(line), SUBSECTION.match(line)
        if top:
            key = top.group(1)
            found[key] = []
            found[f"title:{key}"] = [top.group(2)]
        elif sub:
            key = sub.group(1)
            found[key] = []
            found[f"title:{key}"] = [sub.group(2)]
        elif line.startswith("## "):
            key = "appendix"
            found[key] = []
        elif key == "head" and line.startswith("- "):
            found[key].append(line[2:])
        elif (m := ITEM.match(line)) and key != "appendix":
            found[key].append(m.group(2))
    return found


def _find(found: dict[str, list[str]], key: str, *words: str) -> str | None:
    """The first item in a section whose plain text holds every word, case aside."""
    for item in found.get(key, []):
        low = plain_text(item).lower()
        if all(w.lower() in low for w in words):
            return item
    return None


def _first(text: str | None, currency: str | None = None) -> Decimal | None:
    if text is None:
        return None
    found = [v for c, v in amounts(text) if currency is None or c == currency]
    return found[0] if found else None


def _last(text: str | None) -> Decimal | None:
    found = amounts(text) if text else []
    return found[-1][1] if found else None


def _after(text: str | None, pattern: str) -> Decimal | None:
    """The first figure after a phrase, such as "max" in "max A$2K a week"."""
    if text is None:
        return None
    m = re.search(pattern, text, re.IGNORECASE)
    return _first(text[m.end() :]) if m else None


# The figures.


def _identity(found: dict[str, list[str]]) -> dict[str, Any]:
    line = next((i for i in found["head"] if i.lower().startswith("name:")), "")
    name = line.partition(":")[2].split("|")[0].strip() or None
    born = BORN.search(line)
    day = None
    if born:
        try:
            day = date(int(born.group(3)), int(born.group(2)), int(born.group(1)))
        except ValueError:
            day = None
    return {"name": name, "born": day}


def age(born: date | None, today: date) -> int | None:
    if born is None:
        return None
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


def _goals(found: dict[str, list[str]]) -> list[dict[str, Any]]:
    goals: list[dict[str, Any]] = []
    for item in found.get("2", []):
        if plain_text(item).lower().startswith("milestones"):
            continue
        head = BOLD.search(item)
        text = head.group(1) if head else item
        money = amounts(text)
        due = _day(text)
        if not money or due is None or " by " not in f" {text} ":
            continue
        currency, amount = money[0]
        rest = plain_text(item[head.end() :] if head else "")
        goals.append(
            {
                "amount": amount,
                "currency": currency,
                "date": due,
                "note": re.sub(r"^\((.*?)\)", r"\1", rest.strip(" ,:")),
            }
        )
    return goals


def _milestones(found: dict[str, list[str]]) -> list[dict[str, Any]]:
    """Section 2's "Milestones: US$150K by 31 Dec 2027 | US$400K by 31 Dec 2028": the steps on
    the road to the first goal, in order. None in the file: the road has no steps but the goal."""
    line = _find(found, "2", "milestones")
    steps: list[dict[str, Any]] = []
    for part in plain_text(line or "").partition(":")[2].split("|"):
        money, due = amounts(part), _day(part)
        if money and due is not None:
            steps.append({"amount": money[0][1], "currency": money[0][0], "date": due})
    return sorted(steps, key=lambda s: s["date"])


def _rules(found: dict[str, list[str]]) -> list[dict[str, str]]:
    rules: list[dict[str, str]] = []
    for item in found.get("6", []):
        head = BOLD.search(item)
        title = head.group(1) if head else plain_text(item).split("|")[0]
        rules.append({"title": title.strip(), "text": plain_text(item)})
    return rules


def _chips(rules: list[dict[str, str]]) -> list[str]:
    """The never-break rules, as short chips, each only when its rule is in the file."""
    chips: list[str] = []
    for r in rules:
        low = r["text"].lower()
        if "leverage" in low:
            chips.append("No leverage")
        elif "thesis break" in low and "sell" in low:
            chips.append("Sell only on thesis break")
        elif low.startswith("take profit"):
            pct = re.search(r"(\d+)%", r["text"])
            found = [short(v) for _, v in amounts(r["title"])]
            steps = (
                (", ".join(found[:-1]) + " and " + found[-1]) if len(found) > 1 else "".join(found)
            )
            chips.append(f"Take {pct.group(1) if pct else '?'}% at {steps}")
        elif "speculation max" in low:
            pct = re.search(r"max\s+(\d+)%", r["text"], re.IGNORECASE)
            chips.append(f"Memes max {pct.group(1)}%" if pct else "Memes capped")
        elif "ledger" in low:
            limit = _first(r["text"])
            chips.append(f"Ledger over A${short(limit)}" if limit else "Ledger")
    order = ("No leverage", "Sell", "Take", "Memes", "Ledger")
    return sorted(chips, key=lambda c: next(i for i, o in enumerate(order) if c.startswith(o)))


def short(value: Decimal | None) -> str:
    """500000 as 500K, 1000000 as 1M."""
    if value is None:
        return "?"
    if value >= SCALE["M"]:
        return f"{plain((value / SCALE['M']).normalize())}M"
    if value >= SCALE["K"]:
        return f"{plain((value / SCALE['K']).normalize())}K"
    return plain(value.normalize())


def _split(line: str | None) -> list[str]:
    """ "2026 split: BTC 50% | ETH, SOL ... 10% each | pumpamentals 10% → weekly ..." as parts."""
    if line is None:
        return []
    body = plain_text(line).partition(":")[2].split("→")[0]
    return [p.strip() for p in body.split("|") if p.strip()]


def _targets(parts: list[str]) -> list[dict[str, str]]:
    """Coins and their share from the split's parts: "ETH, SOL 10% each" gives both 10%."""
    found: list[dict[str, str]] = []
    for part in parts:
        pct = re.search(r"(\d+(?:\.\d+)?)%", part)
        if not pct:
            continue
        for coin in COINS.findall(part[: pct.start()]):
            found.append({"coin": coin, "pct": pct.group(1)})
    return found


def _lesson(item: str) -> dict[str, str]:
    head = BOLD.search(item)
    title = (head.group(1) if head else "").strip().rstrip(":")
    body = plain_text(item[head.end() :] if head else item)
    lesson = body.split("→")[-1].strip() if "→" in body else body
    return {"title": title, "story": body.split("→")[0].strip(), "lesson": lesson}


def _cash(found: dict[str, list[str]]) -> dict[str, Any]:
    emergency = _find(found, "4", "emergency fund")
    money = [v for _, v in amounts(emergency or "")]
    floor_line = _find(found, "4", "minimum cash")
    overall = found.get("5.1", [])
    saving = next((i for i in overall if "savings" in i.lower()), None)
    return {
        "emergency": money[0] if money else None,
        "emergencyTarget": money[1] if len(money) > 1 else None,
        "parked": _last(_find(found, "4", "parked")),
        "floor": _after(floor_line, r"\bof\b") or _last(floor_line),
        "monthlyIn": _after(saving, r"\|") if saving and "|" in saving else _first(saving),
        "rate": _rate(floor_line),
    }


def _rate(line: str | None) -> str | None:
    m = re.search(r"(\d+(?:\.\d+)?)%", line or "")
    return m.group(1) if m else None


def _band(line: str | None) -> str | None:
    m = re.search(r"±\s?(\d+)\s*point", line or "")
    return m.group(1) if m else None


def _dca(found: dict[str, list[str]]) -> dict[str, Any]:
    weekly_line = found.get("5.2", [None])[0] if found.get("5.2") else None
    day = re.search(r"every\s+([A-Z][a-z]+)", plain_text(weekly_line or ""))
    extra_line = _find(found, "5.2", "fear & greed")
    fg = re.search(r"below\s+(\d+)", extra_line or "", re.IGNORECASE)
    split_line = _find(found, "5.3", "split")
    btc = re.search(r"A\$\s?(\d[\d,]*(?:\.\d+)?[KkMm]?)\s+BTC", plain_text(split_line or ""))
    monthly = _find(found, "5.1", "monthly")
    return {
        "weekly": _first(weekly_line),
        "day": day.group(1) if day else None,
        "extra": _first(extra_line),
        "fearGreedBelow": int(fg.group(1)) if fg else None,
        "maxWeek": _after(extra_line, r"max"),
        "maxMonth": _last(extra_line) if extra_line and "month" in extra_line.lower() else None,
        "investMonthly": _after(monthly, r"up to"),
        "btcWeekly": _first(f"A${btc.group(1)}") if btc else None,
        "extraAfterDays": int(after.group(1))
        if (after := re.search(r"(\d+)\s+days?\s+after", extra_line or "", re.IGNORECASE))
        else None,
    }


def _holdings(found: dict[str, list[str]]) -> dict[str, Any]:
    title = (found.get("title:8") or [""])[0]
    counts = _find(found, "8", "counts toward goals")
    return {
        "asOf": _day(title),
        "baselineUsd": _first(counts, "USD"),
        "taoInvested": _first(_find(found, "8", "tao")),
        "binanceInvested": _first(_find(found, "8", "binance")),
        "super": _last(_find(found, "8", "super")),
    }


def values(text: str) -> dict[str, Any]:
    """Every figure the page and the older checks read; None where the file doesn't say."""
    found = sections(text)
    rules = _rules(found)
    split_line = _find(found, "5.3", "split")
    btc_target = re.search(
        r"target\s+(\d+(?:\.\d+)?)\s+BTC", plain_text(_find(found, "5.3", "btc") or "")
    )
    focus = plain_text(_find(found, "5.1", "focus") or "").partition(":")[2].split("|")[0]
    guard = plain_text(_find(found, "3", "guardrail") or "").partition(":")[2].split("|")[0]
    risk = BOLD.search(_find(found, "3", "overall") or "")
    lessons = [_lesson(i) for i in found.get("9", [])]
    income = _find(found, "1", "available to invest")
    return {
        **_identity(found),
        "risk": risk.group(1) if risk else None,
        "focus": re.sub(r"\s*\(\d+\)", "", focus).strip() or None,
        "guardrail": re.sub(r"\s*\(\d+\)", "", guard).strip() or None,
        "goals": _goals(found),
        "milestones": _milestones(found),
        "cash": _cash(found),
        "dca": _dca(found),
        "split": _split(split_line),
        "splitLabel": plain_text(split_line or "").partition(":")[0] or None,
        "targets": _targets(_split(split_line)),
        "btcTarget": Decimal(btc_target.group(1)) if btc_target else None,
        "rules": rules,
        "chips": _chips(rules),
        "openItems": [plain_text(i) for i in found.get("10", [])],
        "lessons": lessons,
        "holdings": _holdings(found),
        "available": _first(income),
        "rebalanceBand": _band(_find(found, "5.3", "rebalance:")),
        "strategy": [plain_text(i) for i in found.get("5.1", [])],
        "entry": plain_text(found.get("5.2", ["", ""])[1]) if len(found.get("5.2", [])) > 1 else "",
    }


# The typed Profile the older checks read.


def _money(value: Decimal | None) -> str | None:
    return plain(value.quantize(Decimal("0.01")).normalize()) if value is not None else None


def structured(text: str) -> dict[str, Any]:
    """The typed Profile (profile.RECORDS and LISTS) from the file's figures, unchecked:
    profile.clean checks it."""
    v = values(text)
    cash, dca, held = v["cash"], v["dca"], v["holdings"]
    rules = v["rules"]
    take = next((r["text"] for r in rules if r["text"].lower().startswith("take profit")), None)
    return {
        "identity": {
            "name": v["name"],
            "date_of_birth": v["born"].isoformat() if v["born"] else None,
        },
        "income": {
            "gross_monthly_aud": None,
            "after_tax_monthly_aud": None,
            "living_monthly_aud": None,
            "available_monthly_aud": _money(v["available"]),
            "notes": None,
        },
        "goals": [
            {
                "label": g["note"][:120] or None,
                "amount": _money(g["amount"]),
                "currency": g["currency"],
                "date": g["date"].isoformat(),
                "then_rule": None,
            }
            for g in v["goals"]
        ],
        "foundations": {
            "emergency_fund_aud": _money(cash["emergencyTarget"]),
            "emergency_months": None,
            "parked_funds_aud": _money(cash["parked"]),
            "min_cash_aud": _money(cash["floor"]),
            "insurance": [],
            "health_cover_status": None,
            "health_cover_monthly_aud": None,
            "debt": None,
            "wills": None,
        },
        "strategy": {
            "text": NEWLINE.join(v["strategy"])[:4000] or None,
            "focus": v["focus"],
            "targets": v["targets"],
        },
        "rules": {
            "monthly_deposit_cap_aud": _money(dca["maxMonth"]),
            "deposit_cadence": "weekly" if dca["weekly"] is not None else None,
            "max_pct_per_coin": None,
            "per_trade_aud": _money(dca["weekly"]),
            "max_loss_pct": None,
            "rebalance_band": v["rebalanceBand"],
            "take_profit_rule": take[:500] if take else None,
            "entry_strategy": v["entry"][:500] or None,
            "behaviour_rules": [r["text"][:160] for r in rules],
        },
        "holdings": _typed_holdings(held, cash),
        "lessons": [
            {"year": _year(lesson["title"]), "text": f"{lesson['title']}: {lesson['lesson']}"[:400]}
            for lesson in v["lessons"]
        ],
        "additional_info": "",
        "locks": {},
    }


def _year(title: str) -> str | None:
    m = re.search(r"\b(19|20)\d{2}\b", title)
    return m.group(0) if m else None


def _typed_holdings(held: dict[str, Any], cash: dict[str, Any]) -> list[dict[str, Any]]:
    """TAO and Binance live; the emergency fund counts toward goals, parked tax and super don't."""
    rows: list[dict[str, Any]] = [
        _row("TAO wallet", "taostats", invested=held["taoInvested"]),
        _row("Binance", "binance", invested=held["binanceInvested"]),
    ]
    if cash["emergency"] is not None:
        rows.append(_row("Emergency fund", "manual", value=cash["emergency"], is_cash=True))
    if cash["parked"] is not None:
        rows.append(_row("Parked tax", "manual", value=cash["parked"], is_cash=True, counts=False))
    if held["super"] is not None:
        rows.append(_row("Super", "manual", value=held["super"], counts=False))
    return rows


def _row(  # noqa: PLR0913 - each is a column of the row
    name: str,
    source: str,
    *,
    invested: Decimal | None = None,
    value: Decimal | None = None,
    is_cash: bool = False,
    counts: bool = True,
) -> dict[str, Any]:
    return {
        "name": name,
        "source": source,
        "invested_aud": _money(invested),
        "value_aud": _money(value),
        "cash": is_cash,
        "counts": counts,
    }


def parse(text: str) -> dict[str, Any]:
    """The typed Profile with the text itself under "markdown"; raises Refused when the file
    has lost the shape the desk reads."""
    if len(text) > MAX_TEXT:
        raise Refused("That file is too big for a profile.")
    if not is_v2(text):
        raise Refused("Start the file with “# Profile” and keep its numbered sections.")
    found = sections(text)
    missing = [n for n in ("2", "4", "6") if n not in found]
    if missing:
        raise Refused(f"Section {missing[0]} is missing from profile.md")
    if not _goals(found):
        raise Refused("No goal could be read in section 2: write it as **US$1M by 31 Dec 2030**")
    return structured(text) | {"markdown": text.replace("\r\n", NEWLINE)}


# Agents, versions and changes.


def for_agents(text: str, today: date) -> str:
    """The file as agents read it: unchanged, but an age in place of the date of birth."""

    def aged(m: re.Match[str]) -> str:
        born = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        return f"age {age(born, today)}"

    try:
        return BORN.sub(aged, text)
    except ValueError:
        return BORN.sub("age not given", text)


def stamp(text: str, version: int, now_ms: int) -> str:
    """The file's own version line, set to the version it's saved as."""
    when = datetime.fromtimestamp(now_ms / 1000, UTC).astimezone(SYDNEY)
    line = f"- Version: v{version} | Last updated: {when.day} {when:%b %Y}"
    return re.sub(r"(?m)^- Version:.*$", line, text, count=1)


def _label_value(line: str) -> tuple[str, str] | None:
    body = plain_text(ITEM.sub(r"\2", line.strip().removeprefix("- ")))
    label, sep, value = body.partition(": ")
    return (label, value) if sep and 0 < len(label) <= LABEL_MAX else None


def line_changes(old: str, new: str) -> list[dict[str, str]]:
    """What changed between two versions of the file, line by line, for History's one line:
    a labelled line gives its label and both values ("Emergency fund (6 months): ~A$12K of
    A$20K → ~A$15K of A$20K"); any other gives the line, changed, added or removed."""
    if not old.strip():
        return [{"section": "markdown", "key": "file", "label": "profile.md", "from": "",
                 "to": "rewritten"}]  # fmt: skip
    found: list[dict[str, str]] = []
    a, b = old.splitlines(), new.splitlines()
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b).get_opcodes():
        if tag == "equal":
            continue
        gone, came = a[i1:i2], b[j1:j2]
        for k in range(max(len(gone), len(came))):
            before = gone[k] if k < len(gone) else None
            after = came[k] if k < len(came) else None
            found.append(_change(before, after))
    return [c for c in found if c["label"]]


def _change(before: str | None, after: str | None) -> dict[str, str]:
    old_pair = _label_value(before) if before else None
    new_pair = _label_value(after) if after else None
    if old_pair and new_pair and old_pair[0] == new_pair[0]:
        label, start, end = old_pair[0], old_pair[1], new_pair[1]
    else:
        label = plain_text(after or before or "")[:60]
        start, end = "", "added" if before is None else "removed" if after is None else "changed"
    return {"section": "markdown", "key": label, "label": label, "from": start, "to": end}


def diff(old: str, new: str) -> list[dict[str, str]]:
    """The changed lines with one line around each: kind same, del or add, and the text."""
    rows: list[dict[str, str]] = []
    lines = list(difflib.unified_diff(old.splitlines(), new.splitlines(), lineterm="", n=1))
    for line in lines[2:]:
        if line.startswith("@@"):
            rows.append({"kind": "gap", "text": "…"})
        elif line.startswith("-"):
            rows.append({"kind": "del", "text": line[1:]})
        elif line.startswith("+"):
            rows.append({"kind": "add", "text": line[1:]})
        else:
            rows.append({"kind": "same", "text": line[1:]})
    return rows[1:] if rows and rows[0]["kind"] == "gap" else rows


def apply_edits(text: str, edits: object) -> str:
    """The model's edits, each an exact piece of the file and what replaces it. A piece that
    isn't in the file once and only once is refused: the edit would land in the wrong place."""
    items: list[Any] = edits if isinstance(edits, list) else []  # pyright: ignore[reportUnknownVariableType]
    if not items:
        raise Refused("The change was empty. Ask again, more simply.")
    out = text
    for raw in items[:MAX_EDITS]:
        item: dict[str, Any] = raw if isinstance(raw, dict) else {}  # pyright: ignore[reportUnknownVariableType]
        find, replace = str(item.get("find", "")), str(item.get("replace", ""))
        if not find or out.count(find) != 1:
            raise Refused("The change didn't match profile.md exactly. Ask again, more simply.")
        out = out.replace(find, replace)
    if out == text:
        raise Refused("That's already how your profile reads.")
    return out
