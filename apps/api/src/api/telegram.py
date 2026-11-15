"""The morning summary on the owner's phone, through their own Telegram bot (decision 57).

The bot's token is saved from Settings to `.env` (api.env_file) and never shown, logged or put
in an error: it travels only in the URL to api.telegram.org, so no exception text is printed.
The chat is found from the owner's first message to the bot. One message a day, at the time set
in Settings, Sydney time: the coach's mood line, key points and deposits left.
"""

import os
from datetime import datetime
from decimal import Decimal
from typing import Any, cast

import httpx

from api.store import Store
from api.trading import Refused

API = "https://api.telegram.org"
CHAT_KEY = "telegram_chat_id"
TIME_KEY = "telegram_summary_time"
SENT_KEY = "telegram_last_sent"
DEFAULT_TIME = "07:30"
TIMEOUT_SECONDS = 15
OK = 200


class TelegramError(Exception):
    """Telegram couldn't be reached or refused; the words never include the token."""


def token() -> str:
    return os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()


def view(store: Store) -> dict[str, Any]:
    return {
        "tokenSet": bool(token()),
        "chatFound": bool(store.setting(CHAT_KEY, "")),
        "time": store.setting(TIME_KEY, DEFAULT_TIME),
        "lastSent": store.setting(SENT_KEY, "") or None,
    }


def set_time(store: Store, body: dict[str, Any]) -> dict[str, Any]:
    raw = str(body.get("time", "")).strip()
    try:
        at = datetime.strptime(raw, "%H:%M")
    except ValueError:
        raise Refused("Give the time as HH:MM, such as 07:30.") from None
    store.set_setting(TIME_KEY, f"{at:%H:%M}")
    return view(store)


def _call(client: httpx.Client, method: str, payload: dict[str, Any] | None = None) -> Any:
    secret = token()
    if not secret:
        raise TelegramError("Add your Telegram bot's token in Settings first.")
    try:
        response = client.post(f"{API}/bot{secret}/{method}", json=payload or {})
    except httpx.HTTPError:
        raise TelegramError("Telegram didn't answer. Check the connection.") from None
    body: Any = response.json() if response.content else {}
    if response.status_code != OK or not body.get("ok"):
        said = str(body.get("description", "no reason given"))[:120].replace(secret, "[token]")
        raise TelegramError(f"Telegram said: {said}")
    return body.get("result")


def find_chat(store: Store, client: httpx.Client) -> bool:
    """The owner's private chat with the bot, from the messages it has had; True once found."""
    updates: list[dict[str, Any]] = _call(client, "getUpdates") or []
    for update in reversed(updates):
        message = cast(dict[str, Any], update.get("message") or {})
        chat = cast(dict[str, Any], message.get("chat") or {})
        if chat.get("type") == "private" and chat.get("id"):
            store.set_setting(CHAT_KEY, str(chat["id"]))
            return True
    return False


def send(store: Store, client: httpx.Client, text: str) -> None:
    chat = store.setting(CHAT_KEY, "")
    if not chat and not find_chat(store, client):
        raise TelegramError(
            "Send your bot any message in Telegram first, so the desk can find you."
        )
    _call(
        client,
        "sendMessage",
        {"chat_id": store.setting(CHAT_KEY, ""), "text": text, "disable_web_page_preview": True},
    )  # noqa: E501


def due(store: Store, now: datetime) -> bool:
    """Whether today's summary is due: past the set time, and not yet sent today."""
    if not token():
        return False
    at = store.setting(TIME_KEY, DEFAULT_TIME)
    return f"{now:%H:%M}" >= at and store.setting(SENT_KEY, "") != now.date().isoformat()


def mark_sent(store: Store, now: datetime) -> None:
    store.set_setting(SENT_KEY, now.date().isoformat())


def _aud(value: str | None) -> str:
    if value is None:
        return "–"
    amount = Decimal(value)
    sign = "−" if amount < 0 else ""
    return f"{sign}A${abs(amount):,.0f}"


def point_text(p: dict[str, Any]) -> str:
    """A key point in words, as the Dashboard writes it."""
    kind = p["kind"]
    if kind == "concentration":
        return f"{p['coin']} is {p['pct']}% of your portfolio, over your {p['cap']}% cap."
    if kind == "loss":
        return f"{p['coin']} is {p['pct']}% on its cost, past your {p['cap']}% max loss."
    if kind == "mover":
        return f"{p['coin']} moved most of what you hold: {p['pct']}% today."
    if kind == "addZone":
        return f"{p['coin']} is in its add zone ({p['low']} to {p['high']})."
    return f"{p['coin']} is {p['pct']}% above its invalidation level."


def summary(coach: dict[str, Any]) -> str:
    """The morning message, from the coach's figures and words."""
    change = Decimal(coach["changePct"])
    way = "flat" if coach["mood"] == "flat" else ("down" if change < 0 else "up")
    head = (
        f"Your portfolio is flat today ({change}%)."
        if way == "flat"
        else f"Your portfolio is {way} {abs(change)}% today ({_aud(coach['changeAud'])})."
    )
    lines = [coach["greeting"], head, *coach["message"]["lines"]]
    points = [f"• {point_text(p)}" for p in coach["keyPoints"]]
    dep = coach["deposits"]
    if dep["capAud"]:
        money = f"Deposits: {_aud(dep['monthAud'])} of {_aud(dep['capAud'])} this month"
        money += (
            f", over by {_aud(dep['overAud'])}."
            if dep["overAud"]
            else f", {_aud(dep['leftAud'])} left."
        )
    else:
        money = f"Deposits this month: {_aud(dep['monthAud'])}."
    quote = coach["message"].get("quote")
    tail = (
        [f"“{quote['text']}”" + (f" — {quote['author']}" if quote["author"] else "")]
        if quote
        else []
    )
    blocks = [*lines, *(["", *points] if points else []), "", money, *tail]
    return "\n".join(blocks).strip()


def client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT_SECONDS)
