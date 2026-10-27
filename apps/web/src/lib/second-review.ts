import type { ModelReview, ReviewFinding } from "@/generated/review";
import { BEDROCK, BEDROCK_MODELS } from "@/lib/bedrock-config";
import {
  validateCouncil,
  type CouncilReport,
  type ModelAttempt,
} from "@/lib/orchestration";
import { REVIEW_POLICY } from "@/lib/review-policy";
import { sha256, sourceLines } from "@/lib/static-analysis";

export const SECOND_REVIEW_POLICY_VERSION = "bounded-second-review-v1" as const;
export const SECOND_REVIEW_PROMPT_VERSION = "peer-informed-review-v1" as const;
export const SECOND_REVIEW_POLICY = Object.freeze({
  ...REVIEW_POLICY,
  max_candidates: 12,
  max_rounds: 1,
} as const);

export type SecondReviewPlan = {
  model_ids: string[];
  candidate_ids: string[];
  deferred_ids: string[];
  skipped_reason: "no_disagreements" | "insufficient_reviewers" | null;
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
  max_attempts_per_model: 2;
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
  schema_version: "1.0.0";
  engine: "peer-informed-reassessment";
  policy_version: typeof SECOND_REVIEW_POLICY_VERSION;
  prompt_version: typeof SECOND_REVIEW_PROMPT_VERSION;
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
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
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
  return canonical(actual) === canonical(expected);
}

/** Call only on a validated baseline. No previous findings or votes are changed. */
export function buildSecondReviewPlan(
  baseline: CouncilReport,
): SecondReviewPlan {
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
  return sha256(canonical(await checkedBaseline(baseline, source)));
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
    throw new Error("Invalid second-review content.");
  const lines = sourceLines(source);
  const seen = new Set<string>();
  const assessments = value.assessments.map((entry): SecondReviewAssessment => {
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
      seen.has(entry.finding_id) ||
      !["supported", "not_supported", "uncertain"].includes(
        entry.verdict as string,
      ) ||
      !text(entry.rationale, 3000)
    )
      throw new Error("Invalid or duplicate second-review assessment.");
    seen.add(entry.finding_id);
    if (
      entry.verdict === "supported"
        ? !["HIGH", "MEDIUM", "LOW"].includes(entry.proposed_severity as string)
        : entry.proposed_severity !== null
    )
      throw new Error(
        "Severity must be present only for a supported assessment.",
      );
    const evidence = entry.evidence;
    if (
      !object(evidence) ||
      !keys(evidence, [
        "line_start",
        "line_end",
        "excerpt",
        ...(bound ? ["validation"] : []),
      ]) ||
      !integer(evidence.line_start, 1, lines.length) ||
      !integer(
        evidence.line_end,
        evidence.line_start,
        Math.min(lines.length, evidence.line_start + 11),
      ) ||
      !text(evidence.excerpt, 12000) ||
      evidence.excerpt !==
        lines.slice(evidence.line_start - 1, evidence.line_end).join("\n") ||
      (bound && evidence.validation !== "source-bound")
    )
      throw new Error("Second-review evidence does not match the source.");
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
  });
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

function checkAttempts(model: SecondReviewModelRun) {
  const attempts = model.attempts;
  if (!Array.isArray(attempts) || attempts.length > 2)
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
      !integer(attempt.retry_delay_ms, 0, 5000) ||
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
        !["bedrock_rate_limit", "bedrock_unavailable"].includes(
          attempts[i - 1].error_code ?? "",
        ))
    )
      throw new Error(
        "A non-transient second-review failure cannot be retried.",
      );
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
  sourceHash: string,
  plan: SecondReviewPlan,
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
    const config = BEDROCK_MODELS.find((model) => model.id === entry.model_id)!;
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
        review.model_id !== config.id ||
        review.region !== BEDROCK.region ||
        review.protocol !== BEDROCK.protocol ||
        review.source_sha256 !== sourceHash ||
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
        plan.candidate_ids,
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
    checkAttempts(entry as SecondReviewModelRun);
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
): SecondReviewSummary[] {
  return [...plan.candidate_ids, ...plan.deferred_ids].map((finding_id) => {
    const entries = models.flatMap((model) => {
      const assessment = model.review?.assessments.find(
        (entry) => entry.finding_id === finding_id,
      );
      return assessment ? [{ model_id: model.model_id, assessment }] : [];
    });
    const ids = (verdict: SecondReviewAssessment["verdict"]) =>
      entries
        .filter((entry) => entry.assessment.verdict === verdict)
        .map((entry) => entry.model_id);
    const supporting = ids("supported");
    const rejected = ids("not_supported");
    const uncertain = ids("uncertain");
    const missing = BEDROCK_MODELS.filter(
      (model) => !entries.some((entry) => entry.model_id === model.id),
    ).map((model) => model.id);
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
      supporting.length === BEDROCK_MODELS.length &&
      !severityDisagreement
        ? ("supported" as const)
        : !deferred &&
            !missing.length &&
            rejected.length === BEDROCK_MODELS.length
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
): SecondReviewExecution {
  if (
    !object(value) ||
    !keys(value, [
      "max_attempts_per_model",
      "model_timeout_ms",
      "overall_timeout_ms",
      "total_attempts",
    ]) ||
    value.max_attempts_per_model !== 2 ||
    !integer(
      value.model_timeout_ms,
      1,
      SECOND_REVIEW_POLICY.model_timeout_ms,
    ) ||
    !integer(
      value.overall_timeout_ms,
      1,
      SECOND_REVIEW_POLICY.overall_timeout_ms,
    ) ||
    !integer(
      value.total_attempts,
      0,
      SECOND_REVIEW_POLICY.max_provider_requests,
    ) ||
    value.total_attempts !==
      models.reduce((count, model) => count + model.attempts.length, 0) ||
    models.some((model) => model.elapsed_ms > elapsedMs)
  )
    throw new Error("Invalid second-review execution accounting.");
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
  const checked = checkModels(models, source, original.source_sha256, plan);
  const limits = checkExecution(
    execution ?? {
      max_attempts_per_model: 2,
      model_timeout_ms: SECOND_REVIEW_POLICY.model_timeout_ms,
      overall_timeout_ms: SECOND_REVIEW_POLICY.overall_timeout_ms,
      total_attempts: checked.reduce(
        (count, model) => count + model.attempts.length,
        0,
      ),
    },
    checked,
    elapsedMs,
  );
  return {
    schema_version: "1.0.0",
    engine: "peer-informed-reassessment",
    policy_version: SECOND_REVIEW_POLICY_VERSION,
    prompt_version: SECOND_REVIEW_PROMPT_VERSION,
    source_sha256: original.source_sha256,
    baseline_sha256: await sha256(canonical(original)),
    created_at: new Date().toISOString(),
    elapsed_ms: elapsedMs,
    rounds_used: plan.skipped_reason ? 0 : 1,
    status: status(plan, checked),
    plan,
    execution: limits,
    models: checked,
    findings: summaries(plan, checked),
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
    value.schema_version !== "1.0.0" ||
    value.engine !== "peer-informed-reassessment" ||
    value.policy_version !== SECOND_REVIEW_POLICY_VERSION ||
    value.prompt_version !== SECOND_REVIEW_PROMPT_VERSION ||
    !timestamp(value.created_at) ||
    !duration(value.elapsed_ms)
  )
    throw new Error("Invalid second-review report.");
  const original = await checkedBaseline(baseline, source);
  if (
    value.source_sha256 !== original.source_sha256 ||
    value.baseline_sha256 !== (await sha256(canonical(original)))
  )
    throw new Error(
      "Second review does not match the original report and source.",
    );
  const plan = buildSecondReviewPlan(original);
  if (
    !same(value.plan, plan) ||
    value.rounds_used !== (plan.skipped_reason ? 0 : 1)
  )
    throw new Error(
      "Second-review plan does not match the original review queue.",
    );
  const models = checkModels(
    value.models,
    source,
    original.source_sha256,
    plan,
  );
  checkExecution(value.execution, models, value.elapsed_ms);
  if (
    !same(value.models, models) ||
    value.status !== status(plan, models) ||
    !same(value.findings, summaries(plan, models))
  )
    throw new Error(
      "Second-review summaries do not match the validated reassessments.",
    );
  return value as SecondReviewReport;
}
