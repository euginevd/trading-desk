"""One lock for everything that sends orders (decision 47): the 30-second watcher and the
owner's clicks run in different threads, and two of them acting on the same bot, grid or trade
at once could send an order twice. Re-entrant, so an action may call another."""

import functools
import threading
from collections.abc import Callable
from typing import Any

DESK_LOCK = threading.RLock()


def locked[F: Callable[..., Any]](fn: F) -> F:
    @functools.wraps(fn)
    def run(*args: Any, **kwargs: Any) -> Any:
        with DESK_LOCK:
            return fn(*args, **kwargs)

    return run  # type: ignore[return-value]
