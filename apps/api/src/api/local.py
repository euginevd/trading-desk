"""Runs the api locally on 127.0.0.1 only (decision 10): `uv run python -m api.local`."""

import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import cast
from urllib.parse import urlsplit

from api.handler import handler

HOST = "127.0.0.1"
PORT = 8000


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


class Local(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        reply = handler({"rawPath": urlsplit(self.path).path}, None)
        body = str(reply["body"]).encode()
        self.send_response(int(str(reply["statusCode"])))
        headers = cast(dict[str, str], reply["headers"])
        for name, value in headers.items():
            self.send_header(name, value)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        print(f"{self.command} {urlsplit(self.path).path}")


def main() -> None:
    load_env(Path(".env"))
    print(f"api on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Local).serve_forever()


if __name__ == "__main__":
    main()
