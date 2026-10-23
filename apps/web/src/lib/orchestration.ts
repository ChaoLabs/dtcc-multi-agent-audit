import type { ModelReview, ReviewFinding } from "@/generated/review";
import { BEDROCK, BEDROCK_MODELS } from "@/lib/bedrock-config";
import { validateModelReview } from "@/lib/report";
import {
  POLICY_VERSION,
  PROMPT_VERSION,
  REVIEW_POLICY,
  type PromptVariant,
} from "@/lib/review-policy";
import { sha256, sourceLines } from "@/lib/static-analysis";

/** Shared vocabulary for independent model prompts and deterministic aggregation. */
export const CATEGORIES = [
  "reentrancy",
  "tx-origin",
  "access-control",
  "unchecked-call",
  "delegatecall",
  "selfdestruct",
  "arithmetic",
  "timestamp-dependence",
  "weak-randomness",
  "denial-of-service",
  "front-running",
  "oracle-manipulation",
  "signature-replay",
  "uninitialized-storage",
  "upgradeability",
  "other",
] as const;

export type ModelAttempt = {
  attempt: number;
  status: "succeeded" | "failed";
  elapsed_ms: number;
  error_code: string | null;
  /** Delay before this request. The first request always has a zero delay. */
  retry_delay_ms: number;
};

export type ModelRun = {
  model_id: string;
  label: string;
  status: "succeeded" | "failed";
  elapsed_ms: number;
  review: ModelReview | null;
  error: { code: string; detail: string } | null;
  /** Absent only in legacy 2.0 reports, which did not record attempts. */
  attempts?: ModelAttempt[];
};

export type ConsensusFinding = ReviewFinding & {
  id: string;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  agreement: number;
  supporting_models: string[];
  members: { model_id: string; finding_index: number }[];
  severity_disagreement: boolean;
};

export type ExecutionProvenance = {
  policy_version: typeof POLICY_VERSION;
  prompt_variant: PromptVariant;
  prompt_version: typeof PROMPT_VERSION;
  max_attempts_per_model: 2;
  model_timeout_ms: number;
  overall_timeout_ms: number;
  total_attempts: number;
};

export type ReviewQueueItem = {
  finding_id: string;
  reasons: (
    | "severity_disagreement"
    | "not_reported_by_all_reviewers"
    | "incomplete_model_coverage"
  )[];
  supporting_models: string[];
  not_reported_models: string[];
  unavailable_models: string[];
  action: "manual_review";
};

type CouncilBase = {
  engine: "evidence-consensus";
  source_sha256: string;
  created_at: string;
  elapsed_ms: number;
  status: "completed" | "partial" | "failed";
  models: ModelRun[];
  findings: ConsensusFinding[];
};

export type CouncilReport = CouncilBase &
  (
    | {
        schema_version: "2.0.0";
        execution?: never;
        review_queue?: never;
      }
    | {
        schema_version: "2.1.0";
        execution: ExecutionProvenance;
        review_queue: ReviewQueueItem[];
      }
  );

const severityRank = { HIGH: 3, MEDIUM: 2, LOW: 1 } as const;
const maximumElapsedMs = 3_600_000;
const slug = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const aliases: Record<string, string> = {
  "re-entrancy": "reentrancy",
  "reentrancy-risk": "reentrancy",
  "tx-origin-authorization": "tx-origin",
  "tx-origin-authentication": "tx-origin",
  "authorization-via-tx-origin": "tx-origin",
  "missing-access-control": "access-control",
  "broken-access-control": "access-control",
  authorization: "access-control",
  "unchecked-low-level-call": "unchecked-call",
  "unchecked-call-return-value": "unchecked-call",
  "unchecked-return-value": "unchecked-call",
  "unchecked-external-call": "unchecked-call",
  "unsafe-delegatecall": "delegatecall",
  "integer-overflow": "arithmetic",
  "integer-underflow": "arithmetic",
  "arithmetic-overflow": "arithmetic",
  "arithmetic-underflow": "arithmetic",
  "timestamp-dependency": "timestamp-dependence",
  "weak-random-number-generation": "weak-randomness",
  "insecure-randomness": "weak-randomness",
  dos: "denial-of-service",
  "transaction-ordering": "front-running",
  "replay-attack": "signature-replay",
};

function categoryOf(finding: ReviewFinding): string {
  const category = slug(finding.category);
  const canonical = Object.hasOwn(aliases, category)
    ? aliases[category]
    : category;
  // Refine broad labels only when the title explicitly names a known weakness.
  // Rationale text can discuss several risks and is deliberately not classified.
  if (canonical === "access-control" || canonical === "other") {
    if (/tx\s*[.-]\s*origin/i.test(finding.title)) return "tx-origin";
    if (/re[- ]?entran/i.test(finding.title)) return "reentrancy";
    if (
      /unchecked.*(?:call|return)|(?:call|return).*unchecked/i.test(
        finding.title,
      )
    )
      return "unchecked-call";
    if (/delegatecall/i.test(finding.title)) return "delegatecall";
    if (/selfdestruct/i.test(finding.title)) return "selfdestruct";
  }
  return canonical || "other";
}

/** Mask comments and strings while retaining exact line/UTF-16 offsets. */
function executableSource(source: string): string {
  return source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g,
    (token) => token.replace(/[^\n]/g, " "),
  );
}

type Scope = { start: number; end: number };

function scopesOf(code: string): Scope[] {
  const scopes: Scope[] = [];
  const declarations =
    /\b(?:function\s+[A-Za-z_$][\w$]*|constructor|fallback|receive|modifier\s+[A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of code.matchAll(declarations)) {
    const start = match.index;
    const body = code.indexOf("{", start);
    const semicolon = code.indexOf(";", start);
    if (body < 0 || (semicolon >= 0 && semicolon < body)) continue;
    let depth = 1;
    let end = body + 1;
    while (end < code.length && depth > 0) {
      if (code[end] === "{") depth++;
      else if (code[end] === "}") depth--;
      end++;
    }
    if (depth === 0) scopes.push({ start, end });
  }
  return scopes;
}

const anchorPatterns: Record<string, RegExp> = {
  reentrancy:
    /\.\s*(?:call|send|transfer|safeTransfer|safeTransferFrom|transferFrom)\s*(?=[({])/g,
  "tx-origin": /\btx\s*\.\s*origin\b/g,
  "unchecked-call": /\.\s*(?:call|send|delegatecall|staticcall)\s*(?=[({])/g,
  delegatecall: /\.\s*delegatecall\s*(?=[({])/g,
  selfdestruct: /\b(?:selfdestruct|suicide)\s*\(/g,
  arithmetic: /\+\+|--|[+*/%]=?|-(?!=)|\bunchecked\b/g,
  "timestamp-dependence": /\b(?:block\s*\.\s*timestamp|now)\b/g,
  "weak-randomness":
    /\b(?:blockhash|block\s*\.\s*(?:timestamp|prevrandao|difficulty))\b/g,
  "oracle-manipulation":
    /\.\s*(?:latestRoundData|latestAnswer|getReserves)\s*\(/g,
  "signature-replay": /\b(?:ecrecover|recover)\s*\(/g,
};

function groupingKey(
  finding: ReviewFinding,
  code: string,
  offsets: number[],
  scopes: Scope[],
): { category: string; locus: string } {
  const category = categoryOf(finding);
  const start = offsets[finding.evidence.line_start - 1];
  const end = offsets[finding.evidence.line_end] ?? code.length;
  const pattern = Object.hasOwn(anchorPatterns, category)
    ? anchorPatterns[category]
    : undefined;
  if (pattern) {
    const anchors = [...code.slice(start, end).matchAll(pattern)];
    // A unique operation is an objective locus, independent of title or window.
    // Never guess which site a window containing several operations refers to.
    if (anchors.length === 1)
      return { category, locus: `operation:${start + anchors[0].index}` };
  }
  if (
    category === "access-control" &&
    /\b(?:unrestricted|unprotected|unguarded)\b|\b(?:missing|absent|lacking|no)\b.{0,40}\b(?:access|authorization|authentication|permission|caller|owner|role|check)\b/i.test(
      finding.title,
    )
  ) {
    const window = code.slice(start, end);
    const first = start + window.length - window.trimStart().length;
    const last = end - (window.length - window.trimEnd().length);
    const containing = scopes.filter(
      (scope) => scope.start <= first && scope.end >= last,
    );
    // Only an explicitly missing caller restriction uses the function entry.
    // Other access-control causes (incorrect role logic, bypasses, etc.) do not
    // become equivalent merely because they occur in the same function.
    if (containing.length === 1)
      return { category, locus: `function:${containing[0].start}` };
  }
  // Unknown categories, broad windows and unsupported syntax remain separate
  // unless their exact evidence span and normalized title agree. This lexical
  // method is intentionally conservative: it is not semantic equivalence,
  // exploit validation, an AST/data-flow analysis, or a probability of correctness.
  return {
    category,
    locus: `span:${finding.evidence.line_start}:${finding.evidence.line_end}:${slug(finding.title)}`,
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === [...keys].sort()[index])
  );
}

function duration(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= maximumElapsedMs
  );
}

function timestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function errorCode(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(value);
}

function validateExecution(value: unknown): ExecutionProvenance {
  if (
    !record(value) ||
    !exactKeys(value, [
      "policy_version",
      "prompt_variant",
      "prompt_version",
      "max_attempts_per_model",
      "model_timeout_ms",
      "overall_timeout_ms",
      "total_attempts",
    ]) ||
    value.policy_version !== POLICY_VERSION ||
    value.prompt_version !== PROMPT_VERSION ||
    !["baseline", "few-shot"].includes(value.prompt_variant as string) ||
    value.max_attempts_per_model !== REVIEW_POLICY.max_attempts_per_model ||
    !duration(value.model_timeout_ms) ||
    value.model_timeout_ms < 1 ||
    value.model_timeout_ms > REVIEW_POLICY.model_timeout_ms ||
    !duration(value.overall_timeout_ms) ||
    value.overall_timeout_ms < 1 ||
    value.overall_timeout_ms > REVIEW_POLICY.overall_timeout_ms ||
    !Number.isSafeInteger(value.total_attempts) ||
    (value.total_attempts as number) < 0 ||
    (value.total_attempts as number) > REVIEW_POLICY.max_provider_requests
  )
    throw new Error("Invalid bounded orchestration policy.");
  return value as ExecutionProvenance;
}

function validateAttempts(entry: ModelRun) {
  const attempts = entry.attempts;
  if (
    !Array.isArray(attempts) ||
    attempts.length > REVIEW_POLICY.max_attempts_per_model
  )
    throw new Error("Invalid model attempt history.");
  const terminalTimeout =
    entry.status === "failed" &&
    ["timeout", "cancelled"].includes(entry.error?.code ?? "");
  if (!attempts.length) {
    if (!terminalTimeout)
      throw new Error(
        "A model without requests must have an explicit timeout.",
      );
    return;
  }
  let measured = 0;
  for (const [index, attempt] of attempts.entries()) {
    if (
      !record(attempt) ||
      !exactKeys(attempt, [
        "attempt",
        "status",
        "elapsed_ms",
        "error_code",
        "retry_delay_ms",
      ]) ||
      attempt.attempt !== index + 1 ||
      !duration(attempt.elapsed_ms) ||
      !duration(attempt.retry_delay_ms) ||
      attempt.retry_delay_ms > 5_000 ||
      (index === 0 && attempt.retry_delay_ms !== 0) ||
      (attempt.status !== "succeeded" && attempt.status !== "failed") ||
      (attempt.status === "succeeded"
        ? attempt.error_code !== null || index !== attempts.length - 1
        : !errorCode(attempt.error_code))
    )
      throw new Error("Invalid model attempt history.");
    if (
      index > 0 &&
      (attempts[index - 1].status !== "failed" ||
        !["bedrock_rate_limit", "bedrock_unavailable"].includes(
          attempts[index - 1].error_code ?? "",
        ))
    )
      throw new Error("A non-transient failure cannot be retried.");
    measured += attempt.elapsed_ms + attempt.retry_delay_ms;
  }
  const last = attempts[attempts.length - 1];
  if (
    measured > entry.elapsed_ms ||
    last.status !== entry.status ||
    (entry.status === "failed" &&
      !terminalTimeout &&
      last.error_code !== entry.error?.code) ||
    (entry.review && entry.review.elapsed_ms > last.elapsed_ms)
  )
    throw new Error("Attempt history does not match the model outcome.");
}

async function validateModels(
  value: unknown,
  source: string,
  withAttempts = false,
): Promise<ModelRun[]> {
  if (!Array.isArray(value) || value.length !== BEDROCK_MODELS.length)
    throw new Error("Every configured model must have an explicit outcome.");
  const seen = new Set<string>();
  const models: ModelRun[] = [];
  for (const entry of value) {
    if (
      !record(entry) ||
      !exactKeys(entry, [
        "model_id",
        "label",
        "status",
        "elapsed_ms",
        "review",
        "error",
        ...(withAttempts ? ["attempts"] : []),
      ])
    )
      throw new Error("Invalid model outcome.");
    const config = BEDROCK_MODELS.find((model) => model.id === entry.model_id);
    if (
      !config ||
      entry.label !== config.label ||
      seen.has(config.id) ||
      !duration(entry.elapsed_ms)
    )
      throw new Error("Invalid or duplicate model identity.");
    seen.add(config.id);
    if (entry.status === "succeeded") {
      if (entry.error !== null)
        throw new Error("A successful model cannot have an error.");
      const review = await validateModelReview(entry.review, source);
      if (
        review.model_id !== config.id ||
        review.region !== BEDROCK.region ||
        review.protocol !== BEDROCK.protocol ||
        !timestamp(review.created_at) ||
        !duration(review.elapsed_ms) ||
        (withAttempts
          ? review.elapsed_ms > entry.elapsed_ms
          : review.elapsed_ms !== entry.elapsed_ms) ||
        [review.input_tokens, review.output_tokens].some(
          (tokens) =>
            tokens !== null &&
            (!Number.isSafeInteger(tokens) ||
              tokens < 0 ||
              tokens > 10_000_000),
        )
      )
        throw new Error("Invalid model review provenance.");
    } else if (entry.status === "failed") {
      if (
        entry.review !== null ||
        !record(entry.error) ||
        !exactKeys(entry.error, ["code", "detail"]) ||
        !errorCode(entry.error.code) ||
        typeof entry.error.detail !== "string" ||
        entry.error.detail.length < 1 ||
        entry.error.detail.length > 1000 ||
        /bedrock-api-key-/i.test(entry.error.detail)
      )
        throw new Error("Invalid failed-model outcome.");
    } else {
      throw new Error("Invalid model status.");
    }
    if (withAttempts) validateAttempts(entry as ModelRun);
    models.push(entry as ModelRun);
  }
  return BEDROCK_MODELS.map((config) =>
    models.find((model) => model.model_id === config.id)!,
  );
}

async function aggregate(
  models: ModelRun[],
  source: string,
  hash: string,
): Promise<ConsensusFinding[]> {
  const normalized = sourceLines(source).join("\n");
  const code = executableSource(normalized);
  const offsets = [0];
  for (let offset = 0; offset < code.length; offset++)
    if (code[offset] === "\n") offsets.push(offset + 1);
  const scopes = scopesOf(code);
  const groups = new Map<
    string,
    {
      category: string;
      entries: {
        model_id: string;
        finding_index: number;
        finding: ReviewFinding;
      }[];
    }
  >();
  for (const model of models) {
    if (model.status !== "succeeded" || !model.review) continue;
    model.review.findings.forEach((finding, finding_index) => {
      const { category, locus } = groupingKey(finding, code, offsets, scopes);
      const key = `${category}|${locus}`;
      const group = groups.get(key) ?? { category, entries: [] };
      group.entries.push({ model_id: model.model_id, finding_index, finding });
      groups.set(key, group);
    });
  }
  const findings: ConsensusFinding[] = [];
  for (const [key, group] of groups) {
    const support = [...new Set(group.entries.map((entry) => entry.model_id))];
    const representative = group.entries.reduce((selected, entry) =>
      severityRank[entry.finding.proposed_severity] >
      severityRank[selected.finding.proposed_severity]
        ? entry
        : selected,
    ).finding;
    findings.push({
      ...representative,
      category: group.category,
      id: (await sha256(`evidence-consensus@2.0.0|${hash}|${key}`)).slice(
        0,
        24,
      ),
      confidence:
        support.length === 3 ? "HIGH" : support.length === 2 ? "MEDIUM" : "LOW",
      agreement: support.length,
      supporting_models: support,
      members: group.entries.map(({ model_id, finding_index }) => ({
        model_id,
        finding_index,
      })),
      severity_disagreement:
        new Set(group.entries.map((entry) => entry.finding.proposed_severity))
          .size > 1,
    });
  }
  return findings.sort(
    (a, b) =>
      severityRank[b.proposed_severity] - severityRank[a.proposed_severity] ||
      a.evidence.line_start - b.evidence.line_start ||
      a.id.localeCompare(b.id),
  );
}

function outcome(models: ModelRun[]): CouncilReport["status"] {
  const successes = models.filter(
    (model) => model.status === "succeeded",
  ).length;
  return successes === 0
    ? "failed"
    : successes === BEDROCK_MODELS.length
      ? "completed"
      : "partial";
}

/**
 * A review queue preserves uncertainty instead of asking a fourth model to
 * manufacture a verdict. Non-reporting and unavailable reviewers stay distinct.
 */
export function buildReviewQueue(
  models: ModelRun[],
  findings: ConsensusFinding[],
): ReviewQueueItem[] {
  return findings.flatMap((finding) => {
    const notReported = models
      .filter(
        (model) =>
          model.status === "succeeded" &&
          !finding.supporting_models.includes(model.model_id),
      )
      .map((model) => model.model_id);
    const unavailable = models
      .filter((model) => model.status === "failed")
      .map((model) => model.model_id);
    const reasons: ReviewQueueItem["reasons"] = [];
    if (finding.severity_disagreement) reasons.push("severity_disagreement");
    if (notReported.length) reasons.push("not_reported_by_all_reviewers");
    if (unavailable.length) reasons.push("incomplete_model_coverage");
    return reasons.length
      ? [
          {
            finding_id: finding.id,
            reasons,
            supporting_models: [...finding.supporting_models],
            not_reported_models: notReported,
            unavailable_models: unavailable,
            action: "manual_review" as const,
          },
        ]
      : [];
  });
}

function validateAccounting(
  execution: ExecutionProvenance,
  models: ModelRun[],
  elapsedMs: number,
) {
  if (
    execution.total_attempts !==
      models.reduce((count, model) => count + model.attempts!.length, 0) ||
    models.some((model) => model.elapsed_ms > elapsedMs)
  )
    throw new Error("Execution accounting does not match the model outcomes.");
}

export async function buildCouncilReport(
  models: ModelRun[],
  source: string,
  elapsedMs: number,
  execution?: ExecutionProvenance,
): Promise<CouncilReport> {
  if (!duration(elapsedMs)) throw new Error("Invalid orchestration duration.");
  const policy =
    execution === undefined ? undefined : validateExecution(execution);
  const checked = await validateModels(models, source, !!policy);
  if (policy) validateAccounting(policy, checked, elapsedMs);
  const hash = await sha256(source);
  const findings = await aggregate(checked, source, hash);
  const report: CouncilBase = {
    engine: "evidence-consensus" as const,
    source_sha256: hash,
    created_at: new Date().toISOString(),
    elapsed_ms: elapsedMs,
    status: outcome(checked),
    models: checked,
    findings,
  };
  return policy
    ? {
        ...report,
        schema_version: "2.1.0",
        execution: policy,
        review_queue: buildReviewQueue(checked, findings),
      }
    : { ...report, schema_version: "2.0.0" };
}

function equivalent(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, index) => equivalent(actual[index], item))
    );
  if (record(expected))
    return (
      record(actual) &&
      exactKeys(actual, Object.keys(expected)) &&
      Object.keys(expected).every((key) =>
        equivalent(actual[key], expected[key]),
      )
    );
  return false;
}

/** Recompute every aggregate from source-validated raw model contributions. */
export async function validateCouncil(
  value: unknown,
  source: string,
): Promise<CouncilReport> {
  const withExecution = record(value) && value.schema_version === "2.1.0";
  if (
    !record(value) ||
    !exactKeys(value, [
      "schema_version",
      "engine",
      "source_sha256",
      "created_at",
      "elapsed_ms",
      "status",
      "models",
      "findings",
      ...(withExecution ? ["execution", "review_queue"] : []),
    ]) ||
    (!withExecution && value.schema_version !== "2.0.0") ||
    value.engine !== "evidence-consensus" ||
    !timestamp(value.created_at) ||
    !duration(value.elapsed_ms)
  )
    throw new Error("Invalid orchestration report.");
  const hash = await sha256(source);
  if (value.source_sha256 !== hash)
    throw new Error("Orchestration report does not match this source.");
  const policy = withExecution ? validateExecution(value.execution) : undefined;
  const models = await validateModels(value.models, source, withExecution);
  if (policy) validateAccounting(policy, models, value.elapsed_ms);
  const findings = await aggregate(models, source, hash);
  if (
    value.status !== outcome(models) ||
    !equivalent(value.models, models) ||
    !equivalent(value.findings, findings) ||
    (withExecution &&
      !equivalent(value.review_queue, buildReviewQueue(models, findings)))
  )
    throw new Error(
      "Orchestration findings do not match the validated model contributions.",
    );
  return value as CouncilReport;
}
