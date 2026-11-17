import json

from api.handler import handler


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
    from api.handler import _failure  # noqa: PLC0415  # pyright: ignore[reportPrivateUsage]

    assert _failure(KeyError("orderId"))[1]["error"].startswith("A reply was missing")
    assert "BINANCE_API_KEY" in _failure(LookupError())[1]["error"]
