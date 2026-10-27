import { expect, test } from "@playwright/test";
import Ajv from "ajv";
import type { ReviewFinding } from "../src/generated/review";
import { BEDROCK, BEDROCK_MODELS } from "../src/lib/bedrock-config";
import {
  buildCouncilReport,
  type CouncilReport,
  type ModelRun,
} from "../src/lib/orchestration";
import { POLICY_VERSION, PROMPT_VERSION } from "../src/lib/review-policy";
import {
  bindSecondReviewContent,
  buildSecondReviewPlan,
  buildSecondReviewReport,
  secondReviewBaselineHash,
  secondReviewResponseSchema,
  validateSecondReviewReport,
  type SecondReviewAssessment,
  type SecondReviewModelRun,
  type SecondReviewReport,
} from "../src/lib/second-review";
import { secondReviewMarkdown } from "../src/lib/second-review-export";
import { analyzeStatic, sha256, sourceLines } from "../src/lib/static-analysis";

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
    max_attempts_per_model: 2,
    model_timeout_ms: 180_000,
    overall_timeout_ms: 210_000,
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
): WireContent {
  const plan = buildSecondReviewPlan(original);
  return {
    summary: "Peer-informed claim reassessment.",
    assessments: plan.candidate_ids.map((finding_id) => {
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
                wire(original, verdict, severities[i]),
                source,
                plan.candidate_ids,
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
    "unresolved",
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
  ).rejects.toThrow("non-transient");
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
  const output = secondReviewMarkdown(
    original,
    report,
    await analyzeStatic("TestCalls.sol", source),
  );
  expect(output).toContain("First-round agreement: 2/3 (MEDIUM) — unchanged");
  expect(output).toContain("Second-round outcome: unresolved");
  expect(output).toContain("not additional independent votes");
  expect(output).toContain("not a provider signature");
  expect(output).toContain("Original first-round report — unchanged");
  expect(output).toContain("pragma solidity");
  expect(output).toContain("Reported tokens: 120 input / 90 output");
});
