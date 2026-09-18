"""Generate actual static reports + JSON Schema, never invented model outputs."""

import argparse
import ast
import json
from pathlib import Path

from audit_api.review import EnhancedReport
from audit_core.engine import OVERRIDES, RULES, analyze
from audit_core.models import AuditInput, AuditReport

ROOT = Path(__file__).resolve().parents[1]
GENERATED = ROOT / "apps/web/src/generated"


def browser_catalog():
    tree = ast.parse((ROOT / "packages/audit-core/src/audit_core/legacy_rules.py").read_text())
    catalog = {}
    for node in ast.walk(tree):
        if (
            not isinstance(node, ast.Call)
            or not isinstance(node.func, ast.Name)
            or node.func.id != "_finding"
        ):
            continue
        title = ast.literal_eval(node.args[4])
        rule_id, label, category = RULES[title]
        try:
            rationale = ast.literal_eval(node.args[5]).split(" (SWC-")[0]
        except ValueError:
            rationale = (
                f"A function matches the {label.lower()} rule; verify its intended behavior."
            )
        recommendation = ast.literal_eval(node.args[6])
        rationale, recommendation = OVERRIDES.get(rule_id, (rationale, recommendation))
        catalog[rule_id] = {
            "title": label,
            "category": category,
            "proposed_severity": ast.literal_eval(node.args[1]),
            "rationale": rationale,
            "recommendation": recommendation,
        }
    return dict(sorted(catalog.items()))


def generate(check: bool = False):
    manifest = json.loads((ROOT / "evaluations/cases.json").read_text())
    existing = json.loads((GENERATED / "cases.json").read_text()) if check else []
    artifacts = []
    for index, case in enumerate(manifest):
        source = (
            (ROOT / "contracts/fixtures/originals" / case["filename"]).read_bytes().decode("utf-8")
        )
        report = analyze(AuditInput(filename=case["filename"], source=source), execution="recorded")
        actual_rules = {candidate.rule_id for candidate in report.candidates}
        if not set(case["expected_rules"]) <= actual_rules:
            raise AssertionError(f"Regression in {case['id']}: expected title coverage changed")
        if check:
            saved = AuditReport.model_validate(existing[index]["report"])
            report.run_id = saved.run_id
            report.created_at = saved.created_at
        artifacts.append(
            {key: case[key] for key in ("id", "title", "summary", "caveat")}
            | {"report": report.model_dump(mode="json")}
        )
    schema = AuditReport.model_json_schema(mode="serialization")
    extras = {
        "review.schema.json": EnhancedReport.model_json_schema(mode="serialization"),
        "rule-catalog.json": browser_catalog(),
    }
    if check:
        for name, value in extras.items():
            assert json.loads((GENERATED / name).read_text()) == value, f"Stale {name}"
        assert artifacts == existing, "Showcase snapshots are stale: regenerate deliberately"
        assert schema == json.loads((GENERATED / "report.schema.json").read_text()), (
            "Schema is stale"
        )
        print("Showcase and schema match current source and engine.")
    else:
        GENERATED.mkdir(parents=True, exist_ok=True)
        for name, value in [
            ("cases.json", artifacts),
            ("report.schema.json", schema),
            *extras.items(),
        ]:
            (GENERATED / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
        print(f"Generated {len(artifacts)} actual static reports and JSON Schema.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    generate(parser.parse_args().check)
