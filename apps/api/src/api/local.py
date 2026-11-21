"""Runs the api locally (decisions 10 and 14): `uv run python -m api.local`, on 127.0.0.1.

In Docker it listens inside its container (API_HOST=0.0.0.0) with no port published: only the
desk container reaches it, and the desk is published on 127.0.0.1 only (spec 9)."""

import base64
import ipaddress
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import cast
from urllib.parse import parse_qsl, urlsplit

from api import jobs
from api.advisor import check_alerts
from api.binance import BinanceError
from api.dca_book import DcaBook
from api.handler import (
    handler,
    live_bots,
    live_grids,
    live_services,
    live_trading,
    morning_summary,
    store_path,
    weekly_recap,
)
from api.pot import Pot

HOST = os.environ.get("API_HOST", "127.0.0.1")
PORT = 8000
WATCH_SECONDS = 30
AGENT_SECONDS = 15
# Room for the largest import, a 200 KB Profile, once escaped as JSON (audit 23).
MAX_BODY = 512_000
# The desk's own pages, and the api itself. Anything else is refused, so a web page open in
# another tab can't reach the api (cross-site requests) or rename itself to it (DNS rebinding).
ORIGINS = {"http://127.0.0.1:5173", "http://localhost:5173"} | {
    o.strip().rstrip("/")
    for o in os.environ.get("DESK_ORIGINS", "").split(",")
    if o.strip().startswith(("http://127.0.0.1:", "http://localhost:"))  # local pages only
}
HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"} | {o.split("://", 1)[1] for o in ORIGINS}
# DESK_HOSTS: the paper bot (apps/backtest) may call the api by its compose service name, and
# only to ask trading-agent about a setup: that route sizes and places nothing. No other name
# or route is opened this way.
SERVICE = f"api:{PORT}"
SERVICE_ON = SERVICE in {h.strip() for h in os.environ.get("DESK_HOSTS", "").split(",")}
SERVICE_ROUTES = {("POST", "/pot/judge-one")}
# DESK_BOTS_NET: the Freqtrade containers' own network (docker-compose.yml). A request from it
# reaches that one route and nothing else, whatever its headers say: a container can send any
# Host header, but not another network's address (audit 18).
_bots = os.environ.get("DESK_BOTS_NET", "").strip()
BOTS_NET = ipaddress.ip_network(_bots, strict=False) if _bots else None


def from_bots(peer: str) -> bool:
    """Whether a request came from the Freqtrade containers' network."""
    if BOTS_NET is None or not peer:
        return False
    try:
        return ipaddress.ip_address(peer) in BOTS_NET
    except ValueError:
        return True  # an address that can't be read is treated as theirs: refused


def load_env(path: Path) -> None:
    """Sets KEY=VALUE lines from .env that aren't already set, or are set but empty (compose
    fixes the environment when the container is made; a key saved later from Settings is in the
    mounted .env only). Values are never printed."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        name, value = key.strip(), value.strip().strip("\"'")
        if value and not os.environ.get(name, "").strip():
            os.environ[name] = value


def allowed(method: str, headers: dict[str, str], path: str = "", peer: str = "") -> str | None:
    """Why a request is refused, or None. Changes need JSON from the desk's own page; the
    Freqtrade containers reach the one service route only."""
    host = headers.get("host", "")
    if from_bots(peer) and (
        not SERVICE_ON or host != SERVICE or (method, path) not in SERVICE_ROUTES
    ):
        return "Unknown host."
    if host == SERVICE and SERVICE_ON:
        if (method, path) not in SERVICE_ROUTES or "origin" in headers:
            return "Unknown host."
    elif host not in HOSTS:
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
        refusal = allowed(self.command, headers, url.path, str(self.client_address[0]))
        try:
            length = int(headers.get("content-length", "0") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY:
            refusal = refusal or "The request body is missing its size or too large."
            self.close_connection = True  # the unread body never reaches the next request
        body = self.rfile.read(length).decode("utf-8", "replace") if 0 < length <= MAX_BODY else ""
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
            try:
                reply = handler(event, None)
            except Exception as error:  # noqa: BLE001 - one bad request must not drop the connection
                # The desk would otherwise say the api isn't running; the type is logged, not sent.
                print(f"{self.command} {url.path}: unexpected {type(error).__name__}")
                reply = {
                    "statusCode": 500,
                    "headers": {"content-type": "application/json"},
                    "body": json.dumps(
                        {"error": "The api hit an error it didn't expect. Try again; it's logged."}
                    ),
                }
        text = str(reply["body"])
        data = base64.b64decode(text) if reply.get("isBase64Encoded") else text.encode()
        self.send_response(int(str(reply["statusCode"])))
        for name, value in cast(dict[str, str], reply["headers"]).items():
            self.send_header(name, value)
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = _handle  # noqa: N815
    do_POST = _handle  # noqa: N815
    do_PUT = _handle  # noqa: N815
    do_DELETE = _handle  # noqa: N815

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        print(f"{self.command} {urlsplit(self.path).path}")


def watch(stop: threading.Event) -> None:
    """Every 30 seconds: follows the DCA book's and the Trading account's orders, and steps each
    DCA and grid bot (decisions 37 and 38)."""
    while not stop.wait(WATCH_SECONDS):
        try:
            with live_trading() as desk:
                DcaBook(desk).sync()
                Pot(desk).sync()
            with live_bots() as bots:
                bots.step()
            with live_grids() as grids:
                grids.step()
            with live_services() as services:
                check_alerts(
                    services.binance, services.store, services.audit, int(time.time() * 1000)
                )
                morning_summary(services)  # Telegram, once a day (decision 57)
                weekly_recap(services)  # Sunday evening (decision 58)

        except (LookupError, BinanceError) as error:
            print(f"watcher: {type(error).__name__}")
        except Exception as error:  # noqa: BLE001 - stops and exits live here: the watcher must keep running
            print(f"watcher: unexpected {type(error).__name__}")


def agents(stop: threading.Event) -> None:
    """Every 15 seconds: the scheduler wakes any agent whose time has come (api.schedule), and
    the owner's Telegram buttons are answered. Its own thread, so a minute-long agent call
    never holds up the order sync."""
    while not stop.wait(AGENT_SECONDS):
        try:
            with live_services() as services:
                jobs.tick(services)
        except Exception as error:  # noqa: BLE001 - the scheduler must keep running
            print(f"scheduler: {type(error).__name__}")


def main() -> None:
    load_env(Path(".env"))
    if os.environ.get("DEMO") == "1":
        store_path().unlink(missing_ok=True)  # the demo exchange starts empty, so its trades do
        print("Demo mode: made-up figures and a pretend exchange.")
    stop = threading.Event()
    threading.Thread(target=watch, args=(stop,), daemon=True).start()
    if os.environ.get("DEMO") != "1":  # the demo never wakes an agent or messages anyone
        threading.Thread(target=agents, args=(stop,), daemon=True).start()
    print(f"api on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Local).serve_forever()


if __name__ == "__main__":
    main()
