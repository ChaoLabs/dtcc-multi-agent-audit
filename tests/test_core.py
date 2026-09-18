import hashlib
import json
from pathlib import Path

import pytest
from audit_core.engine import RULES, analyze
from audit_core.legacy_rules import scan
from audit_core.models import AuditInput, AuditReport
from pydantic import ValidationError

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "contracts/fixtures/originals"
MANIFEST = json.loads((ROOT / "evaluations/cases.json").read_text())
CLEAN = """pragma solidity ^0.8.20;
contract Safe {
    mapping(address => uint256) public balances;
    function withdraw() public {
        uint256 bal = balances[msg.sender];
        balances[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: bal}("");
        require(ok, "transfer failed");
    }
}"""


def vault():
    return AuditInput(filename="Vault.sol", source=(FIXTURES / "vulnerable_vault.sol").read_text())


@pytest.mark.parametrize("case", MANIFEST, ids=lambda case: case["id"])
def test_inherited_fixture_regression(case):
    source = (FIXTURES / case["filename"]).read_text()
    report = analyze(AuditInput(filename=case["filename"], source=source))
    assert set(case["expected_rules"]) <= {item.rule_id for item in report.candidates}
    assert all(item["title"] in RULES for item in scan(source))


def test_vault_has_three_candidates():
    assert len(analyze(vault()).candidates) == 3


def test_empty_result_is_not_safe_claim():
    report = analyze(AuditInput(source=CLEAN))
    assert report.candidates == []
    assert any("does not mean" in item for item in report.limitations)


def test_reproducible_candidate_ids_but_distinct_run_ids():
    first, second = analyze(vault()), analyze(vault())
    assert first.run_id != second.run_id
    assert [item.id for item in first.candidates] == [item.id for item in second.candidates]


def test_source_changes_identity_and_preserves_whitespace():
    data = vault()
    first = analyze(data)
    changed = analyze(AuditInput(source="\n\n" + data.source + "\r\n"))
    assert changed.input.source == "\n\n" + data.source + "\r\n"
    assert first.source_sha256 != changed.source_sha256
    assert first.candidates[0].id != changed.candidates[0].id
    assert changed.candidates[0].evidence.line_start == first.candidates[0].evidence.line_start + 2


@pytest.mark.parametrize(
    "source",
    [
        "contract C { function f() public {",
        "function orphan() external",
        "// comment only",
        "pragma solidity ^0.8.20;\n// </script><script>alert(1)</script>",
    ],
)
def test_uncompiled_text_is_handled_as_data(source):
    assert analyze(AuditInput(source=source)).input.source == source


@pytest.mark.parametrize(
    "source",
    ["", "  \n", "\x00", "a" * 2001, "x\n" * 1201, ("a" * 1000 + "\n") * 49, "\ud800", "a\u2028b"],
)
def test_invalid_source_rejected(source):
    with pytest.raises(ValidationError):
        AuditInput(source=source)


@pytest.mark.parametrize(
    "filename",
    ["../Secret.sol", "a/b.sol", "Contract.txt", "<img>.sol", "../.env", "a" * 81 + ".sol"],
)
def test_unsafe_filenames_rejected(filename):
    with pytest.raises(ValidationError):
        AuditInput(filename=filename, source=CLEAN)


@pytest.mark.parametrize(
    "tamper", ["hash", "excerpt", "line", "identity", "duplicate", "naive-date"]
)
def test_report_integrity_rejects_corruption(tamper):
    data = analyze(vault()).model_dump()
    candidate = data["candidates"][0]
    if tamper == "hash":
        data["source_sha256"] = "0" * 64
    elif tamper == "excerpt":
        candidate["evidence"]["excerpt"] = "fabricated"
    elif tamper == "line":
        candidate["evidence"]["line_end"] = 900
    elif tamper == "identity":
        candidate["id"] = "0" * 24
    elif tamper == "duplicate":
        data["candidates"].append(candidate)
    else:
        data["created_at"] = "2026-09-17T00:00:00"
    with pytest.raises(ValidationError):
        AuditReport.model_validate(data)


def test_no_unexecuted_or_certainty_claims():
    report = analyze(vault())
    assert all(item.disposition == "needs-review" for item in report.candidates)
    assert [stage.status for stage in report.stages] == [
        "completed",
        "not-implemented",
        "not-implemented",
        "not-performed",
    ]
    data = report.model_dump_json()
    assert '"confidence"' not in data and '"owasp"' not in data and '"swc"' not in data
    assert report.source_sha256 == hashlib.sha256(report.input.source.encode()).hexdigest()


def test_utf8_bytes_not_character_count():
    with pytest.raises(ValidationError):
        AuditInput(source=("合" * 1000 + "\n") * 17)


@pytest.mark.parametrize(
    "source,rule_id",
    [
        (
            "pragma solidity ^0.8.20;\ncontract C { function pay(address payable to) public { to.send(1); } }",
            "SC-003",
        ),
        (
            "pragma solidity ^0.8.20;\ncontract C { function f() public { require(block.timestamp > 5); } }",
            "SC-013",
        ),
        (
            "pragma solidity ^0.8.20;\ncontract C { function f() public { while(true) {} } }",
            "SC-015",
        ),
    ],
)
def test_secondary_rules_preserved(source, rule_id):
    assert rule_id in {item.rule_id for item in analyze(AuditInput(source=source)).candidates}


def test_recorded_reports_are_actual_current_outputs():
    from scripts.generate_showcase import generate

    generate(check=True)
