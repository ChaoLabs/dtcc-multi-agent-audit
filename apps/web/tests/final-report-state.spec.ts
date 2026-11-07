import { test, expect } from "@playwright/test";
import { BEDROCK_MODELS } from "../src/lib/bedrock-config";
import { buildCouncilReport } from "../src/lib/orchestration";
import { buildFinalReviewReport } from "../src/lib/final-report";
import {
  buildSecondReviewReport,
  validateSecondReviewReport,
  type SecondReviewAssessment,
} from "../src/lib/second-review";
import {
  downloadSecondReviewReport,
  secondReviewMarkdown,
} from "../src/lib/second-review-export";
import {
  syntheticBaseline,
  syntheticSecondReview,
} from "./second-review-fixtures";

const source = "pragma solidity ^0.8.20;\ncontract TestContract {}\n";
const grok = BEDROCK_MODELS[2].id;

async function severityDispute() {
  const initial = await syntheticBaseline(source);
  const original = initial.models[0].review!.findings[0];
  const models = structuredClone(initial.models);
  models.forEach((model, index) => {
    model.review!.findings = [
      {
        ...structuredClone(original),
        proposed_severity: index === 2 ? "HIGH" : "LOW",
        rationale: `Original accepted rationale from ${model.label}.`,
        recommendation: "Review the affected operation before deployment.",
      },
    ];
  });
  return buildCouncilReport(models, source, 3, initial.execution);
}

async function failedReassessment(
  baseline: Awaited<ReturnType<typeof syntheticBaseline>>,
) {
  const second = await syntheticSecondReview(source, baseline);
  const models = structuredClone(second.models);
  const failed = models.find((model) => model.model_id === grok)!;
  failed.status = "failed";
  failed.review = null;
  failed.error = { code: "timeout", detail: "Model time limit reached." };
  failed.elapsed_ms = 180_000;
  failed.attempts = [
    {
      attempt: 1,
      status: "failed",
      elapsed_ms: 180_000,
      error_code: "timeout",
      retry_delay_ms: 0,
    },
  ];
  return buildSecondReviewReport(models, source, baseline, 180_001);
}

test("final findings follow current severity, retain stable ties, and leave both round records unchanged", async () => {
  const initial = await syntheticBaseline(source);
  const original = initial.models[0].review!.findings[0];
  const models = structuredClone(initial.models);
  for (const [index, model] of models.entries()) {
    model.review!.findings = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].map(
      (title) => ({
        ...structuredClone(original),
        title,
        proposed_severity: index === 2 ? "HIGH" : "LOW",
      }),
    );
  }
  const baseline = await buildCouncilReport(
    models,
    source,
    3,
    initial.execution,
  );
  expect(baseline.findings).toHaveLength(5);
  const before = baseline.findings.map((finding) => finding.id);
  const complete = await syntheticSecondReview(source, baseline);
  const secondModels = structuredClone(complete.models);
  const severities = ["LOW", null, "MEDIUM", "HIGH", "MEDIUM"] as const;
  for (const model of secondModels) {
    for (const assessment of model.review!.assessments) {
      const severity = severities[before.indexOf(assessment.finding_id)];
      assessment.verdict = severity === null ? "not_supported" : "supported";
      assessment.proposed_severity = severity;
    }
  }
  const second = await buildSecondReviewReport(
    secondModels,
    source,
    baseline,
    3,
  );
  const snapshot = JSON.stringify({ baseline, second });
  const final = buildFinalReviewReport(baseline, second);

  expect(final.findings.map((finding) => finding.id)).toEqual([
    before[3],
    before[2],
    before[4],
    before[0],
    before[1],
  ]);
  expect(final.findings.map((finding) => finding.proposed_severity)).toEqual([
    "HIGH",
    "MEDIUM",
    "MEDIUM",
    "LOW",
    null,
  ]);
  expect(final.summary).toMatchObject({
    high: 1,
    medium: 2,
    low: 1,
    unrated: 1,
  });
  expect(JSON.stringify({ baseline, second })).toBe(snapshot);
  expect(await validateSecondReviewReport(second, source, baseline)).toEqual(
    second,
  );
});

test("a failed severity reassessment cannot erase accepted support or lower its retained severity", async () => {
  const baseline = await severityDispute();
  const second = await failedReassessment(baseline);
  const original = JSON.stringify({ baseline, second });
  const final = buildFinalReviewReport(baseline, second);
  const finding = final.findings[0];

  expect(final.schema_version).toBe("1.1.0");
  expect(final.aggregation_policy).toBe("last-valid-opinion-v1");
  expect(finding.first_round_agreement).toBe(3);
  expect(finding.supporting_models).toHaveLength(3);
  expect(finding.proposed_severity).toBe("HIGH");
  expect(finding.severity_disagreement).toBe(true);
  expect(finding.outcome).toBe("supported");
  expect(finding.requires_review).toBe(true);
  expect(finding.pending_reassessment_models).toEqual([grok]);
  expect(finding.retained_after_failed_review_models).toEqual([grok]);
  expect(finding.judgments[2]).toMatchObject({
    first_round: "reported",
    second_round: "failed",
    opinion_source: "first_round",
    effective_verdict: "supported",
    proposed_severity: "HIGH",
    rationale: "Original accepted rationale from Grok 4.7.",
    evidence: baseline.models[2].review!.findings[0].evidence,
  });
  expect(final.summary).toMatchObject({
    total_findings: 1,
    high: 1,
    low: 0,
    requires_review: 1,
    first_round_completed: 3,
    second_round_assigned: 3,
    second_round_completed: 2,
    retained_after_failed_review: 1,
  });
  // The historical round record is separate from the new last-valid projection.
  expect(second.findings[0].supporting_models).toHaveLength(2);
  expect(second.findings[0].proposed_severity).toBe("LOW");
  expect(JSON.stringify({ baseline, second })).toBe(original);
  expect(await validateSecondReviewReport(second, source, baseline)).toEqual(
    second,
  );
});

test("pending review remains visible even when retained severity agrees with both accepted reassessments", async () => {
  const baseline = await severityDispute();
  const raw = await failedReassessment(baseline);
  const models = structuredClone(raw.models);
  for (const model of models)
    for (const assessment of model.review?.assessments ?? [])
      assessment.proposed_severity = "HIGH";
  const second = await buildSecondReviewReport(
    models,
    source,
    baseline,
    raw.elapsed_ms,
  );
  const final = buildFinalReviewReport(baseline, second);
  expect(final.findings[0].outcome).toBe("supported");
  expect(final.findings[0].severity_disagreement).toBe(false);
  expect(final.findings[0].requires_review).toBe(true);
  expect(final.findings[0].pending_reassessment_models).toEqual([grok]);
  expect(final.summary.requires_review).toBe(1);
});

for (const verdict of ["uncertain", "not_supported"] as const) {
  test(`an accepted ${verdict} decision supersedes prior support rather than retaining it`, async () => {
    const baseline = await severityDispute();
    const verdicts: SecondReviewAssessment["verdict"][] = [
      "supported",
      "supported",
      verdict,
    ];
    const second = await syntheticSecondReview(source, baseline, verdicts);
    const final = buildFinalReviewReport(baseline, second);
    const finding = final.findings[0];
    expect(finding.supporting_models).toHaveLength(2);
    expect(finding.judgments[2]).toMatchObject({
      effective_verdict: verdict,
      opinion_source: "second_round",
      proposed_severity: null,
    });
    expect(finding.pending_reassessment_models).toEqual([]);
    expect(finding.retained_after_failed_review_models).toEqual([]);
    expect(finding.proposed_severity).toBe("LOW");
    expect(finding.requires_review).toBe(true);
    expect(final.summary.second_round_completed).toBe(3);
  });
}

test("a failed reviewer that originally omitted a claim remains unknown and gains no synthetic support", async () => {
  const baseline = await syntheticBaseline(source);
  const second = await failedReassessment(baseline);
  const final = buildFinalReviewReport(baseline, second);
  const finding = final.findings[0];
  expect(finding.first_round_agreement).toBe(1);
  expect(finding.supporting_models).toHaveLength(2);
  expect(finding.missing_models).toEqual([grok]);
  expect(finding.pending_reassessment_models).toEqual([grok]);
  expect(finding.retained_after_failed_review_models).toEqual([]);
  expect(finding.judgments[2]).toMatchObject({
    first_round: "not_reported",
    second_round: "failed",
    opinion_source: "none",
    effective_verdict: "unknown",
    evidence: null,
    rationale: null,
    proposed_severity: null,
  });
  expect(final.summary.second_round_assigned).toBe(2);
  expect(final.summary.second_round_completed).toBe(1);
});

test("the final risk report includes readable rationale and actions without rewriting the raw round snapshot", async () => {
  const baseline = await severityDispute();
  const second = await failedReassessment(baseline);
  const markdown = await secondReviewMarkdown(baseline, second);
  expect(markdown.startsWith("# DTCC — Risk report")).toBe(true);
  expect(markdown).toContain("## Risk overview");
  expect(markdown).toContain("Proposed severity: 1 high");
  expect(markdown).toContain("Second Review: 2/3 assigned models completed");
  expect(markdown).toContain("Latest available support: 3/3 models");
  expect(markdown).toContain("| Opinion source | Proposed severity |");
  expect(markdown).toContain(
    "| GPT-6\\.1 Sol | reported | supported | supported | second_round | LOW |",
  );
  expect(markdown).toContain(
    "| Grok 4\\.7 | reported | failed | supported | first_round | HIGH |",
  );
  expect(markdown).toContain("Original accepted rationale from Grok 4\\.7\\.");
  expect(markdown).toContain(
    "Review the affected operation before deployment\\.",
  );
  expect(markdown).toContain("Pending reassessment: Grok 4\\.7");
  expect(markdown).toContain("## Original second-round outcome record");
  expect(markdown).toContain("Recorded supported severity: LOW");
  expect(markdown).not.toContain("Current effective support: 2/3");
  expect(markdown.indexOf("## Risk overview")).toBeLessThan(
    markdown.indexOf("## Original second-round outcome record"),
  );
});

test("explicit unanimous rejection leaves original explanation available without an accepted severity or recommendation", async () => {
  const baseline = await severityDispute();
  const second = await syntheticSecondReview(source, baseline, [
    "not_supported",
    "not_supported",
    "not_supported",
  ]);
  const final = buildFinalReviewReport(baseline, second);
  expect(final.findings[0].outcome).toBe("not_supported");
  expect(final.findings[0].proposed_severity).toBeNull();
  expect(final.summary).toMatchObject({
    high: 0,
    medium: 0,
    low: 0,
    unrated: 1,
  });
  const markdown = await secondReviewMarkdown(baseline, second);
  expect(markdown).toContain(
    "Original recommendation — evaluate before acting",
  );
  expect(markdown).toContain("Original accepted rationale from Grok 4\\.7\\.");
  expect(markdown).toContain(
    "| Grok 4\\.7 | reported | not_supported | not_supported | second_round | Not rated |",
  );
});

test("downloaded JSON versions the new final view while preserving both original rounds byte for byte", async () => {
  const baseline = await severityDispute();
  const second = await failedReassessment(baseline);
  const rawBaseline = JSON.stringify(baseline);
  const rawSecond = JSON.stringify(second);
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const originalCreate = URL.createObjectURL;
  let downloaded: Blob | undefined;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => ({ href: "", download: "", click() {} }) },
  });
  URL.createObjectURL = (blob) => {
    if (!(blob instanceof Blob)) throw new Error("Expected a report Blob.");
    downloaded = blob;
    return "blob:test-final-view";
  };
  try {
    await downloadSecondReviewReport(baseline, second, "json");
    const exported = JSON.parse(await downloaded!.text());
    expect(exported.schema_version).toBe("1.2.0");
    expect(exported.final_report.schema_version).toBe("1.1.0");
    expect(exported.final_report.aggregation_policy).toBe(
      "last-valid-opinion-v1",
    );
    expect(exported.final_report.findings[0].supporting_models).toHaveLength(3);
    expect(
      exported.final_report.findings[0].pending_reassessment_models,
    ).toEqual([grok]);
    expect(exported.second_round.findings[0].supporting_models).toHaveLength(2);
    expect(JSON.stringify(exported.first_round)).toBe(rawBaseline);
    expect(JSON.stringify(exported.second_round)).toBe(rawSecond);
  } finally {
    URL.createObjectURL = originalCreate;
    if (originalDocument)
      Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
