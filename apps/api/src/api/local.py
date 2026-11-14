"""Runs the api locally on 127.0.0.1 only (decision 10): `uv run python -m api.local`."""

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import cast
from urllib.parse import parse_qsl, urlsplit

from api.binance import BinanceError
from api.handler import handler, live_trading, store_path

HOST = "127.0.0.1"
PORT = 8000
WATCH_SECONDS = 30
MAX_BODY = 10_000
# The desk's own pages, and the api itself. Anything else is refused, so a web page open in
# another tab can't reach the api (cross-site requests) or rename itself to it (DNS rebinding).
HOSTS = {f"{HOST}:{PORT}", f"localhost:{PORT}", "127.0.0.1:5173", "localhost:5173"}
ORIGINS = {"http://127.0.0.1:5173", "http://localhost:5173"}


def load_env(path: Path) -> None:
    """Sets KEY=VALUE lines from .env that aren't already set. Values are never printed."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def allowed(method: str, headers: dict[str, str]) -> str | None:
    """Why a request is refused, or None. Changes need JSON from the desk's own page."""
    if headers.get("host", "") not in HOSTS:
        return "Unknown host."
    origin = headers.get("origin")
    if origin is not None and origin not in ORIGINS:
        return "Unknown origin."
    if method != "GET" and not headers.get("content-type", "").startswith("application/json"):
        return "Send JSON."
    return None


class Local(BaseHTTPRequestHandler):
    def _handle(self) -> None:
        url = urlsplit(self.path)
        headers = {k.lower(): v for k, v in self.headers.items()}
        refusal = allowed(self.command, headers)
        length = min(int(headers.get("content-length", "0") or 0), MAX_BODY)
        body = self.rfile.read(length).decode("utf-8", "replace") if length else ""
        if refusal:
            reply: dict[str, object] = {
                "statusCode": 403,
                "headers": {"content-type": "application/json"},
                "body": json.dumps({"error": refusal}),
            }
        else:
            event: dict[str, object] = {
                "rawPath": url.path,
                "queryStringParameters": dict(parse_qsl(url.query)),
                "requestContext": {"http": {"method": self.command}},
                "body": body,
            }
            reply = handler(event, None)
        data = str(reply["body"]).encode()
        self.send_response(int(str(reply["statusCode"])))
        for name, value in cast(dict[str, str], reply["headers"]).items():
            self.send_header(name, value)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = _handle  # noqa: N815
    do_POST = _handle  # noqa: N815
    do_PUT = _handle  # noqa: N815

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        print(f"{self.command} {urlsplit(self.path).path}")


def watch(stop: threading.Event) -> None:
    """Every 30 seconds: places exits for filled buys and records trades that closed."""
    while not stop.wait(WATCH_SECONDS):
        try:
            with live_trading() as desk:
                desk.watch()
        except (LookupError, BinanceError) as error:
            print(f"watcher: {type(error).__name__}")


def main() -> None:
    load_env(Path(".env"))
    if os.environ.get("DEMO") == "1":
        store_path().unlink(missing_ok=True)  # the demo exchange starts empty, so its trades do
        print("Demo mode: made-up figures and a pretend exchange.")
    stop = threading.Event()
    threading.Thread(target=watch, args=(stop,), daemon=True).start()
    print(f"api on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Local).serve_forever()


if __name__ == "__main__":
    main()
