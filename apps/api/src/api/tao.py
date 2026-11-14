"""The TAO wallet, read-only by its public coldkey address, through Taostats (decision 17)."""

import threading
import time
from collections.abc import Callable
from decimal import Decimal, InvalidOperation
from typing import Any, cast

import httpx

from api.audit import Audit

TAOSTATS_URL = "https://api.taostats.io"
RAO = Decimal(10) ** 9  # Taostats gives balances in rao: a billionth of a TAO
OK = 200
ADDRESS_LENGTH = 48  # an SS58 address on Bittensor
FRESH_SECONDS = 60  # a reading this recent is used again without asking Taostats
FALLBACK_SECONDS = 6 * 3600  # if Taostats refuses, a reading this recent stands in
_lock = threading.Lock()
_last: dict[str, tuple[float, dict[str, Decimal]]] = {}


def forget() -> None:
    """Drops the kept readings (tests)."""
    with _lock:
        _last.clear()


class TaoError(Exception):
    """Taostats couldn't answer; the message is safe to show the owner."""


def valid_address(address: str) -> bool:
    return len(address) == ADDRESS_LENGTH and address.isalnum()


def _tao(value: object) -> Decimal:
    try:
        return Decimal(str(value or "0")) / RAO
    except InvalidOperation as error:
        raise TaoError("Taostats sent a balance that isn't a number.") from error


def balance(
    client: httpx.Client,
    key: str,
    address: str,
    audit: Audit,
    clock: Callable[[], float] = time.time,
) -> dict[str, Decimal]:
    """Free, staked and total TAO, and root-staking rewards waiting to be claimed (decision 32).
    A reading under a minute old is used again, and if Taostats refuses (a rate limit, a
    timeout), the last reading under six hours old stands in, so the wallet never shows as
    empty for a hiccup (decision 45). The address is public; the key is never logged."""
    if not valid_address(address):
        raise TaoError("TAO_COLDKEY in .env isn't a Bittensor address.")
    with _lock:
        kept = _last.get(address)
    if kept and clock() - kept[0] < FRESH_SECONDS:
        return dict(kept[1])
    try:
        found = _read(client, key, address, audit)
    except TaoError:
        if kept and clock() - kept[0] < FALLBACK_SECONDS:
            audit.record("exchange", "Taostats: TAO wallet", "Used the last reading")
            return dict(kept[1])
        raise
    with _lock:
        _last[address] = (clock(), found)
    return dict(found)


def _read(client: httpx.Client, key: str, address: str, audit: Audit) -> dict[str, Decimal]:
    try:
        response = client.get(
            "/api/account/latest/v1",
            params={"address": address, "network": "finney"},
            headers={"Authorization": key, "accept": "application/json"},
        )
    except httpx.HTTPError as error:
        audit.record("exchange", "Taostats: TAO wallet", f"Failed: {type(error).__name__}")
        raise TaoError("Taostats didn't answer. Try again shortly.") from error
    if response.status_code != OK:
        audit.record("exchange", "Taostats: TAO wallet", f"Refused {response.status_code}")
        if response.status_code == 429:  # noqa: PLR2004 - too many requests
            raise TaoError("Taostats is busy (429): the wallet shows again in a minute.")
        raise TaoError(f"Taostats refused the request ({response.status_code}).")
    audit.record("exchange", "Taostats: TAO wallet", "OK")
    body: object = response.json()
    data: object = cast(dict[str, Any], body).get("data") if isinstance(body, dict) else None
    rows = cast(list[dict[str, Any]], data) if isinstance(data, list) else []
    if not rows:
        return {
            "free": Decimal(0),
            "staked": Decimal(0),
            "total": Decimal(0),
            "rewards": Decimal(0),
        }
    row = rows[0]
    free, staked = _tao(row.get("balance_free")), _tao(row.get("balance_staked"))
    total = _tao(row["balance_total"]) if row.get("balance_total") else free + staked
    rewards = _tao(row.get("root_basket_claimable_tao"))
    return {"free": free, "staked": staked, "total": total, "rewards": rewards}
