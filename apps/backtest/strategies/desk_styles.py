"""The desk's four styles as Freqtrade strategies, for backtests and paper trading only.

The setups are not copied here: each candle's signal comes from the desk's own screener
(api.screener.signals, mounted at /desk), so the backtest tests exactly what New trade finds.
What follows the signal mirrors the desk too:
- a limit buy at the setup's entry, cancelled if unfilled after the style's wait;
- the setup's stop (checked against each candle's low) and its target (against the high),
  the target at the style's minimum reward to risk after 0.1% fees each side;
- 1% of the pot at risk a trade, at most 10 USDC, the position at most 25% of the pot;
- at most 3 trades open (3% open risk), one per coin; no new trades in a Bear regime.
Not mirrored: the desk's monthly loss stop and its two-alts limit.

The AI parts (owner, 17 Nov 2026):
- FreqAI (the *AI classes): a LightGBM model, retrained as the backtest walks forward, learns
  from each coin's past candles how often a trade of the style's shape won; a setup goes ahead
  only when the model's chance of a win clears break-even by 5 points.
- trading-agent: when DESK_AGENT_URL is set (the paper bot), every entry first asks the desk's
  trading-agent (POST /pot/judge-one), the same prompt and rules as New trade, and only a
  "take" goes ahead. Paper trading only: on past dates the model already knows what happened.
"""

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any, ClassVar

import httpx
import numpy as np
import pandas as pd
import talib.abstract as ta
from api import screener
from freqtrade.enums import RunMode
from freqtrade.persistence import Trade
from freqtrade.strategy import IStrategy, stoploss_from_absolute

FEE = 0.001
RISK = 0.01  # of the pot, every style (owner, 17 Nov 2026)
MAX_RISK = 10.0  # USDC
MAX_SPEND = 0.25  # of the pot
VERDICTS = Path("/freqtrade/user_data/agent_verdicts.jsonl")
log = logging.getLogger(__name__)
TF_MS = {
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
    "1w": 604_800_000,
}


def rows_of(df: pd.DataFrame, tf: str) -> list[list[Any]]:
    """Freqtrade's candles as Binance's rows, the shape the desk's screener reads: open time,
    open, high, low, close, volume, close time, and quote volume (volume times close)."""
    if df is None or df.empty:
        return []
    opened = ((df["date"] - pd.Timestamp(0, tz="UTC")) // pd.Timedelta(milliseconds=1)).tolist()
    step = TF_MS[tf]
    return [
        [t, o, h, lo, c, v, t + step - 1, v * c]
        for t, o, h, lo, c, v in zip(
            opened,
            df["open"].tolist(),
            df["high"].tolist(),
            df["low"].tolist(),
            df["close"].tolist(),
            df["volume"].tolist(),
            strict=True,
        )
    ]


def plan_of(tag: str | None) -> tuple[str, float, float, float] | None:
    """The setup, entry, stop and target the signal carried in its tag."""
    try:
        setup, entry, stop, target = str(tag).split("|")
        return setup, float(entry), float(stop), float(target)
    except ValueError:
        return None


class DeskStyle(IStrategy):
    INTERFACE_VERSION = 3
    style = "swing"
    timeframe = "1d"
    bias_tf: str | None = None  # the coin's trend candles (scalp and day)
    btc_tf = "1d"  # BTC's trend candles for the rule
    can_short = False
    minimal_roi: ClassVar[dict[str, float]] = {"0": 100.0}  # the target is per trade, below
    stoploss = -0.99  # the stop is per trade, below
    use_custom_stoploss = True
    use_custom_roi = True
    use_exit_signal = False
    process_only_new_candles = True
    startup_candle_count = 400
    order_types: ClassVar[dict[str, Any]] = {
        "entry": "limit",
        "exit": "limit",
        "stoploss": "market",
        "stoploss_on_exchange": False,
    }
    unfilledtimeout: ClassVar[dict[str, Any]] = {"entry": 3 * 1440, "exit": 10, "unit": "minutes"}

    def informative_pairs(self) -> list[tuple[str, str]]:
        stake = self.config["stake_currency"]
        btc = f"BTC/{stake}"
        pairs = [(btc, "1d"), (btc, self.btc_tf)]
        if self.bias_tf:
            pairs += [(p, self.bias_tf) for p in self.dp.current_whitelist()]
        return pairs

    def populate_indicators(
        self, dataframe: pd.DataFrame, metadata: dict[str, Any]
    ) -> pd.DataFrame:
        return dataframe

    def _candles(self, pair: str, tf: str) -> list[list[Any]]:
        return rows_of(self.dp.get_pair_dataframe(pair, tf), tf)

    def populate_entry_trend(
        self, dataframe: pd.DataFrame, metadata: dict[str, Any]
    ) -> pd.DataFrame:
        pair = metadata["pair"]
        coin, stake = pair.split("/")
        rows = rows_of(dataframe, self.timeframe)
        btc = f"BTC/{stake}"
        testing = self.dp.runmode in (RunMode.BACKTEST, RunMode.HYPEROPT)
        found = screener.signals(
            self.style,
            coin,
            rows,
            bias=self._candles(pair, self.bias_tf) if self.bias_tf else [],
            btc=self._candles(btc, self.btc_tf),
            btc_daily=self._candles(btc, "1d"),
            start=0 if testing else max(len(rows) - 2, 0),  # live: only the newest candles
        )
        enter = [0] * len(dataframe)
        tags: list[str | None] = [None] * len(dataframe)
        for i, entry, stop, target, setup in found:
            enter[i] = 1
            tags[i] = f"{setup}|{entry:.10g}|{stop:.10g}|{target:.10g}"
        dataframe["enter_long"] = enter
        dataframe["enter_tag"] = tags
        return dataframe

    def populate_exit_trend(
        self, dataframe: pd.DataFrame, metadata: dict[str, Any]
    ) -> pd.DataFrame:
        dataframe["exit_long"] = 0
        return dataframe

    def confirm_trade_entry(  # noqa: PLR0913, PLR0917 - Freqtrade's signature
        self,
        pair: str,
        order_type: str,
        amount: float,
        rate: float,
        time_in_force: str,
        current_time: datetime,
        entry_tag: str | None,
        side: str,
        **kwargs: Any,
    ) -> bool:
        """Paper and live only, when DESK_AGENT_URL is set: trading-agent's verdict first."""
        url = os.environ.get("DESK_AGENT_URL", "")
        if not url or self.dp.runmode not in (RunMode.DRY_RUN, RunMode.LIVE):
            return True
        plan = plan_of(entry_tag)
        if not plan:
            return False
        key = f"{pair}|{entry_tag}"
        asked: dict[str, dict[str, Any]] = self.__dict__.setdefault("_asked", {})
        if key not in asked:  # one question a setup, however many candles it stays on
            asked[key] = self._ask_agent(url, pair, plan, rate)
            line = {"at": current_time.isoformat(), "pair": pair, "style": self.style}
            line |= {"setup": plan[0], "entry": plan[1], "stop": plan[2], "target": plan[3]}
            with VERDICTS.open("a", encoding="utf-8") as f:
                f.write(json.dumps(line | asked[key]) + "\n")
        return asked[key].get("verdict") == "take"

    def _ask_agent(
        self, url: str, pair: str, plan: tuple[str, float, float, float], rate: float
    ) -> dict[str, Any]:
        setup, entry, stop, target = plan
        coin = pair.split("/", maxsplit=1)[0]
        body = {"style": self.style, "coin": coin, "setup": setup, "price": rate}
        body |= {"entry": f"{entry:.10g}", "stop": f"{stop:.10g}", "target": f"{target:.10g}"}
        try:
            reply = httpx.post(url, json=body, timeout=300)
            said = reply.json()
        except (httpx.HTTPError, ValueError) as error:
            log.warning("trading-agent unreachable for %s: %s", pair, error)
            return {"verdict": "error", "reason": str(error)[:200]}
        if reply.status_code != 200:  # noqa: PLR2004
            return {"verdict": "error", "reason": str(said.get("error", ""))[:200]}
        log.info("trading-agent on %s %s: %s", pair, setup, said.get("verdict"))
        return said

    def custom_entry_price(  # noqa: PLR0913, PLR0917 - Freqtrade's signature
        self,
        pair: str,
        trade: Trade | None,
        current_time: datetime,
        proposed_rate: float,
        entry_tag: str | None,
        side: str,
        **kwargs: Any,
    ) -> float:
        plan = plan_of(entry_tag)
        return min(plan[1], proposed_rate) if plan else proposed_rate

    def custom_stake_amount(  # noqa: PLR0913, PLR0917 - Freqtrade's signature
        self,
        pair: str,
        current_time: datetime,
        current_rate: float,
        proposed_stake: float,
        min_stake: float | None,
        max_stake: float,
        leverage: float,
        entry_tag: str | None,
        side: str,
        **kwargs: Any,
    ) -> float:
        """Sized from the stop: 1% of the pot (at most 10 USDC) lost if the stop is hit, fees
        included; the position at most 25% of the pot."""
        plan = plan_of(entry_tag)
        if not plan:
            return 0.0
        _, entry, stop, _ = plan
        pot = self.wallets.get_total_stake_amount() if self.wallets else 1000.0
        risk = min(pot * RISK, MAX_RISK)
        per_unit = (entry - stop) / entry + 2 * FEE
        return max(0.0, min(risk / per_unit, pot * MAX_SPEND, max_stake))

    def custom_stoploss(  # noqa: PLR0913, PLR0917 - Freqtrade's signature
        self,
        pair: str,
        trade: Trade,
        current_time: datetime,
        current_rate: float,
        current_profit: float,
        after_fill: bool,
        **kwargs: Any,
    ) -> float | None:
        plan = plan_of(trade.enter_tag)
        if not plan:
            return None
        return stoploss_from_absolute(plan[2], current_rate=current_rate, is_short=False)

    def custom_roi(  # noqa: PLR0913, PLR0917 - Freqtrade's signature
        self,
        pair: str,
        trade: Trade,
        current_time: datetime,
        trade_duration: int,
        entry_tag: str | None,
        side: str,
        **kwargs: Any,
    ) -> float | None:
        """The target as a profit ratio on the fill, after fees each side."""
        plan = plan_of(entry_tag)
        if not plan:
            return None
        paid = trade.open_rate * (1 + FEE)
        return (plan[3] * (1 - FEE) - paid) / paid


class DeskScalp(DeskStyle):
    style = "scalp"
    timeframe = "5m"
    bias_tf = "1h"
    btc_tf = "1h"
    startup_candle_count = 300
    unfilledtimeout: ClassVar[dict[str, Any]] = {"entry": 60, "exit": 10, "unit": "minutes"}


class DeskDay(DeskStyle):
    style = "day"
    timeframe = "15m"
    bias_tf = "4h"
    btc_tf = "4h"
    startup_candle_count = 200
    unfilledtimeout: ClassVar[dict[str, Any]] = {"entry": 12 * 60, "exit": 10, "unit": "minutes"}


class DeskSwing(DeskStyle):
    style = "swing"


class DeskPosition(DeskStyle):
    style = "position"
    timeframe = "1w"
    btc_tf = "1w"
    startup_candle_count = 120
    unfilledtimeout: ClassVar[dict[str, Any]] = {"entry": 14 * 1440, "exit": 10, "unit": "minutes"}


def outcomes(df: pd.DataFrame, steps: int, atr_mult: float, rr: float) -> np.ndarray:
    """The label FreqAI learns: had you bought this candle's close with a stop atr_mult ATRs
    under it and the target rr times that over it (fees added), did the target come first
    within steps candles? A candle touching both counts as the stop; too recent: unknown."""
    close, high, low = (df[c].to_numpy(dtype=float) for c in ("close", "high", "low"))
    atr = np.asarray(ta.ATR(df, timeperiod=14), dtype=float)
    stop = close - atr_mult * atr
    target = close + rr * (close - stop) + close * 2 * FEE
    n = len(close)
    never = steps + 1
    hit_t, hit_s = np.full(n, never), np.full(n, never)
    for k in range(1, steps + 1):
        valid = np.arange(n) < n - k
        ahead_h, ahead_l = np.roll(high, -k), np.roll(low, -k)
        hit_s[valid & (ahead_l <= stop) & (hit_s == never)] = k
        hit_t[valid & (ahead_h >= target) & (hit_t == never)] = k
    label = np.where(hit_t < hit_s, "win", "lose").astype(object)
    label[np.arange(n) >= n - steps] = np.nan
    label[np.isnan(atr)] = np.nan
    return label


class DeskAI(DeskStyle):
    """FreqAI on top of the style's own setups: the rule finds them, the model filters them."""

    atr_mult = 2.0
    min_win = 0.38  # break-even at 2R is 33%, plus 5 points

    def populate_indicators(
        self, dataframe: pd.DataFrame, metadata: dict[str, Any]
    ) -> pd.DataFrame:
        return self.freqai.start(dataframe, metadata, self)

    def feature_engineering_expand_all(
        self, dataframe: pd.DataFrame, period: int, metadata: dict[str, Any], **kwargs: Any
    ) -> pd.DataFrame:
        dataframe["%-rsi-period"] = ta.RSI(dataframe, timeperiod=period)
        dataframe["%-mfi-period"] = ta.MFI(dataframe, timeperiod=period)
        dataframe["%-adx-period"] = ta.ADX(dataframe, timeperiod=period)
        dataframe["%-roc-period"] = ta.ROC(dataframe, timeperiod=period)
        dataframe["%-natr-period"] = ta.NATR(dataframe, timeperiod=period)
        sma = ta.SMA(dataframe, timeperiod=period)
        dataframe["%-sma-gap-period"] = dataframe["close"] / sma - 1
        volume = dataframe["volume"]
        dataframe["%-relvol-period"] = volume / volume.rolling(period).mean()
        return dataframe

    def feature_engineering_expand_basic(
        self, dataframe: pd.DataFrame, metadata: dict[str, Any], **kwargs: Any
    ) -> pd.DataFrame:
        dataframe["%-pct-change"] = dataframe["close"].pct_change()
        dataframe["%-range"] = (dataframe["high"] - dataframe["low"]) / dataframe["close"]
        return dataframe

    def feature_engineering_standard(
        self, dataframe: pd.DataFrame, metadata: dict[str, Any], **kwargs: Any
    ) -> pd.DataFrame:
        dataframe["%-day_of_week"] = dataframe["date"].dt.dayofweek
        dataframe["%-hour_of_day"] = dataframe["date"].dt.hour
        return dataframe

    def set_freqai_targets(
        self, dataframe: pd.DataFrame, metadata: dict[str, Any], **kwargs: Any
    ) -> pd.DataFrame:
        self.freqai.class_names = ["lose", "win"]
        steps = screener.ODDS_PLAN[self.style].steps
        rr = screener.STYLES[self.style].min_rr
        dataframe["&s-win"] = outcomes(dataframe, steps, self.atr_mult, rr)
        return dataframe

    def populate_entry_trend(
        self, dataframe: pd.DataFrame, metadata: dict[str, Any]
    ) -> pd.DataFrame:
        dataframe = super().populate_entry_trend(dataframe, metadata)
        if "win" not in dataframe or "do_predict" not in dataframe:
            dataframe["enter_long"] = 0
            return dataframe
        keep = (
            (dataframe["enter_long"] == 1)
            & (dataframe["do_predict"] == 1)
            & (dataframe["win"] >= self.min_win)
        )
        dataframe["enter_long"] = keep.astype(int)
        dataframe.loc[~keep, "enter_tag"] = None
        return dataframe


class DeskScalpAI(DeskAI, DeskScalp):
    atr_mult = 1.0
    min_win = 0.45  # break-even at 1.5R is 40%, plus 5 points


class DeskDayAI(DeskAI, DeskDay):
    atr_mult = 1.5


class DeskSwingAI(DeskAI, DeskSwing):
    atr_mult = 2.0
