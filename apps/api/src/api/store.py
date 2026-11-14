"""Smart trades, limits and the kill switch, kept in a local SQLite file (decision 13)."""

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
        rows = self._db.execute(
            "SELECT spend FROM trades WHERE created >= ? AND status != 'cancelled'", (since_ms,)
        )
        return sum((Decimal(r["spend"]) for r in rows), Decimal(0))
