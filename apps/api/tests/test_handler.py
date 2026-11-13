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
