"""USDC deposits into Binance for an Australian financial year, by month, in AUD (decision 31).

Each deposit's AUD is what the owner paid where it's recorded (`deposit_paid`, keyed by the
exact USDC amount, which the sending transfer and Binance's deposit share), and otherwise an
estimate: the amount at the ECB's US dollar to AUD rate on the day it landed (USDC counted as
a US dollar)."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from api.binance import Binance, plain

SYDNEY = ZoneInfo("Australia/Sydney")
COIN = "USDC"
WINDOW = timedelta(days=89)  # Binance answers at most 90 days per call
FX_RANGE_URL = "https://api.frankfurter.dev/v1/{start}..{end}?base=USD&symbols=AUD"
OK = 200
FY_FIRST_MONTH = 7  # July
MONTHS = ("Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun")


def fy_of(day: date) -> int:
    """The financial year a day is in, by its first year: 1 Jul 2026 to 30 Jun 2027 is 2026."""
    return day.year if day.month >= FY_FIRST_MONTH else day.year - 1


def _ms(day: date) -> int:
    return int(datetime(day.year, day.month, day.day, tzinfo=SYDNEY).timestamp() * 1000)


def amount_key(value: object) -> str:
    """One spelling per amount, so 700.50 and 700.5 match."""
    try:
        return format(Decimal(str(value)).normalize(), "f")
    except InvalidOperation:
        return ""


def aud_by_day(client: httpx.Client, start: date, end: date) -> dict[str, Decimal]:
    """The ECB's US dollar to AUD rate for each working day in the range; {} if it can't be had."""
    try:
        response = client.get(FX_RANGE_URL.format(start=start.isoformat(), end=end.isoformat()))
        if response.status_code != OK:
            return {}
        rates: Any = response.json()["rates"]
        if "AUD" in rates:  # one day's reply
            return {start.isoformat(): Decimal(str(rates["AUD"]))}
        found: dict[str, Decimal] = {}
        for day, rate in dict[str, Any](rates).items():
            found[str(day)] = Decimal(str(rate["AUD"]))
        return found
    except (httpx.HTTPError, KeyError, TypeError, ValueError, ArithmeticError):
        return {}


def _rate_on(rates: dict[str, Decimal], day: str) -> Decimal | None:
    """The last rate on or before the day (weekends use Friday's); the first after if none."""
    before = [d for d in rates if d <= day]
    if before:
        return rates[max(before)]
    return rates[min(rates)] if rates else None


def report(
    binance: Binance,
    paid: dict[str, str],
    fx: httpx.Client,
    today: date,
    year: int | None = None,
) -> dict[str, Any]:
    fy = year if year is not None else fy_of(today)
    start, end = date(fy, FY_FIRST_MONTH, 1), date(fy + 1, 6, 30)
    upto = min(end, today)
    rows: list[dict[str, Any]] = []
    window = start
    while window <= upto:
        stop = min(window + WINDOW, upto)
        rows += binance.deposits(COIN, _ms(window), _ms(stop + timedelta(days=1)) - 1)
        window = stop + timedelta(days=1)
    rates = aud_by_day(fx, start - timedelta(days=7), upto) if rows else {}

    months: dict[str, str] = {}
    for i, name in enumerate(MONTHS):
        month = (FY_FIRST_MONTH - 1 + i) % 12 + 1
        months[f"{fy if month >= FY_FIRST_MONTH else fy + 1}-{month:02d}"] = name
    usdc_in = dict.fromkeys(months, Decimal(0))
    aud_in = dict.fromkeys(months, Decimal(0))
    count = dict.fromkeys(months, 0)
    deposits: list[dict[str, Any]] = []
    for row in sorted(rows, key=lambda r: int(r["insertTime"])):
        when = datetime.fromtimestamp(int(row["insertTime"]) / 1000, UTC).astimezone(SYDNEY)
        day = when.date().isoformat()
        amount = Decimal(str(row["amount"]))
        known = paid.get(amount_key(row["amount"]))
        rate = _rate_on(rates, day)
        if known is not None:
            aud, basis = Decimal(known), "paid"
        elif rate is not None:
            aud, basis = (amount * rate).quantize(Decimal("0.01")), "estimate"
        else:
            aud, basis = None, "unknown"
        month = day[:7]
        if month in months and aud is not None:
            usdc_in[month] += amount
            aud_in[month] += aud
            count[month] += 1
        deposits.append(
            {
                "time": int(row["insertTime"]),
                "day": day,
                "amount": plain(amount),
                "network": str(row.get("network", "")),
                "aud": plain(aud) if aud is not None else None,
                "basis": basis,
                "rate": plain(rate) if rate is not None else None,
            }
        )
    usdc = sum(usdc_in.values(), Decimal(0))
    aud_total = sum(aud_in.values(), Decimal(0))
    return {
        "fy": f"{fy}-{(fy + 1) % 100:02d}",
        "from": start.isoformat(),
        "to": end.isoformat(),
        "coin": COIN,
        "total": {
            "usdc": plain(usdc),
            "aud": plain(aud_total),
            "audPerUsdc": plain((aud_total / usdc).quantize(Decimal("0.0001"))) if usdc else None,
            "paid": sum(1 for d in deposits if d["basis"] == "paid"),
            "estimated": sum(1 for d in deposits if d["basis"] == "estimate"),
        },
        "months": [
            {
                "month": m,
                "label": name,
                "usdc": plain(usdc_in[m]),
                "aud": plain(aud_in[m]),
                "count": count[m],
            }
            for m, name in months.items()
        ],
        "deposits": deposits[::-1],
    }
