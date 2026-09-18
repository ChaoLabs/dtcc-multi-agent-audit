import asyncio
import json
from copy import deepcopy

import httpx
import pytest
from audit_api.main import app, review_slot
from audit_api.review import ReviewError, parse_content, public_settings, review
from audit_core.engine import analyze
from audit_core.models import AuditInput
from fastapi.testclient import TestClient

SOURCE = 'pragma solidity ^0.8.20;\ncontract Vault {\n function pay() public { msg.sender.call{value: 1}(""); }\n}'
REPORT = analyze(AuditInput(source=SOURCE))
CONTENT = {
    "summary": "Review the unchecked call.",
    "findings": [
        {
            "title": "Unchecked external interaction",
            "category": "External interactions",
            "proposed_severity": "MEDIUM",
            "rationale": "The call result is not used.",
            "recommendation": "Check the return value.",
            "evidence": {
                "line_start": 3,
                "line_end": 3,
                "excerpt": SOURCE.splitlines()[2],
                "validation": "source-bound",
            },
        }
    ],
}


@pytest.fixture(autouse=True)
def environment(monkeypatch):
    for name in (
        "AWS_BEARER_TOKEN_BEDROCK",
        "BEDROCK_API_KEY",
        "BEDROCK_MODEL_ID",
        "AWS_REGION",
        "BEDROCK_PROTOCOL",
    ):
        monkeypatch.delenv(name, raising=False)


def configure(monkeypatch, protocol="converse"):
    monkeypatch.setenv("AWS_BEARER_TOKEN_BEDROCK", "test-bearer-value")
    monkeypatch.setenv("BEDROCK_MODEL_ID", "test-model:1")
    monkeypatch.setenv("BEDROCK_PROTOCOL", protocol)


def payload(protocol, content=CONTENT):
    if protocol == "converse":
        return {
            "stopReason": "end_turn",
            "output": {"message": {"content": [{"text": json.dumps(content)}]}},
            "usage": {"inputTokens": 100, "outputTokens": 50},
        }
    return {
        "stop_reason": "end_turn",
        "content": [{"type": "text", "text": json.dumps(content)}],
        "usage": {"input_tokens": 100, "output_tokens": 50},
    }


@pytest.mark.parametrize("protocol", ["converse", "mantle"])
def test_both_transports_and_bound_result(monkeypatch, protocol):
    configure(monkeypatch, protocol)
    seen = []

    def respond(request):
        seen.append(request)
        body = json.loads(request.content)
        assert SOURCE.splitlines()[2] in str(body).replace('\\"', '"') or "source_lines" in str(
            body
        )
        assert "tools" not in body
        if protocol == "converse":
            assert request.headers["authorization"] == "Bearer test-bearer-value"
            assert request.url.host == "bedrock-runtime.us-east-1.amazonaws.com"
            assert request.url.path.endswith("/converse")
        else:
            assert request.headers["x-api-key"] == "test-bearer-value"
            assert "authorization" not in request.headers
            assert request.url.host == "bedrock-mantle.us-east-1.api.aws"
            assert request.url.path == "/anthropic/v1/messages"
        return httpx.Response(200, json=payload(protocol))

    result = asyncio.run(review(REPORT, transport=httpx.MockTransport(respond)))
    assert len(seen) == 1
    assert result.static_report == REPORT
    assert result.model_review.findings[0].evidence.excerpt == SOURCE.splitlines()[2]
    assert result.model_review.source_sha256 == REPORT.source_sha256
    assert result.model_review.input_tokens == 100
    assert "test-bearer-value" not in result.model_dump_json()


def test_missing_config_makes_no_request():
    def forbidden(request):
        raise AssertionError("Must not contact AWS")

    with pytest.raises(ReviewError, match="Configure"):
        asyncio.run(review(REPORT, transport=httpx.MockTransport(forbidden)))
    config = public_settings()
    assert config["configured"] is False and "token" not in config


@pytest.mark.parametrize(
    "setting,value",
    [
        ("AWS_REGION", "evil.test/path"),
        ("BEDROCK_PROTOCOL", "custom"),
        ("BEDROCK_MODEL_ID", "bad\nheader"),
        ("AWS_BEARER_TOKEN_BEDROCK", "bad\nkey"),
    ],
)
def test_invalid_configuration_is_rejected(monkeypatch, setting, value):
    configure(monkeypatch)
    monkeypatch.setenv(setting, value)
    with pytest.raises(ReviewError):
        public_settings()


@pytest.mark.parametrize("status", [301, 400, 401, 403, 429, 500])
def test_upstream_failure_never_returns_model_results_or_raw_body(monkeypatch, status):
    configure(monkeypatch)
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(
            status, text="private-upstream-value", headers={"Location": "https://example.org"}
        )

    with pytest.raises(ReviewError) as caught:
        asyncio.run(review(REPORT, transport=httpx.MockTransport(respond)))
    assert len(calls) == 1 and "private-upstream-value" not in str(caught.value)


def test_timeout_is_bounded_error(monkeypatch):
    configure(monkeypatch)

    def respond(request):
        raise httpx.ReadTimeout("private-details")

    with pytest.raises(ReviewError, match="timed out"):
        asyncio.run(review(REPORT, transport=httpx.MockTransport(respond)))


def test_response_cap(monkeypatch):
    configure(monkeypatch)
    with pytest.raises(ReviewError, match="size limit"):
        asyncio.run(
            review(
                REPORT,
                transport=httpx.MockTransport(
                    lambda request: httpx.Response(200, content=b"x" * 128001)
                ),
            )
        )


@pytest.mark.parametrize(
    "damage", ["excerpt", "span", "severity", "duplicate", "extra", "not-json"]
)
def test_model_output_is_strictly_validated(damage):
    content = deepcopy(CONTENT)
    if damage == "excerpt":
        content["findings"][0]["evidence"]["excerpt"] = "fabricated"
    elif damage == "span":
        content["findings"][0]["evidence"]["line_end"] = 500
    elif damage == "severity":
        content["findings"][0]["proposed_severity"] = "SAFE"
    elif damage == "duplicate":
        content["findings"] *= 2
    elif damage == "extra":
        content["confidence"] = 100
    text = "not-json" if damage == "not-json" else json.dumps(content)
    with pytest.raises(ReviewError):
        parse_content(text, REPORT)


def test_empty_review_is_valid_and_static_candidates_survive(monkeypatch):
    configure(monkeypatch)
    result = asyncio.run(
        review(
            REPORT,
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    json=payload(
                        "converse", {"summary": "No additional candidates.", "findings": []}
                    ),
                )
            ),
        )
    )
    assert result.model_review.findings == []
    assert len(result.static_report.candidates) > 0


def test_truncated_model_output_is_rejected(monkeypatch):
    configure(monkeypatch)
    body = payload("converse")
    body["stopReason"] = "max_tokens"
    with pytest.raises(ReviewError, match="complete review"):
        asyncio.run(
            review(
                REPORT,
                transport=httpx.MockTransport(lambda request: httpx.Response(200, json=body)),
            )
        )


def test_routes_configuration_lock_and_failure_release():
    with TestClient(app, base_url="http://127.0.0.1") as client:
        assert client.get("/api/config").json()["configured"] is False
        assert client.post("/api/reviews", json={"source": SOURCE}).status_code == 503
        assert not review_slot.locked()
        review_slot.acquire()
        try:
            assert client.post("/api/reviews", json={"source": SOURCE}).status_code == 429
        finally:
            review_slot.release()
        assert (
            client.post(
                "/api/reviews",
                json={"source": SOURCE},
                headers={"Origin": "https://foreign.example"},
            ).status_code
            == 403
        )
