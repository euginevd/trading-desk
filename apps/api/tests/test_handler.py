import json

from api.handler import (
    MissingKey,
    _failure,  # pyright: ignore[reportPrivateUsage]
    handler,
)


def test_health_returns_ok() -> None:
    response = handler({}, None)
    assert response["statusCode"] == 200
    assert json.loads(str(response["body"])) == {"status": "ok"}


def test_health_returns_nothing_from_the_request() -> None:
    # /health is public (infra/aws/api, CKV_AWS_309), so it must never echo what it's sent.
    event: dict[str, object] = {
        "queryStringParameters": {"q": "<script>"},
        "headers": {"x": "secret"},
    }
    response = handler(event, None)
    assert response["body"] == json.dumps({"status": "ok"})


def test_a_missing_field_is_not_reported_as_a_missing_key() -> None:
    # KeyError is a LookupError, like the missing-key signal, and once hid a demo bug behind it.
    assert _failure(KeyError("orderId"))[1]["error"].startswith("The desk couldn't find")
    assert _failure(LookupError("bot-7"))[0] == 404
    assert "BINANCE_API_KEY" in _failure(MissingKey())[1]["error"]
