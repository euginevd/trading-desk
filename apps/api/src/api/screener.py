"""New trade's screener (local/agents/trading-agent.md, each style's section): the 100
most-traded USDC coins on Binance, narrowed by each style's filters, then each style's setups
found in code. No model here: trading-agent reads only the shortlist (pot_agent.judge), and the
desk sizes and checks what it proposes. Prices are floats here, for speed; the desk sizes in
Decimal from the strings."""

import json
import math
import re
import time
from bisect import bisect_right
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from api import odds
from api.binance import Binance, BinanceError
from api.market import QUOTE

SYDNEY = ZoneInfo("Australia/Sydney")
CG_URL = "https://api.coingecko.com/api/v3/coins/markets"
UNIVERSE_KEY = "pot_universe"
RETRY_MS = 10 * 60_000
# Each style's section heading in local/agents/trading-agent.md, the one file of the rules.
HEADING = {"scalp": "Scalp", "day": "Day trade", "swing": "Swing", "position": "Position"}
RISK_PCT = "1"  # every style: 1% of the pot a trade, within its cap (owner, 17 Nov 2026)
# Binance takes only these in a list of symbols: a ticker in another script (some Binance
# listings have one) would refuse the whole request.
PLAIN = re.compile(r"[A-Z0-9]{1,20}")
TOP = 100
FEE = 0.001  # Binance spot, each side
SLIP = 0.0005
DAY_MS = 86_400_000
SCREEN_TTL_S = 90
STABLES = {
    "USDT", "USDC", "DAI", "FDUSD", "TUSD", "USDE", "USDS", "PYUSD", "USD1", "BUSD", "USDD",
    "FRAX", "EURC", "USDP", "GUSD", "RLUSD", "USDTB", "USDF", "USDG", "USDX", "LUSD", "CRVUSD",
    "GHO", "SUSDE", "SUSDS", "BUIDL", "USYC", "USDO", "USR", "AEUR", "EURI", "XUSD", "BFUSD",
}  # fmt: skip
WRAPPED = {
    "WBTC", "WETH", "STETH", "WSTETH", "WEETH", "CBBTC", "WBETH", "RETH", "METH", "LBTC",
    "SOLVBTC", "BSC-USD", "CBETH", "EZETH", "RSETH", "JITOSOL", "MSOL", "BNSOL", "LSETH", "WBNB",
    "XAUT", "PAXG", "WHYPE", "KHYPE", "STHYPE", "BTCB", "TBTC", "CLBTC", "OSETH",
}  # fmt: skip
WRAPPED_WORDS = ("wrapped", "staked", "bridged", "restaked", "tokenized")


@dataclass(frozen=True)
class Style:
    key: str
    name: str
    line: str
    hold: str
    setup_tf: str
    setup_n: int
    bias_tf: str
    bias_n: int
    min_rr: float
    volume_floor: float
    top: int
    history_days: int
    expiry_s: int
    shortlist: int
    searches: int
    model: str


STYLES: dict[str, Style] = {
    "scalp": Style(
        "scalp", "Scalp", "5 to 60 minutes · 5-minute candles · 1-hour trend",
        "5 to 60 minutes", "5m", 300, "1h", 60, 1.5, 300e6, 30, 90, 120, 5, 1,
        "claude-haiku-5-5",
    ),
    "day": Style(
        "day", "Day trade", "1 to 12 hours · 15-minute candles · 4-hour trend",
        "1 to 12 hours", "15m", 200, "4h", 60, 2.0, 100e6, 50, 90, 3600, 6, 2,
        "claude-sonnet-5-5",
    ),
    "swing": Style(
        "swing", "Swing", "2 days to 3 weeks · daily candles · BTC regime and key levels",
        "2 days to 3 weeks", "1d", 400, "1d", 0, 2.0, 50e6, 100, 365, 2 * 86400, 8, 3,
        "claude-opus-5-5",
    ),
    "position": Style(
        "position", "Position", "3 weeks to 6 months · weekly candles · weekly trend",
        "3 weeks to 6 months", "1d", 400, "1w", 120, 3.0, 50e6, 30, 730, 7 * 86400, 5, 3,
        "claude-opus-5-5",
    ),
}  # fmt: skip


def gate(_style: Style, regime: str | None) -> tuple[bool, str]:
    """Whether the BTC regime allows a new trade, and why not: every style trades in Bull and
    Neutral at the pot's same 1% (owner, 17 Nov 2026); none opens a long in Bear."""
    if regime == "bear":
        return False, "BTC is in a Bear regime: no new longs in any style."
    return True, ""


def styles_view(regime: tuple[str | None, str]) -> dict[str, Any]:
    state, words = regime
    rows: list[dict[str, Any]] = []
    for s in STYLES.values():
        allowed, why = gate(s, state)
        rows.append(
            {
                "key": s.key,
                "name": s.name,
                "line": s.line,
                "hold": s.hold,
                "riskPct": RISK_PCT,
                "minRr": f"{s.min_rr:g}",
                "expirySeconds": s.expiry_s,
                "allowed": allowed,
                "note": why,
            }
        )
    return {"regime": {"state": state, "words": words}, "styles": rows}


# Indicators, on floats.


def closes_of(rows: list[list[Any]]) -> list[float]:
    return [float(r[4]) for r in rows]


def sma(xs: list[float], n: int) -> float | None:
    return sum(xs[-n:]) / n if len(xs) >= n else None


def ema(xs: list[float], n: int) -> float | None:
    if len(xs) < n:
        return None
    k = 2 / (n + 1)
    e = sum(xs[:n]) / n
    for x in xs[n:]:
        e = x * k + e * (1 - k)
    return e


def atr(rows: list[list[Any]], n: int = 14) -> float | None:
    if len(rows) <= n:
        return None
    total = 0.0
    for before, row in zip(rows[-n - 1 : -1], rows[-n:], strict=True):
        h, lo, prior = float(row[2]), float(row[3]), float(before[4])
        total += max(h - lo, abs(h - prior), abs(lo - prior))
    return total / n


def vwap(rows: list[list[Any]]) -> float | None:
    """Volume-weighted price over the rows, by quote volume (column 7) over base (5)."""
    weight = sum(float(r[5]) for r in rows)
    if weight <= 0:  # no base volume (the demo): the typical price, equally weighted
        return sum((float(r[2]) + float(r[3]) + float(r[4])) / 3 for r in rows) / len(rows)
    return sum(float(r[7]) for r in rows) / weight


def avg_volume(rows: list[list[Any]], n: int = 20) -> float:
    """The average quote volume of the n rows before the last."""
    span = rows[-n - 1 : -1]
    return sum(float(r[7]) for r in span) / len(span) if span else 0.0


def swing_lows(rows: list[list[Any]], k: int = 3) -> list[tuple[int, float]]:
    """Lows lower than the k candles either side; confirmed only k candles later."""
    lows = [float(r[3]) for r in rows]
    return [
        (i, lows[i])
        for i in range(k, len(lows) - k)
        if all(lows[i] < lows[j] for j in range(i - k, i + k + 1) if j != i)
    ]


def closed(rows: list[list[Any]], now_ms: int) -> list[list[Any]]:
    """Only candles that have closed: Binance's last row is the one still forming."""
    if rows and len(rows[-1]) > 6 and int(rows[-1][6] or 0) > now_ms:  # noqa: PLR2004
        return rows[:-1]
    return rows


def change(xs: list[float], n: int) -> float | None:
    return (xs[-1] / xs[-n - 1] - 1) * 100 if len(xs) > n and xs[-n - 1] else None


def round_number(price: float) -> float:
    """The nearest price ending in zero at the second significant digit (90,000; 150)."""
    if price <= 0:
        return price
    unit = 10 ** (math.floor(math.log10(price)) - 1)
    return round(price / unit) * unit


def off_round(stop: float, a: float) -> float:
    r = round_number(stop)
    return min(stop, r) - 0.25 * a if abs(stop - r) < 0.25 * a else stop


def target_for(entry: float, stop: float, rr: float) -> float:
    """The target that makes reward rr times risk after fees, as the desk measures both."""
    risk = entry - stop + entry * FEE + stop * FEE
    return (rr * risk + entry * (1 + FEE)) / (1 - FEE) * 1.0005


def fmt(x: float) -> str:
    if abs(x) < 1:
        return f"{Decimal(repr(x)):.8g}"
    return f"{x:.7g}"


# The universe: CoinGecko's top 100, listed on Binance against the desk's quote.

_UNIVERSE: dict[str, Any] = {}
_SCREENS: dict[str, dict[str, Any]] = {}


def _crypto(http: httpx.Client | None) -> list[dict[str, Any]] | None:
    """CoinGecko's top 250 by market cap, less stablecoins and wrapped or staked tokens: what
    counts as a crypto coin, so tokenized stocks and fiat on Binance stay out."""
    if http is None:
        return None
    try:
        response = http.get(
            CG_URL,
            params={"vs_currency": "usd", "order": "market_cap_desc", "per_page": 250, "page": 1},
        )
        if response.status_code != 200:  # noqa: PLR2004
            return None
        rows = response.json()
    except (httpx.HTTPError, ValueError):
        return None
    found: list[dict[str, Any]] = []
    for r in rows:
        coin = str(r.get("symbol") or "").upper()
        name = str(r.get("name") or "")
        price = float(r.get("current_price") or 0)
        if not PLAIN.fullmatch(coin) or coin in STABLES or coin in WRAPPED:
            continue
        if any(w in name.lower() for w in WRAPPED_WORDS):
            continue
        if "USD" in coin and 0.97 <= price <= 1.03:  # noqa: PLR2004 - a stablecoin by its price
            continue
        found.append({"coin": coin, "name": name, "capRank": int(r.get("market_cap_rank") or 999)})
    return found


def _volumes(binance: Binance, coins: list[str], symbols: set[str]) -> dict[str, list[float]]:
    """Each coin's 24-hour volume on Binance: [its pair in the quote, the quote and USDT]."""
    pairs = [f"{c}{q}" for c in coins for q in {QUOTE, "USDT"} if f"{c}{q}" in symbols]
    rows = binance.tickers(pairs)
    found: dict[str, list[float]] = {}
    for c in coins:
        own = float(rows.get(f"{c}{QUOTE}", {}).get("quoteVolume") or 0)
        usdt = float(rows.get(f"{c}USDT", {}).get("quoteVolume") or 0) if QUOTE != "USDT" else 0
        found[c] = [own, own + usdt]
    return found


def universe(
    binance: Binance,
    store: Any,
    http: httpx.Client | None,
    fallback: list[str],
    now_ms: int,
) -> dict[str, Any]:
    """Today's coins (by UTC day): the 100 most-traded crypto coins against the desk's quote on
    Binance, ranked by that pair's 24-hour volume, each with 400 daily candles; built once a
    day and kept in memory. The list is also saved, so the desk can size a trade in any."""
    day = datetime.fromtimestamp(now_ms / 1000, UTC).strftime("%Y-%m-%d")
    if _UNIVERSE.get("quote") == QUOTE and (
        _UNIVERSE.get("day") == day or now_ms < _UNIVERSE.get("until", 0)
    ):
        return _UNIVERSE
    crypto = _crypto(http)
    source = f"The {TOP} most-traded {QUOTE} coins on Binance"
    fallback_list = [{"coin": c, "name": c, "capRank": 999} for c in fallback]
    if crypto is None:
        crypto = fallback_list
        source = "trading-agent's coins (CoinGecko didn't answer)"
    symbols = binance.symbols()
    named: dict[str, dict[str, Any]] = {
        str(c["coin"]): c for c in crypto if f"{c['coin']}{QUOTE}" in symbols
    }
    volume = _volumes(binance, list(named), symbols)
    ranked = sorted(named, key=lambda c: -volume[c][0])[:TOP]
    daily = binance.klines_many([f"{c}{QUOTE}" for c in ranked], "1d", 400)
    coins: list[dict[str, Any]] = []
    for n, c in enumerate(ranked):
        rows = daily.get(f"{c}{QUOTE}", [])
        if rows:
            coins.append(
                named[c]
                | {
                    "rank": n + 1,
                    "quoteVolume": volume[c][0],
                    "volume": volume[c][1],
                    "days": len(rows),
                    "daily": closed(rows, now_ms),
                }
            )
    store.set_setting(UNIVERSE_KEY, json.dumps({"day": day, "coins": [c["coin"] for c in coins]}))
    _UNIVERSE.clear()
    _UNIVERSE.update({"day": day, "quote": QUOTE, "source": source, "listed": len(named)})
    if crypto is fallback_list:  # CoinGecko didn't answer: kept 10 minutes, then tried again
        _UNIVERSE.update({"day": "", "until": now_ms + RETRY_MS})
    _UNIVERSE["coins"] = coins
    return _UNIVERSE


def tradable(store: Any) -> set[str]:
    raw = store.setting(UNIVERSE_KEY, "")
    return set(json.loads(raw).get("coins", [])) if raw else set()


# Timing: tendencies, shown as warnings (on test: they don't block).


def timing(style: Style, now_ms: int) -> list[str]:
    utc = datetime.fromtimestamp(now_ms / 1000, UTC)
    syd = utc.astimezone(SYDNEY)
    said: list[str] = []
    weekday, hour = utc.weekday(), utc.hour
    weekend_close = weekday == 5 or weekday == 6 or (weekday == 4 and hour >= 12)  # noqa: PLR2004, PLR1714
    if style.key in ("scalp", "day") and weekend_close:
        said.append("Weekend: thin liquidity and sharp wicks. The rules say no new orders.")
    if style.key == "swing" and weekday in (4, 5, 6):
        said.append("Friday to Monday's daily close: the rules say no new swing orders.")
    if style.key == "scalp" and 8 <= syd.hour < 18:  # noqa: PLR2004
        said.append("Outside scalp hours (6pm to 8am Sydney): moves are smaller now.")
    if style.key == "day" and 4 <= syd.hour < 11:  # noqa: PLR2004
        said.append("Late in the crypto day: a day trade must close by the 11am close.")
    return said


# The styles' setups. Each returns candidates: coin, setup(s), entry, stop, target, score, facts.


def _clamp_stop(entry: float, stop: float, lo: float, hi: float, a: float) -> float | None:
    """Widen a stop closer than lo to lo; refuse one wider than hi; keep it off round numbers."""
    dist = entry - stop
    if dist < lo:
        stop = entry - lo
    elif dist > hi:
        return None
    stop = off_round(stop, a)
    return stop if 0 < stop < entry else None


Setup = tuple[str, float, float]  # its name, the entry, and the stop before it's checked
Rows = list[list[Any]]


def _candidate(  # noqa: PLR0913 - each is a separate part of the candidate
    coin: str,
    found: list[Setup],
    *,
    stop: float,
    style: Style,
    score: float,
    facts: dict[str, Any],
) -> dict[str, Any]:
    entry = max(f[1] for f in found)
    target = target_for(entry, stop, style.min_rr)
    return {
        "coin": coin,
        "setup": " + ".join(f[0] for f in found),
        "grade": "A" if len(found) > 1 else "B",
        "entry": fmt(entry),
        "stop": fmt(stop),
        "target": fmt(target),
        "stopPct": f"{(entry - stop) / entry * 100:.2f}",
        "score": round(min(score, 10.0), 1),
        "facts": facts,
    }


def _hl(rows: Rows) -> tuple[float, float]:
    return max(float(r[2]) for r in rows), min(float(r[3]) for r in rows)


def _scalp_setups(five: Rows, a: float, ratio: float) -> tuple[list[Setup], float | None]:
    c = five[-1]
    lo, close = float(c[3]), float(c[4])
    day_start = int(c[0]) - int(c[0]) % DAY_MS
    today = [r for r in five if int(r[0]) >= day_start]
    v = vwap(today if len(today) >= 6 else five[-288:])  # noqa: PLR2004 - half an hour at least
    found: list[Setup] = []
    if v and close > v and lo <= v + 0.25 * a:
        found.append(("VWAP pullback", v, lo - 0.25 * a))
    top, bottom = _hl(five[-13:-1])  # the hour before
    if top - bottom <= 1.5 * a and close > top and ratio >= 2:  # noqa: PLR2004
        found.append(("Range break", top, (top + bottom) / 2))
    if lo < bottom < close:
        found.append(("Sweep and reclaim", bottom, lo - 0.25 * a))
    return found, v


def _scalp(coin: str, five: Rows, hour: Rows, btc_ok: bool, style: Style) -> dict[str, Any] | None:
    hc = closes_of(hour)
    e50, a = ema(hc, 50), atr(five)
    if e50 is None or a is None or len(five) < 40 or not btc_ok or hc[-1] <= e50:  # noqa: PLR2004
        return None
    close = float(five[-1][4])
    ratio = float(five[-1][7]) / (avg_volume(five) or 1)
    if ratio < 1.5:  # noqa: PLR2004
        return None
    found, v = _scalp_setups(five, a, ratio)
    if not found:
        return None
    entry = max(f[1] for f in found)
    stop = _clamp_stop(entry, min(f[2] for f in found), entry * 0.003, entry * 0.01, a)
    if stop is None or entry > close:
        return None
    score = 2 * len(found) + min(ratio, 4) + (2 if hc[-1] > e50 * 1.01 else 1)
    top, bottom = _hl(five[-13:-1])
    facts = {
        "price": fmt(close),
        "vwap": fmt(v) if v else None,
        "atr5m": fmt(a),
        "volumeVsAvg": f"{ratio:.1f}",
        "ema50_1h": fmt(e50),
        "hourHigh": fmt(top),
        "hourLow": fmt(bottom),
    }
    return _candidate(coin, found, stop=stop, style=style, score=score, facts=facts)


def _opening_range(today: Rows, m15: Rows, a: float) -> Setup | None:
    """Today's first hour broken on volume, then retested and held."""
    if len(today) <= 4:  # noqa: PLR2004 - the opening range is today's first four candles
        return None
    or_high, or_low = _hl(today[:4])
    avg = avg_volume(m15)
    broke = any(
        float(r[4]) > or_high and float(r[7]) >= 1.5 * avg  # noqa: PLR2004
        for r in today[4:-1]
    )
    lo, close = float(m15[-1][3]), float(m15[-1][4])
    if broke and lo <= or_high + 0.25 * a and close > or_high:
        return ("Opening range retest", or_high, (or_high + or_low) / 2)
    return None


def _day_setups(m15: Rows, a: float) -> tuple[list[Setup], dict[str, Any]] | None:
    c = m15[-1]
    lo, close = float(c[3]), float(c[4])
    day_start = int(c[0]) - int(c[0]) % DAY_MS
    today = [r for r in m15 if int(r[0]) >= day_start]
    yday = [r for r in m15 if day_start - DAY_MS <= int(r[0]) < day_start]
    if not yday or not today:
        return None
    y_high, y_low = _hl(yday)
    found: list[Setup] = []
    opening = _opening_range(today, m15, a)
    if opening:
        found.append(opening)
    asia = [r for r in today if int(r[0]) < day_start + 8 * 3_600_000]
    if len(today) > 32 and lo < _hl(asia)[1] < close:  # noqa: PLR2004 - after 08:00 UTC
        found.append(("Asia sweep", _hl(asia)[1], lo - 0.25 * a))
    if any(float(r[4]) > y_high for r in today[:-1]) and lo <= y_high + 0.25 * a < close:
        found.append(("Yesterday's high reclaim", y_high, y_high - 0.5 * a))
    v = vwap(today)
    if v and all(float(r[4]) > v for r in today[-8:-1]) and lo <= v + 0.25 * a < close:
        found.append(("VWAP pullback", v, lo - 0.25 * a))
    facts = {
        "price": fmt(close),
        "atr15m": fmt(a),
        "yesterdayHigh": fmt(y_high),
        "yesterdayLow": fmt(y_low),
        "vwap": fmt(v) if v else None,
    }
    return found, facts


def _day(coin: str, m15: Rows, h4: Rows, btc_ok: bool, style: Style) -> dict[str, Any] | None:
    c4 = closes_of(h4)
    e50, e50_before, a = ema(c4, 50), ema(c4[:-3], 50), atr(m15)
    if e50 is None or e50_before is None or a is None or not btc_ok:
        return None
    if len(m15) < 100 or c4[-1] <= e50 or e50 <= e50_before:  # noqa: PLR2004
        return None
    seen = _day_setups(m15, a)
    if not seen or not seen[0]:
        return None
    found, facts = seen
    entry = max(f[1] for f in found)
    lo, hi = max(a, entry * 0.005), min(2.5 * a, entry * 0.03)
    stop = _clamp_stop(entry, min(f[2] for f in found), lo, hi, a) if lo <= hi else None
    if stop is None or entry > float(m15[-1][4]):
        return None
    score = 2 * len(found) + (2 if c4[-1] > e50 * 1.02 else 1)
    facts["ema50_4h"] = fmt(e50)
    return _candidate(coin, found, stop=stop, style=style, score=score, facts=facts)


def _calendar_levels(rows: Rows) -> list[tuple[float, int, str]]:
    """Quarter, month and week opens, highs and lows, and the Monday range; 1 is strongest."""
    when = [datetime.fromtimestamp(int(r[0]) / 1000, UTC) for r in rows]
    last = when[-1]
    end = last + timedelta(days=1)

    def span(start: datetime, stop: datetime) -> Rows:
        return [r for r, t in zip(rows, when, strict=True) if start <= t < stop]

    week = last - timedelta(days=last.weekday())
    month = last.replace(day=1)
    quarter = month.replace(month=(month.month - 1) // 3 * 3 + 1)
    prev_q = (quarter - timedelta(days=1)).replace(day=1)
    prev_q = prev_q.replace(month=(prev_q.month - 1) // 3 * 3 + 1)
    periods = [
        (prev_q, quarter, 1, "quarter"),
        ((month - timedelta(days=1)).replace(day=1), month, 2, "month"),
        (week - timedelta(days=7), week, 3, "week"),
    ]
    raw: list[tuple[float, int, str]] = []
    for before, now, strength, name in periods:
        part = span(before, now)
        if part:
            high, low = _hl(part)
            raw += [(high, strength, f"Last {name}'s high"), (low, strength, f"Last {name}'s low")]
        this = span(now, end)
        if this:
            raw.append((float(this[0][1]), strength, f"{name.capitalize()} open"))
    this_week = span(week, end)
    if len(this_week) > 1:  # Monday's candle has closed
        high, low = _hl(this_week[:1])
        raw += [(high, 4, "Monday high"), (low, 4, "Monday low")]
    return raw


def levels(rows: Rows, a: float) -> list[dict[str, Any]]:
    """Key levels from daily candles (swing guide, layer 2), merged into zones within 1 ATR."""
    raw = _calendar_levels(rows)
    raw += [(low, 5, "Swing low") for _, low in swing_lows(rows[-90:])]
    closes = closes_of(rows)
    raw += [(s, 5, f"{n}-day SMA") for n in (20, 50) if (s := sma(closes, n))]
    raw.sort()
    zones: list[dict[str, Any]] = []
    for price, strength, name in raw:
        if zones and price - zones[-1]["prices"][-1] <= a:
            z = zones[-1]
            z["prices"].append(price)
            z["names"].append(name)
            z["strength"] = min(z["strength"], strength)
        else:
            zones.append({"prices": [price], "names": [name], "strength": strength})
    return [
        {
            "price": sum(z["prices"]) / len(z["prices"]),
            "names": z["names"],
            "strength": z["strength"],
        }
        for z in zones
    ]


def _w_pattern(rows: Rows, p: float, a: float) -> bool:
    """Two swing lows near the zone, 5 to 30 candles apart, then the first close over the peak."""
    recent = rows[-40:]
    lows = [x for x in swing_lows(recent) if abs(x[1] - p) <= 0.5 * a]
    if len(lows) < 2:  # noqa: PLR2004
        return False
    (i, first), (j, second) = lows[-2], lows[-1]
    if abs(second - first) > 0.5 * a or not 5 <= j - i <= 30:  # noqa: PLR2004
        return False
    peak = _hl(recent[i:j])[0]
    return float(rows[-1][4]) > peak >= float(rows[-2][4])


def _zone_setups(
    rows: Rows, below: list[dict[str, Any]], a: float
) -> tuple[list[Setup], dict[str, Any] | None]:
    """The best setup at the nearest two zones under the price: the most setups at one zone."""
    lo = float(rows[-1][3])
    best: tuple[list[Setup], dict[str, Any] | None] = ([], None)
    for z in reversed(below):
        p = z["price"]
        found: list[Setup] = []
        if lo < p:
            found.append(("Sweep and reclaim", p, lo - 0.5 * a))
        elif lo <= p + 0.5 * a:
            found.append(("Trend pullback", p, lo - 0.5 * a))
        if _w_pattern(rows, p, a):
            found.append(("W pattern", p, lo - 0.5 * a))
        if len(found) > len(best[0]):
            best = (found, z)
    return best


def _breakout(rows: Rows, a: float) -> Setup | None:
    """A 15-day range broken on volume within the last month, retested now and held."""
    lo, close = float(rows[-1][3]), float(rows[-1][4])
    window = rows[-31:-1]
    avg = avg_volume(rows)
    for i in range(15, len(window)):
        high, low = _hl(window[i - 15 : i])
        broke = float(window[i][4]) > high and float(window[i][7]) >= 1.5 * avg  # noqa: PLR2004
        if high - low <= 4 * a and broke and lo <= high + 0.5 * a and close > high:
            return ("Breakout retest", high, lo - 0.5 * a)
    return None


def _swing(coin: str, rows: Rows, btc_month: float | None, style: Style) -> dict[str, Any] | None:
    closes = closes_of(rows)
    a, s50 = atr(rows), sma(closes, 50)
    if a is None or s50 is None or len(rows) < 60 or closes[-1] <= s50:  # noqa: PLR2004
        return None
    month = change(closes, 30)
    if coin != "BTC" and (month is None or btc_month is None or month <= btc_month):
        return None
    zones = levels(rows, a)
    close = closes[-1]
    below = [z for z in zones if z["price"] < close][-2:]
    found, zone = _zone_setups(rows, below, a)
    retest = _breakout(rows, a)
    if retest and (not found or abs(found[0][1] - retest[1]) <= a):
        found.append(retest)
    if not found:
        return None
    zone = zone or {"names": ["Range top"], "strength": 3}
    entry = max(f[1] for f in found)
    stop = _clamp_stop(entry, min(f[2] for f in found), 1.5 * a, 3 * a, a)
    if stop is None:
        return None
    lead = max((month or 0) - (btc_month or 0), 0)
    score = 2 * len(found) + (6 - zone["strength"]) * 0.6 + min(lead / 5, 2)
    facts = {
        "price": fmt(close),
        "atr14": fmt(a),
        "sma50": fmt(s50),
        "change30dPct": f"{month:.1f}" if month is not None else None,
        "btcChange30dPct": f"{btc_month:.1f}" if btc_month is not None else None,
        "zone": {"price": fmt(entry), "madeOf": zone["names"]},
        "zonesBelow": [{"price": fmt(z["price"]), "names": z["names"]} for z in below],
        "zonesAbove": [
            {"price": fmt(z["price"]), "names": z["names"]}
            for z in [z for z in zones if z["price"] >= close][:2]
        ],
    }
    return _candidate(coin, found, stop=stop, style=style, score=score, facts=facts)


def _weekly_setups(weekly: Rows, s10: float, s20: float, wa: float) -> list[Setup]:
    lo, close = float(weekly[-1][3]), float(weekly[-1][4])
    found: list[Setup] = []
    for name, s in (("Pullback to the 10-week", s10), ("Pullback to the 20-week", s20)):
        if lo <= s + 0.5 * wa and close > s:
            found.append((name, s, lo - 0.5 * wa))
            break
    top, bottom = _hl(weekly[-9:-1])
    if top - bottom <= 3 * wa and close > top:
        found.append(("Base breakout", top, (top + bottom) / 2))
    return found


def _position(
    coin: str, daily: Rows, weekly: Rows, btc_q: float | None, style: Style
) -> dict[str, Any] | None:
    wc = closes_of(weekly)
    s10, s20, s40, wa = sma(wc, 10), sma(wc, 20), sma(wc, 40), atr(weekly)
    if s10 is None or s20 is None or s40 is None or wa is None or len(weekly) < 104:  # noqa: PLR2004
        return None
    quarter = change(wc, 13)
    weak = coin != "BTC" and (quarter is None or btc_q is None or quarter <= btc_q)
    if wc[-1] <= s40 or s10 <= s40 or weak:
        return None
    found = _weekly_setups(weekly, s10, s20, wa)
    if not found:
        return None
    price = float(daily[-1][4]) if daily else wc[-1]
    found = [(n, min(e, price), s) for n, e, s in found]
    entry = max(f[1] for f in found)
    stop = off_round(min(f[2] for f in found), wa)
    if not 0 < stop < entry:
        return None
    lead = max((quarter or 0) - (btc_q or 0), 0)
    score = 2 * len(found) + min(lead / 10, 3) + (1 if s10 > s20 else 0)
    facts = {
        "price": fmt(price),
        "weeklyAtr": fmt(wa),
        "sma10w": fmt(s10),
        "sma20w": fmt(s20),
        "sma40w": fmt(s40),
        "change13wPct": f"{quarter:.1f}" if quarter is not None else None,
        "btcChange13wPct": f"{btc_q:.1f}" if btc_q is not None else None,
        "weeksListed": len(weekly),
    }
    return _candidate(coin, found, stop=stop, style=style, score=score, facts=facts)


Miss = tuple[float, str, str]  # how far from a setup (smaller is closer), the coin, and why
Found = tuple[list[dict[str, Any]], list[Miss], str]  # picks, near misses, a block on them all


def _under(coin: str, price: float, avg: float, name: str) -> Miss:
    gap = (avg / price - 1) * 100
    return (gap, coin, f"{_by(gap)} under its {name}")


def _by(gap: float) -> str:
    return "just" if gap < 0.05 else f"{gap:.1f}%"  # noqa: PLR2004 - under a twentieth of 1%


def _intraday_miss(coin: str, rows: Rows, bias: Rows, style: Style) -> Miss:
    """Why a liquid coin has no scalp or day trade: its trend, its volume, or no setup."""
    hc = closes_of(bias)
    e = ema(hc, 50)
    frame = "1-hour" if style.key == "scalp" else "4-hour"
    if e and hc[-1] <= e:
        return _under(coin, hc[-1], e, f"{frame} 50 EMA")
    ratio = float(rows[-1][7]) / (avg_volume(rows) or 1)
    if style.key == "scalp" and ratio < 1.5:  # noqa: PLR2004
        return ((1.5 - ratio) * 10, coin, f"quiet: volume {ratio:.1f}x its average, 1.5x needed")
    return (5.0, coin, "trend and volume pass; no setup on the last candle")


def _intraday(style: Style, liquid: list[dict[str, Any]], binance: Binance, now_ms: int) -> Found:
    """Scalp and day trade: fresh candles for the liquid coins, then each one's setups."""
    symbols = [f"{c['coin']}{QUOTE}" for c in liquid]
    if f"BTC{QUOTE}" not in symbols:
        symbols.append(f"BTC{QUOTE}")
    setup_rows = binance.klines_many(symbols, style.setup_tf, style.setup_n)
    bias_rows = binance.klines_many(symbols, style.bias_tf, style.bias_n)
    try:
        books = binance.books(symbols)
    except BinanceError:
        books = {}
    btc_bias = closes_of(closed(bias_rows.get(f"BTC{QUOTE}", []), now_ms))
    btc_e = ema(btc_bias, 50)
    btc_ok = bool(btc_e and btc_bias[-1] > btc_e)
    block = ""
    if btc_e and not btc_ok:
        frame = "1-hour" if style.key == "scalp" else "4-hour"
        gap = (btc_e / btc_bias[-1] - 1) * 100
        block = (
            f"BTC's {frame} close is {_by(gap)} under its 50 EMA: no "
            f"{style.name.lower()}s until it's back above."
        )
    widest = Decimal("0.0003") if style.key == "scalp" else Decimal("0.0005")
    find = _scalp if style.key == "scalp" else _day
    picks: list[dict[str, Any]] = []
    misses: list[Miss] = []
    for c in liquid:
        sym = f"{c['coin']}{QUOTE}"
        bid, ask = books.get(sym, (Decimal(0), Decimal(0)))
        if bid > 0 and (ask - bid) / bid > widest:
            spread = float((ask - bid) / bid * 100)
            misses.append((spread * 10, c["coin"], f"spread {spread:.3f}%, too wide"))
            continue
        rows = closed(setup_rows.get(sym, []), now_ms)
        bias = closed(bias_rows.get(sym, []), now_ms)
        if not rows or not bias:
            continue
        if pick := find(c["coin"], rows, bias, btc_ok, style):
            picks.append(pick)
        else:
            misses.append(_intraday_miss(c["coin"], rows, bias, style))
    return picks, misses, block


def _swing_miss(coin: str, rows: Rows, btc_month: float | None) -> Miss:
    """Why a liquid coin has no swing: its trend, its strength, or how far it is from a level."""
    closes = closes_of(rows)
    price, s50 = closes[-1], sma(closes, 50)
    if s50 and price <= s50:
        return _under(coin, price, s50, "50-day")
    month = change(closes, 30)
    if coin != "BTC" and month is not None and btc_month is not None and month <= btc_month:
        lag = btc_month - month
        return (lag, coin, f"behind BTC by {lag:.1f} points over 30 days")
    a = atr(rows)
    below = [z for z in levels(rows, a) if z["price"] < price] if a else []
    if not below:
        return (99.0, coin, "no setup, and no level under the price")
    z = below[-1]
    gap = (price / z["price"] - 1) * 100
    names = ", ".join(z["names"][:2])
    return (gap, coin, f"no setup: {gap:.1f}% above its nearest level, {fmt(z['price'])} ({names})")


def _swings(style: Style, liquid: list[dict[str, Any]], btc_daily: Rows) -> Found:
    btc_month = change(closes_of(btc_daily), 30) if btc_daily else None
    picks: list[dict[str, Any]] = []
    misses: list[Miss] = []
    for c in liquid:
        if pick := _swing(c["coin"], c["daily"], btc_month, style):
            picks.append(pick)
        elif len(c["daily"]) > 50:  # noqa: PLR2004
            misses.append(_swing_miss(c["coin"], c["daily"], btc_month))
    return picks, misses, ""


def _position_miss(coin: str, weekly: Rows, btc_q: float | None) -> Miss:
    wc = closes_of(weekly)
    price, s10, s40 = wc[-1], sma(wc, 10), sma(wc, 40)
    if len(weekly) < 104:  # noqa: PLR2004
        return (99.0, coin, f"only {len(weekly)} weeks of history, 104 needed")
    if s40 and price <= s40:
        return _under(coin, price, s40, "40-week")
    if s10 and s40 and s10 <= s40:
        gap = (s40 / s10 - 1) * 100
        return (gap, coin, f"its 10-week is {gap:.1f}% under its 40-week")
    quarter = change(wc, 13)
    if coin != "BTC" and quarter is not None and btc_q is not None and quarter <= btc_q:
        lag = btc_q - quarter
        return (lag, coin, f"behind BTC by {lag:.1f} points over 13 weeks")
    gap = (price / s10 - 1) * 100 if s10 else 99.0
    return (abs(gap), coin, f"no setup: {gap:+.1f}% from its 10-week")


def _positions(style: Style, liquid: list[dict[str, Any]], binance: Binance, now_ms: int) -> Found:
    """Position trades: each coin's own weekly trend decides, not BTC's."""
    symbols = [f"{c['coin']}{QUOTE}" for c in liquid if c["coin"] != "BTC"]
    weekly = binance.klines_many([*symbols, f"BTC{QUOTE}"], "1w", style.bias_n)
    btc_q = change(closes_of(closed(weekly.get(f"BTC{QUOTE}", []), now_ms)), 13)
    picks: list[dict[str, Any]] = []
    misses: list[Miss] = []
    for c in liquid:
        rows = closed(weekly.get(f"{c['coin']}{QUOTE}", []), now_ms)
        if len(rows) < 41:  # noqa: PLR2004 - too short to say anything
            continue
        if pick := _position(c["coin"], c["daily"], rows, btc_q, style):
            picks.append(pick)
        else:
            misses.append(_position_miss(c["coin"], rows, btc_q))
    return picks, misses, ""


# The odds check (api/odds.py): each shortlisted coin's rule re-run on its past candles, and
# its plan simulated from them. The candles are kept with the screen, so judge's levels can
# be simulated again without another call to Binance.


@dataclass(frozen=True)
class OddsPlan:
    steps: int  # candles a trade is given to play out: the style's longest hold
    slot_ms: int | None  # intraday: draw each candle from the same time of day
    horizon: str
    history: int  # candles of the setup's timeframe to re-run the rule on


ODDS_PLAN = {
    "scalp": OddsPlan(12, 300_000, "1 hour", 1000),
    "day": OddsPlan(48, 900_000, "12 hours", 1000),
    "swing": OddsPlan(21, None, "3 weeks", 400),
    "position": OddsPlan(26, None, "6 months", 120),
}
_ODDS: dict[str, dict[str, Any]] = {}


def _signal(i: int, pick: dict[str, Any] | None) -> list[odds.Signal]:
    if not pick:
        return []
    return [(i, float(pick["entry"]), float(pick["stop"]), float(pick["target"]))]


def _trend_ok(rows: Rows) -> bool:
    c = closes_of(rows)
    e = ema(c, 50)
    return bool(e and c[-1] > e)


def _intraday_signals(
    style: Style, coin: str, rows: Rows, bias: Rows, btc: Rows
) -> list[odds.Signal]:
    """The scalp or day rule at each past candle, with the trend candles closed by then."""
    find = _scalp if style.key == "scalp" else _day
    bias_t = [int(r[6]) for r in bias]
    btc_t = [int(r[6]) for r in btc]
    btc_ok: dict[int, bool] = {}
    out: list[odds.Signal] = []
    for i in range(60, len(rows) - 1):
        t = int(rows[i][6])
        j = bisect_right(btc_t, t)
        if j not in btc_ok:
            btc_ok[j] = _trend_ok(btc[:j][-style.bias_n :])
        b = bias[: bisect_right(bias_t, t)][-style.bias_n :]
        if not btc_ok[j] or len(b) < 50:  # noqa: PLR2004
            continue
        window = rows[max(0, i + 1 - style.setup_n) : i + 1]
        out += _signal(i, find(coin, window, b, True, style))
    return out


def _change_at(btc: Rows, at: int, n: int) -> float | None:
    j = bisect_right([int(r[0]) for r in btc], at)
    return change(closes_of(btc[:j]), n)


def _swing_signals(style: Style, coin: str, rows: Rows, btc: Rows) -> list[odds.Signal]:
    out: list[odds.Signal] = []
    for i in range(60, len(rows) - 1):
        window = rows[max(0, i - 199) : i + 1]  # enough for a quarter's levels and the 50-day
        out += _signal(i, _swing(coin, window, _change_at(btc, int(rows[i][0]), 30), style))
    return out


def _position_signals(style: Style, coin: str, weekly: Rows, btc: Rows) -> list[odds.Signal]:
    out: list[odds.Signal] = []
    for i in range(103, len(weekly) - 1):
        btc_q = _change_at(btc, int(weekly[i][0]), 13)
        out += _signal(i, _position(coin, [], weekly[: i + 1], btc_q, style))
    return out


def _odds_rows(
    style: Style, coins: list[str], binance: Binance, btc_daily: Rows, now_ms: int
) -> tuple[dict[str, Rows], dict[str, Rows], Rows]:
    """The candles the odds need: the setup's timeframe (longer than the screen's, for
    intraday), the trend's, and BTC's. Only for the shortlist, so a few calls."""
    plan = ODDS_PLAN[style.key]
    symbols = [f"{c}{QUOTE}" for c in {*coins, "BTC"}]
    if style.key == "swing":
        return {}, {}, btc_daily
    tf = "1w" if style.key == "position" else style.setup_tf
    setup = binance.klines_many(symbols, tf, plan.history)
    bias = {} if style.key == "position" else binance.klines_many(symbols, style.bias_tf, 200)
    rows = {s.removesuffix(QUOTE): closed(r, now_ms) for s, r in setup.items()}
    trend = {s.removesuffix(QUOTE): closed(r, now_ms) for s, r in bias.items()}
    btc = (trend if style.key != "position" else rows).get("BTC", [])
    return rows, trend, btc


def _odds_context(
    style: Style,
    shortlist: list[dict[str, Any]],
    *,
    daily: dict[str, Rows],
    binance: Binance,
    now_ms: int,
) -> dict[str, Any]:
    plan = ODDS_PLAN[style.key]
    coins = [f["coin"] for f in shortlist]
    try:
        rows, trend, btc = _odds_rows(style, coins, binance, daily.get("BTC", []), now_ms)
    except BinanceError:
        return {}
    kept: dict[str, Any] = {}
    for coin in coins:
        if style.key == "swing":
            own = daily.get(coin, [])
            signals = _swing_signals(style, coin, own, btc)
        elif style.key == "position":
            own = rows.get(coin, [])
            signals = _position_signals(style, coin, own, btc)
        else:
            own = rows.get(coin, [])
            signals = _intraday_signals(style, coin, own, trend.get(coin, []), btc)
        if len(own) < 30:  # noqa: PLR2004
            continue
        record: dict[str, Any] = dict(odds.past(own, signals, plan.steps))
        record["span"] = odds.span(own, 60 if style.key != "position" else 103)
        kept[coin] = {"rows": own, "record": record}
    return kept


def odds_for(
    style_key: str, coin: str, entry: str, stop: str, target: str
) -> dict[str, Any] | None:
    """A pick's odds at these levels, from the candles its screen kept; None when they're gone."""
    plan = ODDS_PLAN.get(style_key)
    kept = _ODDS.get(style_key, {}).get(coin)
    if plan is None or kept is None:
        return None
    try:
        e, s, t = float(entry), float(stop), float(target)
    except ValueError:
        return None
    if not 0 < s < e < t:
        return None
    need = odds.needed(e, s, t)
    sim = odds.simulate(kept["rows"], e, s, t, steps=plan.steps, slot_ms=plan.slot_ms)
    record = dict(kept["record"])
    record["lean"], record["share"] = odds.lean(
        record["target"], record["stop"], need, odds.MIN_SIGNALS
    )
    return odds.summary(sim, record, need, plan.horizon)


def screen(  # noqa: PLR0913 - the screen's parts, each needed
    style_key: str,
    *,
    binance: Binance,
    store: Any,
    http: httpx.Client | None,
    regime: tuple[str | None, str],
    fallback: list[str],
    now_ms: int,
    crowding: Callable[[str], str] | None = None,
) -> dict[str, Any]:
    """One style's screen: the universe, its filters, its setups, scored; the best few kept."""
    style = STYLES.get(style_key)
    if style is None:
        raise ValueError("Pick scalp, day, swing or position.")
    allowed, note = gate(style, regime[0])
    out: dict[str, Any] = {
        "style": style.key,
        "name": style.name,
        "regime": {"state": regime[0], "words": regime[1]},
        "allowed": allowed,
        "note": note,
        "riskPct": RISK_PCT,
        "warnings": timing(style, now_ms),
        "counts": {"listed": 0, "onBinance": 0, "liquid": 0, "setups": 0},
        "quote": QUOTE,
        "shortlist": [],
        "misses": [],
        "block": "",
        "at": now_ms,
        "expires": now_ms + style.expiry_s * 1000,
    }
    if not allowed:
        return out
    uni = universe(binance, store, http, fallback, now_ms)
    days = min(style.history_days, 399)  # the daily candles reach 400 days; weeks check the rest
    liquid = [
        c
        for c in uni["coins"]
        if c["rank"] <= style.top and c["volume"] >= style.volume_floor and c["days"] >= days
    ]
    out["source"] = uni["source"]
    out["counts"] |= {
        "listed": uni["listed"],
        "onBinance": len(uni["coins"]),
        "liquid": len(liquid),
    }
    no_rows: Rows = []
    btc_daily: Rows = next((c["daily"] for c in uni["coins"] if c["coin"] == "BTC"), no_rows)
    if style.key == "swing":
        found, misses, block = _swings(style, liquid, btc_daily)
    elif style.key == "position":
        found, misses, block = _positions(style, liquid, binance, now_ms)
    else:
        found, misses, block = _intraday(style, liquid, binance, now_ms)
    out["block"] = block
    out["misses"] = [{"coin": c, "why": why} for _, c, why in sorted(misses)[:3]]
    found.sort(key=lambda f: -f["score"])
    out["counts"]["setups"] = len(found)
    out["shortlist"] = found[: style.shortlist]
    daily = {c["coin"]: c["daily"] for c in uni["coins"]}
    _ODDS[style.key] = _odds_context(
        style, out["shortlist"], daily=daily, binance=binance, now_ms=now_ms
    )
    for f in out["shortlist"]:
        f["crowding"] = crowding(f["coin"]) if crowding else "Not checked"
        f["odds"] = odds_for(style.key, f["coin"], f["entry"], f["stop"], f["target"])
    _SCREENS[style.key] = out
    return out


def last_screen(style_key: str, now_ms: int) -> dict[str, Any] | None:
    found = _SCREENS.get(style_key)
    if found and now_ms - found["at"] <= SCREEN_TTL_S * 1000:
        return found
    return None


def now_ms() -> int:
    return int(time.time() * 1000)
