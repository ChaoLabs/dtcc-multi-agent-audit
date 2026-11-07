import { expect, test } from "@playwright/test";
import Ajv from "ajv";
import type { ReviewFinding } from "../src/generated/review";
import { BEDROCK, BEDROCK_MODELS } from "../src/lib/bedrock-config";
import {
  buildCouncilReport,
  type CouncilReport,
  type ModelRun,
} from "../src/lib/orchestration";
import {
  POLICY_VERSION,
  PROMPT_VERSION,
  REVIEW_POLICY,
  LEGACY_REVIEW_POLICY,
} from "../src/lib/review-policy";
import {
  assignedSecondReviewCandidates,
  bindSecondReviewContent,
  buildSecondReviewPlan,
  buildSecondReviewReport,
  SECOND_REVIEW_POLICY_VERSION,
  SECOND_REVIEW_PROMPT_VERSION,
  secondReviewBaselineHash,
  secondReviewEvidenceMethod,
  secondReviewReasoningEffort,
  secondReviewResponseSchema,
  validateSecondReviewReport,
  type SecondReviewAssessment,
  type SecondReviewModelRun,
  type SecondReviewReport,
} from "../src/lib/second-review";
import { buildFinalReviewReport } from "../src/lib/final-report";
import { secondReviewMarkdown } from "../src/lib/second-review-export";
import { analyzeStatic, sha256, sourceLines } from "../src/lib/static-analysis";

const legacyLimits = {
  max_attempts_per_model: LEGACY_REVIEW_POLICY.max_attempts_per_model,
  model_timeout_ms: LEGACY_REVIEW_POLICY.model_timeout_ms,
  overall_timeout_ms: LEGACY_REVIEW_POLICY.overall_timeout_ms,
};

const source = [
  "pragma solidity ^0.8.20;",
  "contract TestCalls {",
  ...Array.from(
    { length: 14 },
    (_, i) =>
      `  function call${i}(address target) external { target.call(\"\"); }`,
  ),
  "}",
].join("\n");

type Contribution = "HIGH" | "LOW" | "empty" | "failed";
async function baseline(
  count = 1,
  modes: Contribution[] = ["HIGH", "LOW", "empty"],
): Promise<CouncilReport> {
  const hash = await sha256(source);
  const models: ModelRun[] = BEDROCK_MODELS.map((config, index) => {
    const mode = modes[index];
    const findings: ReviewFinding[] =
      mode === "empty" || mode === "failed"
        ? []
        : Array.from({ length: count }, (_, i) => ({
            title: `Unchecked call ${i}`,
            category: "unchecked-call",
            proposed_severity: mode,
            rationale: `Call ${i} does not check its return value.`,
            recommendation: "Check the call result.",
            evidence: {
              line_start: i + 3,
              line_end: i + 3,
              excerpt: sourceLines(source)[i + 2],
              validation: "source-bound",
            },
          }));
    return {
      model_id: config.id,
      label: config.label,
      status: mode === "failed" ? "failed" : "succeeded",
      elapsed_ms: 8,
      attempts: [
        {
          attempt: 1,
          status: mode === "failed" ? "failed" : "succeeded",
          elapsed_ms: 8,
          error_code: mode === "failed" ? "bedrock_unavailable" : null,
          retry_delay_ms: 0,
        },
      ],
      error:
        mode === "failed"
          ? { code: "bedrock_unavailable", detail: "Service unavailable." }
          : null,
      review:
        mode === "failed"
          ? null
          : {
              summary: "Independent source review.",
              findings,
              provider: "aws-bedrock",
              model_id: config.id,
              region: BEDROCK.region,
              protocol: BEDROCK.protocol,
              source_sha256: hash,
              created_at: "2026-10-27T12:00:00.000Z",
              elapsed_ms: 8,
              input_tokens: 100,
              output_tokens: 50,
            },
    };
  });
  return buildCouncilReport(models, source, 10, {
    policy_version: POLICY_VERSION,
    prompt_version: PROMPT_VERSION,
    prompt_variant: "baseline",
    max_attempts_per_model: REVIEW_POLICY.max_attempts_per_model,
    model_timeout_ms: REVIEW_POLICY.model_timeout_ms,
    overall_timeout_ms: REVIEW_POLICY.overall_timeout_ms,
    total_attempts: 3,
  });
}

type WireContent = {
  summary: string;
  assessments: (Omit<SecondReviewAssessment, "evidence"> & {
    evidence: Omit<SecondReviewAssessment["evidence"], "validation">;
  })[];
};
function wire(
  original: CouncilReport,
  verdict: SecondReviewAssessment["verdict"] = "supported",
  severity: ReviewFinding["proposed_severity"] = "HIGH",
  assignedIds?: string[],
): WireContent {
  const plan = buildSecondReviewPlan(original);
  return {
    summary: "Peer-informed claim reassessment.",
    assessments: (assignedIds ?? plan.candidate_ids).map((finding_id) => {
      const finding = original.findings.find((item) => item.id === finding_id)!;
      return {
        finding_id,
        verdict,
        proposed_severity: verdict === "supported" ? severity : null,
        rationale:
          "The cited call and surrounding source were reassessed against the assigned claim.",
        evidence: {
          line_start: finding.evidence.line_start,
          line_end: finding.evidence.line_end,
          excerpt: finding.evidence.excerpt,
        },
      };
    }),
  };
}

function reassessments(
  original: CouncilReport,
  verdicts: (SecondReviewAssessment["verdict"] | null)[] = [
    "supported",
    "supported",
    "supported",
  ],
  severities: ReviewFinding["proposed_severity"][] = ["HIGH", "HIGH", "HIGH"],
): SecondReviewModelRun[] {
  const plan = buildSecondReviewPlan(original);
  return plan.model_ids.map((id, i) => {
    const config = BEDROCK_MODELS.find((model) => model.id === id)!;
    const verdict = verdicts[i];
    return {
      model_id: id,
      label: config.label,
      status: verdict === null ? "failed" : "succeeded",
      elapsed_ms: 8,
      attempts: [
        {
          attempt: 1,
          status: verdict === null ? "failed" : "succeeded",
          elapsed_ms: 8,
          error_code: verdict === null ? "bedrock_unavailable" : null,
          retry_delay_ms: 0,
        },
      ],
      error:
        verdict === null
          ? { code: "bedrock_unavailable", detail: "Service unavailable." }
          : null,
      review:
        verdict === null
          ? null
          : {
              ...bindSecondReviewContent(
                wire(
                  original,
                  verdict,
                  severities[i],
                  assignedSecondReviewCandidates(plan, id),
                ),
                source,
                assignedSecondReviewCandidates(plan, id),
              ),
              provider: "aws-bedrock",
              model_id: id,
              region: BEDROCK.region,
              protocol: BEDROCK.protocol,
              source_sha256: original.source_sha256,
              created_at: "2026-10-27T12:01:00.000Z",
              elapsed_ms: 8,
              input_tokens: 120,
              output_tokens: 90,
            },
    };
  });
}

test("second review selects at most twelve queued claims and all successful original models", async () => {
  const original = await baseline(14);
  const plan = buildSecondReviewPlan(original);
  expect(plan.model_ids).toEqual(BEDROCK_MODELS.map((model) => model.id));
  expect(plan.candidate_ids).toEqual(
    original.review_queue!.slice(0, 12).map((item) => item.finding_id),
  );
  expect(plan.deferred_ids).toEqual(
    original.review_queue!.slice(12).map((item) => item.finding_id),
  );
  const report = await buildSecondReviewReport(
    reassessments(original),
    source,
    original,
    10,
  );
  expect(report.findings).toHaveLength(14);
  expect(
    report.findings
      .slice(12)
      .every(
        (item) =>
          item.deferred &&
          item.status === "unresolved" &&
          item.missing_models.length === 3,
      ),
  ).toBe(true);
  expect(report.execution.total_attempts).toBe(3);
});

test("no disagreements and fewer than two successful reviewers are explicit no-call outcomes", async () => {
  for (const [modes, reason] of [
    [["HIGH", "HIGH", "HIGH"], "no_disagreements"],
    [["HIGH", "failed", "failed"], "insufficient_reviewers"],
    [["failed", "failed", "failed"], "insufficient_reviewers"],
    [["empty", "failed", "failed"], "insufficient_reviewers"],
    [["empty", "empty", "empty"], "no_disagreements"],
  ] as const) {
    const original = await baseline(1, [...modes]);
    const report = await buildSecondReviewReport([], source, original, 0);
    expect(report.plan.skipped_reason).toBe(reason);
    expect(report.rounds_used).toBe(0);
    expect(report.status).toBe("skipped");
    expect(report.execution.total_attempts).toBe(0);
    expect(await validateSecondReviewReport(report, source, original)).toEqual(
      report,
    );
  }
});

test("all support preserves original agreement and model reviews byte-for-byte", async () => {
  const original = await baseline();
  const serialized = JSON.stringify(original);
  const report = await buildSecondReviewReport(
    reassessments(original),
    source,
    original,
    10,
  );
  expect(report.findings[0].status).toBe("supported");
  expect(report.findings[0].supporting_models).toHaveLength(3);
  expect(original.findings[0].agreement).toBe(2);
  expect(original.findings[0].confidence).toBe("MEDIUM");
  expect(JSON.stringify(original)).toBe(serialized);
  expect(
    await validateSecondReviewReport(
      JSON.parse(JSON.stringify(report)),
      source,
      original,
    ),
  ).toEqual(report);
});

for (const [name, verdicts, severities, expected] of [
  [
    "all reviewers withdraw support",
    ["not_supported", "not_supported", "not_supported"],
    ["HIGH", "HIGH", "HIGH"],
    "not_supported",
  ],
  [
    "original author retracts but a peer supports",
    ["not_supported", "supported", "supported"],
    ["HIGH", "HIGH", "HIGH"],
    "unresolved",
  ],
  [
    "one reviewer remains uncertain",
    ["supported", "supported", "uncertain"],
    ["HIGH", "HIGH", "HIGH"],
    "unresolved",
  ],
  [
    "all support but severity differs",
    ["supported", "supported", "supported"],
    ["HIGH", "LOW", "HIGH"],
    "supported",
  ],
  [
    "one reviewer fails",
    ["supported", "supported", null],
    ["HIGH", "HIGH", "HIGH"],
    "unresolved",
  ],
  [
    "all reviewers fail",
    [null, null, null],
    ["HIGH", "HIGH", "HIGH"],
    "unresolved",
  ],
] as const) {
  test(`peer-informed summary: ${name}`, async () => {
    const original = await baseline();
    const report = await buildSecondReviewReport(
      reassessments(original, [...verdicts], [...severities]),
      source,
      original,
      10,
    );
    expect(report.findings[0].status).toBe(expected);
    expect(report.findings[0].severity_disagreement).toBe(
      name === "all support but severity differs",
    );
    if (name === "all reviewers withdraw support")
      expect(report.findings[0].proposed_severity).toBeNull();
    if (name === "all reviewers fail") expect(report.status).toBe("failed");
    if (name === "one reviewer fails") expect(report.status).toBe("partial");
    expect(await validateSecondReviewReport(report, source, original)).toEqual(
      report,
    );
  });
}

test("two eligible reviewers never substitute for the absent third model", async () => {
  const original = await baseline(1, ["HIGH", "LOW", "failed"]);
  const models = reassessments(original, ["not_supported", "not_supported"]);
  const report = await buildSecondReviewReport(models, source, original, 10);
  expect(report.status).toBe("completed");
  expect(report.models).toHaveLength(2);
  expect(report.findings[0].status).toBe("unresolved");
  expect(report.findings[0].missing_models).toEqual([BEDROCK_MODELS[2].id]);
  await expect(
    buildSecondReviewReport(
      [...models, { ...models[0], model_id: BEDROCK_MODELS[2].id }],
      source,
      original,
      10,
    ),
  ).rejects.toThrow();
});

test("reordered wire assessments normalize without changing IDs or evidence", async () => {
  const original = await baseline(3);
  const plan = buildSecondReviewPlan(original);
  const input = wire(original);
  input.assessments.reverse();
  const result = bindSecondReviewContent(input, source, plan.candidate_ids);
  expect(result.assessments.map((item) => item.finding_id)).toEqual(
    plan.candidate_ids,
  );
  expect(result.assessments[0].evidence.validation).toBe("source-bound");
  expect(input.assessments[0].evidence).not.toHaveProperty("validation");
  const validate = new Ajv({ strict: false }).compile(
    secondReviewResponseSchema(plan.candidate_ids),
  );
  expect(validate(input)).toBe(true);
});

for (const [name, mutate] of [
  [
    "invented claim ID",
    (value: WireContent) => {
      value.assessments[0].finding_id = "f".repeat(24);
    },
  ],
  [
    "duplicate claim",
    (value: WireContent) => {
      value.assessments[1] = structuredClone(value.assessments[0]);
    },
  ],
  [
    "missing claim",
    (value: WireContent) => {
      value.assessments.pop();
    },
  ],
  [
    "new discovery field",
    (value: WireContent) => {
      (value as unknown as Record<string, unknown>).findings = [];
    },
  ],
  [
    "unsupported verdict",
    (value: WireContent) => {
      (value.assessments[0] as unknown as Record<string, unknown>).verdict =
        "verified";
    },
  ],
  [
    "severity on rejected claim",
    (value: WireContent) => {
      value.assessments[0].verdict = "not_supported";
    },
  ],
  [
    "missing severity on supported claim",
    (value: WireContent) => {
      value.assessments[0].proposed_severity = null;
    },
  ],
  [
    "fabricated evidence",
    (value: WireContent) => {
      value.assessments[0].evidence.excerpt = "fabricated code";
    },
  ],
  [
    "fractional source line",
    (value: WireContent) => {
      value.assessments[0].evidence.line_start = 3.5;
    },
  ],
  [
    "outside source",
    (value: WireContent) => {
      value.assessments[0].evidence.line_end = 1000;
    },
  ],
  [
    "overlong evidence window",
    (value: WireContent) => {
      value.assessments[0].evidence = {
        line_start: 1,
        line_end: 13,
        excerpt: sourceLines(source).slice(0, 13).join("\n"),
      };
    },
  ],
  [
    "self-declared validation",
    (value: WireContent) => {
      (
        value.assessments[0].evidence as unknown as Record<string, unknown>
      ).validation = "source-bound";
    },
  ],
  [
    "credential-bearing rationale",
    (value: WireContent) => {
      value.assessments[0].rationale = "bedrock-api-key-SYNTHETIC";
    },
  ],
  [
    "oversized rationale",
    (value: WireContent) => {
      value.assessments[0].rationale = "x".repeat(3001);
    },
  ],
] as const) {
  test(`strict content rejects ${name}`, async () => {
    const original = await baseline(2);
    const value = wire(original);
    mutate(value);
    expect(() =>
      bindSecondReviewContent(
        value,
        source,
        buildSecondReviewPlan(original).candidate_ids,
      ),
    ).toThrow();
  });
}

test("baseline fingerprint tolerates object key order but binds every original run", async () => {
  const original = await baseline();
  const report = await buildSecondReviewReport(
    reassessments(original),
    source,
    original,
    10,
  );
  const reorder = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reorder)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, item]) => [key, reorder(item)]),
          )
        : value;
  const reordered = reorder(original) as CouncilReport;
  expect(await secondReviewBaselineHash(reordered, source)).toBe(
    report.baseline_sha256,
  );
  expect(await validateSecondReviewReport(report, source, reordered)).toEqual(
    report,
  );
  for (const field of ["created_at", "prompt", "rationale"] as const) {
    const changed = structuredClone(original);
    if (field === "created_at") changed.created_at = "2026-10-27T14:00:00.000Z";
    if (field === "prompt") changed.execution!.prompt_variant = "few-shot";
    if (field === "rationale") {
      // A non-representative original member can change without changing the aggregate.
      changed.models[1].review!.findings[0].rationale =
        "A different source interpretation from this reviewer.";
    }
    expect(await secondReviewBaselineHash(changed, source)).not.toBe(
      report.baseline_sha256,
    );
    await expect(
      validateSecondReviewReport(report, source, changed),
    ).rejects.toThrow("original report");
  }
});

for (const [name, mutate] of [
  [
    "new candidate",
    (value: SecondReviewReport) => {
      value.plan.candidate_ids.push("a".repeat(24));
    },
  ],
  [
    "missing task",
    (value: SecondReviewReport) => {
      value.models.pop();
    },
  ],
  [
    "duplicate model",
    (value: SecondReviewReport) => {
      value.models[1] = structuredClone(value.models[0]);
    },
  ],
  [
    "changed baseline hash",
    (value: SecondReviewReport) => {
      value.baseline_sha256 = "0".repeat(64);
    },
  ],
  [
    "additional round",
    (value: SecondReviewReport) => {
      (value as unknown as Record<string, unknown>).rounds_used = 2;
    },
  ],
  [
    "inflated support",
    (value: SecondReviewReport) => {
      value.findings[0].supporting_models.push(BEDROCK_MODELS[0].id);
    },
  ],
  [
    "false resolution",
    (value: SecondReviewReport) => {
      value.findings[0].status = "not_supported";
    },
  ],
  [
    "invalid source stamp",
    (value: SecondReviewReport) => {
      (
        value.models[0].review!.assessments[0].evidence as unknown as Record<
          string,
          unknown
        >
      ).validation = "verified";
    },
  ],
  [
    "changed model provenance",
    (value: SecondReviewReport) => {
      value.models[0].review!.model_id = BEDROCK_MODELS[1].id;
    },
  ],
  [
    "fractional usage",
    (value: SecondReviewReport) => {
      value.models[0].review!.input_tokens = 0.5;
    },
  ],
  [
    "omitted attempt",
    (value: SecondReviewReport) => {
      value.models[0].attempts = [];
    },
  ],
  [
    "mismatched attempt state",
    (value: SecondReviewReport) => {
      value.models[0].attempts[0].status = "failed";
      value.models[0].attempts[0].error_code = "timeout";
    },
  ],
  [
    "budget reset",
    (value: SecondReviewReport) => {
      value.execution.overall_timeout_ms = 420_000;
    },
  ],
  [
    "underreported calls",
    (value: SecondReviewReport) => {
      value.execution.total_attempts = 1;
    },
  ],
  [
    "nonfinite elapsed time",
    (value: SecondReviewReport) => {
      value.elapsed_ms = Infinity;
    },
  ],
  [
    "unknown extra fields",
    (value: SecondReviewReport) => {
      (value as unknown as Record<string, unknown>).certified = true;
    },
  ],
] as const) {
  test(`report validation rejects ${name}`, async () => {
    const original = await baseline();
    const report = await buildSecondReviewReport(
      reassessments(original),
      source,
      original,
      10,
    );
    mutate(report);
    await expect(
      validateSecondReviewReport(report, source, original),
    ).rejects.toThrow();
  });
}

test("bounded retry telemetry preserves final successful attempt and rejects auth retries", async () => {
  const original = await baseline();
  const models = reassessments(original);
  models[0].attempts.unshift({
    attempt: 1,
    status: "failed",
    elapsed_ms: 2,
    error_code: "bedrock_rate_limit",
    retry_delay_ms: 0,
  });
  models[0].attempts[1].attempt = 2;
  models[0].attempts[1].retry_delay_ms = 500;
  models[0].elapsed_ms = 510;
  const report = await buildSecondReviewReport(models, source, original, 515);
  expect(report.execution.total_attempts).toBe(4);
  expect(report.models[0].review!.elapsed_ms).toBe(8);
  expect(await validateSecondReviewReport(report, source, original)).toEqual(
    report,
  );
  models[0].attempts[0].error_code = "bedrock_access";
  await expect(
    buildSecondReviewReport(models, source, original, 515),
  ).rejects.toThrow("does not permit retrying");
});

test("a timeout during backoff retains the first error and never invents another request", async () => {
  const original = await baseline();
  const models = reassessments(original, [null, "supported", "supported"]);
  models[0].error = {
    code: "timeout",
    detail: "Deadline exhausted during backoff.",
  };
  models[0].elapsed_ms = 500;
  const report = await buildSecondReviewReport(models, source, original, 500);
  expect(report.models[0].attempts).toHaveLength(1);
  expect(report.execution.total_attempts).toBe(3);
  expect(report.findings[0].status).toBe("unresolved");
});

test("network recovery and provider waits retain truthful second-round provenance", async () => {
  const original = await baseline();
  const models = reassessments(original);
  models[0].attempts.unshift({
    attempt: 1,
    status: "failed",
    elapsed_ms: 2,
    error_code: "bedrock_network",
    retry_delay_ms: 0,
  });
  models[0].attempts[1].attempt = 2;
  models[0].attempts[1].retry_delay_ms = 10_000;
  models[0].elapsed_ms = 10_010;
  const report = await buildSecondReviewReport(
    models,
    source,
    original,
    10_015,
  );
  expect(report.policy_version).toBe(SECOND_REVIEW_POLICY_VERSION);
  expect(report.prompt_version).toBe(SECOND_REVIEW_PROMPT_VERSION);
  expect(report.execution.total_attempts).toBe(4);
  expect(report.models[0].review!.elapsed_ms).toBe(8);
  expect(await validateSecondReviewReport(report, source, original)).toEqual(
    report,
  );
  const historical = structuredClone(report);
  historical.policy_version = "targeted-peer-review-v2";
  Object.assign(historical.execution, legacyLimits);
  historical.prompt_version = "targeted-peer-review-v3-source-spans";
  await expect(
    validateSecondReviewReport(historical, source, original),
  ).rejects.toThrow();
  historical.models[0].attempts[1].retry_delay_ms = 500;
  await expect(
    validateSecondReviewReport(historical, source, original),
  ).rejects.toThrow("does not permit retrying");
  historical.models[0].attempts[0].error_code = "bedrock_rate_limit";
  expect(
    await validateSecondReviewReport(historical, source, original),
  ).toEqual(historical);
});

test("second-round recovery cannot start at or after either declared deadline", async () => {
  const original = await baseline();
  const models = reassessments(original);
  models[0].attempts.unshift({
    attempt: 1,
    status: "failed",
    elapsed_ms: 2,
    error_code: "bedrock_unavailable",
    retry_delay_ms: 0,
  });
  models[0].attempts[1].attempt = 2;
  models[0].attempts[1].retry_delay_ms = 10_000;
  models[0].elapsed_ms = 10_010;
  const report = await buildSecondReviewReport(
    models,
    source,
    original,
    10_015,
  );
  for (const deadline of ["model_timeout_ms", "overall_timeout_ms"] as const) {
    const invalid = structuredClone(report);
    invalid.execution[deadline] = 10_002;
    await expect(
      validateSecondReviewReport(invalid, source, original),
    ).rejects.toThrow("deadline");
  }
  for (const code of [
    "bedrock_access",
    "bedrock_filtered",
    "bedrock_configuration",
    "cancelled",
    "incomplete",
  ]) {
    const invalid = structuredClone(report);
    invalid.models[0].attempts[0].error_code = code;
    await expect(
      validateSecondReviewReport(invalid, source, original),
    ).rejects.toThrow("does not permit retrying");
  }
});

test("slot prompts and recovery policies cannot be retroactively attached to old reports", async () => {
  const original = await baseline();
  const report = await buildSecondReviewReport(
    reassessments(original),
    source,
    original,
    10,
  );
  for (const change of [
    { policy_version: "targeted-peer-review-v2" },
    { policy_version: "targeted-peer-review-v3-network-recovery" },
    { prompt_version: "targeted-peer-review-v3-source-spans" },
    { prompt_version: "targeted-peer-review-v6-stable-slots-grok-medium" },
    { policy_version: "future-policy" },
  ]) {
    await expect(
      validateSecondReviewReport({ ...report, ...change }, source, original),
    ).rejects.toThrow("Invalid second-review report");
  }
});

test("legacy reports cannot silently acquire second-review provenance", async () => {
  const current = await baseline();
  const models = structuredClone(current.models);
  models.forEach((model) => delete model.attempts);
  const legacy = await buildCouncilReport(models, source, 10);
  expect(() => buildSecondReviewPlan(legacy)).toThrow("version 2.1");
  await expect(buildSecondReviewReport([], source, legacy, 0)).rejects.toThrow(
    "version 2.1",
  );
});

test("combined Markdown retains original source, independent votes and explicit peer judgments", async () => {
  const original = await baseline();
  const report = await buildSecondReviewReport(
    reassessments(original, ["not_supported", "supported", "uncertain"]),
    source,
    original,
    10,
  );
  const output = await secondReviewMarkdown(
    original,
    report,
    await analyzeStatic("TestCalls.sol", source),
  );
  expect(output).toContain("First-round agreement: 2/3 (MEDIUM) — unchanged");
  expect(output).toContain("Recorded second-round outcome: unresolved");
  expect(output).toContain("not additional independent votes");
  expect(output).toContain("not a provider signature");
  expect(output).toContain("Original first-round report — unchanged");
  expect(output).toContain("pragma solidity");
  expect(output).toContain("Reported tokens: 120 input / 90 output");
});

test("targeted peer review assigns omissions only and carries original support without a fabricated second vote", async () => {
  const original = await baseline(1, ["HIGH", "empty", "empty"]);
  const plan = buildSecondReviewPlan(original);
  expect(plan.model_ids).toEqual(
    BEDROCK_MODELS.slice(1).map((item) => item.id),
  );
  expect(plan.unassigned_model_ids).toEqual([BEDROCK_MODELS[0].id]);
  expect(assignedSecondReviewCandidates(plan, BEDROCK_MODELS[0].id)).toEqual(
    [],
  );
  const report = await buildSecondReviewReport(
    reassessments(original),
    source,
    original,
    10,
  );
  expect(report.execution.total_attempts).toBe(2);
  expect(report.findings[0].status).toBe("supported");
  expect(report.findings[0].supporting_models).toHaveLength(3);
  expect(
    report.models.some((run) => run.model_id === BEDROCK_MODELS[0].id),
  ).toBe(false);
  const final = buildFinalReviewReport(original, report);
  expect(final.findings[0].judgments[0]).toMatchObject({
    first_round: "reported",
    second_round: "not_assigned",
    opinion_source: "first_round",
  });
  expect(final.findings[0].judgments[1]).toMatchObject({
    first_round: "not_reported",
    second_round: "supported",
    opinion_source: "second_round",
  });
  expect(original.findings[0].agreement).toBe(1);
  expect(await validateSecondReviewReport(report, source, original)).toEqual(
    report,
  );
});

test("a failed first-round model alone creates no actionable peer assignment", async () => {
  const original = await baseline(1, ["HIGH", "HIGH", "failed"]);
  const plan = buildSecondReviewPlan(original);
  expect(plan.skipped_reason).toBe("no_eligible_assignments");
  expect(plan.model_ids).toEqual([]);
  expect(plan.candidate_ids).toEqual([]);
  expect(plan.deferred_ids).toEqual([original.findings[0].id]);
  const report = await buildSecondReviewReport([], source, original, 0);
  expect(report.execution.total_attempts).toBe(0);
  const final = buildFinalReviewReport(original, report);
  expect(final.findings[0].outcome).toBe("unresolved");
  expect(final.findings[0].missing_models).toEqual([BEDROCK_MODELS[2].id]);
});

test("each model receives only its missing claim IDs in a mixed assignment batch", async () => {
  const original = await baseline(2, ["HIGH", "HIGH", "empty"]);
  // Model 2 omitted one of two operations; reconstruct rather than tamper aggregates.
  const models = structuredClone(original.models);
  models[1].review!.findings.pop();
  const first = await buildCouncilReport(
    models,
    source,
    10,
    original.execution!,
  );
  const plan = buildSecondReviewPlan(first);
  expect(
    assignedSecondReviewCandidates(plan, BEDROCK_MODELS[0].id),
  ).toHaveLength(0);
  expect(
    assignedSecondReviewCandidates(plan, BEDROCK_MODELS[1].id),
  ).toHaveLength(1);
  expect(
    assignedSecondReviewCandidates(plan, BEDROCK_MODELS[2].id),
  ).toHaveLength(2);
  const report = await buildSecondReviewReport(
    reassessments(first),
    source,
    first,
    10,
  );
  expect(report.findings.every((item) => item.status === "supported")).toBe(
    true,
  );
  const forged = structuredClone(report);
  forged.models[0].review!.assessments.push(
    structuredClone(
      forged.models[1].review!.assessments.find(
        (item) =>
          item.finding_id !==
          forged.models[0].review!.assessments[0].finding_id,
      )!,
    ),
  );
  await expect(
    validateSecondReviewReport(forged, source, first),
  ).rejects.toThrow();
});

test("consolidated report retains unanimous, deferred and unreviewed claims with separate severity alignment", async () => {
  const unanimous = await baseline(1, ["HIGH", "HIGH", "HIGH"]);
  const firstOnly = buildFinalReviewReport(unanimous);
  expect(firstOnly.findings[0]).toMatchObject({
    outcome: "supported",
    review_state: "first_round",
    first_round_agreement: 3,
  });
  const disputed = await baseline(14);
  const report = await buildSecondReviewReport(
    reassessments(
      disputed,
      ["supported", "supported", "supported"],
      ["HIGH", "LOW", "HIGH"],
    ),
    source,
    disputed,
    10,
  );
  const final = buildFinalReviewReport(disputed, report);
  expect(final.findings).toHaveLength(14);
  expect(final.findings[0]).toMatchObject({
    outcome: "supported",
    severity_disagreement: true,
  });
  expect(
    final.findings.filter((item) => item.review_state === "deferred"),
  ).toHaveLength(2);
  expect(
    buildFinalReviewReport(disputed).findings.every(
      (item) => item.review_state === "not_reviewed",
    ),
  ).toBe(true);
});

test("validated legacy second-round records retain their original all-reviewer policy", async () => {
  const original = await baseline();
  const report = await buildSecondReviewReport(
    reassessments(original),
    source,
    original,
    10,
  );
  report.schema_version = "1.0.0";
  report.policy_version = "bounded-second-review-v1";
  Object.assign(report.execution, legacyLimits);
  report.prompt_version = "peer-informed-review-v1";
  delete report.plan.assignments;
  delete report.plan.unassigned_model_ids;
  expect(await validateSecondReviewReport(report, source, original)).toEqual(
    report,
  );
});

test("source-span prompt records citation provenance and keeps historical report semantics", async () => {
  const original = await baseline();
  const report = await buildSecondReviewReport(
    reassessments(original),
    source,
    original,
    10,
  );
  expect(report.prompt_version).toBe(SECOND_REVIEW_PROMPT_VERSION);
  expect(report.policy_version).toBe(SECOND_REVIEW_POLICY_VERSION);
  expect(await validateSecondReviewReport(report, source, original)).toEqual(
    report,
  );
  const retrieved =
    "Model-selected lines; excerpt retrieved from the submitted source.";
  const quoted = "Model-provided excerpt; exact match to the submitted source.";
  expect(secondReviewEvidenceMethod(report, BEDROCK_MODELS[2].id)).toBe(
    retrieved,
  );
  for (const model of BEDROCK_MODELS.slice(0, 2)) {
    expect(secondReviewEvidenceMethod(report, model.id)).toBe(retrieved);
  }
  const markdown = await secondReviewMarkdown(original, report);
  expect(markdown.match(/Model-selected lines/g)).toHaveLength(4);
  expect(markdown).not.toContain(quoted);
  const historical = structuredClone(report);
  historical.policy_version = "targeted-peer-review-v2";
  Object.assign(historical.execution, legacyLimits);
  historical.prompt_version = "targeted-peer-review-v2";
  expect(
    await validateSecondReviewReport(historical, source, original),
  ).toEqual(historical);
  expect(secondReviewEvidenceMethod(historical, BEDROCK_MODELS[2].id)).toBe(
    quoted,
  );
  const oldMarkdown = (await secondReviewMarkdown(original, historical)).split(
    "## Original first-round report",
  )[0];
  expect(oldMarkdown).not.toContain(retrieved);
  expect(oldMarkdown.match(/Model-provided excerpt/g)).toHaveLength(3);
  expect(buildFinalReviewReport(original, historical)).toEqual(
    buildFinalReviewReport(original, report),
  );
  historical.prompt_version = "targeted-peer-review-v3-source-spans";
  expect(
    await validateSecondReviewReport(historical, source, original),
  ).toEqual(historical);
  expect(secondReviewEvidenceMethod(historical, BEDROCK_MODELS[2].id)).toBe(
    retrieved,
  );
  historical.policy_version = "targeted-peer-review-v3-network-recovery";
  Object.assign(historical.execution, legacyLimits);
  historical.prompt_version = "targeted-peer-review-v4-slots";
  expect(
    await validateSecondReviewReport(historical, source, original),
  ).toEqual(historical);
  for (const model of BEDROCK_MODELS) {
    expect(secondReviewEvidenceMethod(historical, model.id)).toBe(
      model.id === BEDROCK_MODELS[2].id ? retrieved : quoted,
    );
    expect(secondReviewReasoningEffort(historical, model.id)).toBe(
      "provider default",
    );
    expect(secondReviewReasoningEffort(report, model.id)).toBe(
      model.id === BEDROCK_MODELS[2].id ? "medium" : "provider default",
    );
  }
});

test("unrecognized prompt versions and incompatible historical envelopes are rejected", async () => {
  const original = await baseline();
  const report = await buildSecondReviewReport(
    reassessments(original),
    source,
    original,
    10,
  );
  await expect(
    validateSecondReviewReport(
      { ...report, prompt_version: "future-unrecognized" },
      source,
      original,
    ),
  ).rejects.toThrow("Invalid second-review report");
  await expect(
    validateSecondReviewReport(
      {
        ...report,
        schema_version: "1.0.0",
        policy_version: "bounded-second-review-v1",
      },
      source,
      original,
    ),
  ).rejects.toThrow("Invalid second-review report");
});

test("combined export rejects a different first-round record even for identical source", async () => {
  const original = await baseline();
  const report = await buildSecondReviewReport(
    reassessments(original),
    source,
    original,
    10,
  );
  const changed = structuredClone(original);
  changed.created_at = "2026-10-28T12:00:00.000Z";
  await expect(secondReviewMarkdown(changed, report)).rejects.toThrow(
    "exact same baseline",
  );
});

test("consolidation preserves conflicting first-round severities even within one model", async () => {
  const original = await baseline(1, ["HIGH", "HIGH", "HIGH"]);
  const models = structuredClone(original.models);
  models[0].review!.findings.push({
    ...structuredClone(models[0].review!.findings[0]),
    proposed_severity: "LOW",
    title: "Alternate severity assessment of the unchecked call",
  });
  const first = await buildCouncilReport(
    models,
    source,
    10,
    original.execution!,
  );
  expect(first.findings[0].agreement).toBe(3);
  expect(first.findings[0].severity_disagreement).toBe(true);
  expect(buildFinalReviewReport(first).findings[0].severity_disagreement).toBe(
    true,
  );
  const report = await buildSecondReviewReport(
    reassessments(first),
    source,
    first,
    10,
  );
  expect(
    buildFinalReviewReport(first, report).findings[0].severity_disagreement,
  ).toBe(false);
});

test("stable-slot prompts do not relabel previous source-span judgments", async () => {
  const original = await baseline();
  const current = await buildSecondReviewReport(
    reassessments(original),
    source,
    original,
    10,
  );
  const prior = structuredClone(current);
  prior.policy_version = "targeted-peer-review-v3-network-recovery";
  Object.assign(prior.execution, legacyLimits);
  prior.prompt_version = "targeted-peer-review-v5-source-spans-grok-medium";
  expect(await validateSecondReviewReport(prior, source, original)).toEqual(
    prior,
  );
  expect(prior.prompt_version).not.toBe(SECOND_REVIEW_PROMPT_VERSION);
  for (const model of BEDROCK_MODELS) {
    expect(secondReviewEvidenceMethod(prior, model.id)).toContain(
      "Model-selected lines",
    );
    expect(secondReviewReasoningEffort(prior, model.id)).toBe(
      model.id === BEDROCK_MODELS[2].id ? "medium" : "provider default",
    );
  }
  prior.policy_version = "targeted-peer-review-v2";
  Object.assign(prior.execution, legacyLimits);
  await expect(
    validateSecondReviewReport(prior, source, original),
  ).rejects.toThrow("Invalid second-review report");
});

for (const failure of ["invalid_evidence", "invalid_report"] as const) {
  test(`${failure} correction records two calls but one accepted second-round judgment`, async () => {
    const original = await baseline();
    const originalSnapshot = structuredClone(original);
    const clean = await buildSecondReviewReport(
      reassessments(original),
      source,
      original,
      10,
    );
    const models = reassessments(original);
    models[0].attempts.unshift({
      attempt: 1,
      status: "failed",
      elapsed_ms: 18,
      error_code: failure,
      retry_delay_ms: 0,
    });
    models[0].attempts[1].attempt = 2;
    models[0].elapsed_ms = 26;
    const corrected = await buildSecondReviewReport(
      models,
      source,
      original,
      30,
    );

    expect(corrected.policy_version).toBe(SECOND_REVIEW_POLICY_VERSION);
    expect(corrected.prompt_version).toBe(
      "targeted-peer-review-v7-bounded-evidence-correction-grok-medium",
    );
    expect(corrected.execution.total_attempts).toBe(4);
    expect(corrected.models[0].attempts.map((item) => item.error_code)).toEqual(
      [failure, null],
    );
    expect(corrected.models[0].review).toEqual(clean.models[0].review);
    expect(corrected.findings).toEqual(clean.findings);
    expect(corrected.models[0].review!.assessments).toHaveLength(1);
    expect(original).toEqual(originalSnapshot);
    expect(
      await validateSecondReviewReport(corrected, source, original),
    ).toEqual(corrected);

    for (const historical of [
      {
        policy_version: "targeted-peer-review-v3-network-recovery",
        prompt_version: "targeted-peer-review-v6-stable-slots-grok-medium",
      },
      {
        policy_version: "targeted-peer-review-v2",
        prompt_version: "targeted-peer-review-v3-source-spans",
      },
    ]) {
      await expect(
        validateSecondReviewReport(
          { ...corrected, ...historical },
          source,
          original,
        ),
      ).rejects.toThrow("does not permit retrying");
    }
    for (const field of ["model_timeout_ms", "overall_timeout_ms"] as const) {
      const expired = structuredClone(corrected);
      expired.execution[field] = 18;
      await expect(
        validateSecondReviewReport(expired, source, original),
      ).rejects.toThrow("deadline");
    }
    const thirdAttempt = structuredClone(corrected);
    thirdAttempt.models[0].attempts[1].status = "failed";
    thirdAttempt.models[0].attempts[1].error_code = failure;
    thirdAttempt.models[0].attempts.push({
      attempt: 3,
      status: "succeeded",
      elapsed_ms: 8,
      error_code: null,
      retry_delay_ms: 0,
    });
    thirdAttempt.models[0].elapsed_ms = 34;
    thirdAttempt.elapsed_ms = 35;
    thirdAttempt.execution.total_attempts = 5;
    expect(
      await validateSecondReviewReport(thirdAttempt, source, original),
    ).toEqual(thirdAttempt);
    const legacy = structuredClone(thirdAttempt);
    legacy.policy_version = "targeted-peer-review-v4-validation-correction";
    Object.assign(legacy.execution, legacyLimits);
    await expect(
      validateSecondReviewReport(legacy, source, original),
    ).rejects.toThrow("attempt history");
    const fourth = structuredClone(thirdAttempt);
    fourth.models[0].attempts[2].status = "failed";
    fourth.models[0].attempts[2].error_code = failure;
    fourth.models[0].attempts.push({
      attempt: 4,
      status: "succeeded",
      elapsed_ms: 8,
      error_code: null,
      retry_delay_ms: 0,
    });
    fourth.models[0].elapsed_ms = 42;
    fourth.elapsed_ms = 45;
    fourth.execution.total_attempts = 6;
    await expect(
      validateSecondReviewReport(fourth, source, original),
    ).rejects.toThrow("attempt history");
  });
}

test("failed evidence correction preserves the rejected attempts and original evidence without inventing support", async () => {
  const original = await baseline(1, ["HIGH", "LOW", "HIGH"]);
  const originalSnapshot = structuredClone(original);
  const models = reassessments(original, ["supported", null, "supported"]);
  const failed = models[1];
  failed.error = {
    code: "invalid_evidence",
    detail: "The corrected response still has an invalid source span.",
  };
  failed.attempts = [
    {
      attempt: 1,
      status: "failed",
      elapsed_ms: 8,
      error_code: "invalid_evidence",
      retry_delay_ms: 0,
    },
    {
      attempt: 2,
      status: "failed",
      elapsed_ms: 8,
      error_code: "invalid_evidence",
      retry_delay_ms: 0,
    },
  ];
  failed.elapsed_ms = 16;
  const second = await buildSecondReviewReport(models, source, original, 20);
  const rawSnapshot = structuredClone(second);
  expect(second.status).toBe("partial");
  expect(second.execution.total_attempts).toBe(4);
  expect(second.models[1].review).toBeNull();
  expect(second.findings[0].supporting_models).toHaveLength(2);
  expect(second.findings[0].missing_models).toEqual([failed.model_id]);

  const final = buildFinalReviewReport(original, second);
  expect(final.findings[0].supporting_models).toHaveLength(3);
  expect(final.findings[0].pending_reassessment_models).toEqual([
    failed.model_id,
  ]);
  expect(final.findings[0].requires_review).toBe(true);
  expect(final.findings[0].judgments[1]).toMatchObject({
    opinion_source: "first_round",
    second_round: "failed",
  });
  expect(second).toEqual(rawSnapshot);
  expect(original).toEqual(originalSnapshot);
  expect(await validateSecondReviewReport(second, source, original)).toEqual(
    rawSnapshot,
  );
});

test("historical network recovery remains valid without gaining validation-correction provenance", async () => {
  const original = await baseline();
  const models = reassessments(original);
  models[0].attempts.unshift({
    attempt: 1,
    status: "failed",
    elapsed_ms: 2,
    error_code: "bedrock_network",
    retry_delay_ms: 0,
  });
  models[0].attempts[1].attempt = 2;
  models[0].attempts[1].retry_delay_ms = 10_000;
  models[0].elapsed_ms = 10_010;
  const historical = await buildSecondReviewReport(
    models,
    source,
    original,
    10_015,
  );
  historical.policy_version = "targeted-peer-review-v3-network-recovery";
  Object.assign(historical.execution, legacyLimits);
  for (const prompt of [
    "targeted-peer-review-v4-slots",
    "targeted-peer-review-v5-source-spans-grok-medium",
    "targeted-peer-review-v6-stable-slots-grok-medium",
  ] as const) {
    historical.prompt_version = prompt;
    expect(
      await validateSecondReviewReport(historical, source, original),
    ).toEqual(historical);
    await expect(
      validateSecondReviewReport(
        { ...historical, policy_version: SECOND_REVIEW_POLICY_VERSION },
        source,
        original,
      ),
    ).rejects.toThrow("Invalid second-review report");
  }
  for (const model of BEDROCK_MODELS) {
    expect(secondReviewEvidenceMethod(historical, model.id)).toContain(
      "Model-selected lines",
    );
    expect(secondReviewReasoningEffort(historical, model.id)).toBe(
      model.id === BEDROCK_MODELS[2].id ? "medium" : "provider default",
    );
  }
});

test("extended second review records remote model-timeout recovery within one shared budget", async () => {
  const original = await baseline();
  const models = reassessments(original);
  for (const model of models) {
    model.attempts = [
      {
        attempt: 1,
        status: "failed",
        elapsed_ms: 120_000,
        error_code: "bedrock_model_timeout",
        retry_delay_ms: 0,
      },
      {
        attempt: 2,
        status: "failed",
        elapsed_ms: 50_000,
        error_code: "invalid_evidence",
        retry_delay_ms: 500,
      },
      {
        attempt: 3,
        status: "succeeded",
        elapsed_ms: 8,
        error_code: null,
        retry_delay_ms: 30_000,
      },
    ];
    model.elapsed_ms = 200_508;
  }
  const report = await buildSecondReviewReport(
    models,
    source,
    original,
    200_520,
  );
  expect(await validateSecondReviewReport(report, source, original)).toEqual(
    report,
  );
  expect(report.execution.total_attempts).toBe(9);
  expect(report.findings[0].supporting_models).toHaveLength(3);
  expect(
    report.models.every((model) => model.review!.assessments.length === 1),
  ).toBe(true);
  const prior = await buildSecondReviewReport(
    reassessments(original),
    source,
    original,
    10,
  );
  prior.policy_version = "targeted-peer-review-v4-validation-correction";
  Object.assign(prior.execution, legacyLimits);
  expect(await validateSecondReviewReport(prior, source, original)).toEqual(
    prior,
  );
  for (const altered of [
    { model_timeout_ms: 180_001 },
    { overall_timeout_ms: 210_001 },
    { max_attempts_per_model: 3 },
    { total_attempts: 7 },
  ]) {
    const invalid = structuredClone(prior);
    Object.assign(invalid.execution, altered);
    await expect(
      validateSecondReviewReport(invalid, source, original),
    ).rejects.toThrow("execution accounting");
  }
  const remoteTimeout = structuredClone(prior);
  remoteTimeout.models[0].attempts.unshift({
    attempt: 1,
    status: "failed",
    elapsed_ms: 1,
    error_code: "bedrock_model_timeout",
    retry_delay_ms: 0,
  });
  remoteTimeout.models[0].attempts[1].attempt = 2;
  remoteTimeout.models[0].elapsed_ms = 9;
  remoteTimeout.execution.total_attempts = 4;
  await expect(
    validateSecondReviewReport(remoteTimeout, source, original),
  ).rejects.toThrow("does not permit retrying");
  remoteTimeout.models[0].attempts[0].error_code = "invalid_evidence";
  expect(
    await validateSecondReviewReport(remoteTimeout, source, original),
  ).toEqual(remoteTimeout);
});

test("extended second-round imports reject late accepted judgments without changing historical or failed outcomes", async () => {
  const original = await baseline();
  const report = await buildSecondReviewReport(
    reassessments(original),
    source,
    original,
    10,
  );
  const late = structuredClone(report);
  late.models[0].elapsed_ms = 270_011;
  late.models[0].attempts[0].elapsed_ms = 270_011;
  late.elapsed_ms = 270_012;
  await expect(
    validateSecondReviewReport(late, source, original),
  ).rejects.toThrow("execution deadline");
  const earlierRound = structuredClone(report);
  earlierRound.execution.overall_timeout_ms = 10;
  earlierRound.models[0].elapsed_ms = 21;
  earlierRound.models[0].attempts[0].elapsed_ms = 21;
  earlierRound.elapsed_ms = 22;
  await expect(
    validateSecondReviewReport(earlierRound, source, original),
  ).rejects.toThrow("execution deadline");
  const historical = structuredClone(late);
  historical.policy_version = "targeted-peer-review-v4-validation-correction";
  Object.assign(historical.execution, legacyLimits);
  expect(
    await validateSecondReviewReport(historical, source, original),
  ).toEqual(historical);
  late.models[0].status = "failed";
  late.models[0].review = null;
  late.models[0].error = { code: "timeout", detail: "Model deadline reached." };
  late.models[0].attempts[0].status = "failed";
  late.models[0].attempts[0].error_code = "timeout";
  const timedOut = await buildSecondReviewReport(
    late.models,
    source,
    original,
    late.elapsed_ms,
  );
  expect(timedOut.status).toBe("partial");
  expect(timedOut.models[0].error!.code).toBe("timeout");
});
