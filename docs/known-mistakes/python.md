# Known mistakes: Python and Postgres

Part of [known-mistakes.md](../known-mistakes.md); the numbers stay as cited.

26a. Services creating the same tables at start race on Postgres's catalog: retry setup on `UniqueViolation`, `DuplicateTable` and `DuplicateObject`.
27. Semgrep blocks `urllib` and `http.client` calls to a variable URL, even with the scheme checked: use `httpx`.
27a. Appending to a log file per line lost lines under threads on Windows: keep one shared handle under the lock (`audit.py`, `test_audit.py`).
27b. A second reader of a rate-limited source tripped Taostats' 429 and showed the wallet empty: keep and fall back to the last good reading (`tao.py`).
27c. `KeyError` is a `LookupError`: signal missing config with its own class (`MissingKey`).
27d. `zipfile.BadZipFile` is neither `OSError` nor `ValueError`: catch it by name when reading a file another process may be writing (`backtest.py`).
27e. Freqtrade calls a strategy's `custom_exit` only with `use_exit_signal = True`: off, the exit never runs and a trade sat 518 days (`DeskExits`).
27f. A Freqtrade backtest fills a partial exit before it checks the stop on the same candle: run exits with `--timeframe-detail`, and move a stop to break-even only from the candle after the partial fills.
