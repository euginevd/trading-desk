"""Coin logos (decision 25): each coin's own logo, found once on CoinGecko by its ticker, kept
in `local/icons/` and served from there. A coin CoinGecko doesn't know is remembered for a week,
and the desk shows its letters instead."""

import re
import threading
import time
from pathlib import Path
from typing import Any

import httpx

SEARCH_URL = "https://api.coingecko.com/api/v3/search"
IMAGE_HOST = "coin-images.coingecko.com"
TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
MAX_BYTES = 256_000
RETRY_SECONDS = 7 * 24 * 3600
OK = 200
_COIN = re.compile(r"[A-Z0-9]{1,15}")
_lock = threading.Lock()


class Icons:
    def __init__(self, folder: Path, client: httpx.Client, clock: Any = time.time) -> None:
        self._folder = folder
        self._client = client
        self._clock = clock

    def _kept(self, coin: str) -> tuple[bytes, str] | None:
        for kind, ext in TYPES.items():
            path = self._folder / f"{coin}.{ext}"
            if path.exists():
                return path.read_bytes(), kind
        return None

    def _missing(self, coin: str) -> bool:
        marker = self._folder / f"{coin}.none"
        return marker.exists() and self._clock() - marker.stat().st_mtime < RETRY_SECONDS

    def _logo_url(self, coin: str) -> str | None:
        """The logo of the largest coin with exactly this ticker; CoinGecko ranks by size."""
        response = self._client.get(SEARCH_URL, params={"query": coin})
        if response.status_code != OK:
            raise httpx.HTTPError(f"search answered {response.status_code}")
        body: Any = response.json()
        for found in body.get("coins", []):
            if str(found.get("symbol", "")).upper() == coin:
                url = str(found.get("large") or "")
                return url if httpx.URL(url).host == IMAGE_HOST else None
        return None

    def get(self, coin: str) -> tuple[bytes, str] | None:
        """The coin's logo and its media type, or None to show its letters."""
        coin = coin.upper()
        if not _COIN.fullmatch(coin):
            return None
        with _lock:
            kept = self._kept(coin)
            if kept or self._missing(coin):
                return kept
            try:
                url = self._logo_url(coin)
                image = self._client.get(url) if url else None
            except httpx.HTTPError:
                return None  # busy or offline: try again next time, nothing remembered
            self._folder.mkdir(parents=True, exist_ok=True)
            kind = image.headers.get("content-type", "").split(";")[0] if image else ""
            if image is None or image.status_code != OK or kind not in TYPES:
                (self._folder / f"{coin}.none").touch()
                return None
            if len(image.content) > MAX_BYTES:
                (self._folder / f"{coin}.none").touch()
                return None
            (self._folder / f"{coin}.{TYPES[kind]}").write_bytes(image.content)
            return image.content, kind
