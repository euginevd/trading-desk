"""The Crypto Fear & Greed Index from alternative.me (decision 36): today's value and yesterday's,
kept for 10 minutes. Nothing is sent but the request; the index updates once a day."""

import threading
import time
from typing import Any, cast

import httpx

FNG_URL = "https://api.alternative.me/fng/?limit=2"
KEEP_SECONDS = 600
OK = 200
_lock = threading.Lock()
_kept: dict[str, Any] = {}


class SentimentError(Exception):
    """The index couldn't be read; the message is safe to show."""


def _read(client: httpx.Client) -> dict[str, Any]:
    try:
        response = client.get(FNG_URL)
    except httpx.HTTPError as error:
        raise SentimentError("The Fear & Greed Index didn't answer.") from error
    if response.status_code != OK:
        raise SentimentError("The Fear & Greed Index didn't answer.")
    try:
        rows: Any = response.json()["data"]
        today, before = rows[0], rows[1] if len(rows) > 1 else None
        value = int(today["value"])
        if not 0 <= value <= 100:  # noqa: PLR2004 - the index's own range
            raise ValueError(value)
        return {
            "value": value,
            "label": str(today["value_classification"]),
            "yesterday": int(before["value"]) if before else None,
            "updated": int(today["timestamp"]) * 1000,
        }
    except (KeyError, IndexError, TypeError, ValueError) as error:
        raise SentimentError("The Fear & Greed Index sent something unexpected.") from error


def fear_and_greed(client: httpx.Client, clock: Any = time.time) -> dict[str, Any]:
    with _lock:
        if _kept and clock() - _kept["at"] < KEEP_SECONDS:
            return dict(_kept["index"])
        index = _read(client)
        _kept.update(at=clock(), index=index)
        return dict(index)


def forget() -> None:
    """Drops the kept values (tests)."""
    with _lock:
        _kept.clear()
        _kept_detail.clear()
        _kept_market.clear()


YEAR_URL = "https://api.alternative.me/fng/?limit=366"
GLOBAL_URL = "https://api.coingecko.com/api/v3/global"
DAY = 86_400
_kept_detail: dict[str, Any] = {}
AGO = {"yesterday": 1, "lastWeek": 7, "lastMonth": 30, "lastYear": 365}


def _year(client: httpx.Client) -> list[dict[str, Any]]:
    """The index for each of the last 366 days, newest first."""
    try:
        response = client.get(YEAR_URL)
        rows: Any = response.json()["data"] if response.status_code == OK else None
    except (httpx.HTTPError, ValueError, KeyError) as error:
        raise SentimentError("The Fear & Greed Index didn't answer.") from error
    if not isinstance(rows, list) or not rows:
        raise SentimentError("The Fear & Greed Index sent something unexpected.")
    try:
        listed = cast(list[dict[str, Any]], rows)
        return [
            {
                "value": int(r["value"]),
                "label": str(r["value_classification"]),
                "day": int(r["timestamp"]) * 1000,
            }
            for r in listed
        ]
    except (KeyError, TypeError, ValueError) as error:
        raise SentimentError("The Fear & Greed Index sent something unexpected.") from error


def _market(client: httpx.Client) -> dict[str, Any] | None:
    """The whole crypto market's size and 24-hour volume; None if CoinGecko can't say."""
    try:
        response = client.get(GLOBAL_URL)
        data: Any = response.json()["data"] if response.status_code == OK else None
        return {
            "cap": str(data["total_market_cap"]["usd"]),
            "capChange": str(data["market_cap_change_percentage_24h_usd"]),
            "volume": str(data["total_volume"]["usd"]),
            "btcShare": str(data["market_cap_percentage"]["btc"]),
            "ethShare": str(data["market_cap_percentage"]["eth"]),
        }
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        return None


def _summary(days: list[dict[str, Any]]) -> str:
    """One plain sentence on where the mood has been and where it is, worked out in code."""
    now, month = days[0], days[min(30, len(days) - 1)]
    week = days[: min(7, len(days))]
    extremes = sum(1 for d in week if d["label"] == "Extreme Fear")
    move = (
        f"from {month['label']} a month ago to {now['label']} today"
        if month["label"] != now["label"]
        else f"at {now['label']}, as it was a month ago"
    )
    tail = f", with {extremes} days of Extreme Fear this week" if extremes > 1 else ""
    mood = "cautious" if now["value"] < 45 else "confident" if now["value"] > 55 else "undecided"  # noqa: PLR2004
    return f"The index has moved {move}{tail}: the market is {mood}."


def fear_and_greed_detail(client: httpx.Client, clock: Any = time.time) -> dict[str, Any]:
    """Today against a day, a week, a month and a year ago, the year's high and low, 90 days
    for a chart, and the market's size; kept 10 minutes."""
    with _lock:
        if _kept_detail and clock() - _kept_detail["at"] < KEEP_SECONDS:
            return dict(_kept_detail["detail"])
        days = _year(client)
        high = max(days, key=lambda d: d["value"])
        low = min(days, key=lambda d: d["value"])
        detail = {
            "now": days[0],
            "history": {k: days[n] for k, n in AGO.items() if n < len(days)},
            "high": high,
            "low": low,
            "summary": _summary(days),
            "chart": [{"day": d["day"], "value": d["value"]} for d in reversed(days[:90])],
            "market": _market(client),
        }
        _kept_detail.update(at=clock(), detail=detail)
        return dict(detail)


_kept_market: dict[str, Any] = {}


def market_global(client: httpx.Client, clock: Any = time.time) -> dict[str, Any]:
    """The whole market for the header (decision 44): its size, 24h change and Bitcoin's and
    Ether's shares, kept 10 minutes; empty if CoinGecko can't say."""
    with _lock:
        if _kept_market and clock() - _kept_market["at"] < KEEP_SECONDS:
            return dict(_kept_market["market"])
        found = _market(client) or {}
        _kept_market.update(at=clock(), market=found)
        return dict(found)
