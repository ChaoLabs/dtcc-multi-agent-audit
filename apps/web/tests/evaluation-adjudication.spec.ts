import { expect, test } from "@playwright/test";
import {
  EVALUATION_CASES,
  evaluationMetrics,
  importEvaluationJSON,
  type EvaluationReport,
} from "../src/lib/evaluation";
import {
  compareAdjudicatedRun,
  createAdjudicationTemplate,
  validateAdjudication,
} from "../src/lib/evaluation-adjudication";
import { PROMPT_VERSION } from "../src/lib/review-policy";
import { buildCouncilReport } from "../src/lib/orchestration";
import {
  syntheticBaseline,
  syntheticSecondReview,
} from "./second-review-fixtures";

async function experiment(paired = true): Promise<EvaluationReport> {
  const cases = await Promise.all(
    EVALUATION_CASES.map(async (fixture) => {
      const baseline = await syntheticBaseline(fixture.source);
      const second = paired
        ? await syntheticSecondReview(fixture.source, baseline)
        : null;
      return {
        id: fixture.id,
        title: fixture.title,
        filename: fixture.filename,
        source_sha256: fixture.source_sha256,
        status: "completed" as const,
        report: baseline,
        error: null,
        elapsed_ms: 10,
        second_review: second,
        second_review_status: second
          ? second.status
          : ("not_requested" as const),
        second_review_error: null,
      };
    }),
  );
  return {
    schema_version: "1.1.0",
    review_mode: paired ? "paired-second-review" : "independent",
    prompt_variant: "baseline",
    prompt_version: PROMPT_VERSION,
    created_at: "2026-10-27T12:00:00.000Z",
    status: "completed",
    elapsed_ms: 50,
    cases,
    metrics: evaluationMetrics(cases),
  };
}
async function confirmed(report: EvaluationReport, complete = true) {
  const labels = await createAdjudicationTemplate(report);
  labels.reviewer = "Synthetic test reviewer";
  for (const entry of labels.cases) {
    entry.inventory_complete = complete;
    entry.inventory_rationale = complete
      ? "Synthetic complete inventory for metric tests only."
      : "";
    entry.reference_issues.push({
      id: "reference-1",
      title: "Synthetic verified issue",
      category: "other",
      line_start: 1,
      line_end: 1,
      rationale:
        "Test-only reference, not a vulnerability claim about the fixture.",
    });
    for (const finding of entry.findings) {
      finding.verdict = "confirmed";
      finding.reference_id = "reference-1";
      finding.rationale = "Synthetic match for testing metric arithmetic only.";
    }
  }
  return validateAdjudication(labels, report);
}

test("review template has no invented labels or complete reference inventories", async () => {
  const report = await experiment();
  const template = await createAdjudicationTemplate(report);
  expect(template.reviewer).toBe("");
  expect(template.cases).toHaveLength(5);
  expect(
    template.cases.every(
      (item) =>
        !item.inventory_complete &&
        !item.reference_issues.length &&
        item.findings.every((finding) => finding.verdict === "unreviewed"),
    ),
  ).toBe(true);
  const checked = await validateAdjudication(template, report);
  const compared = compareAdjudicatedRun(report, checked);
  expect(compared.first_round.precision).toBeNull();
  expect(compared.first_round.recall).toBeNull();
  expect(compared.first_round.false_negatives).toBeNull();
  expect(compared.after_review?.precision).toBeNull();
});

test("paired metric comparison preserves exact baseline and counts model/issue pairs", async () => {
  const report = await experiment();
  const original = JSON.stringify(report);
  const labels = await confirmed(report);
  const compared = compareAdjudicatedRun(report, labels);
  expect(compared.model_slots).toBe(15);
  expect(compared.excluded_model_slots).toBe(0);
  expect(compared.first_round).toMatchObject({
    true_positives: 5,
    false_positives: 0,
    false_negatives: 10,
    precision: 1,
    recall: 1 / 3,
    f1: 0.5,
  });
  expect(compared.after_review).toMatchObject({
    true_positives: 15,
    false_positives: 0,
    false_negatives: 0,
    precision: 1,
    recall: 1,
    f1: 1,
  });
  expect(JSON.stringify(report)).toBe(original);
});

test("incomplete human inventory cannot establish recall or false negatives", async () => {
  const report = await experiment();
  const labels = await confirmed(report, false);
  const compared = compareAdjudicatedRun(report, labels);
  expect(compared.first_round.precision).toBe(1);
  expect(compared.first_round.recall).toBeNull();
  expect(compared.first_round.false_negatives).toBeNull();
  expect(compared.first_round.f1).toBeNull();
  expect(compared.after_review?.recall).toBeNull();
});

test("missed human reference issues contribute false negatives even if no model reported them", async () => {
  const report = await experiment();
  const labels = await confirmed(report);
  for (const entry of labels.cases)
    entry.reference_issues.push({
      id: "missed-issue",
      title: "Synthetic fully missed issue",
      category: "other",
      line_start: 2,
      line_end: 2,
      rationale:
        "Independent synthetic reference for testing false negative accounting.",
    });
  const checked = await validateAdjudication(labels, report);
  const compared = compareAdjudicatedRun(report, checked);
  expect(compared.first_round.false_negatives).toBe(25);
  expect(compared.after_review?.false_negatives).toBe(15);
  expect(compared.after_review?.recall).toBe(0.5);
});

test("failed second-round model is excluded from BOTH sides of paired metrics", async () => {
  const report = await experiment();
  const second = report.cases[0].second_review!;
  // Simulate an already validated failed provider record; no negative verdict is fabricated.
  const run = second.models[0];
  run.status = "failed";
  run.review = null;
  run.error = { code: "bedrock_timeout", detail: "Synthetic timeout." };
  const compared = compareAdjudicatedRun(report, await confirmed(report));
  expect(compared.model_slots).toBe(14);
  expect(compared.excluded_model_slots).toBe(1);
  const firstSupported =
    report.cases[0].report!.findings[0].supporting_models.includes(
      run.model_id,
    );
  expect(compared.first_round.true_positives).toBe(firstSupported ? 4 : 5);
  expect(compared.after_review?.true_positives).toBe(14);
});

test("unavailable second-round cases do not create apparent paired improvement", async () => {
  const report = await experiment();
  report.cases[0].second_review = null;
  report.cases[0].second_review_status = "failed";
  const compared = compareAdjudicatedRun(report, await confirmed(report));
  expect(compared.cases).toBe(4);
  expect(compared.model_slots).toBe(12);
  expect(compared.excluded_model_slots).toBe(3);
});

test("confirmed duplicate candidates count once for a shared reference issue", async () => {
  const report = await experiment(false);
  const original = report.cases[0].report!;
  const models = structuredClone(original.models);
  const first = models[0].review!;
  first.findings.push({
    ...first.findings[0],
    title: "Distinct synthetic title for same adjudicated issue",
  });
  report.cases[0].report = await buildCouncilReport(
    models,
    EVALUATION_CASES[0].source,
    3,
    original.execution,
  );
  expect(report.cases[0].report!.findings).toHaveLength(2);
  const compared = compareAdjudicatedRun(report, await confirmed(report));
  expect(compared.first_round.true_positives).toBe(5);
  expect(compared.first_round.false_negatives).toBe(10);
  expect(compared.after_review).toBeNull();
});

test("human labels reject source mismatch, baseline mismatch, duplicate IDs and ungrounded confirmation", async () => {
  const report = await experiment();
  const labels = await confirmed(report);
  for (const mutate of [
    (value: typeof labels) => {
      value.cases[0].source_sha256 = "0".repeat(64);
    },
    (value: typeof labels) => {
      value.cases[0].baseline_sha256 = "0".repeat(64);
    },
    (value: typeof labels) => {
      value.cases[1] = value.cases[0];
    },
    (value: typeof labels) => {
      value.cases[0].findings[0].reference_id = "nonexistent";
    },
    (value: typeof labels) => {
      value.cases[0].reference_issues[0].line_end = 100000;
    },
    (value: typeof labels) => {
      value.cases[0].reference_issues.push(value.cases[0].reference_issues[0]);
    },
    (value: typeof labels) => {
      value.reviewer = "";
    },
    (value: typeof labels) => {
      value.cases[0].findings[0].rationale = "";
    },
    (value: typeof labels) => {
      value.cases[0].inventory_rationale = "";
    },
  ]) {
    const altered = structuredClone(labels);
    mutate(altered);
    await expect(validateAdjudication(altered, report)).rejects.toThrow(
      "human review file",
    );
  }
});

test("validation JSON import recomputes metrics and performs no requests", async () => {
  const report = await experiment();
  const altered = structuredClone(report);
  altered.metrics.findings = 9999;
  const imported = await importEvaluationJSON(JSON.stringify(altered));
  expect(imported.metrics.findings).toBe(5);
  expect(imported.cases).toEqual(report.cases);
});

test("saved runs reject changed fixtures, credentials, unsupported fields and cross-baseline second reviews", async () => {
  const report = await experiment();
  const badSource = structuredClone(report);
  badSource.cases[0].source_sha256 = "0".repeat(64);
  await expect(
    importEvaluationJSON(JSON.stringify(badSource)),
  ).rejects.toThrow();
  await expect(
    importEvaluationJSON(
      JSON.stringify({ ...report, api_key: "bedrock-api-key-SYNTHETIC" }),
    ),
  ).rejects.toThrow();
  await expect(
    importEvaluationJSON(JSON.stringify({ ...report, unwanted: true })),
  ).rejects.toThrow();
  const wrongBaseline = structuredClone(report);
  wrongBaseline.cases[0].report!.created_at = "2026-10-28T12:00:00.000Z";
  await expect(
    importEvaluationJSON(JSON.stringify(wrongBaseline)),
  ).rejects.toThrow();
  const wrongStatus = structuredClone(report);
  wrongStatus.cases[0].second_review_status = "not_requested";
  await expect(
    importEvaluationJSON(JSON.stringify(wrongStatus)),
  ).rejects.toThrow();
});

test("uncertain second-round judgments remain visible as abstentions, never explicit rejections", async () => {
  const report = await experiment();
  for (const [index, entry] of report.cases.entries()) {
    entry.second_review = await syntheticSecondReview(
      EVALUATION_CASES[index].source,
      entry.report!,
      ["supported", "uncertain", "not_supported"],
    );
  }
  const labels = await confirmed(report);
  const compared = compareAdjudicatedRun(report, labels);
  expect(compared.second_round_judgments).toEqual({
    supported: 0,
    uncertain: 5,
    not_supported: 5,
    retained_first_round_supports: 5,
  });
  expect(compared.after_review?.true_positives).toBe(5);
  expect(compared.after_review?.false_negatives).toBe(10);
  expect(compared.after_review?.recall).toBe(compared.first_round.recall);
});

test("refuted claims remain false positives even when all models agree", async () => {
  const report = await experiment();
  const labels = await createAdjudicationTemplate(report);
  labels.reviewer = "Synthetic reviewer";
  for (const entry of labels.cases) {
    entry.inventory_complete = true;
    entry.inventory_rationale =
      "Synthetic test scope with no verified vulnerabilities.";
    for (const label of entry.findings) {
      label.verdict = "refuted";
      label.rationale =
        "The synthetic claim has no independently verified vulnerability.";
    }
  }
  const compared = compareAdjudicatedRun(
    report,
    await validateAdjudication(labels, report),
  );
  expect(compared.first_round.false_positives).toBe(5);
  expect(compared.after_review?.false_positives).toBe(15);
  expect(compared.after_review?.precision).toBe(0);
  expect(compared.after_review?.recall).toBeNull();
});
