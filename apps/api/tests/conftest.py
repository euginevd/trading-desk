from collections.abc import Iterator

import pytest
from api import binance, ledger_wallet, screener, tao


@pytest.fixture(autouse=True)
def fresh_tao_readings() -> Iterator[None]:
    """Each test starts with no kept TAO or Ledger reading."""
    tao.forget()
    ledger_wallet.forget()
    yield
    tao.forget()
    ledger_wallet.forget()


@pytest.fixture(autouse=True)
def fresh_binance_reads() -> Iterator[None]:
    """Each test starts with no kept Binance reads and no weight used."""
    binance.forget()
    yield
    binance.forget()


@pytest.fixture(autouse=True)
def fresh_screener() -> Iterator[None]:
    """Each test starts with no kept universe, CoinGecko list, screens, odds or gate."""
    kept = (
        screener._UNIVERSE,  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
        screener._SCREENS,  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
        screener._CG,  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
        screener._ODDS,  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
        screener._GATE,  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
    )
    for k in kept:
        k.clear()
    yield
    for k in kept:
        k.clear()
