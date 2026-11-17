"""The Trading account's coin snapshot: each coin held on Binance (no stablecoins, no BNB, no
dust), its price, day and 30 days, and one line on its trend and setup, worked out here from
the daily candles trading-agent's scan reads. No model: the line is the desk's own reading,
and Analyse in New trade is where trading-agent judges it."""

from decimal import Decimal
from typing import Any

from api.binance import Binance, BinanceError, plain
from api.market import QUOTE
from api.pot import Pot
from api.pot_agent import DAYS, coin_facts

SKIP = ("USDC", "USDT", "FDUSD", "BUSD", "DAI", "TUSD", "BNB")  # money, and the fee token
DUST = Decimal(5)  # in the quote: less is left out
NEAR_20 = Decimal("0.02")  # within 2% of the 20-day: a pullback to it
AT_HIGH = Decimal("0.995")
AT_LOW = Decimal("1.01")
SPARK = 30


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


def snapshot(pot: Pot) -> dict[str, Any]:
    binance: Binance = pot.binance
    held: dict[str, Decimal] = {}
    for b in binance.balances():
        asset = str(b["asset"])
        amount = Decimal(str(b["free"])) + Decimal(str(b["locked"]))
        if asset not in SKIP and amount > 0:
            held[asset] = held.get(asset, Decimal(0)) + amount
    listed = binance.tickers([f"{c}{QUOTE}" for c in held]) if held else {}
    tradable = set(pot.coins())
    watching = {p["coin"] for p in pot.proposals()}
    live = {
        t["coin"] for t in pot.view()["trades"] if t["status"] in ("placing", "waiting", "open")
    }
    coins: list[dict[str, Any]] = []
    for coin, amount in held.items():
        row = listed.get(f"{coin}{QUOTE}")
        if row is None:
            continue  # no pair with the quote: not one the desk can price or trade
        price = Decimal(str(row["lastPrice"]))
        value = amount * price
        if value < DUST:
            continue
        candles: list[list[Any]]
        try:
            candles = binance.klines(f"{coin}{QUOTE}", "1d", DAYS)
        except BinanceError:
            candles = []
        facts = coin_facts(coin, candles, None) if len(candles) > SPARK else None
        coins.append(
            {
                "coin": coin,
                "amount": plain(amount),
                "price": plain(price),
                "value": plain(value.quantize(Decimal("0.01"))),
                "change24hPct": str(row.get("priceChangePercent", "0")),
                "change30dPct": facts["change30dPct"] if facts else None,
                "spark": [str(r[4]) for r in candles[-SPARK:]],
                "insight": insight(facts) if facts else None,
                "tradable": coin in tradable,
                "watching": coin in watching,
                "inTrade": coin in live,
            }
        )
    coins.sort(key=lambda c: Decimal(c["value"]), reverse=True)
    return {"quote": QUOTE, "coins": coins}
