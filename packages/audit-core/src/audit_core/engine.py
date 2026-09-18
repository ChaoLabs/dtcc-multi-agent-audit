"""Convert inherited rule candidates into evidence-bound, non-certifying reports."""

import hashlib
from datetime import UTC, datetime
from typing import Literal
from uuid import uuid4

from audit_core.legacy_rules import scan
from audit_core.models import AuditInput, AuditReport, Candidate, Evidence, Stage, candidate_id

# Neutral project categories. Historical taxonomy/confidence fields are deliberately omitted.
RULES = {
    "Reentrancy": ("SC-001", "External call before balance update", "State & interactions"),
    "Unchecked low-level call": ("SC-002", "Unchecked low-level call", "External interactions"),
    "Unchecked send": ("SC-003", "Unchecked send", "External interactions"),
    "Arbitrary delegatecall": ("SC-004", "Delegatecall requires review", "Execution authority"),
    "tx.origin authorization": ("SC-005", "tx.origin authorization", "Access control"),
    "selfdestruct present": ("SC-006", "selfdestruct requires review", "Asset lifecycle"),
    "Outdated compiler": ("SC-007", "Legacy compiler declaration", "Compiler configuration"),
    "Missing compiler pragma": ("SC-008", "Missing compiler pragma", "Compiler configuration"),
    "Insecure randomness": ("SC-009", "Block-data randomness candidate", "Economic logic"),
    "Phishing / drain pattern": ("SC-010", "Caller-controlled callback", "External interactions"),
    "Predictable game outcome": ("SC-011", "Predictable game outcome", "Economic logic"),
    "Missing access control": ("SC-012", "Ownership change requires review", "Access control"),
    "Timestamp dependence": ("SC-013", "Timestamp-sensitive logic", "Time assumptions"),
    "Unrestricted asset transfer": ("SC-014", "Asset transfer requires review", "Asset custody"),
    "Potential gas-exhaustion loop": ("SC-015", "Potential unbounded iteration", "Availability"),
}

LIMITATIONS = [
    "Regex baseline only: source has not been compiled; imports and dependencies are not resolved.",
    "Source-bound evidence proves a location, not exploitability or semantic correctness.",
    "Comments, formatting, naming and function-scope heuristics can cause false positives and misses.",
    "All candidates need human review. No findings does not mean the contract is safe.",
    "No Bedrock model, multi-agent orchestration, Slither, bytecode or on-chain state analysis ran.",
    "Severity is a rule-level proposal, not a calibrated probability, loss estimate or risk score.",
]

OVERRIDES = {
    "SC-004": (
        "A delegatecall is present. The rule does not establish that its target is attacker-controlled.",
        "Trace target control, upgrade authorization and storage compatibility before adjudication.",
    ),
    "SC-006": (
        "A selfdestruct expression is present; its chain-specific effects have not been checked.",
        "Review reachability, authorization, asset flow and the target chain's execution semantics.",
    ),
    "SC-009": (
        "Block data occurs in a contract containing randomness-related terms; data flow is unverified.",
        "Trace the randomness source and adversarial influence over outcomes and asset payouts.",
    ),
    "SC-010": (
        "The source calls a method on an interface derived from msg.sender. This may be attack-side code.",
        "Inspect both sides of the callback; do not infer that an external victim is vulnerable.",
    ),
    "SC-014": (
        "A transfer occurs without a guard recognized by the rule. Legitimate payouts may match.",
        "Review intended permissions, recipient selection, preconditions and business invariants.",
    ),
}


def analyze(data: AuditInput, *, execution: Literal["recorded", "local"] = "local") -> AuditReport:
    source_hash = hashlib.sha256(data.source.encode("utf-8")).hexdigest()
    lines = data.source.splitlines()
    candidates = []
    for item in scan(data.source):
        rule_id, title, category = RULES[item["title"]]
        rationale, recommendation = OVERRIDES.get(
            rule_id, (item["message"].split(" (SWC-")[0], item["recommendation"])
        )
        candidates.append(
            Candidate(
                id=candidate_id(source_hash, rule_id, item["line"]),
                rule_id=rule_id,
                title=title,
                category=category,
                proposed_severity=item["severity"],
                rationale=rationale,
                recommendation=recommendation,
                evidence=Evidence(
                    line_start=item["line"], line_end=item["line"], excerpt=lines[item["line"] - 1]
                ),
            )
        )
    return AuditReport(
        run_id=str(uuid4()),
        created_at=datetime.now(UTC).isoformat(),
        execution=execution,
        source_sha256=source_hash,
        input=data,
        candidates=candidates,
        stages=[
            Stage(name="Static rules", status="completed"),
            Stage(name="Three-model analysis", status="not-implemented"),
            Stage(name="Orchestration", status="not-implemented"),
            Stage(name="Human review", status="not-performed"),
        ],
        limitations=LIMITATIONS,
    )
