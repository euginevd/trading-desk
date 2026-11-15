"""Saving the AI's credentials from the Settings page into `.env` (decision 51), so the owner
never edits the file by hand. Only these two names may be written, each checked for its shape;
the value takes effect at once and is never logged, returned or shown again.
"""

import os
import re
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
    target = path()
    lines = target.read_text(encoding="utf-8").splitlines()
    line = f"{name}={value}"
    kept = [line if raw.split("=", 1)[0].strip() == name else raw for raw in lines]
    if line not in kept:
        kept.append(line)
    # In place, not a rename: .env is a single file mounted into the container.
    with target.open("w", encoding="utf-8", newline="\n") as file:
        file.write("\n".join(kept) + "\n")
    os.environ[name] = value


def _word(name: str) -> str:
    return WORDS.get(name, "credential")
