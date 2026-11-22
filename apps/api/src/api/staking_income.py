"""Staking income for the Tax page (owner, 22 Nov 2026): each reward claimed, such as a TAO root
claim, with its day, amount and price, valued in AUD at the rate kept when it was entered.

Staking rewards are generally income when received, valued in AUD at that time; under Bittensor's
Root Reborn a claim is the moment they are realised. The owner enters each claim; nothing here
reads a wallet. Estimates for the owner's records, not tax advice."""

from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from api.binance import plain
from api.ledger_wallet import COIN
from api.profile_live import RATE_KEY
from api.store import Store
from api.tax import fy_of
from api.trading import Refused

MOST = Decimal(10_000_000)


def _positive(raw: object, what: str) -> Decimal:
    try:
        value = Decimal(str(raw).strip())
    except InvalidOperation:
        raise Refused(f"{what} must be a number.") from None
    if not value.is_finite() or value <= 0:
        raise Refused(f"{what} must be more than 0.")
    if value > MOST:
        raise Refused(f"{what} is too large.")
    return value


def add(store: Store, body: dict[str, Any], today: date, now_ms: int) -> None:
    """Records one claim: {day: YYYY-MM-DD, coin, amount, priceUsd}; the AUD rate is the desk's
    latest unless the body gives `audRate`."""
    try:
        day = date.fromisoformat(str(body.get("day") or ""))
    except ValueError:
        raise Refused("Give the day it was claimed, as YYYY-MM-DD.") from None
    if day > today:
        raise Refused("That day hasn't happened yet.")
    coin = str(body.get("coin") or "").strip().upper()
    if not COIN.fullmatch(coin):
        raise Refused("Name the coin, such as TAO.")
    amount = _positive(body.get("amount"), "The amount")
    price = _positive(body.get("priceUsd"), "The price")
    if body.get("audRate"):
        rate = _positive(body["audRate"], "The AUD rate")
    elif day == today and store.setting(RATE_KEY, ""):
        rate = Decimal(store.setting(RATE_KEY, ""))  # the desk's rate today
    else:
        raise Refused("Give the A$ per US$ rate for that day: income is valued when received.")
    store.add_staking_claim(day.isoformat(), coin, plain(amount), plain(price), plain(rate), now_ms)


def view(store: Store, today: date) -> dict[str, Any]:
    """Every claim, newest first, each valued in USD and AUD, and the total for this FY."""
    fy = fy_of(today)
    rows: list[dict[str, Any]] = []
    total = Decimal(0)
    for c in store.staking_claims():
        usd = Decimal(c["amount"]) * Decimal(c["price_usd"])
        aud = usd * Decimal(c["aud_rate"])
        this_fy = fy_of(date.fromisoformat(c["day"])) == fy
        total += aud if this_fy else Decimal(0)
        rows.append(
            {
                "id": c["id"],
                "day": c["day"],
                "coin": c["coin"],
                "amount": c["amount"],
                "priceUsd": c["price_usd"],
                "audRate": c["aud_rate"],
                "usd": plain(usd.quantize(Decimal("0.01"))),
                "aud": plain(aud.quantize(Decimal("0.01"))),
                "thisFy": this_fy,
            }
        )
    return {"fy": fy, "claims": rows, "fyAud": plain(total.quantize(Decimal("0.01")))}
