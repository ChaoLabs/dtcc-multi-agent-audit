"""Versioned source-bound contract shared by the API and generated web types."""

import hashlib
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_SOURCE_BYTES = 48_000
MAX_LINES = 1_200
MAX_LINE_LENGTH = 2_000
ENGINE = "legacy-static-rules"
ENGINE_VERSION = "0.1.0"


class StrictModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid", strict=True, json_schema_serialization_defaults_required=True
    )


class AuditInput(StrictModel):
    filename: str = Field(default="Contract.sol", pattern=r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.sol$")
    source: str = Field(min_length=1, max_length=MAX_SOURCE_BYTES)

    @field_validator("source")
    @classmethod
    def validate_source(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Source must not be blank")
        try:
            encoded = value.encode("utf-8")
        except UnicodeEncodeError as exc:
            raise ValueError("Source must contain valid UTF-8 characters") from exc
        if len(encoded) > MAX_SOURCE_BYTES:
            raise ValueError("Source exceeds 48,000 UTF-8 bytes")
        if any(ord(char) < 32 and char not in "\t\n\r" for char in value):
            raise ValueError("Source contains unsupported control characters")
        if any(char in value for char in ("\u0085", "\u2028", "\u2029")):
            raise ValueError("Use LF or CRLF line separators for this baseline")
        lines = value.splitlines()
        if len(lines) > MAX_LINES or any(len(line) > MAX_LINE_LENGTH for line in lines):
            raise ValueError("Source exceeds 1,200 lines or 2,000 characters per line")
        return value  # No trimming or newline conversion: preserve exact evidence offsets.


class Evidence(StrictModel):
    line_start: int = Field(ge=1)
    line_end: int = Field(ge=1)
    excerpt: str
    validation: Literal["source-bound"] = "source-bound"


class Candidate(StrictModel):
    id: str = Field(pattern=r"^[a-f0-9]{24}$")
    rule_id: str
    title: str
    category: str
    proposed_severity: Literal["HIGH", "MEDIUM", "LOW"]
    disposition: Literal["needs-review"] = "needs-review"
    rationale: str
    recommendation: str
    evidence: Evidence
    origin: Literal["legacy-static-rules", "browser-static-rules"] = ENGINE


class Stage(StrictModel):
    name: Literal["Static rules", "Three-model analysis", "Orchestration", "Human review"]
    status: Literal["completed", "not-implemented", "not-performed"]


class AuditReport(StrictModel):
    schema_version: Literal["1.0.0"] = "1.0.0"
    run_id: str
    created_at: str
    execution: Literal["recorded", "local", "browser"]
    mode: Literal["static"] = "static"
    engine: Literal["legacy-static-rules", "browser-static-rules"] = ENGINE
    engine_version: Literal["0.1.0"] = ENGINE_VERSION
    source_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    input: AuditInput
    candidates: list[Candidate]
    stages: list[Stage]
    limitations: list[str]

    @model_validator(mode="after")
    def validate_integrity(self):
        UUID(self.run_id)
        if datetime.fromisoformat(self.created_at).utcoffset() is None:
            raise ValueError("Run timestamp must include a timezone")
        expected = hashlib.sha256(self.input.source.encode("utf-8")).hexdigest()
        if expected != self.source_sha256:
            raise ValueError("Source hash does not match snapshot")
        lines = self.input.source.splitlines()
        ids = set()
        for candidate in self.candidates:
            span = candidate.evidence
            if not (1 <= span.line_start <= span.line_end <= len(lines)):
                raise ValueError("Evidence span is outside source")
            if span.excerpt != "\n".join(lines[span.line_start - 1 : span.line_end]):
                raise ValueError("Evidence excerpt does not match source")
            expected_id = candidate_id(expected, candidate.rule_id, span.line_start, self.engine)
            if candidate.origin != self.engine:
                raise ValueError("Candidate engine does not match report")
            if candidate.id != expected_id or candidate.id in ids:
                raise ValueError("Invalid or duplicate candidate identity")
            ids.add(candidate.id)
        return self


def candidate_id(source_hash: str, rule_id: str, line: int, engine: str = ENGINE) -> str:
    material = f"{engine}@{ENGINE_VERSION}|{source_hash}|{rule_id}|{line}"
    return hashlib.sha256(material.encode()).hexdigest()[:24]
