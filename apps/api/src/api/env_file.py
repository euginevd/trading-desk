"""Saving credentials from the Settings page into `.env` (decisions 51 and 57), so the owner
never edits the file by hand. Only the names in SHAPES may be written (the Claude API key, the
Claude sign-in token and the Telegram bot token), each checked in full against its shape, so no
other line can be added. One save at a time; the value takes effect at once and is never
logged, returned or shown again.
"""

import os
import re
import threading
from pathlib import Path

from api.trading import Refused

SHAPES = {
    "ANTHROPIC_API_KEY": re.compile(r"sk-ant-api\d{2}-[A-Za-z0-9_-]{20,300}"),
    "CLAUDE_CODE_OAUTH_TOKEN": re.compile(r"sk-ant-oat\d{2}-[A-Za-z0-9_-]{20,300}"),
    "TELEGRAM_BOT_TOKEN": re.compile(r"\d{5,15}:[A-Za-z0-9_-]{30,60}"),  # decision 57
}
WORDS = {
    "ANTHROPIC_API_KEY": "Claude API key",
    "CLAUDE_CODE_OAUTH_TOKEN": "Claude sign-in token",
    "TELEGRAM_BOT_TOKEN": "Telegram bot token",
}


_LOCK = threading.Lock()


def path() -> Path:
    named = os.environ.get("DESK_ENV_FILE", "").strip()
    if not named or not Path(named).is_file():
        raise Refused(
            "The api can't reach .env to save it: run `docker compose up -d` to mount it."
        )
    return Path(named)


def save(name: str, value: str) -> None:
    """Writes NAME=value into .env, replacing its line or adding one, and uses it at once."""
    shape = SHAPES.get(name)
    value = value.strip()
    if shape is None or not shape.fullmatch(value):
        raise Refused(f"That doesn't look like a {_word(name)}. Copy it again, in full.")
    with _LOCK:
        _write(name, value, path())
    os.environ[name] = value


def _write(name: str, value: str, target: Path) -> None:
    lines = target.read_text(encoding="utf-8").splitlines()
    line = f"{name}={value}"
    kept = [line if raw.split("=", 1)[0].strip() == name else raw for raw in lines]
    if line not in kept:
        kept.append(line)
    # In place, not a rename: .env is a single file mounted into the container. Built first and
    # written in one call, so the file is never left half-written by a slow save.
    text = "\n".join(kept) + "\n"
    with target.open("w", encoding="utf-8", newline="\n") as file:
        file.write(text)


def _word(name: str) -> str:
    return WORDS.get(name, "credential")
