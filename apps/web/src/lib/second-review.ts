import type { ModelReview, ReviewFinding } from "@/generated/review";
import { BEDROCK } from "@/lib/bedrock-config";
import {
  validateCouncil,
  type CouncilReport,
  type ModelAttempt,
} from "@/lib/orchestration";
import {
  REVIEW_POLICY,
  LEGACY_REVIEW_POLICY,
  PREVIOUS_REVIEW_POLICY,
  validRecordedDeadlines,
  reviewDeadlines,
} from "@/lib/review-policy";
import { sha256, sourceLines } from "@/lib/static-analysis";

export const SECOND_REVIEW_POLICY_VERSION =
  "targeted-peer-review-v6-output-recovery" as const;
export const PREVIOUS_SECOND_REVIEW_POLICY_VERSION =
  "targeted-peer-review-v5-extended-recovery" as const;
export const SECOND_REVIEW_PROMPT_VERSION =
  "targeted-peer-review-v7-bounded-evidence-correction-grok-medium" as const;
export const SECOND_REVIEW_POLICY = Object.freeze({
  ...REVIEW_POLICY,
  max_candidates: 12,
  max_rounds: 1,
} as const);

export type SecondReviewPlan = {
  model_ids: string[];
  candidate_ids: string[];
  deferred_ids: string[];
  /** Present in v1.1; only these per-model claims may be returned. */
  assignments?: { model_id: string; candidate_ids: string[] }[];
  /** Successful first-round models with no actionable peer omissions or severity disputes. */
  unassigned_model_ids?: string[];
  skipped_reason:
    | "no_disagreements"
    | "insufficient_reviewers"
    | "no_eligible_assignments"
    | null;
};
export type SecondReviewAssessment = {
  finding_id: string;
  verdict: "supported" | "not_supported" | "uncertain";
  proposed_severity: ReviewFinding["proposed_severity"] | null;
  rationale: string;
  evidence: ReviewFinding["evidence"];
};
export type SecondReviewContent = {
  summary: string;
  assessments: SecondReviewAssessment[];
};
export type SecondReviewModelReview = Omit<ModelReview, "findings"> &
  SecondReviewContent;
export type SecondReviewModelRun = {
  model_id: string;
  label: string;
  status: "succeeded" | "failed";
  elapsed_ms: number;
  review: SecondReviewModelReview | null;
  error: { code: string; detail: string } | null;
  attempts: ModelAttempt[];
};
export type SecondReviewExecution = {
  max_attempts_per_model: 2 | 3;
  model_timeout_ms: number;
  overall_timeout_ms: number;
  total_attempts: number;
};
export type SecondReviewSummary = {
  finding_id: string;
  status: "supported" | "not_supported" | "unresolved";
  supporting_models: string[];
  not_supported_models: string[];
  uncertain_models: string[];
  missing_models: string[];
  severity_disagreement: boolean;
  proposed_severity: ReviewFinding["proposed_severity"] | null;
  deferred: boolean;
};
export type SecondReviewReport = {
  schema_version: "1.0.0" | "1.1.0";
  engine: "peer-informed-reassessment";
  policy_version:
    | typeof SECOND_REVIEW_POLICY_VERSION
    | typeof PREVIOUS_SECOND_REVIEW_POLICY_VERSION
    | "targeted-peer-review-v4-validation-correction"
    | "targeted-peer-review-v3-network-recovery"
    | "targeted-peer-review-v2"
    | "bounded-second-review-v1";
  prompt_version:
    | typeof SECOND_REVIEW_PROMPT_VERSION
    | "targeted-peer-review-v6-stable-slots-grok-medium"
    | "targeted-peer-review-v5-source-spans-grok-medium"
    | "targeted-peer-review-v4-slots"
    | "targeted-peer-review-v3-source-spans"
    | "targeted-peer-review-v2"
    | "peer-informed-review-v1";
  source_sha256: string;
  baseline_sha256: string;
  created_at: string;
  elapsed_ms: number;
  rounds_used: 0 | 1;
  status: "completed" | "partial" | "failed" | "skipped";
  plan: SecondReviewPlan;
  execution: SecondReviewExecution;
  models: SecondReviewModelRun[];
  findings: SecondReviewSummary[];
};

/** The prompt version records how citations were supplied, without relabeling old reports. */
export function secondReviewEvidenceMethod(
  report: Pick<SecondReviewReport, "prompt_version">,
  modelId: string,
) {
  return report.prompt_version === SECOND_REVIEW_PROMPT_VERSION ||
    report.prompt_version ===
      "targeted-peer-review-v6-stable-slots-grok-medium" ||
    report.prompt_version ===
      "targeted-peer-review-v5-source-spans-grok-medium" ||
    ((report.prompt_version === "targeted-peer-review-v4-slots" ||
      report.prompt_version === "targeted-peer-review-v3-source-spans") &&
      modelId === "us.xai.grok-4.7")
    ? "Model-selected lines; excerpt retrieved from the submitted source."
    : "Model-provided excerpt; exact match to the submitted source.";
}

/** Record configured effort without assigning new settings to historical requests. */
export function secondReviewReasoningEffort(
  report: Pick<SecondReviewReport, "prompt_version">,
  modelId: string,
) {
  return (report.prompt_version === SECOND_REVIEW_PROMPT_VERSION ||
    report.prompt_version ===
      "targeted-peer-review-v6-stable-slots-grok-medium" ||
    report.prompt_version ===
      "targeted-peer-review-v5-source-spans-grok-medium") &&
    modelId === "us.xai.grok-4.7"
    ? "medium"
    : "provider default";
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return (
    actual.length === sorted.length &&
    actual.every((key, i) => key === sorted[i])
  );
}
function integer(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
  );
}
const duration = (value: unknown): value is number =>
  integer(value, 0, 3_600_000);
const text = (value: unknown, maximum: number): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= maximum &&
  !/bedrock-api-key-/i.test(value);
const code = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(value);
function timestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/** Sorting object keys preserves array order and all original provenance. */
export function canonicalReviewJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalReviewJson).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalReviewJson(value[key])}`)
      .join(",")}}`;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return JSON.stringify(value);
  throw new Error("Non-JSON review data.");
}
function same(actual: unknown, expected: unknown) {
  return canonicalReviewJson(actual) === canonicalReviewJson(expected);
}

/** Call only on a validated baseline. No previous findings or votes are changed. */
function legacySecondReviewPlan(baseline: CouncilReport): SecondReviewPlan {
  if (baseline.schema_version !== "2.1.0")
    throw new Error("Second review requires a version 2.1 first-round report.");
  const queued = baseline.review_queue.map((item) => item.finding_id);
  const eligible = baseline.models
    .filter((model) => model.status === "succeeded")
    .map((model) => model.model_id);
  if (eligible.length < 2)
    return {
      model_ids: [],
      candidate_ids: [],
      deferred_ids: queued,
      skipped_reason: "insufficient_reviewers",
    };
  if (!queued.length)
    return {
      model_ids: [],
      candidate_ids: [],
      deferred_ids: [],
      skipped_reason: "no_disagreements",
    };
  return {
    model_ids: eligible,
    candidate_ids: queued.slice(0, SECOND_REVIEW_POLICY.max_candidates),
    deferred_ids: queued.slice(SECOND_REVIEW_POLICY.max_candidates),
    skipped_reason: null,
  };
}

/** Muxiang's second iteration: ask each successful model about claims it omitted.
 * Severity disagreements are an explicit extension requiring the involved reviewers.
 * Never call a model with an empty assignment or resurrect a failed first round.
 */
export function buildSecondReviewPlan(
  baseline: CouncilReport,
): SecondReviewPlan {
  const legacy = legacySecondReviewPlan(baseline);
  const eligible = baseline.models
    .filter((run) => run.status === "succeeded")
    .map((run) => run.model_id);
  if (legacy.skipped_reason)
    return { ...legacy, assignments: [], unassigned_model_ids: eligible };
  const actionable = baseline
    .review_queue!.filter(
      (item) =>
        item.reasons.includes("severity_disagreement") ||
        item.not_reported_models.length > 0,
    )
    .map((item) => item.finding_id);
  const candidate_ids = actionable.slice(
    0,
    SECOND_REVIEW_POLICY.max_candidates,
  );
  const assignments = eligible
    .map((model_id) => ({
      model_id,
      candidate_ids: candidate_ids.filter((id) => {
        const finding = baseline.findings.find((item) => item.id === id)!;
        return (
          finding.severity_disagreement ||
          !finding.supporting_models.includes(model_id)
        );
      }),
    }))
    .filter((item) => item.candidate_ids.length > 0);
  return {
    model_ids: assignments.map((item) => item.model_id),
    candidate_ids,
    deferred_ids: baseline
      .review_queue!.map((item) => item.finding_id)
      .filter((id) => !candidate_ids.includes(id)),
    assignments,
    unassigned_model_ids: eligible.filter(
      (id) => !assignments.some((item) => item.model_id === id),
    ),
    skipped_reason: assignments.length ? null : "no_eligible_assignments",
  };
}

/** Legacy records assigned all selected claims to every model. */
export function assignedSecondReviewCandidates(
  plan: SecondReviewPlan,
  modelId: string,
): string[] {
  if (!plan.model_ids.includes(modelId)) return [];
  return (
    plan.assignments?.find((item) => item.model_id === modelId)
      ?.candidate_ids ?? plan.candidate_ids
  );
}

async function checkedBaseline(value: unknown, source: string) {
  const baseline = await validateCouncil(value, source);
  if (baseline.schema_version !== "2.1.0")
    throw new Error("Second review requires a version 2.1 first-round report.");
  return baseline;
}
export async function secondReviewBaselineHash(
  baseline: unknown,
  source: string,
) {
  return sha256(canonicalReviewJson(await checkedBaseline(baseline, source)));
}

/** Full local schema. Provider grammars may omit quantitative bounds; our validator never does. */
export function secondReviewResponseSchema(candidateIds: string[]) {
  checkCandidateIds(candidateIds);
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "assessments"],
    properties: {
      summary: { type: "string", minLength: 1, maxLength: 2000 },
      assessments: {
        type: "array",
        minItems: candidateIds.length,
        maxItems: candidateIds.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "finding_id",
            "verdict",
            "proposed_severity",
            "rationale",
            "evidence",
          ],
          properties: {
            finding_id: { type: "string", enum: [...candidateIds] },
            verdict: {
              type: "string",
              enum: ["supported", "not_supported", "uncertain"],
            },
            proposed_severity: {
              type: ["string", "null"],
              enum: ["HIGH", "MEDIUM", "LOW", null],
            },
            rationale: { type: "string", minLength: 1, maxLength: 3000 },
            evidence: {
              type: "object",
              additionalProperties: false,
              required: ["line_start", "line_end", "excerpt"],
              properties: {
                line_start: { type: "integer", minimum: 1 },
                line_end: { type: "integer", minimum: 1 },
                excerpt: { type: "string", minLength: 1, maxLength: 12000 },
              },
            },
          },
        },
      },
    },
  };
}

function checkCandidateIds(ids: string[]) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > SECOND_REVIEW_POLICY.max_candidates ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== "string" || !/^[a-f0-9]{24}$/.test(id))
  )
    throw new Error("Invalid assigned second-review candidates.");
}

/** Public diagnostics contain only application-authored rules and bounded indices. */
export class SecondReviewValidationError extends Error {}

function checkContent(
  value: unknown,
  source: string,
  candidateIds: string[],
  bound: boolean,
): SecondReviewContent {
  checkCandidateIds(candidateIds);
  if (
    !object(value) ||
    !keys(value, ["summary", "assessments"]) ||
    !text(value.summary, 2000) ||
    !Array.isArray(value.assessments) ||
    value.assessments.length !== candidateIds.length
  )
    throw new SecondReviewValidationError(
      "Return a non-empty summary and exactly one assessment per assigned claim.",
    );
  const lines = sourceLines(source);
  const seen = new Set<string>();
  const assessments = value.assessments.map(
    (entry, index): SecondReviewAssessment => {
      const field = `assessments[${index}]`;
      if (
        !object(entry) ||
        !keys(entry, [
          "finding_id",
          "verdict",
          "proposed_severity",
          "rationale",
          "evidence",
        ]) ||
        typeof entry.finding_id !== "string" ||
        !candidateIds.includes(entry.finding_id) ||
        !["supported", "not_supported", "uncertain"].includes(
          entry.verdict as string,
        ) ||
        !text(entry.rationale, 3000)
      )
        throw new SecondReviewValidationError(
          `${field} must use an assigned claim ID, a permitted verdict and a non-empty rationale.`,
        );
      if (seen.has(entry.finding_id))
        throw new SecondReviewValidationError(
          `${field}.finding_id duplicates another assessment. Return every assigned claim exactly once.`,
        );
      seen.add(entry.finding_id);
      if (
        entry.verdict === "supported"
          ? !["HIGH", "MEDIUM", "LOW"].includes(
              entry.proposed_severity as string,
            )
          : entry.proposed_severity !== null
      )
        throw new SecondReviewValidationError(
          `${field}.proposed_severity must be HIGH, MEDIUM or LOW for supported; it must be null for not_supported or uncertain.`,
        );
      const evidence = entry.evidence;
      if (
        !object(evidence) ||
        !keys(evidence, [
          "line_start",
          "line_end",
          "excerpt",
          ...(bound ? ["validation"] : []),
        ])
      )
        throw new SecondReviewValidationError(
          `${field}.evidence has missing or unexpected fields.`,
        );
      if (
        !integer(evidence.line_start, 1, lines.length) ||
        !integer(
          evidence.line_end,
          evidence.line_start,
          Math.min(lines.length, evidence.line_start + 11),
        )
      )
        throw new SecondReviewValidationError(
          `${field}.evidence must cite 1 to 12 complete source lines using in-range, ascending line numbers.`,
        );
      if (!text(evidence.excerpt, 12000))
        throw new SecondReviewValidationError(
          `${field}.evidence.excerpt must be non-empty and at most 12000 characters.`,
        );
      if (
        evidence.excerpt !==
        lines.slice(evidence.line_start - 1, evidence.line_end).join("\n")
      )
        throw new SecondReviewValidationError(
          `${field}.evidence.excerpt does not exactly match the cited source lines, including whitespace.`,
        );
      if (bound && evidence.validation !== "source-bound")
        throw new SecondReviewValidationError(
          `${field}.evidence has an invalid source-binding annotation.`,
        );
      return {
        finding_id: entry.finding_id,
        verdict: entry.verdict as SecondReviewAssessment["verdict"],
        proposed_severity:
          entry.proposed_severity as SecondReviewAssessment["proposed_severity"],
        rationale: entry.rationale,
        evidence: {
          line_start: evidence.line_start,
          line_end: evidence.line_end,
          excerpt: evidence.excerpt,
          validation: "source-bound",
        },
      };
    },
  );
  // All assessments are present exactly once. Preserve a deterministic ID order.
  return {
    summary: value.summary,
    assessments: candidateIds.map((id) =>
      assessments.find((entry) => entry.finding_id === id)!,
    ),
  };
}

/** The model supplies three evidence fields; only the application stamps source binding. */
export function bindSecondReviewContent(
  value: unknown,
  source: string,
  candidateIds: string[],
) {
  return checkContent(value, source, candidateIds, false);
}
export const validateSecondReviewContent = bindSecondReviewContent;

type SecondPolicy = SecondReviewReport["policy_version"];
function secondPolicy(version: SecondPolicy) {
  const outputRecovery = version === SECOND_REVIEW_POLICY_VERSION;
  const extendedRecovery =
    outputRecovery || version === PREVIOUS_SECOND_REVIEW_POLICY_VERSION;
  const validationCorrection =
    extendedRecovery ||
    version === "targeted-peer-review-v4-validation-correction";
  const networkRecovery =
    validationCorrection ||
    version === "targeted-peer-review-v3-network-recovery";
  const limits = outputRecovery
    ? { ...REVIEW_POLICY, ...reviewDeadlines(false) }
    : extendedRecovery
      ? PREVIOUS_REVIEW_POLICY
      : LEGACY_REVIEW_POLICY;
  return {
    outputRecovery,
    extendedRecovery,
    validationCorrection,
    networkRecovery,
    limits,
  };
}

function checkAttempts(
  model: SecondReviewModelRun,
  policy: ReturnType<typeof secondPolicy>,
) {
  const {
    networkRecovery,
    validationCorrection,
    extendedRecovery,
    limits,
    outputRecovery,
  } = policy;
  const attempts = model.attempts;
  if (!Array.isArray(attempts) || attempts.length > (extendedRecovery ? 3 : 2))
    throw new Error("Invalid second-review attempt history.");
  const timedOut =
    model.status === "failed" &&
    ["timeout", "cancelled"].includes(model.error?.code ?? "");
  if (!attempts.length) {
    if (!timedOut)
      throw new Error(
        "A model without requests must have an explicit timeout.",
      );
    return;
  }
  let elapsed = 0;
  let retriedOutputLimit = false;
  for (const [i, attempt] of attempts.entries()) {
    if (
      !object(attempt) ||
      !keys(attempt, [
        "attempt",
        "status",
        "elapsed_ms",
        "error_code",
        "retry_delay_ms",
      ]) ||
      attempt.attempt !== i + 1 ||
      !duration(attempt.elapsed_ms) ||
      !integer(
        attempt.retry_delay_ms,
        0,
        networkRecovery ? limits.model_timeout_ms : 5000,
      ) ||
      (i === 0 && attempt.retry_delay_ms !== 0) ||
      !["succeeded", "failed"].includes(attempt.status) ||
      (attempt.status === "succeeded"
        ? attempt.error_code !== null || i !== attempts.length - 1
        : !code(attempt.error_code))
    )
      throw new Error("Invalid second-review attempt history.");
    if (
      i > 0 &&
      (attempts[i - 1].status !== "failed" ||
        ![
          "bedrock_rate_limit",
          "bedrock_unavailable",
          ...(outputRecovery && !retriedOutputLimit ? ["output_limit"] : []),
          ...(networkRecovery ? ["bedrock_network"] : []),
          ...(extendedRecovery ? ["bedrock_model_timeout"] : []),
          ...(validationCorrection
            ? ["invalid_report", "invalid_evidence"]
            : []),
        ].includes(attempts[i - 1].error_code ?? ""))
    )
      throw new Error(
        "This second-review policy does not permit retrying the recorded failure.",
      );
    if (i > 0 && attempts[i - 1].error_code === "output_limit")
      retriedOutputLimit = true;
    elapsed += attempt.elapsed_ms + attempt.retry_delay_ms;
  }
  const last = attempts[attempts.length - 1];
  if (
    elapsed > model.elapsed_ms ||
    last.status !== model.status ||
    (model.status === "failed" &&
      !timedOut &&
      last.error_code !== model.error?.code) ||
    (model.review && model.review.elapsed_ms > last.elapsed_ms)
  )
    throw new Error("Second-review attempts do not match the model outcome.");
}

function checkModels(
  value: unknown,
  source: string,
  baseline: CouncilReport,
  plan: SecondReviewPlan,
  policy: ReturnType<typeof secondPolicy>,
): SecondReviewModelRun[] {
  if (!Array.isArray(value) || value.length !== plan.model_ids.length)
    throw new Error(
      "Every assigned second-review model requires an explicit outcome.",
    );
  const seen = new Set<string>();
  const models: SecondReviewModelRun[] = [];
  for (const entry of value) {
    if (
      !object(entry) ||
      !keys(entry, [
        "model_id",
        "label",
        "status",
        "elapsed_ms",
        "review",
        "error",
        "attempts",
      ]) ||
      typeof entry.model_id !== "string" ||
      !plan.model_ids.includes(entry.model_id) ||
      seen.has(entry.model_id) ||
      !duration(entry.elapsed_ms)
    )
      throw new Error("Invalid second-review model identity.");
    const config = baseline.models.find(
      (model) => model.model_id === entry.model_id,
    )!;
    if (entry.label !== config.label)
      throw new Error("Invalid second-review model label.");
    seen.add(entry.model_id);
    if (entry.status === "succeeded") {
      const review = entry.review;
      if (
        entry.error !== null ||
        !object(review) ||
        !keys(review, [
          "summary",
          "assessments",
          "provider",
          "model_id",
          "region",
          "protocol",
          "source_sha256",
          "created_at",
          "elapsed_ms",
          "input_tokens",
          "output_tokens",
        ]) ||
        review.provider !== "aws-bedrock" ||
        review.model_id !== config.model_id ||
        review.region !== BEDROCK.region ||
        review.protocol !== BEDROCK.protocol ||
        review.source_sha256 !== baseline.source_sha256 ||
        !timestamp(review.created_at) ||
        !duration(review.elapsed_ms) ||
        review.elapsed_ms > entry.elapsed_ms ||
        [review.input_tokens, review.output_tokens].some(
          (count) => count !== null && !integer(count, 0, 10_000_000),
        )
      )
        throw new Error("Invalid second-review provenance.");
      const content = checkContent(
        { summary: review.summary, assessments: review.assessments },
        source,
        assignedSecondReviewCandidates(plan, entry.model_id),
        true,
      );
      if (!same(content.assessments, review.assessments))
        throw new Error("Second-review assessments are not in assigned order.");
    } else if (entry.status === "failed") {
      if (
        entry.review !== null ||
        !object(entry.error) ||
        !keys(entry.error, ["code", "detail"]) ||
        !code(entry.error.code) ||
        !text(entry.error.detail, 1000)
      )
        throw new Error("Invalid failed second-review outcome.");
    } else throw new Error("Invalid second-review model status.");
    checkAttempts(entry as SecondReviewModelRun, policy);
    models.push(entry as SecondReviewModelRun);
  }
  return plan.model_ids.map((id) =>
    models.find((model) => model.model_id === id)!,
  );
}

const severityRank = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
function summaries(
  plan: SecondReviewPlan,
  models: SecondReviewModelRun[],
  baseline: CouncilReport,
  targeted = true,
): SecondReviewSummary[] {
  return [...plan.candidate_ids, ...plan.deferred_ids].map((finding_id) => {
    const entries = models.flatMap((model) => {
      const assessment = model.review?.assessments.find(
        (entry) => entry.finding_id === finding_id,
      );
      return assessment ? [{ model_id: model.model_id, assessment }] : [];
    });
    // Existing authors retain an explicitly first-round opinion when no task was assigned.
    // This is carried support, never a fabricated second-round confirmation.
    if (targeted && !plan.deferred_ids.includes(finding_id)) {
      const original = baseline.findings.find(
        (finding) => finding.id === finding_id,
      )!;
      for (const modelId of original.supporting_models) {
        if (assignedSecondReviewCandidates(plan, modelId).includes(finding_id))
          continue;
        const member = original.members.find(
          (item) => item.model_id === modelId,
        )!;
        const finding = baseline.models.find((run) => run.model_id === modelId)!
          .review!.findings[member.finding_index];
        entries.push({
          model_id: modelId,
          assessment: {
            finding_id,
            verdict: "supported",
            proposed_severity: finding.proposed_severity,
            rationale: finding.rationale,
            evidence: finding.evidence,
          },
        });
      }
    }
    const ids = (verdict: SecondReviewAssessment["verdict"]) =>
      entries
        .filter((entry) => entry.assessment.verdict === verdict)
        .map((entry) => entry.model_id);
    const supporting = ids("supported");
    const rejected = ids("not_supported");
    const uncertain = ids("uncertain");
    const missing = baseline.models
      .filter(
        (model) => !entries.some((entry) => entry.model_id === model.model_id),
      )
      .map((model) => model.model_id);
    const severities = entries.flatMap((entry) =>
      entry.assessment.proposed_severity
        ? [entry.assessment.proposed_severity]
        : [],
    );
    const severityDisagreement = new Set(severities).size > 1;
    const deferred = plan.deferred_ids.includes(finding_id);
    const status =
      !deferred &&
      !missing.length &&
      !uncertain.length &&
      supporting.length === baseline.models.length &&
      (targeted || !severityDisagreement)
        ? ("supported" as const)
        : !deferred &&
            !missing.length &&
            rejected.length === baseline.models.length
          ? ("not_supported" as const)
          : ("unresolved" as const);
    return {
      finding_id,
      status,
      supporting_models: supporting,
      not_supported_models: rejected,
      uncertain_models: uncertain,
      missing_models: missing,
      severity_disagreement: severityDisagreement,
      proposed_severity: severities.length
        ? severities.reduce((selected, severity) =>
            severityRank[severity] > severityRank[selected]
              ? severity
              : selected,
          )
        : null,
      deferred,
    };
  });
}

function checkExecution(
  value: unknown,
  models: SecondReviewModelRun[],
  elapsedMs: number,
  policy: ReturnType<typeof secondPolicy>,
  importing = false,
): SecondReviewExecution {
  const { limits, extendedRecovery, networkRecovery, outputRecovery } = policy;
  if (
    !object(value) ||
    !keys(value, [
      "max_attempts_per_model",
      "model_timeout_ms",
      "overall_timeout_ms",
      "total_attempts",
    ]) ||
    value.max_attempts_per_model !== limits.max_attempts_per_model ||
    !integer(value.model_timeout_ms, 1, limits.model_timeout_ms) ||
    !integer(value.overall_timeout_ms, 1, limits.overall_timeout_ms) ||
    !integer(value.total_attempts, 0, limits.max_provider_requests) ||
    value.total_attempts !==
      models.reduce((count, model) => count + model.attempts.length, 0) ||
    models.some((model) => model.elapsed_ms > elapsedMs)
  )
    throw new Error("Invalid second-review execution accounting.");
  if (
    importing &&
    outputRecovery &&
    !validRecordedDeadlines(value.model_timeout_ms, value.overall_timeout_ms)
  )
    throw new Error("Invalid model and round execution deadline combination.");
  if (networkRecovery) {
    const deadline = Math.min(
      value.model_timeout_ms as number,
      value.overall_timeout_ms as number,
    );
    for (const model of models) {
      if (
        extendedRecovery &&
        model.status === "succeeded" &&
        model.elapsed_ms > deadline + 10
      )
        throw new Error(
          "Successful second review exceeds its execution deadline.",
        );
      let beforeAttempt = 0;
      for (const attempt of model.attempts) {
        beforeAttempt += attempt.retry_delay_ms;
        // A provider-directed wait is permitted only inside this round's
        // declared deadline. Elapsed requests and every scheduled wait remain
        // part of the measured model duration checked above.
        if (beforeAttempt >= deadline)
          throw new Error(
            "Second-review retry exceeds its execution deadline.",
          );
        beforeAttempt += attempt.elapsed_ms;
      }
    }
  }
  return value as SecondReviewExecution;
}

function status(
  plan: SecondReviewPlan,
  models: SecondReviewModelRun[],
): SecondReviewReport["status"] {
  if (plan.skipped_reason) return "skipped";
  const count = models.filter((model) => model.status === "succeeded").length;
  return count === models.length
    ? "completed"
    : count === 0
      ? "failed"
      : "partial";
}

/** Builds a separate peer-informed record; the original council is never modified. */
export async function buildSecondReviewReport(
  models: SecondReviewModelRun[],
  source: string,
  baseline: CouncilReport,
  elapsedMs: number,
  execution?: SecondReviewExecution,
): Promise<SecondReviewReport> {
  if (!duration(elapsedMs)) throw new Error("Invalid second-review duration.");
  const original = await checkedBaseline(baseline, source);
  const plan = buildSecondReviewPlan(original);
  const policy = secondPolicy(SECOND_REVIEW_POLICY_VERSION);
  const checked = checkModels(models, source, original, plan, policy);
  const limits = checkExecution(
    execution ?? {
      max_attempts_per_model: SECOND_REVIEW_POLICY.max_attempts_per_model,
      model_timeout_ms: SECOND_REVIEW_POLICY.model_timeout_ms,
      overall_timeout_ms: SECOND_REVIEW_POLICY.overall_timeout_ms,
      total_attempts: checked.reduce(
        (count, model) => count + model.attempts.length,
        0,
      ),
    },
    checked,
    elapsedMs,
    policy,
  );
  return {
    schema_version: "1.1.0",
    engine: "peer-informed-reassessment",
    policy_version: SECOND_REVIEW_POLICY_VERSION,
    prompt_version: SECOND_REVIEW_PROMPT_VERSION,
    source_sha256: original.source_sha256,
    baseline_sha256: await sha256(canonicalReviewJson(original)),
    created_at: new Date().toISOString(),
    elapsed_ms: elapsedMs,
    rounds_used: plan.skipped_reason ? 0 : 1,
    status: status(plan, checked),
    plan,
    execution: limits,
    models: checked,
    findings: summaries(plan, checked, original),
  };
}

/** Recompute every plan, summary and counter against the exact validated first round. */
export async function validateSecondReviewReport(
  value: unknown,
  source: string,
  baseline: CouncilReport,
): Promise<SecondReviewReport> {
  if (
    !object(value) ||
    !keys(value, [
      "schema_version",
      "engine",
      "policy_version",
      "prompt_version",
      "source_sha256",
      "baseline_sha256",
      "created_at",
      "elapsed_ms",
      "rounds_used",
      "status",
      "plan",
      "execution",
      "models",
      "findings",
    ]) ||
    !["1.0.0", "1.1.0"].includes(value.schema_version as string) ||
    value.engine !== "peer-informed-reassessment" ||
    (value.schema_version === "1.1.0"
      ? !(
          ((value.policy_version === SECOND_REVIEW_POLICY_VERSION ||
            value.policy_version === PREVIOUS_SECOND_REVIEW_POLICY_VERSION ||
            value.policy_version ===
              "targeted-peer-review-v4-validation-correction") &&
            value.prompt_version === SECOND_REVIEW_PROMPT_VERSION) ||
          (value.policy_version ===
            "targeted-peer-review-v3-network-recovery" &&
            (value.prompt_version ===
              "targeted-peer-review-v6-stable-slots-grok-medium" ||
              value.prompt_version ===
                "targeted-peer-review-v5-source-spans-grok-medium" ||
              value.prompt_version === "targeted-peer-review-v4-slots")) ||
          (value.policy_version === "targeted-peer-review-v2" &&
            (value.prompt_version === "targeted-peer-review-v3-source-spans" ||
              value.prompt_version === "targeted-peer-review-v2"))
        )
      : value.policy_version !== "bounded-second-review-v1" ||
        value.prompt_version !== "peer-informed-review-v1") ||
    !timestamp(value.created_at) ||
    !duration(value.elapsed_ms)
  )
    throw new Error("Invalid second-review report.");
  const original = await checkedBaseline(baseline, source);
  if (
    value.source_sha256 !== original.source_sha256 ||
    value.baseline_sha256 !== (await sha256(canonicalReviewJson(original)))
  )
    throw new Error(
      "Second review does not match the original report and source.",
    );
  const plan =
    value.schema_version === "1.0.0"
      ? legacySecondReviewPlan(original)
      : buildSecondReviewPlan(original);
  if (
    !same(value.plan, plan) ||
    value.rounds_used !== (plan.skipped_reason ? 0 : 1)
  )
    throw new Error(
      "Second-review plan does not match the original review queue.",
    );
  const policy = secondPolicy(value.policy_version as SecondPolicy);
  const models = checkModels(value.models, source, original, plan, policy);
  checkExecution(value.execution, models, value.elapsed_ms, policy, true);
  if (
    !same(value.models, models) ||
    value.status !== status(plan, models) ||
    !same(
      value.findings,
      summaries(plan, models, original, value.schema_version === "1.1.0"),
    )
  )
    throw new Error(
      "Second-review summaries do not match the validated reassessments.",
    );
  return value as SecondReviewReport;
}
