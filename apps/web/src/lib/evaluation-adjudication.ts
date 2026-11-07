import { EVALUATION_CASES, type EvaluationReport } from "@/lib/evaluation";
import type { CouncilReport } from "@/lib/orchestration";
import { secondReviewBaselineHash } from "@/lib/second-review";

/** Human decisions are evidence, never generated from model agreement. */
export type HumanFindingLabel = {
  finding_id: string;
  verdict: "confirmed" | "refuted" | "uncertain" | "unreviewed";
  reference_id: string | null;
  rationale: string;
};
export type ReferenceIssue = {
  id: string;
  title: string;
  category: string;
  line_start: number;
  line_end: number;
  rationale: string;
};
export type AdjudicatedCase = {
  case_id: string;
  source_sha256: string;
  baseline_sha256: string;
  inventory_complete: boolean;
  inventory_rationale: string;
  reference_issues: ReferenceIssue[];
  findings: HumanFindingLabel[];
};
export type HumanAdjudication = {
  schema_version: "1.0.0";
  reviewer: string;
  cases: AdjudicatedCase[];
};
export type AccuracyCounts = {
  true_positives: number;
  false_positives: number;
  false_negatives: number | null;
  unreviewed_predictions: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
};
export type AdjudicationComparison = {
  cases: number;
  model_slots: number;
  excluded_model_slots: number;
  reference_inventory_complete: boolean;
  second_round_judgments: {
    supported: number;
    not_supported: number;
    uncertain: number;
    retained_first_round_supports: number;
  } | null;
  first_round: AccuracyCounts;
  after_review: AccuracyCounts | null;
  interpretation: string;
};

const fail = () => {
  throw new Error(
    "The human review file is invalid or does not match this run. Use its downloaded template and keep the source and baseline hashes unchanged.",
  );
};
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function exact(value: Record<string, unknown>, expected: string[]) {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}
const text = (
  value: unknown,
  maximum: number,
  empty = false,
): value is string =>
  typeof value === "string" &&
  (empty || value.trim().length > 0) &&
  value.length <= maximum &&
  !/bedrock-api-key-|[\u0000-\u0008\u000b\u000c\u000e-\u001f]/i.test(value);
const identity = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);

export async function createAdjudicationTemplate(
  report: EvaluationReport,
): Promise<HumanAdjudication> {
  return {
    schema_version: "1.0.0",
    reviewer: "",
    cases: await Promise.all(
      report.cases.flatMap((entry) =>
        entry.report
          ? [
              (async () => ({
                case_id: entry.id,
                source_sha256: entry.source_sha256,
                baseline_sha256: await secondReviewBaselineHash(
                  entry.report!,
                  EVALUATION_CASES.find((item) => item.id === entry.id)!.source,
                ),
                inventory_complete: false,
                inventory_rationale: "",
                reference_issues: [],
                findings: entry.report!.findings.map((finding) => ({
                  finding_id: finding.id,
                  verdict: "unreviewed" as const,
                  reference_id: null,
                  rationale: "",
                })),
              }))(),
            ]
          : [],
      ),
    ),
  };
}

/** Labels bind to the exact independent run, not merely the same contract name. */
export async function validateAdjudication(
  value: unknown,
  report: EvaluationReport,
): Promise<HumanAdjudication> {
  if (
    !object(value) ||
    !exact(value, ["schema_version", "reviewer", "cases"]) ||
    value.schema_version !== "1.0.0" ||
    !text(value.reviewer, 120, true) ||
    !Array.isArray(value.cases)
  )
    return fail();
  const expected = await createAdjudicationTemplate(report);
  if (value.cases.length !== expected.cases.length) return fail();
  const seen = new Set<string>();
  for (const candidate of value.cases) {
    if (
      !object(candidate) ||
      !exact(candidate, [
        "case_id",
        "source_sha256",
        "baseline_sha256",
        "inventory_complete",
        "inventory_rationale",
        "reference_issues",
        "findings",
      ]) ||
      typeof candidate.case_id !== "string" ||
      seen.has(candidate.case_id)
    )
      return fail();
    seen.add(candidate.case_id);
    const original = expected.cases.find(
      (item) => item.case_id === candidate.case_id,
    );
    const fixture = EVALUATION_CASES.find(
      (item) => item.id === candidate.case_id,
    );
    if (
      !original ||
      !fixture ||
      candidate.source_sha256 !== original.source_sha256 ||
      candidate.baseline_sha256 !== original.baseline_sha256 ||
      typeof candidate.inventory_complete !== "boolean" ||
      !text(
        candidate.inventory_rationale,
        4000,
        !candidate.inventory_complete,
      ) ||
      !Array.isArray(candidate.reference_issues) ||
      candidate.reference_issues.length > 100 ||
      !Array.isArray(candidate.findings) ||
      candidate.findings.length !== original.findings.length
    )
      return fail();
    const issues = new Set<string>();
    for (const issue of candidate.reference_issues) {
      if (
        !object(issue) ||
        !exact(issue, [
          "id",
          "title",
          "category",
          "line_start",
          "line_end",
          "rationale",
        ]) ||
        !identity(issue.id) ||
        issues.has(issue.id) ||
        !text(issue.title, 240) ||
        !text(issue.category, 80) ||
        !text(issue.rationale, 4000) ||
        !Number.isSafeInteger(issue.line_start) ||
        !Number.isSafeInteger(issue.line_end) ||
        (issue.line_start as number) < 1 ||
        (issue.line_end as number) < (issue.line_start as number) ||
        (issue.line_end as number) > fixture.source.split("\n").length
      )
        return fail();
      issues.add(issue.id);
    }
    const findingIds = new Set<string>();
    for (const label of candidate.findings) {
      if (
        !object(label) ||
        !exact(label, ["finding_id", "verdict", "reference_id", "rationale"]) ||
        typeof label.finding_id !== "string" ||
        findingIds.has(label.finding_id) ||
        !original.findings.some(
          (item) => item.finding_id === label.finding_id,
        ) ||
        !["confirmed", "refuted", "uncertain", "unreviewed"].includes(
          String(label.verdict),
        ) ||
        !text(label.rationale, 4000, label.verdict === "unreviewed")
      )
        return fail();
      findingIds.add(label.finding_id);
      if (label.verdict === "confirmed") {
        if (
          typeof label.reference_id !== "string" ||
          !issues.has(label.reference_id)
        )
          return fail();
      } else if (label.reference_id !== null) return fail();
      if (label.verdict !== "unreviewed" && !value.reviewer.trim())
        return fail();
    }
    if (candidate.inventory_complete && !value.reviewer.trim()) return fail();
    if (candidate.reference_issues.length && !value.reviewer.trim())
      return fail();
  }
  return structuredClone(value) as HumanAdjudication;
}

type Accumulator = {
  tp: number;
  fp: number;
  fn: number;
  unknown: number;
  complete: boolean;
};
function countPredictions(
  acc: Accumulator,
  predicted: string[],
  labels: AdjudicatedCase,
) {
  const detected = new Set<string>();
  for (const id of predicted) {
    const label = labels.findings.find((item) => item.finding_id === id)!;
    if (label.verdict === "confirmed") detected.add(label.reference_id!);
    else if (label.verdict === "refuted") acc.fp++;
    else acc.unknown++;
  }
  acc.tp += detected.size;
  acc.fn += labels.reference_issues.filter(
    (issue) => !detected.has(issue.id),
  ).length;
  acc.complete &&= labels.inventory_complete;
}
function counts(acc: Accumulator): AccuracyCounts {
  const precision =
    !acc.unknown && acc.tp + acc.fp > 0 ? acc.tp / (acc.tp + acc.fp) : null;
  const recall =
    acc.complete && !acc.unknown && acc.tp + acc.fn > 0
      ? acc.tp / (acc.tp + acc.fn)
      : null;
  return {
    true_positives: acc.tp,
    false_positives: acc.fp,
    false_negatives: acc.complete && !acc.unknown ? acc.fn : null,
    unreviewed_predictions: acc.unknown,
    precision,
    recall,
    f1:
      precision !== null && recall !== null
        ? precision + recall === 0
          ? 0
          : (2 * precision * recall) / (precision + recall)
        : null,
  };
}
const firstPredictions = (baseline: CouncilReport, modelId: string) =>
  baseline.findings
    .filter((finding) => finding.supporting_models.includes(modelId))
    .map((finding) => finding.id);

/** Micro-average model/issue pairs. Equal model cohorts prevent outages appearing as improvement. */
export function compareAdjudicatedRun(
  report: EvaluationReport,
  adjudication: HumanAdjudication,
): AdjudicationComparison {
  const before: Accumulator = {
    tp: 0,
    fp: 0,
    fn: 0,
    unknown: 0,
    complete: true,
  };
  const after: Accumulator = { ...before };
  let cases = 0,
    slots = 0,
    excluded = 0;
  const paired = report.review_mode === "paired-second-review";
  const judgments = {
    supported: 0,
    not_supported: 0,
    uncertain: 0,
    retained_first_round_supports: 0,
  };
  for (const entry of report.cases) {
    const labels = adjudication.cases.find((item) => item.case_id === entry.id);
    if (!entry.report || !labels) {
      excluded += 3;
      continue;
    }
    if (paired && !entry.second_review) {
      excluded += 3;
      continue;
    }
    let used = false;
    for (const model of entry.report.models) {
      const secondModel = entry.second_review?.models.find(
        (run) => run.model_id === model.model_id,
      );
      const expectedSecond = entry.second_review?.plan.model_ids.includes(
        model.model_id,
      );
      if (
        model.status !== "succeeded" ||
        (paired && expectedSecond && secondModel?.status !== "succeeded")
      ) {
        excluded++;
        continue;
      }
      used = true;
      slots++;
      const predicted = firstPredictions(entry.report, model.model_id);
      countPredictions(before, predicted, labels);
      if (paired) {
        const effective = new Set(predicted);
        judgments.retained_first_round_supports += predicted.filter(
          (id) =>
            !secondModel?.review?.assessments.some(
              (assessment) => assessment.finding_id === id,
            ),
        ).length;
        for (const assessment of secondModel?.review?.assessments ?? []) {
          judgments[assessment.verdict]++;
          if (assessment.verdict === "supported")
            effective.add(assessment.finding_id);
          else effective.delete(assessment.finding_id);
        }
        countPredictions(after, [...effective], labels);
      }
    }
    if (used) cases++;
  }
  if (!slots) {
    before.complete = false;
    after.complete = false;
  }
  return {
    cases,
    model_slots: slots,
    excluded_model_slots: excluded,
    reference_inventory_complete: before.complete,
    second_round_judgments: paired ? judgments : null,
    first_round: counts(before),
    after_review: paired ? counts(after) : null,
    interpretation:
      "Micro-averaged model/issue pairs on the same eligible model cohort. Confirmed duplicate claims count once per reference issue per model. Missing or failed reviews are excluded, never treated as rejection. Uncertain judgments are abstentions, not positive detections or explicit rejections. Their count is reported separately; fewer positive predictions alone does not demonstrate improved accuracy. Precision requires all positive predictions adjudicated; recall and false negatives additionally require a complete human reference inventory. Five familiar contracts are a regression set, not independent proof of general accuracy.",
  };
}

export function downloadReviewJSON(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
