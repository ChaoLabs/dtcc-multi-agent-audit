import pytest
from audit_api.main import LocalRequestBoundary, app
from audit_core.models import AuditReport
from fastapi.testclient import TestClient

client = TestClient(app, base_url="http://127.0.0.1")
SOURCE = "pragma solidity ^0.8.20;\ncontract C {}"


def test_health_is_offline():
    assert client.get("/api/health").json()["offline"] is True


def test_round_trip():
    response = client.post("/api/audits", json={"filename": "C.sol", "source": SOURCE})
    assert response.status_code == 200
    report = AuditReport.model_validate(response.json())
    assert report.candidates == []
    assert report.input.source == SOURCE
    assert report.execution == "local"


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"source": 1},
        {"source": "  "},
        {"source": SOURCE, "api_key": "dummy-do-not-echo"},
        {"source": SOURCE, "mode": "bedrock"},
    ],
)
def test_validation_never_echoes_source_or_keys(body):
    response = client.post("/api/audits", json=body)
    assert response.status_code == 422
    assert "dummy-do-not-echo" not in response.text
    assert "contract C" not in response.text


def test_malformed_json_is_not_echoed():
    response = client.post(
        "/api/audits",
        content='{"source": "private-marker"',
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 422
    assert "private-marker" not in response.text


def test_large_body_rejected_before_json_parsing():
    response = client.post("/api/audits", content="x" * 64_001)
    assert response.status_code == 413


def test_foreign_browser_origin_denied():
    response = client.post(
        "/api/audits", json={"source": SOURCE}, headers={"Origin": "https://example.com"}
    )
    assert response.status_code == 403
    assert "access-control-allow-origin" not in response.headers


def test_loopback_cors():
    response = client.options(
        "/api/audits",
        headers={
            "Origin": "http://127.0.0.1:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"


def test_dns_rebinding_host_denied():
    assert client.get("/api/health", headers={"Host": "attacker.example"}).status_code == 400


def test_chunked_size_limit():
    import asyncio

    sent = []
    chunks = iter(
        [
            {"type": "http.request", "body": b"x" * 40_000, "more_body": True},
            {"type": "http.request", "body": b"x" * 25_000, "more_body": False},
        ]
    )

    async def receive():
        return next(chunks)

    async def send(event):
        sent.append(event)

    async def forbidden_app(*args):
        pytest.fail("Oversized request reached application")

    asyncio.run(
        LocalRequestBoundary(forbidden_app)(
            {"type": "http", "method": "POST", "headers": []}, receive, send
        )
    )
    assert sent[0]["status"] == 413
