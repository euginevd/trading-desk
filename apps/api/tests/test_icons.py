import base64
from pathlib import Path

import httpx
import pytest
from api import handler as desk
from api.handler import handler
from api.icons import Icons

PNG = b"\x89PNG\r\n\x1a\nlogo"


def coingecko(asked: list[str], search_status: int = 200, host: str = "coin-images.coingecko.com"):
    def reply(request: httpx.Request) -> httpx.Response:
        asked.append(str(request.url))
        if request.url.path == "/api/v3/search":
            if search_status != 200:
                return httpx.Response(search_status)
            return httpx.Response(
                200,
                json={
                    "coins": [
                        {"symbol": "HYPER", "large": f"https://{host}/wrong.png"},
                        {"symbol": "HYPE", "large": f"https://{host}/hyperliquid.png"},
                    ]
                },
            )
        return httpx.Response(200, content=PNG, headers={"content-type": "image/png"})

    return httpx.Client(transport=httpx.MockTransport(reply))


def test_finds_the_logo_by_exact_ticker_and_keeps_it(tmp_path: Path) -> None:
    asked: list[str] = []
    icons = Icons(tmp_path, coingecko(asked))
    assert icons.get("hype") == (PNG, "image/png")
    assert asked[-1].endswith("/hyperliquid.png")
    assert (tmp_path / "HYPE.png").read_bytes() == PNG
    assert icons.get("HYPE") == (PNG, "image/png")
    assert len(asked) == 2  # kept: no second lookup


def test_remembers_a_coin_with_no_logo(tmp_path: Path) -> None:
    asked: list[str] = []
    icons = Icons(tmp_path, coingecko(asked))
    assert icons.get("ZZZ") is None
    assert icons.get("ZZZ") is None
    assert len(asked) == 1


def test_a_busy_coingecko_is_tried_again_later(tmp_path: Path) -> None:
    asked: list[str] = []
    icons = Icons(tmp_path, coingecko(asked, search_status=429))
    assert icons.get("HYPE") is None
    assert icons.get("HYPE") is None
    assert len(asked) == 2
    assert not list(tmp_path.iterdir())


def test_takes_images_only_from_coingeckos_image_host(tmp_path: Path) -> None:
    asked: list[str] = []
    icons = Icons(tmp_path, coingecko(asked, host="evil.example"))
    assert icons.get("HYPE") is None
    assert len(asked) == 1


def test_refuses_names_that_arent_tickers(tmp_path: Path) -> None:
    asked: list[str] = []
    icons = Icons(tmp_path, coingecko(asked))
    assert icons.get("../etc") is None
    assert icons.get("") is None
    assert asked == []


def test_route_sends_the_logo_or_404(monkeypatch: pytest.MonkeyPatch) -> None:
    def found(coin: str) -> tuple[bytes, str] | None:
        return (PNG, "image/png") if coin == "BTC" else None

    monkeypatch.setattr(desk, "live_icon", found)
    reply = handler({"rawPath": "/coin-icon/BTC"}, None)
    assert reply["statusCode"] == 200
    assert reply["isBase64Encoded"] is True
    assert base64.b64decode(str(reply["body"])) == PNG
    assert handler({"rawPath": "/coin-icon/NOPE"}, None)["statusCode"] == 404
