"""Smart trades, limits, the kill switch, the watchlist, signals and account value history,
kept in a local SQLite file (decisions 13 and 18)."""

import sqlite3
from decimal import Decimal
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY,
    client_id TEXT NOT NULL UNIQUE,
    created INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    entry TEXT NOT NULL,
    limit_price TEXT,
    spend TEXT NOT NULL,
    take_profit TEXT,
    stop_loss TEXT,
    status TEXT NOT NULL,
    buy_id INTEGER,
    qty TEXT,
    entry_price TEXT,
    exit_kind TEXT,
    exit_id INTEGER,
    exit_price TEXT,
    note TEXT,
    updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS watchlist (coin TEXT PRIMARY KEY, added INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS lists (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS list_coins (
    list_id INTEGER NOT NULL, coin TEXT NOT NULL, added INTEGER NOT NULL,
    PRIMARY KEY (list_id, coin)
);
CREATE TABLE IF NOT EXISTS signals (
    coin TEXT PRIMARY KEY, ran INTEGER NOT NULL, data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS history (day TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deposit_paid (amount TEXT PRIMARY KEY, aud TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bots (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    config TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    last_signal INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bot_deals (
    id INTEGER PRIMARY KEY,
    bot_id INTEGER NOT NULL,
    started INTEGER NOT NULL,
    status TEXT NOT NULL,
    profit TEXT,
    ended INTEGER,
    note TEXT
);
CREATE TABLE IF NOT EXISTS bot_orders (
    id INTEGER PRIMARY KEY,
    deal_id INTEGER NOT NULL,
    rung INTEGER NOT NULL,
    side TEXT NOT NULL,
    client_id TEXT NOT NULL UNIQUE,
    order_id INTEGER,
    price TEXT NOT NULL,
    qty TEXT NOT NULL,
    spend TEXT NOT NULL,
    status TEXT NOT NULL,
    executed_qty TEXT NOT NULL DEFAULT '0',
    executed_quote TEXT NOT NULL DEFAULT '0',
    fee_base TEXT NOT NULL DEFAULT '0',
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS grids (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    config TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    started INTEGER,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS grid_orders (
    id INTEGER PRIMARY KEY,
    grid_id INTEGER NOT NULL,
    line INTEGER NOT NULL,
    target INTEGER NOT NULL,
    side TEXT NOT NULL,
    client_id TEXT NOT NULL UNIQUE,
    order_id INTEGER,
    price TEXT NOT NULL,
    qty TEXT NOT NULL,
    spend TEXT NOT NULL,
    cost TEXT NOT NULL DEFAULT '0',
    status TEXT NOT NULL,
    executed_qty TEXT NOT NULL DEFAULT '0',
    executed_quote TEXT NOT NULL DEFAULT '0',
    fee_base TEXT NOT NULL DEFAULT '0',
    profit TEXT,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS signal_history (
    coin TEXT NOT NULL, ran INTEGER NOT NULL, action TEXT NOT NULL, price TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY,
    coin TEXT NOT NULL,
    direction TEXT NOT NULL,
    price TEXT NOT NULL,
    note TEXT NOT NULL,
    created INTEGER NOT NULL,
    triggered INTEGER
);
CREATE TABLE IF NOT EXISTS costs (
    source TEXT NOT NULL, asset TEXT NOT NULL, average TEXT NOT NULL,
    PRIMARY KEY (source, asset)
);
"""
FIELDS = (
    "status",
    "buy_id",
    "qty",
    "entry_price",
    "exit_kind",
    "exit_id",
    "exit_price",
    "note",
    "updated",
)
# Every column a trade can change, written out whole: no SQL is built from strings.
UPDATE = (
    "UPDATE trades SET status = :status, buy_id = :buy_id, qty = :qty, "
    "entry_price = :entry_price, exit_kind = :exit_kind, exit_id = :exit_id, "
    "exit_price = :exit_price, note = :note, updated = :updated WHERE id = :id"
)


class Store:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, timeout=5)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(SCHEMA)

    def close(self) -> None:
        self._db.close()

    def setting(self, key: str, default: str) -> str:
        row = self._db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return str(row["value"]) if row else default

    def set_setting(self, key: str, value: str) -> None:
        with self._db:
            self._db.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )

    def claim(self, trade: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        """Records a new trade as placing; the same client_id again returns the first one."""
        try:
            with self._db:
                cursor = self._db.execute(
                    "INSERT INTO trades (client_id, created, symbol, entry, limit_price, spend, "
                    "take_profit, stop_loss, status, updated) "
                    "VALUES (:client_id, :created, :symbol, :entry, :limit_price, :spend, "
                    ":take_profit, :stop_loss, 'placing', :created)",
                    trade,
                )
        except sqlite3.IntegrityError:
            row = self._db.execute(
                "SELECT * FROM trades WHERE client_id = ?", (trade["client_id"],)
            ).fetchone()
            return dict(row), False
        return self.trade(int(cursor.lastrowid or 0)), True

    def trade(self, trade_id: int) -> dict[str, Any]:
        row = self._db.execute("SELECT * FROM trades WHERE id = ?", (trade_id,)).fetchone()
        if row is None:
            raise LookupError(trade_id)
        return dict(row)

    def update(self, trade_id: int, **changes: Any) -> dict[str, Any]:
        unknown = set(changes) - set(FIELDS)
        if unknown:
            raise ValueError(unknown)
        row = {**self.trade(trade_id), **changes}
        with self._db:
            self._db.execute(UPDATE, {field: row[field] for field in (*FIELDS, "id")})
        return self.trade(trade_id)

    def trades(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self._db.execute("SELECT * FROM trades ORDER BY created DESC LIMIT ?", (limit,))
        return [dict(r) for r in rows]

    def open_trades(self) -> list[dict[str, Any]]:
        rows = self._db.execute(
            "SELECT * FROM trades "
            "WHERE status IN ('placing', 'waiting', 'needs_exits', 'protected', 'open')"
        )
        return [dict(r) for r in rows]

    def spent_since(self, since_ms: int) -> Decimal:
        """Today's spend against the daily limit: smart trades, and the DCA and grid bots' buys
        (decisions 37 and 38), a buy cancelled before it filled counting only what it bought."""
        rows = self._db.execute(
            "SELECT spend FROM trades WHERE created >= ? AND status != 'cancelled'", (since_ms,)
        )
        trades = sum((Decimal(r["spend"]) for r in rows), Decimal(0))
        buys = self._db.execute(
            "SELECT status, spend, executed_quote FROM bot_orders "
            "WHERE side = 'buy' AND created >= ?",
            (since_ms,),
        )
        bots = sum(
            (
                Decimal(r["executed_quote"] if r["status"] == "cancelled" else r["spend"])
                for r in buys
            ),
            Decimal(0),
        )
        grids = self._db.execute(
            "SELECT status, spend, executed_quote FROM grid_orders "
            "WHERE side = 'buy' AND status != 'wanted' AND created >= ?",
            (since_ms,),
        )
        gridded = sum(
            (
                Decimal(r["executed_quote"] if r["status"] == "cancelled" else r["spend"])
                for r in grids
            ),
            Decimal(0),
        )
        return trades + bots + gridded

    def order_owner(self, order_id: int) -> str | None:
        """Which bot or grid placed this Binance order, by its reference, if any."""
        row = self._db.execute(
            "SELECT bot_deals.bot_id FROM bot_orders JOIN bot_deals "
            "ON bot_deals.id = bot_orders.deal_id WHERE bot_orders.order_id = ?",
            (order_id,),
        ).fetchone()
        if row:
            return f"bot {row['bot_id']}"
        row = self._db.execute(
            "SELECT grid_id FROM grid_orders WHERE order_id = ?", (order_id,)
        ).fetchone()
        return f"GRID-{row['grid_id']}" if row else None

    # DCA bots (decision 37): each bot, its deals and every order a deal placed.

    def bots(self) -> list[dict[str, Any]]:
        return [dict(r) for r in self._db.execute("SELECT * FROM bots ORDER BY created, id")]

    def bot(self, bot_id: int) -> dict[str, Any]:
        row = self._db.execute("SELECT * FROM bots WHERE id = ?", (bot_id,)).fetchone()
        if row is None:
            raise LookupError(bot_id)
        return dict(row)

    def add_bot(self, name: str, symbol: str, config: str, now_ms: int) -> int:
        with self._db:
            cursor = self._db.execute(
                "INSERT INTO bots (name, symbol, config, created, updated) VALUES (?, ?, ?, ?, ?)",
                (name, symbol, config, now_ms, now_ms),
            )
        return int(cursor.lastrowid or 0)

    def save_bot(self, bot: dict[str, Any]) -> dict[str, Any]:
        with self._db:
            self._db.execute(
                "UPDATE bots SET name = :name, symbol = :symbol, config = :config, "
                "enabled = :enabled, note = :note, last_signal = :last_signal, "
                "updated = :updated WHERE id = :id",
                bot,
            )
        return self.bot(int(bot["id"]))

    def delete_bot(self, bot_id: int) -> None:
        with self._db:
            self._db.execute(
                "DELETE FROM bot_orders WHERE deal_id IN "
                "(SELECT id FROM bot_deals WHERE bot_id = ?)",
                (bot_id,),
            )
            self._db.execute("DELETE FROM bot_deals WHERE bot_id = ?", (bot_id,))
            self._db.execute("DELETE FROM bots WHERE id = ?", (bot_id,))

    def deals(self, bot_id: int) -> list[dict[str, Any]]:
        rows = self._db.execute(
            "SELECT * FROM bot_deals WHERE bot_id = ? ORDER BY started, id", (bot_id,)
        )
        return [dict(r) for r in rows]

    def add_deal(self, bot_id: int, now_ms: int) -> int:
        with self._db:
            cursor = self._db.execute(
                "INSERT INTO bot_deals (bot_id, started, status) VALUES (?, ?, 'open')",
                (bot_id, now_ms),
            )
        return int(cursor.lastrowid or 0)

    def end_deal(
        self, deal_id: int, status: str, profit: str | None, now_ms: int, note: str | None
    ) -> None:
        with self._db:
            self._db.execute(
                "UPDATE bot_deals SET status = ?, profit = ?, ended = ?, note = ? WHERE id = ?",
                (status, profit, now_ms, note, deal_id),
            )

    def add_bot_order(self, order: dict[str, Any]) -> int:
        with self._db:
            cursor = self._db.execute(
                "INSERT INTO bot_orders (deal_id, rung, side, client_id, price, qty, spend, "
                "status, created, updated) VALUES (:deal_id, :rung, :side, :client_id, :price, "
                ":qty, :spend, 'placing', :created, :created)",
                order,
            )
        return int(cursor.lastrowid or 0)

    def bot_orders(self, deal_id: int) -> list[dict[str, Any]]:
        rows = self._db.execute(
            "SELECT * FROM bot_orders WHERE deal_id = ? ORDER BY id", (deal_id,)
        )
        return [dict(r) for r in rows]

    def save_bot_order(self, order: dict[str, Any]) -> None:
        with self._db:
            self._db.execute(
                "UPDATE bot_orders SET order_id = :order_id, status = :status, "
                "executed_qty = :executed_qty, executed_quote = :executed_quote, "
                "fee_base = :fee_base, updated = :updated WHERE id = :id",
                order,
            )

    # Watchlists, each a named list of coins, oldest first (decisions 18 and 23).

    def lists(self) -> list[dict[str, Any]]:
        rows = self._db.execute(
            "SELECT lists.id, lists.name, COUNT(list_coins.coin) AS count FROM lists "
            "LEFT JOIN list_coins ON list_coins.list_id = lists.id "
            "GROUP BY lists.id ORDER BY lists.created, lists.id"
        )
        return [
            {"id": int(r["id"]), "name": str(r["name"]), "count": int(r["count"])} for r in rows
        ]

    def create_list(self, name: str, now_ms: int) -> int:
        with self._db:
            cursor = self._db.execute(
                "INSERT INTO lists (name, created) VALUES (?, ?)", (name, now_ms)
            )
        return int(cursor.lastrowid or 0)

    def delete_list(self, list_id: int) -> None:
        with self._db:
            self._db.execute("DELETE FROM list_coins WHERE list_id = ?", (list_id,))
            self._db.execute("DELETE FROM lists WHERE id = ?", (list_id,))

    def old_watchlist(self) -> list[str]:
        """The single watchlist from before there were several, to move into the first list."""
        rows = self._db.execute("SELECT coin FROM watchlist ORDER BY added, coin")
        return [str(r["coin"]) for r in rows]

    def list_coins(self, list_id: int) -> list[str]:
        rows = self._db.execute(
            "SELECT coin FROM list_coins WHERE list_id = ? ORDER BY added, coin", (list_id,)
        )
        return [str(r["coin"]) for r in rows]

    def watch_coin(self, list_id: int, coin: str, now_ms: int) -> None:
        with self._db:
            self._db.execute(
                "INSERT OR IGNORE INTO list_coins (list_id, coin, added) VALUES (?, ?, ?)",
                (list_id, coin, now_ms),
            )

    def unwatch_coin(self, list_id: int, coin: str) -> None:
        with self._db:
            self._db.execute(
                "DELETE FROM list_coins WHERE list_id = ? AND coin = ?", (list_id, coin)
            )

    # The last AI signal for each coin, kept as JSON (decision 16).

    def signal(self, coin: str) -> tuple[int, str] | None:
        row = self._db.execute("SELECT ran, data FROM signals WHERE coin = ?", (coin,)).fetchone()
        return (int(row["ran"]), str(row["data"])) if row else None

    def save_signal(self, coin: str, ran_ms: int, data: str) -> None:
        with self._db:
            self._db.execute(
                "INSERT INTO signals (coin, ran, data) VALUES (?, ?, ?) "
                "ON CONFLICT(coin) DO UPDATE SET ran = excluded.ran, data = excluded.data",
                (coin, ran_ms, data),
            )

    # The account's total value, the last figure of each day.

    def record_value(self, day: str, value: str) -> None:
        with self._db:
            self._db.execute(
                "INSERT INTO history (day, value) VALUES (?, ?) "
                "ON CONFLICT(day) DO UPDATE SET value = excluded.value",
                (day, value),
            )

    def history(self, days: int) -> list[tuple[str, str]]:
        rows = self._db.execute("SELECT day, value FROM history ORDER BY day DESC LIMIT ?", (days,))
        return [(str(r["day"]), str(r["value"])) for r in rows][::-1]

    # Average costs the owner enters for holdings with no trades here, such as the TAO wallet.

    def costs(self) -> dict[tuple[str, str], str]:
        rows = self._db.execute("SELECT source, asset, average FROM costs")
        return {(str(r["source"]), str(r["asset"])): str(r["average"]) for r in rows}

    def set_cost(self, source: str, asset: str, average: str | None) -> None:
        with self._db:
            if average is None:
                self._db.execute(
                    "DELETE FROM costs WHERE source = ? AND asset = ?", (source, asset)
                )
            else:
                self._db.execute(
                    "INSERT INTO costs (source, asset, average) VALUES (?, ?, ?) "
                    "ON CONFLICT(source, asset) DO UPDATE SET average = excluded.average",
                    (source, asset, average),
                )

    # What the owner paid in AUD for a USDC deposit, by its exact amount (decision 31).

    def deposits_paid(self) -> dict[str, str]:
        rows = self._db.execute("SELECT amount, aud FROM deposit_paid")
        return {str(r["amount"]): str(r["aud"]) for r in rows}

    def set_deposit_paid(self, amount: str, aud: str | None) -> None:
        with self._db:
            if aud is None:
                self._db.execute("DELETE FROM deposit_paid WHERE amount = ?", (amount,))
            else:
                self._db.execute(
                    "INSERT INTO deposit_paid (amount, aud) VALUES (?, ?) "
                    "ON CONFLICT(amount) DO UPDATE SET aud = excluded.aud",
                    (amount, aud),
                )

    # Grid bots (decision 38): each grid, and every order it wants or placed.

    def grids(self) -> list[dict[str, Any]]:
        return [dict(r) for r in self._db.execute("SELECT * FROM grids ORDER BY created, id")]

    def grid(self, grid_id: int) -> dict[str, Any]:
        row = self._db.execute("SELECT * FROM grids WHERE id = ?", (grid_id,)).fetchone()
        if row is None:
            raise LookupError(grid_id)
        return dict(row)

    def add_grid(self, name: str, symbol: str, config: str, now_ms: int) -> int:
        with self._db:
            cursor = self._db.execute(
                "INSERT INTO grids (name, symbol, config, created, updated) VALUES (?, ?, ?, ?, ?)",
                (name, symbol, config, now_ms, now_ms),
            )
        return int(cursor.lastrowid or 0)

    def save_grid(self, grid: dict[str, Any]) -> dict[str, Any]:
        with self._db:
            self._db.execute(
                "UPDATE grids SET name = :name, symbol = :symbol, config = :config, "
                "enabled = :enabled, note = :note, started = :started, updated = :updated "
                "WHERE id = :id",
                grid,
            )
        return self.grid(int(grid["id"]))

    def delete_grid(self, grid_id: int) -> None:
        with self._db:
            self._db.execute("DELETE FROM grid_orders WHERE grid_id = ?", (grid_id,))
            self._db.execute("DELETE FROM grids WHERE id = ?", (grid_id,))

    def add_grid_order(self, order: dict[str, Any]) -> int:
        with self._db:
            cursor = self._db.execute(
                "INSERT INTO grid_orders (grid_id, line, target, side, client_id, price, qty, "
                "spend, cost, status, created, updated) VALUES (:grid_id, :line, :target, "
                ":side, :client_id, :price, :qty, :spend, :cost, 'wanted', :created, :created)",
                order,
            )
        return int(cursor.lastrowid or 0)

    def grid_orders(self, grid_id: int) -> list[dict[str, Any]]:
        rows = self._db.execute(
            "SELECT * FROM grid_orders WHERE grid_id = ? ORDER BY id", (grid_id,)
        )
        return [dict(r) for r in rows]

    def save_grid_order(self, order: dict[str, Any]) -> None:
        with self._db:
            self._db.execute(
                "UPDATE grid_orders SET order_id = :order_id, status = :status, "
                "executed_qty = :executed_qty, executed_quote = :executed_quote, "
                "fee_base = :fee_base, profit = :profit, updated = :updated WHERE id = :id",
                order,
            )

    # Each AI plan's action and price, to score the track record (decision 46).

    def add_signal_history(self, coin: str, ran_ms: int, action: str, price: str) -> None:
        with self._db:
            self._db.execute(
                "INSERT INTO signal_history (coin, ran, action, price) VALUES (?, ?, ?, ?)",
                (coin, ran_ms, action, price),
            )

    def signal_history(self, coin: str) -> list[dict[str, Any]]:
        rows = self._db.execute(
            "SELECT ran, action, price FROM signal_history WHERE coin = ? ORDER BY ran", (coin,)
        )
        return [dict(r) for r in rows]

    # Price alerts set from the plan's Watch for (decision 46).

    def add_alert(self, coin: str, direction: str, price: str, note: str, now_ms: int) -> int:
        with self._db:
            cursor = self._db.execute(
                "INSERT INTO alerts (coin, direction, price, note, created) VALUES (?, ?, ?, ?, ?)",
                (coin, direction, price, note, now_ms),
            )
        return int(cursor.lastrowid or 0)

    def alerts(self, coin: str | None = None) -> list[dict[str, Any]]:
        if coin:
            rows = self._db.execute(
                "SELECT * FROM alerts WHERE coin = ? ORDER BY created DESC", (coin,)
            )
        else:
            rows = self._db.execute("SELECT * FROM alerts ORDER BY created DESC")
        return [dict(r) for r in rows]

    def trigger_alert(self, alert_id: int, now_ms: int) -> None:
        with self._db:
            self._db.execute("UPDATE alerts SET triggered = ? WHERE id = ?", (now_ms, alert_id))

    def delete_alert(self, alert_id: int) -> None:
        with self._db:
            self._db.execute("DELETE FROM alerts WHERE id = ?", (alert_id,))
