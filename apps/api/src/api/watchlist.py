"""The Trade page's watchlists (decisions 18 and 23): named lists of up to 10 coins each, each
coin with its price and last signal."""

import time
from typing import Any

from api.ai_signal import Signals
from api.audit import Audit
from api.binance import Binance
from api.market import QUOTE, MarketError, coin_symbol
from api.portfolio import pair
from api.store import Store

MAX_COINS = 10
MAX_LISTS = 20
FIRST_LIST = "Portfolio"
STARTERS = ("BTC", "ETH", "SOL", "TAO")


def _now() -> int:
    return int(time.time() * 1000)


class Watchlist:
    def __init__(self, binance: Binance, store: Store, signals: Signals, audit: Audit) -> None:
        self._binance = binance
        self._store = store
        self._signals = signals
        self._audit = audit

    def _lists(self) -> list[dict[str, Any]]:
        """The owner's lists. The first run makes "Portfolio", from the old single watchlist if
        there was one, or a few starter coins."""
        lists = self._store.lists()
        if lists:
            return lists
        list_id = self._store.create_list(FIRST_LIST, _now())
        coins = self._store.old_watchlist()
        if not coins and self._store.setting("watchlist_started", "0") == "0":
            listed = self._binance.symbols()
            coins = [c for c in STARTERS if f"{c}{QUOTE}" in listed]
        for n, coin in enumerate(coins):
            self._store.watch_coin(list_id, coin, _now() + n)
        self._store.set_setting("watchlist_started", "1")
        return self._store.lists()

    def _pick(self, list_id: object) -> dict[str, Any]:
        lists = self._lists()
        try:
            wanted = int(str(list_id)) if list_id not in (None, "") else lists[0]["id"]
        except ValueError as error:
            raise MarketError("Pick a watchlist.") from error
        for found in lists:
            if found["id"] == wanted:
                return found
        raise MarketError("That watchlist doesn't exist any more.")

    def view(self, list_id: object = None) -> dict[str, Any]:
        chosen = self._pick(list_id)
        coins = self._store.list_coins(chosen["id"])
        listed = self._binance.symbols()
        symbols = [f"{c}{QUOTE}" for c in coins if f"{c}{QUOTE}" in listed]
        tickers = self._binance.tickers(symbols)
        rows: list[dict[str, Any]] = []
        for coin in coins:
            ticker = tickers.get(f"{coin}{QUOTE}", {})
            rows.append(
                {
                    "coin": coin,
                    "symbol": f"{coin}{QUOTE}",
                    "pair": pair(f"{coin}{QUOTE}"),
                    "price": ticker.get("lastPrice"),
                    "change24h": ticker.get("priceChangePercent"),
                    "signal": self._signals.last(coin),
                }
            )
        return {
            "lists": self._store.lists(),
            "list": {"id": chosen["id"], "name": chosen["name"]},
            "coins": rows,
            "max": MAX_COINS,
            "aiBudget": self._signals.budget(),
        }

    def add(self, coin: object, list_id: object = None) -> dict[str, Any]:
        chosen = self._pick(list_id)
        symbol = coin_symbol(coin)
        name = symbol.removesuffix(QUOTE)
        coins = self._store.list_coins(chosen["id"])
        if name in coins:
            raise MarketError(f"{name} is already on {chosen['name']}.")
        if len(coins) >= MAX_COINS:
            raise MarketError(f"{chosen['name']} is full at {MAX_COINS}. Remove a coin first.")
        if symbol not in self._binance.symbols():
            raise MarketError(f"Binance has no {pair(symbol)} pair.")
        self._store.watch_coin(chosen["id"], name, _now())
        self._audit.record("settings", "Watchlist", f"Added {name} to {chosen['name']}")
        return self.view(chosen["id"])

    def remove(self, coin: str, list_id: object = None) -> dict[str, Any]:
        chosen = self._pick(list_id)
        name = coin_symbol(coin).removesuffix(QUOTE)
        self._store.unwatch_coin(chosen["id"], name)
        self._audit.record("settings", "Watchlist", f"Removed {name} from {chosen['name']}")
        return self.view(chosen["id"])

    def create(self, name: object) -> dict[str, Any]:
        text = " ".join(str(name or "").split())
        if not 1 <= len(text) <= 30:  # noqa: PLR2004
            raise MarketError("Give the watchlist a name of up to 30 characters.")
        lists = self._lists()
        if any(found["name"].lower() == text.lower() for found in lists):
            raise MarketError(f"You already have a watchlist called {text}.")
        if len(lists) >= MAX_LISTS:
            raise MarketError(f"You have {MAX_LISTS} watchlists, the most there can be.")
        list_id = self._store.create_list(text, _now())
        self._audit.record("settings", "Watchlist", f"Created {text}")
        return self.view(list_id)

    def delete(self, list_id: object) -> dict[str, Any]:
        chosen = self._pick(list_id)
        if len(self._lists()) == 1:
            raise MarketError("Keep at least one watchlist.")
        self._store.delete_list(chosen["id"])
        self._audit.record("settings", "Watchlist", f"Deleted {chosen['name']}")
        return self.view()
