"""My agents (TODO 10): agents named by purpose, one Markdown file each in `local/agents/`. The
owner writes them through Claude Code; the desk only reads them, like profile.md (decision 61).
A file that changed since the desk last read it becomes a new version. The page shows each
agent's header and schedule; the file itself is the detail.
"""

import hashlib
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from api.ai_signal import MODELS
from api.store import Store

SYDNEY = ZoneInfo("Australia/Sydney")
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
# "1. **Friday 5pm, deposit day:** ..." or "2. **When the USDC lands on Binance:** ..."
ITEM = re.compile(r"^\d+\.\s+\*\*(?P<head>[^*]+?):?\*\*:?\s*(?P<text>.*)$")
WHEN = re.compile(
    r"^(?P<day>monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+"
    r"(?P<hour>\d{1,2})(?::(?P<min>\d{2}))?\s*(?P<ampm>am|pm)(?:,\s*(?P<label>.+))?$",
    re.IGNORECASE,
)


def folder(store: Store) -> Path:
    """`local/agents/` beside the desk's database; a demo or test database gets its own."""
    stem = store.profile_md.stem
    name = "agents" if stem == "profile" else f"{stem.removesuffix('-profile')}-agents"
    return store.profile_md.parent / name


def _first_sentence(text: str) -> str:
    plain = text.replace("**", "").strip()
    cut = re.split(r"(?<=[.;:])\s", plain, maxsplit=1)[0].rstrip(".;:")
    return cut[:60]


def parse(text: str) -> dict[str, Any]:
    """The header bullets before the first section, the line under the title, and the
    schedule's items, each with a weekday and time when it has one."""
    lines = text.splitlines()
    title, about = "", ""
    facts: dict[str, str] = {}
    schedule: list[dict[str, Any]] = []
    section = ""
    for line in lines:
        if line.startswith("# ") and not title:
            title = line[2:].strip()
        elif line.startswith("## "):
            section = line[3:].strip().lower()
        elif not section and line.startswith("- ") and ":" in line:
            key, value = line[2:].split(":", 1)
            facts[key.strip().lower()] = value.strip()
        elif not section and title and line.strip() and not about:
            about = line.strip()
        elif section.startswith("schedule") and (item := ITEM.match(line.strip())):
            head, rest = item["head"].strip(), item["text"]
            when = WHEN.match(head)
            if when:
                hour = int(when["hour"]) % 12 + (12 if when["ampm"].lower() == "pm" else 0)
                schedule.append(
                    {
                        "day": DAYS.index(when["day"].lower()),
                        "minute": hour * 60 + int(when["min"] or 0),
                        "label": (when["label"] or _first_sentence(rest)).strip(),
                    }
                )
            else:
                schedule.append({"day": None, "minute": None, "label": head})
    return {"title": title, "about": about, "facts": facts, "schedule": schedule}


def _model(value: str) -> dict[str, str]:
    """ "claude-opus-5-5, effort high" to its id, name and effort."""
    parts = [p.strip() for p in value.split(",")]
    model_id = parts[0] if parts else ""
    effort = next((p[7:].strip() for p in parts[1:] if p.lower().startswith("effort ")), "")
    known = MODELS.get(model_id)
    return {"id": model_id, "name": known.name if known else model_id, "effort": effort}


ICONS = (
    "dca",
    "grid",
    "rebalance",
    "research",
    "news",
    "risk",
    "tax",
    "journal",
    "alert",
    "coach",
)


def _persona(value: str) -> dict[str, str]:
    """ "The patient buyer: steady, never chases" to its title and its traits."""
    title, _, traits = value.partition(":")
    return {"title": title.strip(), "traits": traits.strip()}


def next_run(schedule: list[dict[str, Any]], now: datetime) -> dict[str, Any] | None:
    """The soonest timed item after `now`, in Sydney time."""
    local = now.astimezone(SYDNEY)
    best: tuple[datetime, str] | None = None
    for item in schedule:
        if item["day"] is None:
            continue
        ahead = (item["day"] - local.weekday()) % 7
        at = (local + timedelta(days=ahead)).replace(
            hour=item["minute"] // 60, minute=item["minute"] % 60, second=0, microsecond=0
        )
        if at <= local:
            at += timedelta(days=7)
        if best is None or at < best[0]:
            best = (at, item["label"])
    return None if best is None else {"at": int(best[0].timestamp() * 1000), "label": best[1]}


def _version(store: Store, slug: str, text: str, now_ms: int) -> tuple[int, int]:
    """The file's version: a new one each time its contents change."""
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    key = f"my_agent:{slug}"
    if store.setting(f"{key}:hash", "") != digest:
        n = int(store.setting(f"{key}:version", "0")) + 1
        store.set_setting(f"{key}:hash", digest)
        store.set_setting(f"{key}:version", str(n))
        store.set_setting(f"{key}:time", str(now_ms))
    return int(store.setting(f"{key}:version", "1")), int(store.setting(f"{key}:time", "0"))


def _files(store: Store) -> list[tuple[str, Path]]:
    where = folder(store)
    if not where.is_dir():
        return []
    return sorted((p.stem, p) for p in where.glob("*.md") if SLUG.fullmatch(p.stem))


def listing(store: Store, now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(SYDNEY)
    now_ms = int(now.timestamp() * 1000)
    out: list[dict[str, Any]] = []
    for slug, path in _files(store):
        text = path.read_text(encoding="utf-8")
        found = parse(text)
        facts = found["facts"]
        version, time = _version(store, slug, text, now_ms)
        coins = [c.strip() for c in facts.get("coins", "").split(",") if c.strip()]
        out.append(
            {
                "slug": slug,
                "file": f"{path.parent.name}/{path.name}",
                "purpose": facts.get("purpose", found["about"]),
                "about": found["about"],
                "model": _model(facts.get("model", "")),
                "autonomy": facts.get("autonomy", ""),
                "cost": facts.get("cost", ""),
                "icon": icon if (icon := facts.get("icon", "").lower()) in ICONS else "",
                "persona": _persona(facts.get("persona", "")),
                "sends": facts.get("sends", ""),
                "coins": coins,
                "schedule": found["schedule"],
                "next": next_run(found["schedule"], now),
                "version": version,
                "time": time,
                # No agent runs on its own yet: the files say what each will do.
                "running": False,
            }
        )
    return {"agents": out, "folder": f"local/{folder(store).name}"}


def file(store: Store, slug: str) -> dict[str, Any]:
    for name, path in _files(store):
        if name == slug:
            return {"markdown": path.read_text(encoding="utf-8"), "error": None}
    return {"markdown": "", "error": f"There's no agent called {slug}."}
