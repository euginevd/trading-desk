"""The desk's four styles as Freqtrade strategies, for backtests and paper trading only.

The setups are not copied here: each candle's signal comes from the desk's own screener
(api.screener.signals, mounted at /desk), so the backtest tests exactly what New trade finds.
What follows the signal mirrors the desk too:
- a limit buy at the setup's entry, cancelled if unfilled after the style's wait;
- the setup's stop (checked against each candle's low) and its target (against the high),
  the target at the style's minimum reward to risk after 0.1% fees each side;
- 1% of the pot at risk a trade, at most 10 USDC, the position at most 25% of the pot;
- at most 3 trades open (3% open risk), one per coin; no new trades in a Bear regime.
Not mirrored: the desk's monthly loss stop, its two-alts limit and the model's take/wait/pass.
"""

from datetime import datetime
from typing import Any, ClassVar

import pandas as pd
from api import screener
from freqtrade.enums import RunMode
from freqtrade.persistence import Trade
from freqtrade.strategy import IStrategy, stoploss_from_absolute

FEE = 0.001
RISK = 0.01  # of the pot, every style (owner, 17 Nov 2026)
MAX_RISK = 10.0  # USDC
MAX_SPEND = 0.25  # of the pot
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
