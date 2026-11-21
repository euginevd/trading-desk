"""The Trading account's watchlist: a list of up to 10 coins, started from the coins held on
Binance (no stablecoins, no BNB, no dust) and edited by the owner. Each coin's price, day and 30
days, what's held, and one line on its trend and setup, worked out here from the daily candles
trading-agent's scan reads. No model: the line is the desk's own reading, and Ask
trading-agent (POST /pot/analyse) is where the model judges it."""

import time
from decimal import Decimal
from typing import Any

import httpx

from api import perp, screener
from api.binance import Binance, BinanceError, plain
from api.market import QUOTE
from api.pot import Pot
from api.pot_agent import DAYS, coin_facts
from api.watchlist import ACCOUNT_LIST as LIST
from api.watchlist import ACCOUNT_MAX

SKIP = ("USDC", "USDT", "FDUSD", "BUSD", "DAI", "TUSD", "BNB")  # money, and the fee token
DUST = Decimal(5)  # in the quote: less is left out
NEAR_20 = Decimal("0.02")  # within 2% of the 20-day: a pullback to it
AT_HIGH = Decimal("0.995")
AT_LOW = Decimal("1.01")
SPARK = 30
MAX = 10  # held coins it starts with; the owner may add up to ACCOUNT_MAX


def _d(value: object) -> Decimal | None:
    return None if value in (None, "") else Decimal(str(value))


def insight(facts: dict[str, Any]) -> dict[str, str]:
    """Trend and setup in words, and a status: watch (worth an Analyse), wait or none."""
    price = Decimal(facts["price"])
    s20, s50, s200 = (_d(facts.get(k)) for k in ("sma20", "sma50", "sma200"))
    high, low = Decimal(facts["range21d"]["high"]), Decimal(facts["range21d"]["low"])
    if s50 is None or s200 is None:
        trend = "Too new for a 200-day average."
        up = down = False
    else:
        up = price > s50 > s200
        down = price < s50 and price < s200
        if up:
            trend = "Up trend: above its 50- and 200-day."
        elif down:
            trend = "Down trend: under its 50- and 200-day."
        elif price > s200:
            trend = "Above its 200-day, under its 50-day."
        else:
            trend = "Above its 50-day, under its 200-day."
    if up and s20 is not None and abs(price / s20 - 1) <= NEAR_20:
        status, setup = "watch", "Back at its 20-day: worth an Analyse."
    elif not down and s50 is not None and price > s50 and price >= high * AT_HIGH:
        status, setup = "watch", "At its 21-day high: a breakout if it holds."
    elif price <= low * AT_LOW:
        status, setup = "wait", "At its 21-day low: wait for it to hold."
    elif down:
        status, setup = "none", "No long setup until it gets back over its 50-day."
    else:
        status, setup = "none", "No setup now."
    return {"trend": trend, "setup": setup, "status": status}


def _held(binance: Binance) -> dict[str, Decimal]:
    held: dict[str, Decimal] = {}
    for b in binance.balances():
        asset = str(b["asset"])
        amount = Decimal(str(b["free"])) + Decimal(str(b["locked"]))
        if asset not in SKIP and amount > 0:
            held[asset] = held.get(asset, Decimal(0)) + amount
    return held


def watchlist(pot: Pot) -> tuple[int, list[str]]:
    """The account's list and its coins. The first read makes it from the coins held on
    Binance worth more than dust, largest first."""
    store = pot.store
    found = next((x for x in store.lists() if x["name"] == LIST), None)
    if found is not None:
        return int(found["id"]), list(store.list_coins(found["id"]))
    binance: Binance = pot.binance
    held = _held(binance)
    known: set[str] = binance.symbols()
    pairs = [f"{c}{QUOTE}" for c in held if f"{c}{QUOTE}" in known]
    tickers = binance.tickers(pairs) if pairs else {}
    worth = {
        c: held[c] * Decimal(str(tickers[f"{c}{QUOTE}"]["lastPrice"]))
        for c in held
        if f"{c}{QUOTE}" in tickers
    }
    coins = sorted((c for c in worth if worth[c] >= DUST), key=lambda c: -worth[c])[:MAX]
    now = int(time.time() * 1000)
    list_id = store.create_list(LIST, now)
    for n, coin in enumerate(coins):
        store.watch_coin(list_id, coin, now - len(coins) + n)
    return list_id, coins


def _change(candles: list[list[Any]], days: int) -> str | None:
    """The change over the last `days` daily closes, in percent."""
    if len(candles) <= days:
        return None
    then, now = Decimal(str(candles[-days - 1][4])), Decimal(str(candles[-1][4]))
    return plain(((now / then - 1) * 100).quantize(Decimal("0.1"))) if then else None


def _from_high(candles: list[list[Any]], price: Decimal) -> str | None:
    """How far the price sits under its 30-day high, in percent (0 or less)."""
    highs = [Decimal(str(r[2])) for r in candles[-30:]]
    top = max(highs, default=Decimal(0))
    return plain(((price / top - 1) * 100).quantize(Decimal("0.1"))) if top else None


def snapshot(pot: Pot) -> dict[str, Any]:
    binance: Binance = pot.binance
    list_id, watched = watchlist(pot)
    held = _held(binance)
    # Binance refuses the whole request over one unknown pair, so ask only for listed ones.
    pairs = [f"{c}{QUOTE}" for c in watched]
    known: set[str] = binance.symbols() if pairs else set()
    listed = binance.tickers([p for p in pairs if p in known]) if pairs else {}
    tradable = set(pot.coins())
    watching = {p["coin"] for p in pot.proposals()}
    live = {
        t["coin"] for t in pot.view()["trades"] if t["status"] in ("placing", "waiting", "open")
    }
    with httpx.Client(timeout=10) as http:  # read once a day, then from memory
        caps = screener.market_caps(http)
    coins: list[dict[str, Any]] = []
    for coin in watched:
        row = listed.get(f"{coin}{QUOTE}")
        source = "spot"
        candles: list[list[Any]] = []
        if row is None:  # not on spot: a USDT perpetual's price, watch only
            row = perp.ticker(coin)
            if row is None:
                continue  # neither: not one the desk can price
            source = "futures"
            candles = perp.klines(coin, DAYS)
        else:
            try:
                candles = binance.klines(f"{coin}{QUOTE}", "1d", DAYS)
            except BinanceError:
                candles = []
        price = Decimal(str(row["lastPrice"]))
        amount = held.get(coin, Decimal(0))
        facts = coin_facts(coin, candles, None) if len(candles) > SPARK else None
        coins.append(
            {
                "coin": coin,
                "amount": plain(amount),
                "price": plain(price),
                "value": plain((amount * price).quantize(Decimal("0.01"))),
                "change24hPct": str(row.get("priceChangePercent", "0")),
                "change30dPct": facts["change30dPct"] if facts else None,
                "marketCap": f"{caps[coin]:.0f}" if coin in caps else None,
                "change7dPct": _change(candles, 7),
                "fromHighPct": _from_high(candles, price),
                "spark": [str(r[4]) for r in candles[-SPARK:]],
                "insight": insight(facts) if facts else None,
                "tradable": coin in tradable and source == "spot",
                "source": source,
                "watching": coin in watching,
                "inTrade": coin in live,
            }
        )
    return {"quote": QUOTE, "list": list_id, "max": ACCOUNT_MAX, "coins": coins}
