import httpx
import pytest
from api import handler as desk
from api.handler import handler
from api.sentiment import (
    SentimentError,
    fear_and_greed,
    fear_and_greed_detail,
    forget,
    market_global,
)


def client(reply: httpx.Response, asked: list[str]) -> httpx.Client:
    def send(request: httpx.Request) -> httpx.Response:
        asked.append(str(request.url))
        return reply

    return httpx.Client(transport=httpx.MockTransport(send))


ROWS = {
    "data": [
        {"value": "13", "value_classification": "Extreme Fear", "timestamp": "1794614400"},
        {"value": "20", "value_classification": "Extreme Fear", "timestamp": "1794528000"},
    ]
}


def test_reads_today_and_yesterday_and_keeps_them_ten_minutes() -> None:
    forget()
    asked: list[str] = []
    now = [1000.0]
    c = client(httpx.Response(200, json=ROWS), asked)
    got = fear_and_greed(c, clock=lambda: now[0])
    assert got == {
        "value": 13,
        "label": "Extreme Fear",
        "yesterday": 20,
        "updated": 1_794_614_400_000,
    }
    now[0] += 599
    fear_and_greed(c, clock=lambda: now[0])
    assert len(asked) == 1
    now[0] += 2
    fear_and_greed(c, clock=lambda: now[0])
    assert len(asked) == 2  # noqa: PLR2004


def test_refuses_a_bad_reply() -> None:
    forget()
    for reply in (
        httpx.Response(503),
        httpx.Response(200, json={"data": []}),
        httpx.Response(
            200, json={"data": [{"value": "150", "value_classification": "x", "timestamp": "1"}]}
        ),
    ):
        with pytest.raises(SentimentError):
            fear_and_greed(client(reply, []))


def test_route_answers_or_says_why(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(desk, "live_sentiment", lambda: {"value": 50, "label": "Neutral"})
    assert handler({"rawPath": "/sentiment"}, None)["statusCode"] == 200  # noqa: PLR2004

    def broken() -> dict[str, object]:
        raise SentimentError("down")

    monkeypatch.setattr(desk, "live_sentiment", broken)
    assert handler({"rawPath": "/sentiment"}, None)["statusCode"] == 502  # noqa: PLR2004


def test_the_details_compare_today_with_a_year_and_add_the_market() -> None:
    def reply(request: httpx.Request) -> httpx.Response:
        if "coingecko" in str(request.url):
            return httpx.Response(
                200,
                json={
                    "data": {
                        "total_market_cap": {"usd": 2.2e12},
                        "market_cap_change_percentage_24h_usd": -2.5,
                        "total_volume": {"usd": 7.4e10},
                        "market_cap_percentage": {"btc": 57.0, "eth": 11.0},
                    }
                },
            )
        labels = ["Extreme Fear"] * 8 + ["Neutral"] * 358
        rows = [
            {"value": str(10 + n % 80), "value_classification": labels[n], "timestamp": "1"}
            for n in range(366)
        ]
        return httpx.Response(200, json={"data": rows})

    forget()
    with httpx.Client(transport=httpx.MockTransport(reply)) as client:
        detail = fear_and_greed_detail(client)
    assert detail["now"]["value"] == 10
    assert detail["history"]["lastWeek"]["value"] == 17
    assert detail["high"]["value"] == 89
    assert detail["low"]["value"] == 10
    assert "Extreme Fear" in detail["summary"]
    assert len(detail["chart"]) == 90
    assert detail["market"]["capChange"] == "-2.5"
    forget()


def test_the_header_gets_the_market_and_survives_coingecko_being_down() -> None:
    def down(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    forget()
    with httpx.Client(transport=httpx.MockTransport(down)) as client:
        assert market_global(client) == {}
    forget()
