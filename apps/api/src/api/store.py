"""Limits, the kill switch, the watchlist, signals and account value history, and the old smart
trades (read only, decision 98), kept in a local SQLite file (decisions 13 and 18)."""

import json
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
CREATE TABLE IF NOT EXISTS dca_orders (
    id INTEGER PRIMARY KEY,
    ref TEXT NOT NULL UNIQUE,
    coin TEXT NOT NULL,
    side TEXT NOT NULL,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    link TEXT,
    week TEXT NOT NULL,
    price TEXT,
    qty TEXT,
    spend TEXT,
    client_id TEXT NOT NULL UNIQUE,
    order_id INTEGER,
    status TEXT NOT NULL,
    executed_qty TEXT NOT NULL DEFAULT '0',
    executed_quote TEXT NOT NULL DEFAULT '0',
    fee_base TEXT NOT NULL DEFAULT '0',
    fee_quote TEXT NOT NULL DEFAULT '0',
    fee_usd TEXT NOT NULL DEFAULT '0',
    aud_rate TEXT,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
);
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
    updated INTEGER NOT NULL,
    deleted INTEGER
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
    updated INTEGER NOT NULL,
    deleted INTEGER
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
CREATE TABLE IF NOT EXISTS profile_versions (
    n INTEGER PRIMARY KEY, time INTEGER NOT NULL, author TEXT NOT NULL,
    summary TEXT NOT NULL, reason TEXT NOT NULL, doc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_versions (
    n INTEGER PRIMARY KEY, time INTEGER NOT NULL, author TEXT NOT NULL,
    summary TEXT NOT NULL, doc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_runs (
    id INTEGER PRIMARY KEY, coin TEXT NOT NULL, started INTEGER NOT NULL, doc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job_runs (
    id INTEGER PRIMARY KEY,
    job TEXT NOT NULL,
    slot INTEGER NOT NULL,
    started INTEGER NOT NULL,
    finished INTEGER,
    status TEXT NOT NULL,
    line TEXT NOT NULL DEFAULT '',
    UNIQUE (job, slot)
);
CREATE TABLE IF NOT EXISTS pot_moves (
    id INTEGER PRIMARY KEY,
    ref TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    usdc TEXT NOT NULL,
    created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pot_trades (
    id INTEGER PRIMARY KEY,
    ref TEXT NOT NULL UNIQUE,
    coin TEXT NOT NULL,
    setup TEXT NOT NULL,
    regime TEXT NOT NULL,
    reason TEXT NOT NULL,
    entry TEXT NOT NULL,
    stop TEXT NOT NULL,
    first_stop TEXT NOT NULL,
    target TEXT NOT NULL,
    qty TEXT NOT NULL,
    spend TEXT NOT NULL,
    risk TEXT NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    fill_qty TEXT NOT NULL DEFAULT '0',
    fill_quote TEXT NOT NULL DEFAULT '0',
    exit_qty TEXT NOT NULL DEFAULT '0',
    exit_quote TEXT NOT NULL DEFAULT '0',
    exit_kind TEXT,
    fees_usd TEXT NOT NULL DEFAULT '0',
    rules_kept INTEGER NOT NULL DEFAULT 1,
    note TEXT,
    created INTEGER NOT NULL,
    filled INTEGER,
    closed INTEGER,
    updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pot_notes (
    id INTEGER PRIMARY KEY,
    trade_ref TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pot_orders (
    id INTEGER PRIMARY KEY,
    ref TEXT NOT NULL UNIQUE,
    trade_ref TEXT NOT NULL,
    role TEXT NOT NULL,
    kind TEXT NOT NULL,
    side TEXT NOT NULL,
    price TEXT,
    stop TEXT,
    qty TEXT NOT NULL,
    spend TEXT,
    client_id TEXT NOT NULL UNIQUE,
    order_id INTEGER,
    list_id INTEGER,
    legs TEXT,
    status TEXT NOT NULL,
    executed_qty TEXT NOT NULL DEFAULT '0',
    executed_quote TEXT NOT NULL DEFAULT '0',
    fee_usd TEXT NOT NULL DEFAULT '0',
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL
);
"""


# Columns added after the first databases were made, each with its fixed statement: no SQL is
# built from strings.
ADDED_COLUMNS = (
    ("bots", "deleted", "ALTER TABLE bots ADD COLUMN deleted INTEGER"),
    ("grids", "deleted", "ALTER TABLE grids ADD COLUMN deleted INTEGER"),
)


class Store:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(path, timeout=5)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(SCHEMA)
        # Added after the first databases were made: a deleted bot or grid is hidden, its
        # orders kept for today's spend, the monthly cap and the ledger (audit 8).
        for table, column, statement in ADDED_COLUMNS:
            self._add_column(table, column, statement)
        # The Markdown made from the Profile on each save, beside the database it came from.
        self.profile_md = path.parent / (
            "profile.md" if path.stem == "desk" else f"{path.stem}-profile.md"
        )
        # The same for the trading agent's profile (decision 60).
        self.trade_md = path.parent / (
            "trade.md" if path.stem == "desk" else f"{path.stem}-trade.md"
        )

    def _add_column(self, table: str, column: str, statement: str) -> None:
        rows = self._db.execute("SELECT name FROM pragma_table_info(?)", (table,))
        if column not in {str(r["name"]) for r in rows}:
            with self._db:
                self._db.execute(statement)  # one of ADDED_COLUMNS' fixed statements

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
        dca = self._db.execute(
            "SELECT status, spend, executed_quote FROM dca_orders "
            "WHERE side = 'buy' AND created >= ?",
            (since_ms,),
        )
        booked = sum(
            (
                Decimal(r["executed_quote"] if r["status"] == "cancelled" else r["spend"] or "0")
                for r in dca
            ),
            Decimal(0),
        )
        pot = self._db.execute(
            "SELECT status, spend, executed_quote FROM pot_orders "
            "WHERE side = 'buy' AND created >= ?",  # entries and adds alike
            (since_ms,),
        )
        potted = sum(
            (
                Decimal(r["executed_quote"] if r["status"] == "cancelled" else r["spend"] or "0")
                for r in pot
            ),
            Decimal(0),
        )
        return trades + bots + gridded + booked + potted

    def order_owner(self, order_id: int) -> str | None:
        """Which part of the desk placed this Binance order, by its reference, if any: the DCA
        book, a Trading account trade, a bot or a grid."""
        row = self._db.execute(
            "SELECT ref FROM dca_orders WHERE order_id = ?", (order_id,)
        ).fetchone()
        if row:
            return f"the DCA book ({row['ref']})"
        row = self._db.execute(
            "SELECT trade_ref FROM pot_orders WHERE order_id = ?", (order_id,)
        ).fetchone()
        if row:
            return f"trade {row['trade_ref']}"
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

    # The ledger (decisions 54 and 56): which coins to read, and which part of the desk placed
    # each Binance order.

    def watched_coins(self) -> set[str]:
        return {str(r["coin"]) for r in self._db.execute("SELECT DISTINCT coin FROM list_coins")}

    def desk_coins(self) -> set[str]:
        """Coins the desk's own orders traded: smart trades, DCA bots and trades, grid bots."""
        rows = self._db.execute(
            "SELECT symbol FROM trades UNION SELECT symbol FROM bots UNION SELECT symbol FROM grids"
        )
        coins: set[str] = set()
        for row in rows:
            symbol = str(row["symbol"])
            for quote in ("USDT", "USDC", "FDUSD"):
                if symbol.endswith(quote):
                    coins.add(symbol.removesuffix(quote))
        return coins

    def order_sources(self) -> dict[str, str]:
        """PAIR:order id to its reference: ST-n, DCA-n · D-n, TR-n, or GRID-n."""
        sources: dict[str, str] = {}
        for row in self._db.execute("SELECT id, symbol, buy_id, exit_id FROM trades"):
            for order_id in (row["buy_id"], row["exit_id"]):
                if order_id:
                    sources[f"{row['symbol']}:{order_id}"] = f"Smart trade ST-{row['id']}"
        bots = self._db.execute(
            "SELECT bot_orders.order_id, bot_deals.id AS deal, bots.id AS bot, bots.config, "
            "bots.symbol "
            "FROM bot_orders JOIN bot_deals ON bot_deals.id = bot_orders.deal_id "
            "JOIN bots ON bots.id = bot_deals.bot_id WHERE bot_orders.order_id IS NOT NULL"
        )
        for row in bots:
            config: dict[str, Any] = json.loads(str(row["config"]))
            key = f"{row['symbol']}:{row['order_id']}"
            if config.get("entry_price") is not None:
                sources[key] = f"Trade TR-{row['bot']}"
            else:
                sources[key] = f"DCA-{row['bot']} · D-{row['deal']}"
        grids = self._db.execute(
            "SELECT grid_orders.order_id, grid_orders.grid_id, grids.symbol FROM grid_orders "
            "JOIN grids ON grids.id = grid_orders.grid_id WHERE grid_orders.order_id IS NOT NULL"
        )
        for row in grids:
            sources[f"{row['symbol']}:{row['order_id']}"] = f"GRID-{row['grid_id']}"
        return sources

    # DCA bots (decision 37): each bot, its deals and every order a deal placed.

    def bots(self) -> list[dict[str, Any]]:
        rows = self._db.execute("SELECT * FROM bots WHERE deleted IS NULL ORDER BY created, id")
        return [dict(r) for r in rows]

    def bot(self, bot_id: int) -> dict[str, Any]:
        row = self._db.execute(
            "SELECT * FROM bots WHERE id = ? AND deleted IS NULL", (bot_id,)
        ).fetchone()
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

    def delete_bot(self, bot_id: int, now_ms: int) -> None:
        """Hides the bot; its deals and orders stay, so what it bought still counts against
        today's limit and the monthly cap, and the ledger still names its fills (audit 8)."""
        with self._db:
            self._db.execute("UPDATE bots SET deleted = ? WHERE id = ?", (now_ms, bot_id))

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

    # The DCA book (TODO 11): every order the desk placed into the five lifelong positions.

    def add_dca_order(self, order: dict[str, Any]) -> int:
        with self._db:
            cursor = self._db.execute(
                "INSERT INTO dca_orders (ref, coin, side, kind, source, link, week, price, qty, "
                "spend, client_id, status, aud_rate, created, updated) VALUES (:ref, :coin, "
                ":side, :kind, :source, :link, :week, :price, :qty, :spend, :ref, "
                "'placing', :aud_rate, :created, :created)",
                order,
            )
            # Binance keeps the reference as the order's client id (DCA-BTC-26W47-1), so every
            # order can be found on Binance by it, with or without this database.
        return int(cursor.lastrowid or 0)

    def dca_orders(self) -> list[dict[str, Any]]:
        rows = self._db.execute("SELECT * FROM dca_orders ORDER BY created, id")
        return [dict(r) for r in rows]

    def dca_order(self, ref: str) -> dict[str, Any] | None:
        row = self._db.execute("SELECT * FROM dca_orders WHERE ref = ?", (ref,)).fetchone()
        return dict(row) if row else None

    def save_dca_order(self, order: dict[str, Any]) -> None:
        with self._db:
            self._db.execute(
                "UPDATE dca_orders SET order_id = :order_id, status = :status, "
                "executed_qty = :executed_qty, executed_quote = :executed_quote, "
                "fee_base = :fee_base, fee_quote = :fee_quote, fee_usd = :fee_usd, "
                "updated = :updated WHERE id = :id",
                order,
            )

    # The trading pot (docs/plan-trade.md): money in and out, trades, and every order they
    # sent. Permanent like the DCA book: rows are added and updated, never deleted.

    # The scheduler's runs (api.schedule): one row per job and slot, so a slot runs once.

    def claim_job_run(self, job: str, slot: int, started: int) -> bool:
        with self._db:
            done = self._db.execute(
                "INSERT OR IGNORE INTO job_runs (job, slot, started, status) "
                "VALUES (?, ?, ?, 'running')",
                (job, slot, started),
            )
        return done.rowcount == 1

    def finish_job_run(self, job: str, slot: int, status: str, line: str, finished: int) -> None:
        with self._db:
            self._db.execute(
                "UPDATE job_runs SET status = ?, line = ?, finished = ? WHERE job = ? AND slot = ?",
                (status, line, finished, job, slot),
            )

    def job_runs(self, job: str, limit: int) -> list[dict[str, Any]]:
        rows = self._db.execute(
            "SELECT * FROM job_runs WHERE job = ? ORDER BY slot DESC LIMIT ?", (job, limit)
        )
        return [dict(r) for r in rows]

    def add_pot_move(self, kind: str, usdc: str, created: int) -> str:
        with self._db:
            n = self._db.execute("SELECT COUNT(*) FROM pot_moves WHERE kind = ?", (kind,))
            ref = f"POT-{kind.upper()}-{int(n.fetchone()[0]) + 1}"
            self._db.execute(
                "INSERT INTO pot_moves (ref, kind, usdc, created) VALUES (?, ?, ?, ?)",
                (ref, kind, usdc, created),
            )
        return ref

    def pot_moves(self) -> list[dict[str, Any]]:
        rows = self._db.execute("SELECT * FROM pot_moves ORDER BY created, id")
        return [dict(r) for r in rows]

    def add_pot_trade(self, trade: dict[str, Any]) -> None:
        with self._db:
            self._db.execute(
                "INSERT INTO pot_trades (ref, coin, setup, regime, reason, entry, stop, "
                "first_stop, target, qty, spend, risk, mode, status, created, updated) VALUES "
                "(:ref, :coin, :setup, :regime, :reason, :entry, :stop, :stop, :target, :qty, "
                ":spend, :risk, :mode, 'placing', :created, :created)",
                trade,
            )

    def pot_trades(self) -> list[dict[str, Any]]:
        rows = self._db.execute("SELECT * FROM pot_trades ORDER BY created DESC, id DESC")
        return [dict(r) for r in rows]

    def pot_trade(self, ref: str) -> dict[str, Any] | None:
        row = self._db.execute("SELECT * FROM pot_trades WHERE ref = ?", (ref,)).fetchone()
        return dict(row) if row else None

    def save_pot_trade(self, trade: dict[str, Any]) -> None:
        with self._db:
            self._db.execute(
                "UPDATE pot_trades SET entry = :entry, stop = :stop, target = :target, "
                "qty = :qty, spend = :spend, risk = :risk, status = :status, "
                "fill_qty = :fill_qty, fill_quote = :fill_quote, exit_qty = :exit_qty, "
                "exit_quote = :exit_quote, exit_kind = :exit_kind, fees_usd = :fees_usd, "
                "rules_kept = :rules_kept, note = :note, filled = :filled, closed = :closed, "
                "updated = :updated WHERE id = :id",
                trade,
            )

    def add_pot_note(self, trade_ref: str, kind: str, text: str, created: int) -> None:
        """A line in a trade's log: the desk's own (each event, with its numbers) or yours."""
        with self._db:
            self._db.execute(
                "INSERT INTO pot_notes (trade_ref, kind, text, created) VALUES (?, ?, ?, ?)",
                (trade_ref, kind, text, created),
            )

    def pot_notes(self, trade_ref: str) -> list[dict[str, Any]]:
        rows = self._db.execute(
            "SELECT kind, text, created FROM pot_notes WHERE trade_ref = ? ORDER BY created, id",
            (trade_ref,),
        )
        return [dict(r) for r in rows]

    def add_pot_order(self, order: dict[str, Any]) -> None:
        with self._db:
            self._db.execute(
                "INSERT INTO pot_orders (ref, trade_ref, role, kind, side, price, stop, qty, "
                "spend, client_id, status, created, updated) VALUES (:ref, :trade_ref, :role, "
                ":kind, :side, :price, :stop, :qty, :spend, :ref, 'placing', :created, :created)",
                order,
            )
            # The reference is the Binance client id (TRD-SOL-26W47-1-E), so each order can be
            # found on Binance by it, with or without this database.

    def pot_orders(self) -> list[dict[str, Any]]:
        rows = self._db.execute("SELECT * FROM pot_orders ORDER BY created, id")
        return [dict(r) for r in rows]

    def pot_order(self, ref: str) -> dict[str, Any] | None:
        row = self._db.execute("SELECT * FROM pot_orders WHERE ref = ?", (ref,)).fetchone()
        return dict(row) if row else None

    def save_pot_order(self, order: dict[str, Any]) -> None:
        with self._db:
            self._db.execute(
                "UPDATE pot_orders SET order_id = :order_id, list_id = :list_id, legs = :legs, "
                "status = :status, executed_qty = :executed_qty, "
                "executed_quote = :executed_quote, fee_usd = :fee_usd, updated = :updated "
                "WHERE id = :id",
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
        rows = self._db.execute("SELECT * FROM grids WHERE deleted IS NULL ORDER BY created, id")
        return [dict(r) for r in rows]

    def grid(self, grid_id: int) -> dict[str, Any]:
        row = self._db.execute(
            "SELECT * FROM grids WHERE id = ? AND deleted IS NULL", (grid_id,)
        ).fetchone()
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

    def delete_grid(self, grid_id: int, now_ms: int) -> None:
        """Hides the grid; its orders stay, for today's limit, the monthly cap and the ledger
        (audit 8)."""
        with self._db:
            self._db.execute("UPDATE grids SET deleted = ? WHERE id = ?", (now_ms, grid_id))

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
                "fee_base = :fee_base, profit = :profit, created = :created, updated = :updated "
                "WHERE id = :id",
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

    # The Profile's versions (decision 58): each save is a whole document, never edited.

    def add_profile_version(
        self, now_ms: int, author: str, summary: str, reason: str, doc: str
    ) -> int:
        with self._db:
            cursor = self._db.execute(
                "INSERT INTO profile_versions (time, author, summary, reason, doc) "
                "VALUES (?, ?, ?, ?, ?)",
                (now_ms, author, summary, reason, doc),
            )
        return int(cursor.lastrowid or 0)

    def profile_versions(self) -> list[dict[str, Any]]:
        """Every version, oldest first, each with its document."""
        rows = self._db.execute("SELECT * FROM profile_versions ORDER BY n")
        return [dict(r) for r in rows]

    def profile_version(self, n: int) -> dict[str, Any] | None:
        row = self._db.execute("SELECT * FROM profile_versions WHERE n = ?", (n,)).fetchone()
        return dict(row) if row else None

    def latest_profile(self) -> dict[str, Any] | None:
        row = self._db.execute("SELECT * FROM profile_versions ORDER BY n DESC LIMIT 1").fetchone()
        return dict(row) if row else None

    # The trading agent's versions and runs (decision 60).

    def add_agent_version(self, now_ms: int, author: str, summary: str, doc: str) -> int:
        with self._db:
            cursor = self._db.execute(
                "INSERT INTO agent_versions (time, author, summary, doc) VALUES (?, ?, ?, ?)",
                (now_ms, author, summary, doc),
            )
        return int(cursor.lastrowid or 0)

    def agent_versions(self) -> list[dict[str, Any]]:
        """Every version, oldest first, each with its document."""
        rows = self._db.execute("SELECT * FROM agent_versions ORDER BY n")
        return [dict(r) for r in rows]

    def agent_version(self, n: int) -> dict[str, Any] | None:
        row = self._db.execute("SELECT * FROM agent_versions WHERE n = ?", (n,)).fetchone()
        return dict(row) if row else None

    def latest_agent(self) -> dict[str, Any] | None:
        row = self._db.execute("SELECT * FROM agent_versions ORDER BY n DESC LIMIT 1").fetchone()
        return dict(row) if row else None

    def add_run(self, coin: str, now_ms: int, doc: str) -> int:
        with self._db:
            cursor = self._db.execute(
                "INSERT INTO agent_runs (coin, started, doc) VALUES (?, ?, ?)", (coin, now_ms, doc)
            )
        return int(cursor.lastrowid or 0)

    def save_run(self, run_id: int, doc: str) -> None:
        with self._db:
            self._db.execute("UPDATE agent_runs SET doc = ? WHERE id = ?", (doc, run_id))

    def run(self, run_id: int) -> str | None:
        row = self._db.execute("SELECT doc FROM agent_runs WHERE id = ?", (run_id,)).fetchone()
        return str(row["doc"]) if row else None

    def last_run(self, coin: str) -> int | None:
        row = self._db.execute(
            "SELECT id FROM agent_runs WHERE coin = ? ORDER BY id DESC LIMIT 1", (coin,)
        ).fetchone()
        return int(row["id"]) if row else None

    def claim_run(self, run_id: int, now_ms: int, stale_ms: int) -> bool:
        """Takes the run's next step for this request; False while another request has it. A
        claim older than `stale_ms` is from a request that died, and is taken over."""
        key = f"run_claim_{run_id}"
        with self._db:
            self._db.execute(
                "DELETE FROM settings WHERE key = ? AND CAST(value AS INTEGER) < ?",
                (key, now_ms - stale_ms),
            )
            cursor = self._db.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, str(now_ms))
            )
        return cursor.rowcount == 1

    def release_run(self, run_id: int) -> None:
        with self._db:
            self._db.execute("DELETE FROM settings WHERE key = ?", (f"run_claim_{run_id}",))
