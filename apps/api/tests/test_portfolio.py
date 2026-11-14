from decimal import Decimal
from typing import Any

from api.portfolio import average_cost, build, pair


def trade(**fields: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "symbol": "BTCUSDT",
        "id": 1,
        "time": 1,
        "price": "100",
        "qty": "1",
        "quoteQty": "100",
        "commission": "0",
        "commissionAsset": "USDT",
        "isBuyer": True,
    }
    return {**base, **fields}


def test_pair_splits_the_quote() -> None:
    assert pair("BTCUSDT") == "BTC/USDT"
    assert pair("ETHBTC") == "ETH/BTC"
    assert pair("SOLFDUSD") == "SOL/FDUSD"


def test_average_cost_of_two_buys() -> None:
    cost = average_cost("BTC", [trade(price="100", time=1), trade(price="200", time=2)])
    assert cost.average == Decimal(150)
    assert cost.covered == Decimal(2)


def test_a_sell_keeps_the_average() -> None:
    trades = [
        trade(price="100", qty="2", time=1),
        trade(price="300", qty="1", time=2, isBuyer=False),
    ]
    cost = average_cost("BTC", trades)
    assert cost.average == Decimal(100)
    assert cost.covered == Decimal(1)


def test_a_fee_in_the_coin_reduces_what_is_held() -> None:
    cost = average_cost("BTC", [trade(qty="1", commission="0.1", commissionAsset="BTC")])
    assert cost.covered == Decimal("0.9")


def test_selling_everything_leaves_no_cost() -> None:
    trades = [trade(time=1), trade(time=2, isBuyer=False)]
    assert average_cost("BTC", trades).average is None


def portfolio() -> dict[str, Any]:
    balances = [
        {"asset": "BTC", "free": "1.5", "locked": "0.5"},
        {"asset": "USDT", "free": "100", "locked": "0"},
        {"asset": "XYZ", "free": "5", "locked": "0"},
    ]
    tickers = {"BTCUSDT": {"symbol": "BTCUSDT", "lastPrice": "150", "priceChangePercent": "50"}}
    trades = {"BTC": [trade(price="100", qty="1")]}
    orders = [
        {
            "time": 5,
            "symbol": "BTCUSDT",
            "side": "BUY",
            "type": "LIMIT",
            "price": "90",
            "origQty": "0.1",
            "executedQty": "0",
        }
    ]
    return build(balances, tickers, trades, orders, (Decimal("1.5"), "2026-11-13"))


def test_totals_in_us_and_australian_dollars() -> None:
    total = portfolio()["total"]
    assert total["value"] == "400"
    assert total["aud"] == "600"
    assert total["audDate"] == "2026-11-13"


def test_profit_counts_only_what_the_trades_cover() -> None:
    btc = portfolio()["holdings"][0]
    assert btc["asset"] == "BTC"
    assert btc["covered"] == "1"
    assert btc["profit"] == "50"
    assert btc["profitPercent"] == "50"


def test_24_hour_change_from_each_price() -> None:
    total = portfolio()["total"]
    assert total["change24h"] == "100"


def test_a_coin_with_no_usdt_price_is_listed_without_a_value() -> None:
    holdings = portfolio()["holdings"]
    assert holdings[-1]["asset"] == "XYZ"
    assert holdings[-1]["value"] is None
    assert holdings[-1]["share"] is None


def test_open_orders_and_trades_read_plainly() -> None:
    data = portfolio()
    assert data["openOrders"][0]["pair"] == "BTC/USDT"
    assert data["openOrders"][0]["side"] == "Buy"
    assert data["recentTrades"][0]["fee"] == "0 USDT"


def test_no_aud_rate_leaves_the_aud_total_out() -> None:
    data = build([{"asset": "USDT", "free": "1", "locked": "0"}], {}, {}, [], None)
    assert data["total"]["aud"] is None


def test_a_stablecoin_has_a_cost_only_when_one_is_entered() -> None:
    usdc = {"asset": "USDC", "free": "100", "locked": "0"}
    plain = build([usdc], {}, {}, [], None)["holdings"][0]
    assert plain["averageCost"] is None
    costed = build([{**usdc, "cost": "1.02"}], {}, {}, [], None)["holdings"][0]
    assert costed["averageCost"] == "1.02"
    assert costed["profit"] == "-2"


def test_a_fee_token_costs_the_average_of_its_buys_for_all_that_is_held() -> None:
    bnb = {"asset": "BNB", "free": "0.05", "locked": "0"}
    tickers = {"BNBUSDT": {"lastPrice": "600", "priceChangePercent": "0"}}
    trades = {
        "BNB": [
            trade(symbol="BNBUSDC", id=1, time=1, price="500", qty="0.2", quoteQty="100"),
            trade(symbol="BNBUSDC", id=2, time=2, price="700", qty="0.2", quoteQty="140"),
            trade(
                symbol="BNBUSDC",
                id=3,
                time=3,
                price="650",
                qty="0.4",
                quoteQty="260",
                isBuyer=False,
            ),
        ]
    }
    h = build([bnb], tickers, trades, [], None)["holdings"][0]
    assert h["averageCost"] == "600"  # (100 + 140) / 0.4; the sale doesn't change it
    assert h["covered"] == "0.05"
    assert h["profit"] == "0"
