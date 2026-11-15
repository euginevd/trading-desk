"""Every fill the desk can see, for the Tax tab and the Journal (decisions 54 and 56): Binance's
trade history on each coin's stablecoin pairs, from the cost start date (decision 34), with the
day's US dollar to AUD rate, and which part of the desk placed each order.

Coins are the ones held, in a watchlist or traded by the desk: a coin sold out elsewhere and
never watched isn't read, and says so on the page. A short cache stops two pages loading at once
from reading Binance twice.
"""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from api.binance import Binance
from api.deposits import aud_by_day
from api.store import Store

STABLES = ("USDT", "USDC", "FDUSD")
SYDNEY = ZoneInfo("Australia/Sydney")
KEEP_SECONDS = 120
WORKERS = 4
_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_LOCK = threading.Lock()


@dataclass(frozen=True)
class Fill:
    """One Binance trade, in the desk's terms."""

    coin: str
    symbol: str
    order_id: int
    time: int  # ms
    buy: bool
    qty: Decimal
    price: Decimal  # in the stablecoin, counted as US dollars
    quote: Decimal
    aud_rate: Decimal  # US dollars to AUD on the day

    @property
    def order(self) -> str:
        """PAIR:order id, the order's key: Binance's ids are unique within a pair only."""
        return f"{self.symbol}:{self.order_id}"

    @property
    def aud(self) -> Decimal:
        return self.quote * self.aud_rate

    @property
    def day(self) -> date:
        return datetime.fromtimestamp(self.time / 1000, UTC).astimezone(SYDNEY).date()


def _symbol_trades(binance: Binance, symbol: str) -> list[dict[str, Any]]:
    with _LOCK:
        kept = _CACHE.get(symbol)
        if kept and time.monotonic() - kept[0] < KEEP_SECONDS:
            return kept[1]
    found = binance.trades(symbol)
    with _LOCK:
        _CACHE[symbol] = (time.monotonic(), found)
    return found


def coins_seen(store: Store, held: set[str]) -> set[str]:
    """The coins to read: held now, on any watchlist, or traded by the desk's own orders."""
    return held | store.watched_coins() | store.desk_coins()


def fills(
    binance: Binance, fx: httpx.Client, coins: set[str], from_ms: int, today: date
) -> list[Fill]:
    """Every fill on the coins' stablecoin pairs since `from_ms`, oldest first."""
    symbols = binance.symbols()
    pairs = [(c, f"{c}{q}") for c in sorted(coins) for q in STABLES if f"{c}{q}" in symbols]

    def read(pair: tuple[str, str]) -> tuple[tuple[str, str], list[dict[str, Any]]]:
        return pair, _symbol_trades(binance, pair[1])

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        found = list(pool.map(read, pairs))
    rows = [
        (coin, symbol, t)
        for (coin, symbol), trades in found
        for t in trades
        if int(t["time"]) >= from_ms
    ]
    if not rows:
        return []
    start = datetime.fromtimestamp(from_ms / 1000, UTC).date() - timedelta(days=7)
    rates = aud_by_day(fx, start, today)
    fallback = rates[max(rates)] if rates else Decimal("1.5")
    out: list[Fill] = []
    for coin, symbol, t in rows:
        moment = datetime.fromtimestamp(int(t["time"]) / 1000, UTC).astimezone(SYDNEY)
        day = moment.date().isoformat()
        before = [d for d in rates if d <= day]
        rate = rates[max(before)] if before else fallback
        out.append(
            Fill(
                coin=coin,
                symbol=symbol,
                order_id=int(t["orderId"]),
                time=int(t["time"]),
                buy=bool(t["isBuyer"]),
                qty=Decimal(str(t["qty"])),
                price=Decimal(str(t["price"])),
                quote=Decimal(str(t["quoteQty"])),
                aud_rate=rate,
            )
        )
    return sorted(out, key=lambda f: (f.time, f.order_id))
