"""Fetches everything the portfolio page needs and hands it to portfolio.build."""

import threading
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import httpx

from api.binance import Binance, plain
from api.portfolio import STABLES, build
from api.tao import TaoError

FX_URL = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD,INR"
LIVE_FX_URL = (
    "https://api.coingecko.com/api/v3/simple/price"
    "?ids=tether&vs_currencies=aud,inr&precision=6&include_last_updated_at=true"
)
OK = 200
# A live rate outside its band is a bad reply, not a market: the ECB's is used instead.
SANE = {"AUD": (Decimal("0.8"), Decimal(3)), "INR": (Decimal(40), Decimal(200))}
Rates = dict[str, tuple[Decimal, str]]


def _live(client: httpx.Client) -> Rates:
    """USDT in each currency now, from CoinGecko: close to what Binance's own figures use."""
    try:
        response = client.get(LIVE_FX_URL)
        if response.status_code != OK:
            return {}
        tether: Any = response.json()["tether"]
        day = datetime.fromtimestamp(int(tether["last_updated_at"]), UTC).date().isoformat()
        found: Rates = {}
        for code, (low, high) in SANE.items():
            raw = tether.get(code.lower())
            if raw is not None and low < (rate := Decimal(str(raw))) < high:
                found[code] = (rate, day)
        return found
    except (httpx.HTTPError, KeyError, TypeError, ValueError, ArithmeticError):
        return {}


def _ecb(client: httpx.Client) -> Rates:
    try:
        response = client.get(FX_URL)
        if response.status_code != OK:
            return {}
        body: Any = response.json()
        return {
            code: (Decimal(str(rate)), str(body["date"]))
            for code, rate in body["rates"].items()
            if code in SANE
        }
    except (httpx.HTTPError, KeyError, TypeError, ValueError, ArithmeticError):
        return {}


def usd_rates(client: httpx.Client) -> Rates:
    """US dollars to Australian dollars and Indian rupees (decisions 29, 30): each the live USDT
    rate, or the ECB's daily rate where that can't be had; left out if neither can."""
    live = _live(client)
    if len(live) == len(SANE):
        return live
    return {**_ecb(client), **live}


def aud_rate(client: httpx.Client) -> tuple[Decimal, str] | None:
    return usd_rates(client).get("AUD")


Wallet = Callable[[], dict[str, Decimal]]
WORKERS = 8


class TradeCache:
    """Each coin's trade history, kept while its balance stays the same: a fill, deposit or
    withdrawal changes the balance, and only then is that coin's history fetched again."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._kept: dict[str, tuple[str, list[dict[str, Any]]]] = {}

    def get(self, coin: str, balance: str) -> list[dict[str, Any]] | None:
        with self._lock:
            kept = self._kept.get(coin)
        return kept[1] if kept and kept[0] == balance else None

    def put(self, coin: str, balance: str, trades: list[dict[str, Any]]) -> None:
        with self._lock:
            self._kept[coin] = (balance, trades)


def _held(row: dict[str, str]) -> str:
    return plain(Decimal(row["free"]) + Decimal(row["locked"]))


def _history(binance: Binance, coin: str, symbols: set[str]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for quote in STABLES:
        if f"{coin}{quote}" in symbols:
            found.extend(binance.trades(f"{coin}{quote}"))
    return found


@dataclass(frozen=True)
class CostRules:
    """How average cost is worked out: costs the owner entered, by source and coin, and the
    time (ms) from which trades count."""

    entered: dict[tuple[str, str], str] = field(default_factory=dict[tuple[str, str], str])
    from_ms: int = 0


def fetch(
    binance: Binance,
    fx: httpx.Client,
    wallet: Wallet | None = None,
    cache: TradeCache | None = None,
    rules: CostRules | None = None,
) -> dict[str, Any]:
    """The portfolio, with the TAO wallet when one is set up. A TAO wallet that can't be read
    leaves Binance's figures standing and says why in `wallets`. Binance's calls run side by
    side, and a cache skips trade histories that can't have changed. `rules` hold the owner's
    entered average costs (decision 27) and the date trades count from (decision 34)."""
    rules = rules or CostRules()
    costs, cost_from_ms = rules.entered, rules.from_ms
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        balances_job = pool.submit(binance.balances)
        symbols_job = pool.submit(binance.symbols)
        orders_job = pool.submit(binance.open_orders)
        fx_job = pool.submit(usd_rates, fx)
        wallet_job = pool.submit(wallet) if wallet is not None else None
        balances = balances_job.result()
        symbols = symbols_job.result()
        held = {b["asset"]: _held(b) for b in balances if b["asset"] not in STABLES}
        trades: dict[str, list[dict[str, Any]]] = {}
        jobs: dict[str, Future[list[dict[str, Any]]]] = {}
        for coin, amount in held.items():
            kept = cache.get(coin, amount) if cache else None
            if kept is not None:
                trades[coin] = kept
            else:
                jobs[coin] = pool.submit(_history, binance, coin, symbols)
        tao: dict[str, Decimal] | None = None
        tao_status: dict[str, Any] = {"status": "not_set"}
        if wallet_job is not None:
            try:
                tao = wallet_job.result()
                tao_status = {"status": "connected", **{k: plain(v) for k, v in tao.items()}}
            except TaoError as error:
                tao_status = {"status": "error", "error": str(error)}
        priced = {*held, "BTC", *(["TAO"] if tao is not None else [])}
        tickers_job = pool.submit(
            binance.tickers, sorted(f"{c}USDT" for c in priced if f"{c}USDT" in symbols)
        )
        for coin, job in jobs.items():
            trades[coin] = job.result()
            if cache:
                cache.put(coin, held[coin], trades[coin])
        tickers = tickers_job.result()
        open_orders = orders_job.result()
        rates = fx_job.result()
    # Average cost counts only trades from the owner's start date (decision 34).
    trades = {
        coin: kept
        for coin, found in trades.items()
        if (kept := [t for t in found if int(t["time"]) >= cost_from_ms])
    }
    if tao is not None and tao["total"] > 0:
        # Unclaimed root rewards count as held (decision 32); an entered cost covers the rest.
        held_tao = tao["total"] + tao.get("rewards", Decimal(0))
        wallet_row = {
            "asset": "TAO",
            "free": plain(held_tao),
            "locked": "0",
            "covers": plain(tao["total"]),
        }
        balances = [*balances, {**wallet_row, "source": "TAO wallet"}]
    if costs:
        balances = [
            {**b, "cost": entered}
            if (entered := costs.get((b.get("source", "Binance"), b["asset"])))
            else b
            for b in balances
        ]
    aud = rates.get("AUD")
    portfolio = build(balances, tickers, trades, open_orders, aud)
    # Every currency the Dashboard can show, as units per US dollar (decision 30).
    btc = tickers.get("BTCUSDT")
    portfolio["total"]["rates"] = {
        "USD": "1",
        **{code: plain(rate) for code, (rate, _) in rates.items()},
        **({"BTC": plain(1 / Decimal(btc["lastPrice"]))} if btc else {}),
    }
    portfolio["fetchedAt"] = datetime.now(UTC).isoformat(timespec="seconds")
    portfolio["wallets"] = {"binance": {"status": "connected"}, "tao": tao_status}
    return portfolio
