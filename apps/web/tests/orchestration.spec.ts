import { expect, test } from "@playwright/test";
import type { ReviewFinding } from "../src/generated/review";
import { BEDROCK, BEDROCK_MODELS } from "../src/lib/bedrock-config";
import {
  buildCouncilReport,
  validateCouncil,
  firstReviewEvidenceMethod,
  firstReviewReasoningEffort,
  type ModelRun,
  type ModelAttempt,
  type CouncilReport,
  type ExecutionProvenance,
} from "../src/lib/orchestration";
import { councilMarkdown } from "../src/lib/council-export";
import { analyzeStatic, sha256, sourceLines } from "../src/lib/static-analysis";
import {
  POLICY_VERSION,
  PROMPT_VERSION,
  REVIEW_POLICY,
  LEGACY_REVIEW_POLICY,
} from "../src/lib/review-policy";

const legacyLimits = {
  max_attempts_per_model: LEGACY_REVIEW_POLICY.max_attempts_per_model,
  model_timeout_ms: LEGACY_REVIEW_POLICY.model_timeout_ms,
  overall_timeout_ms: LEGACY_REVIEW_POLICY.overall_timeout_ms,
};

const source = [
  "pragma solidity ^0.8.20;",
  "contract Vault {",
  "  mapping(address => uint) balances;",
  "  function withdraw() external {",
  "    uint amount = balances[msg.sender];",
  '    (bool ok,) = msg.sender.call{value: amount}("");',
  "    require(ok);",
  "    balances[msg.sender] = 0;",
  "  }",
  "  function rescue(address payable recipient) external {",
  "    require(tx.origin == recipient);",
  '    recipient.call{value: 1}("");',
  '    recipient.call{value: 2}("");',
  "  }",
  "}",
].join("\n");

function finding(
  title = "Reentrancy in withdrawal",
  start = 6,
  end = start,
  category = "reentrancy",
  severity: ReviewFinding["proposed_severity"] = "HIGH",
  input = source,
): ReviewFinding {
  return {
    title,
    category,
    proposed_severity: severity,
    rationale: "The source operation requires review in its execution context.",
    recommendation:
      "Review permissions and state changes before external calls.",
    evidence: {
      line_start: start,
      line_end: end,
      excerpt: sourceLines(input)
        .slice(start - 1, end)
        .join("\n"),
      validation: "source-bound",
    },
  };
}

async function runs(
  contributions: (ReviewFinding[] | null)[],
  input = source,
): Promise<ModelRun[]> {
  const hash = await sha256(input);
  return BEDROCK_MODELS.map((model, index) => ({
    model_id: model.id,
    label: model.label,
    status: contributions[index] === null ? "failed" : "succeeded",
    elapsed_ms: 12,
    error:
      contributions[index] === null
        ? {
            code: "model_unavailable",
            detail: "The selected model is unavailable in this account.",
          }
        : null,
    review:
      contributions[index] === null
        ? null
        : {
            summary: "Independent source review.",
            findings: contributions[index],
            provider: "aws-bedrock",
            model_id: model.id,
            region: BEDROCK.region,
            protocol: BEDROCK.protocol,
            source_sha256: hash,
            created_at: new Date().toISOString(),
            elapsed_ms: 12,
            input_tokens: 100,
            output_tokens: 80,
          },
  }));
}

for (const [count, confidence] of [
  [1, "LOW"],
  [2, "MEDIUM"],
  [3, "HIGH"],
] as const) {
  test(`${count} distinct model contributions produce ${confidence} agreement confidence`, async () => {
    const contributions = BEDROCK_MODELS.map((_, index) =>
      index < count
        ? [
            finding(
              `Withdrawal candidate ${index}`,
              index === 0 ? 6 : 5,
              index === 0 ? 6 : 8,
              index === 2 ? "Re-entrancy" : "reentrancy",
            ),
          ]
        : [],
    );
    const report = await buildCouncilReport(
      await runs(contributions),
      source,
      20,
    );
    expect(report.status).toBe("completed");
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].confidence).toBe(confidence);
    expect(report.findings[0].agreement).toBe(count);
    expect(report.findings[0].supporting_models).toEqual(
      BEDROCK_MODELS.slice(0, count).map((model) => model.id),
    );
    expect(
      await validateCouncil(JSON.parse(JSON.stringify(report)), source),
    ).toEqual(report);
  });
}

test("differently worded duplicates from one model retain raw members without inflating support", async () => {
  const models = await runs([
    [finding(), finding("External call before balance update", 5, 8)],
    [finding("Potential recursive withdrawal", 6, 8, "Re-entrancy")],
    [],
  ]);
  const report = await buildCouncilReport(models, source, 25);
  expect(report.findings).toHaveLength(1);
  expect(report.findings[0].agreement).toBe(2);
  expect(report.findings[0].confidence).toBe("MEDIUM");
  expect(report.findings[0].members).toEqual([
    { model_id: BEDROCK_MODELS[0].id, finding_index: 0 },
    { model_id: BEDROCK_MODELS[0].id, finding_index: 1 },
    { model_id: BEDROCK_MODELS[1].id, finding_index: 0 },
  ]);
  expect(report.models[0].review?.findings).toHaveLength(2);
});

test("separate functions, separate call sites and separate weaknesses do not merge", async () => {
  const items = [
    finding(),
    finding("Rescue call", 12),
    finding("Another rescue call", 13),
    finding("Unchecked result", 12, 12, "unchecked-call"),
  ];
  const report = await buildCouncilReport(
    await runs([items, [], []]),
    source,
    20,
  );
  expect(report.findings).toHaveLength(4);
  expect(new Set(report.findings.map((item) => item.id)).size).toBe(4);
  expect(report.findings.every((item) => item.confidence === "LOW")).toBe(true);
});

test("broad evidence containing multiple operations is not guessed to identify one site", async () => {
  const items = [
    finding("First call reentrancy", 12),
    finding("Second call reentrancy", 13),
  ];
  const report = await buildCouncilReport(
    await runs([items, [finding("Rescue external interaction", 12, 13)], []]),
    source,
    20,
  );
  expect(report.findings).toHaveLength(3);
  expect(report.findings.every((item) => item.agreement === 1)).toBe(true);
});

test("unknown weaknesses at the same source remain distinct", async () => {
  const report = await buildCouncilReport(
    await runs([
      [finding("Accounting inconsistency", 6, 6, "other")],
      [finding("Unsupported token callback", 6, 6, "other")],
      [],
    ]),
    source,
    20,
  );
  expect(report.findings).toHaveLength(2);
});

for (const [category, expected] of [
  ["constructor", "constructor"],
  ["__proto__", "proto"],
  ["toString", "tostring"],
] as const) {
  test(`prototype-like category ${category} stays a serialized string`, async () => {
    const report = await buildCouncilReport(
      await runs([[finding("Unknown weakness", 6, 6, category)], [], []]),
      source,
      20,
    );
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].category).toBe(expected);
    const serialized = JSON.parse(JSON.stringify(report));
    expect(serialized.findings[0].category).toBe(expected);
    expect(await validateCouncil(serialized, source)).toEqual(report);
  });
}

test("access-control windows in one function merge, but different functions remain separate", async () => {
  const report = await buildCouncilReport(
    await runs([
      [finding("Missing access check", 10, 10, "missing-access-control")],
      [finding("Unrestricted rescue", 12, 13, "access-control")],
      [finding("Unrestricted withdrawal", 4, 8, "access-control")],
    ]),
    source,
    20,
  );
  expect(report.findings).toHaveLength(2);
  expect(report.findings.map((item) => item.agreement).sort()).toEqual([1, 2]);
});

test("specific tx.origin findings normalize across broader access-control labels", async () => {
  const report = await buildCouncilReport(
    await runs([
      [finding("Unsafe tx.origin authorization", 11, 11, "Access control")],
      [
        finding(
          "Origin-based authentication",
          10,
          12,
          "tx-origin-authorization",
        ),
      ],
      [],
    ]),
    source,
    20,
  );
  expect(report.findings).toHaveLength(1);
  expect(report.findings[0].category).toBe("tx-origin");
  expect(report.findings[0].agreement).toBe(2);
});

test("different access-control causes in one function do not acquire false agreement", async () => {
  const report = await buildCouncilReport(
    await runs([
      [finding("Incorrect role hierarchy", 10, 12, "access-control")],
      [finding("Caller comparison is inverted", 11, 11, "access-control")],
      [finding("Missing access check", 10, 10, "access-control")],
    ]),
    source,
    20,
  );
  expect(report.findings).toHaveLength(3);
  expect(report.findings.every((item) => item.agreement === 1)).toBe(true);
});

test("severity disagreement stays visible and aggregate retains the highest proposed severity", async () => {
  const report = await buildCouncilReport(
    await runs([
      [finding("Withdrawal call", 6, 6, "reentrancy", "LOW")],
      [finding("Reentrant balance", 5, 8, "reentrancy", "HIGH")],
      [finding("Recursive withdrawal", 6, 8, "reentrancy", "MEDIUM")],
    ]),
    source,
    20,
  );
  expect(report.findings[0].proposed_severity).toBe("HIGH");
  expect(report.findings[0].severity_disagreement).toBe(true);
  expect(report.findings[0].confidence).toBe("HIGH");
  expect(
    report.models.map((model) => model.review?.findings[0].proposed_severity),
  ).toEqual(["LOW", "HIGH", "MEDIUM"]);
});

test("failed models remain explicit and do not renormalize agreement", async () => {
  const report = await buildCouncilReport(
    await runs([[finding()], null, null]),
    source,
    20,
  );
  expect(report.status).toBe("partial");
  expect(report.models).toHaveLength(3);
  expect(report.findings[0].agreement).toBe(1);
  expect(report.findings[0].confidence).toBe("LOW");
  expect(
    report.models.filter((model) => model.status === "failed"),
  ).toHaveLength(2);
  expect(await validateCouncil(report, source)).toEqual(report);
});

test("all model failures are a failed report, not a clean review", async () => {
  const report = await buildCouncilReport(
    await runs([null, null, null]),
    source,
    20,
  );
  expect(report.status).toBe("failed");
  expect(report.findings).toEqual([]);
  expect(await validateCouncil(report, source)).toEqual(report);
});

test("three successful empty reviews complete without inventing findings", async () => {
  const report = await buildCouncilReport(await runs([[], [], []]), source, 20);
  expect(report.status).toBe("completed");
  expect(report.findings).toEqual([]);
});

test("comments and string literals do not create operation anchors", async () => {
  const input = [
    "contract A {",
    'function x() external { string memory note = "recipient.call()";',
    "// recipient.call();",
    'recipient.call("");',
    "}",
    "}",
  ].join("\n");
  const report = await buildCouncilReport(
    await runs(
      [
        [finding("Candidate one", 2, 4, "unchecked-call", "MEDIUM", input)],
        [
          finding(
            "Candidate two",
            4,
            4,
            "unchecked-low-level-call",
            "MEDIUM",
            input,
          ),
        ],
        [],
      ],
      input,
    ),
    input,
    20,
  );
  expect(report.findings).toHaveLength(1);
  expect(report.findings[0].agreement).toBe(2);
});

test("CRLF source binds to its exact hash while using normalized source evidence", async () => {
  const input = source.replace(/\n/g, "\r\n");
  const report = await buildCouncilReport(
    await runs([[finding()], [finding("Other phrasing", 5, 8)], []], input),
    input,
    20,
  );
  expect(report.findings).toHaveLength(1);
  expect(await validateCouncil(report, input)).toEqual(report);
  await expect(validateCouncil(report, source)).rejects.toThrow(
    "does not match this source",
  );
});

test("aggregation is independent of model result arrival order and gives stable finding IDs", async () => {
  const models = await runs([
    [finding()],
    [finding("Other phrasing", 5, 8)],
    [],
  ]);
  const first = await buildCouncilReport(models, source, 20);
  const second = await buildCouncilReport([...models].reverse(), source, 40);
  expect(first.findings).toEqual(second.findings);
  expect(first.models.map((model) => model.model_id)).toEqual(
    BEDROCK_MODELS.map((model) => model.id),
  );
});

for (const [name, mutate] of [
  [
    "agreement",
    (value: CouncilReport) => {
      value.findings[0].agreement = 3;
    },
  ],
  [
    "confidence",
    (value: CouncilReport) => {
      value.findings[0].confidence = "HIGH";
    },
  ],
  [
    "support",
    (value: CouncilReport) => {
      value.findings[0].supporting_models.push(BEDROCK_MODELS[1].id);
    },
  ],
  [
    "member",
    (value: CouncilReport) => {
      value.findings[0].members[0].finding_index = 1;
    },
  ],
  [
    "severity",
    (value: CouncilReport) => {
      value.findings[0].proposed_severity = "LOW";
    },
  ],
  [
    "evidence",
    (value: CouncilReport) => {
      value.findings[0].evidence.excerpt = "invented";
    },
  ],
  [
    "status",
    (value: CouncilReport) => {
      value.status = "failed";
    },
  ],
  [
    "hash",
    (value: CouncilReport) => {
      value.source_sha256 = "0".repeat(64);
    },
  ],
  [
    "timestamp",
    (value: CouncilReport) => {
      value.created_at = "not a date";
    },
  ],
  [
    "negative duration",
    (value: CouncilReport) => {
      value.elapsed_ms = -1;
    },
  ],
  [
    "extra metadata",
    (value: CouncilReport) => {
      (value.findings[0] as unknown as Record<string, unknown>).verified = true;
    },
  ],
  [
    "raw evidence",
    (value: CouncilReport) => {
      value.models[0].review!.findings[0].evidence.excerpt = "invented";
    },
  ],
  [
    "model identity",
    (value: CouncilReport) => {
      value.models[0].review!.model_id = BEDROCK_MODELS[1].id;
    },
  ],
  [
    "model label",
    (value: CouncilReport) => {
      value.models[0].label = "Different model";
    },
  ],
  [
    "token count",
    (value: CouncilReport) => {
      value.models[0].review!.input_tokens = -1;
    },
  ],
  [
    "model region",
    (value: CouncilReport) => {
      value.models[0].review!.region = "us-west-2";
    },
  ],
] as const) {
  test(`client validation rejects tampered ${name}`, async () => {
    const report = await buildCouncilReport(
      await runs([[finding()], [], []]),
      source,
      20,
    );
    const modified = JSON.parse(JSON.stringify(report));
    mutate(modified);
    await expect(validateCouncil(modified, source)).rejects.toThrow();
  });
}

test("missing, repeated and unconfigured model outcomes cannot manufacture a quorum", async () => {
  const models = await runs([[finding()], [], []]);
  await expect(
    buildCouncilReport(models.slice(0, 2), source, 20),
  ).rejects.toThrow();
  await expect(
    buildCouncilReport([models[0], models[0], models[0]], source, 20),
  ).rejects.toThrow();
  await expect(
    buildCouncilReport(
      [{ ...models[0], model_id: "unconfigured" }, ...models.slice(1)],
      source,
      20,
    ),
  ).rejects.toThrow();
});

test("contradictory failure entries and secret-bearing error text are rejected", async () => {
  const models = await runs([null, null, null]);
  await expect(
    buildCouncilReport(
      [{ ...models[0], status: "succeeded" }, ...models.slice(1)],
      source,
      20,
    ),
  ).rejects.toThrow();
  await expect(
    buildCouncilReport(
      [
        {
          ...models[0],
          error: { code: "error", detail: "bedrock-api-key-SYNTHETIC" },
        },
        ...models.slice(1),
      ],
      source,
      20,
    ),
  ).rejects.toThrow();
});

function execution(totalAttempts = 3): ExecutionProvenance {
  return {
    policy_version: POLICY_VERSION,
    prompt_variant: "baseline",
    prompt_version: PROMPT_VERSION,
    max_attempts_per_model: REVIEW_POLICY.max_attempts_per_model,
    model_timeout_ms: REVIEW_POLICY.model_timeout_ms,
    overall_timeout_ms: REVIEW_POLICY.overall_timeout_ms,
    total_attempts: totalAttempts,
  };
}

async function trackedRuns(contributions: (ReviewFinding[] | null)[]) {
  return (await runs(contributions)).map((model) => ({
    ...model,
    attempts: [
      {
        attempt: 1,
        status: model.status,
        elapsed_ms: model.elapsed_ms,
        error_code: model.error?.code ?? null,
        retry_delay_ms: 0,
      },
    ],
  }));
}

test("bounded reports preserve retry provenance and successful-attempt usage", async () => {
  const models = await trackedRuns([[finding()], [], null]);
  models[0].attempts.unshift({
    attempt: 1,
    status: "failed",
    elapsed_ms: 10,
    error_code: "bedrock_rate_limit",
    retry_delay_ms: 0,
  });
  models[0].attempts[1].attempt = 2;
  models[0].attempts[1].retry_delay_ms = 500;
  models[0].elapsed_ms = 522;
  const report = await buildCouncilReport(models, source, 530, execution(4));
  expect(report.schema_version).toBe("2.1.0");
  expect(report.execution?.total_attempts).toBe(4);
  expect(report.models[0].review?.elapsed_ms).toBe(12);
  expect(report.models[0].elapsed_ms).toBe(522);
  expect(
    await validateCouncil(JSON.parse(JSON.stringify(report)), source),
  ).toEqual(report);
  expect(report.review_queue).toEqual([
    {
      finding_id: report.findings[0].id,
      reasons: ["not_reported_by_all_reviewers", "incomplete_model_coverage"],
      supporting_models: [BEDROCK_MODELS[0].id],
      not_reported_models: [BEDROCK_MODELS[1].id],
      unavailable_models: [BEDROCK_MODELS[2].id],
      action: "manual_review",
    },
  ]);
});

test("severity disagreements enter review even when all three models report the weakness", async () => {
  const models = await trackedRuns([
    [finding("Reentrancy", 6, 6, "reentrancy", "LOW")],
    [finding("Reentrant call", 5, 8, "reentrancy", "HIGH")],
    [finding("Withdrawal", 6, 8, "reentrancy", "MEDIUM")],
  ]);
  const report = await buildCouncilReport(models, source, 20, execution());
  expect(report.findings[0].agreement).toBe(3);
  expect(report.findings[0].proposed_severity).toBe("HIGH");
  expect(report.review_queue?.[0].reasons).toEqual(["severity_disagreement"]);
  expect(report.review_queue?.[0].not_reported_models).toEqual([]);
  expect(report.review_queue?.[0].unavailable_models).toEqual([]);
});

test("unanimous retained findings have no disagreement flags without claiming verification", async () => {
  const report = await buildCouncilReport(
    await trackedRuns([[finding()], [finding()], [finding()]]),
    source,
    20,
    execution(),
  );
  expect(report.review_queue).toEqual([]);
  expect(report.findings[0].evidence.validation).toBe("source-bound");
});

test("a deadline during backoff preserves the transient cause without inventing a second request", async () => {
  const models = await trackedRuns([[], null, null]);
  models[1].error = { code: "timeout", detail: "Model deadline exhausted." };
  models[1].attempts[0].error_code = "bedrock_rate_limit";
  models[1].elapsed_ms = 500;
  models[2].attempts = [];
  models[2].error = {
    code: "timeout",
    detail: "Deadline reached before dispatch.",
  };
  const report = await buildCouncilReport(models, source, 500, execution(2));
  expect(report.execution?.total_attempts).toBe(2);
  expect(report.models[1].attempts?.[0].error_code).toBe("bedrock_rate_limit");
  expect(report.models[1].error?.code).toBe("timeout");
  expect(report.status).toBe("partial");
  expect(await validateCouncil(report, source)).toEqual(report);
});

for (const [name, change] of [
  [
    "missing attempt history",
    (report: CouncilReport) => {
      delete report.models[0].attempts;
    },
  ],
  [
    "request count",
    (report: CouncilReport) => {
      report.execution!.total_attempts = 2;
    },
  ],
  [
    "unknown prompt variant",
    (report: CouncilReport) => {
      (report.execution as unknown as Record<string, unknown>).prompt_variant =
        "hidden-provider-prompt";
    },
  ],
  [
    "unknown prompt version",
    (report: CouncilReport) => {
      (report.execution as unknown as Record<string, unknown>).prompt_version =
        "unversioned";
    },
  ],
  [
    "unbounded model deadline",
    (report: CouncilReport) => {
      report.execution!.model_timeout_ms = 270_001;
    },
  ],
  [
    "unbounded overall deadline",
    (report: CouncilReport) => {
      report.execution!.overall_timeout_ms = 285_001;
    },
  ],
  [
    "attempt sequence",
    (report: CouncilReport) => {
      report.models[0].attempts![0].attempt = 2;
    },
  ],
  [
    "first-request retry delay",
    (report: CouncilReport) => {
      report.models[0].attempts![0].retry_delay_ms = 500;
    },
  ],
  [
    "contradictory attempt result",
    (report: CouncilReport) => {
      report.models[0].attempts![0].status = "failed";
      report.models[0].attempts![0].error_code = "bedrock_access";
    },
  ],
  [
    "attempt elapsed time",
    (report: CouncilReport) => {
      report.models[0].attempts![0].elapsed_ms = 1000;
    },
  ],
  [
    "successful review duration",
    (report: CouncilReport) => {
      report.models[0].attempts![0].elapsed_ms = 1;
    },
  ],
  [
    "overall elapsed time",
    (report: CouncilReport) => {
      report.elapsed_ms = 1;
    },
  ],
  [
    "erased review queue",
    (report: CouncilReport) => {
      report.review_queue!.length = 0;
    },
  ],
  [
    "non-reporting mislabeled unavailable",
    (report: CouncilReport) => {
      report.review_queue![0].unavailable_models = [BEDROCK_MODELS[1].id];
    },
  ],
  [
    "unjustified manual decision",
    (report: CouncilReport) => {
      (report.review_queue![0] as unknown as Record<string, unknown>).action =
        "verified-vulnerability";
    },
  ],
] as const) {
  test(`bounded client report rejects ${name}`, async () => {
    const report = await buildCouncilReport(
      await trackedRuns([[finding()], [], null]),
      source,
      20,
      execution(),
    );
    change(report);
    await expect(validateCouncil(report, source)).rejects.toThrow();
  });
}

test("attempt histories cannot turn access or opaque failures into an automatic retry", async () => {
  for (const code of ["bedrock_access", "invalid_review", "review_failed"]) {
    const models = await trackedRuns([[], [], []]);
    models[0].attempts.unshift({
      attempt: 1,
      status: "failed",
      elapsed_ms: 1,
      error_code: code,
      retry_delay_ms: 0,
    });
    models[0].attempts[1].attempt = 2;
    models[0].elapsed_ms = 13;
    await expect(
      buildCouncilReport(models, source, 20, execution(4)),
    ).rejects.toThrow("non-transient");
  }
});

test("a fourth request exceeds the hard per-model and overall request budget", async () => {
  const models = await trackedRuns([[], [], []]);
  models[0].attempts = [1, 2, 3]
    .map<ModelAttempt>((attempt) => ({
      attempt,
      status: "failed",
      elapsed_ms: 1,
      error_code: "bedrock_unavailable",
      retry_delay_ms: 0,
    }))
    .concat([
      {
        attempt: 4,
        status: "succeeded",
        elapsed_ms: 12,
        error_code: null,
        retry_delay_ms: 0,
      },
    ]);
  models[0].elapsed_ms = 15;
  await expect(
    buildCouncilReport(models, source, 20, execution(6)),
  ).rejects.toThrow("attempt history");
  await expect(
    buildCouncilReport(
      await trackedRuns([[], [], []]),
      source,
      20,
      execution(10),
    ),
  ).rejects.toThrow("policy");
});

test("legacy reports cannot acquire unvalidated execution metadata", async () => {
  const report = await buildCouncilReport(await runs([[], [], []]), source, 20);
  await expect(
    validateCouncil({ ...report, execution: execution() }, source),
  ).rejects.toThrow();
});

test("Markdown exports execution limits, full contribution provenance and separate uncertainty reasons", async () => {
  const models = await trackedRuns([
    [finding("Reentrancy | <script>")],
    [],
    null,
  ]);
  const report = await buildCouncilReport(models, source, 20, {
    ...execution(),
    prompt_variant: "few-shot",
  });
  const text = councilMarkdown(
    await analyzeStatic("Vault.sol", source),
    report,
  );
  expect(text).toContain(`Prompt: ${PROMPT_VERSION} / few-shot`);
  expect(text).toContain("Requests made: 3 / 9 maximum");
  expect(text).toContain("Attempt 1: succeeded");
  expect(text).toContain(
    "successful attempt only; failed requests may also be billed",
  );
  expect(text).toContain(
    `Not reported by: ${BEDROCK_MODELS[1].label.replace(/\./g, "\\.")}`,
  );
  expect(text).toContain(
    `Unavailable: ${BEDROCK_MODELS[2].label.replace(/\./g, "\\.")}`,
  );
  expect(text).toContain("Completed models are retained");
  expect(text).toContain("Reentrancy \\| \\<script\\>");
  expect(text).toContain("#### Model contributions");
});

test("subtraction assignment anchors merge the same arithmetic site but preserve distinct sites", async () => {
  const input = [
    "pragma solidity ^0.7.6;",
    "contract Arithmetic {",
    "  uint value;",
    "  function subtract() external {",
    "    value -= 1;",
    "    value -= 2;",
    "  }",
    "}",
  ].join("\n");
  const first = [
    "Subtraction may wrap",
    "Unchecked decrement",
    "Integer underflow",
  ].map((title, index) =>
    finding(
      title,
      5,
      5,
      index === 2 ? "integer-underflow" : "arithmetic",
      "HIGH",
      input,
    ),
  );
  const report = await buildCouncilReport(
    await runs(
      first.map((item) => [item]),
      input,
    ),
    input,
    20,
  );
  expect(report.findings).toHaveLength(1);
  expect(report.findings[0].agreement).toBe(3);
  const split = await buildCouncilReport(
    await runs(
      [
        [first[0]],
        [first[1]],
        [finding("Distinct subtraction", 6, 6, "arithmetic", "HIGH", input)],
      ],
      input,
    ),
    input,
    20,
  );
  expect(split.findings).toHaveLength(2);
  expect(split.findings.map((item) => item.agreement).sort()).toEqual([1, 2]);
});

test("archived arithmetic reports without a grouping version retain their historical split findings", async () => {
  const input = [
    "pragma solidity ^0.7.6;",
    "contract OldArithmetic {",
    "  function subtract(uint value) external {",
    "    value -= 1;",
    "  }",
    "}",
  ].join("\n");
  const contributions = ["Wraparound A", "Wraparound B", "Wraparound C"].map(
    (title) => [finding(title, 4, 4, "arithmetic", "HIGH", input)],
  );
  const models = await runs(contributions, input);
  const archived = await buildCouncilReport(models, input, 20);
  delete archived.aggregation_version;
  const historicIds = [
    "53ec7a7d39dcd2b3c2c8adb1",
    "9ba92336287f4218e51d5502",
    "d8bb27cc8e719588e5f88d14",
  ];
  archived.findings = contributions.map(([item], index) => ({
    ...item,
    id: historicIds[index],
    agreement: 1,
    confidence: "LOW",
    supporting_models: [models[index].model_id],
    members: [{ model_id: models[index].model_id, finding_index: 0 }],
    severity_disagreement: false,
  }));
  expect((await validateCouncil(archived, input)).findings).toHaveLength(3);
  // Relabeling an old aggregate cannot silently change the grouping interpretation.
  await expect(
    validateCouncil(
      { ...archived, aggregation_version: "source-locus-v2" },
      input,
    ),
  ).rejects.toThrow();
  const current = await buildCouncilReport(models, input, 20);
  expect(current.aggregation_version).toBe("source-locus-v2");
  expect(current.findings).toHaveLength(1);
  expect((await validateCouncil(current, input)).findings[0].agreement).toBe(3);
});

async function recoveredRuns(code = "bedrock_network", delay = 10_000) {
  const models = await trackedRuns([[finding()], [], []]);
  models[0].attempts.unshift({
    attempt: 1,
    status: "failed",
    elapsed_ms: 10,
    error_code: code,
    retry_delay_ms: 0,
  });
  models[0].attempts[1].attempt = 2;
  models[0].attempts[1].retry_delay_ms = delay;
  models[0].elapsed_ms = delay + 22;
  return models;
}

test("network recovery provenance permits a provider delay within the original budget", async () => {
  const models = await recoveredRuns();
  const report = await buildCouncilReport(models, source, 10_030, execution(4));
  expect(report.execution?.policy_version).toBe(POLICY_VERSION);
  expect(
    report.models[0].attempts?.map((attempt) => attempt.error_code),
  ).toEqual(["bedrock_network", null]);
  expect(
    await validateCouncil(JSON.parse(JSON.stringify(report)), source),
  ).toEqual(report);
  expect(report.findings[0].agreement).toBe(1);
});

test("historical policy imports retain their original identity and five-second delay bound", async () => {
  const models = await recoveredRuns("bedrock_rate_limit", 500);
  const policy: ExecutionProvenance = {
    ...execution(4),
    ...legacyLimits,
    policy_version: "bounded-review-v1",
    prompt_version: "independent-review-v2",
  };
  const report = await buildCouncilReport(models, source, 530, policy);
  expect(
    (await validateCouncil(report, source)).execution?.policy_version,
  ).toBe("bounded-review-v1");
  for (const runs of [
    await recoveredRuns("bedrock_rate_limit", 10_000),
    await recoveredRuns("bedrock_network", 500),
  ]) {
    await expect(
      buildCouncilReport(runs, source, 10_030, policy),
    ).rejects.toThrow();
  }
});

test("recovery provenance rejects an unknown policy and a delay that exhausts the budget", async () => {
  const models = await recoveredRuns();
  await expect(
    buildCouncilReport(models, source, 10_030, {
      ...execution(4),
      model_timeout_ms: 10_000,
    }),
  ).rejects.toThrow();
  await expect(
    buildCouncilReport(models, source, 10_030, {
      ...execution(4),
      overall_timeout_ms: 10_000,
    }),
  ).rejects.toThrow();
  const report = await buildCouncilReport(models, source, 10_030, execution(4));
  const altered = JSON.parse(JSON.stringify(report));
  altered.execution.policy_version = "unbounded-network-recovery";
  await expect(validateCouncil(altered, source)).rejects.toThrow();
});

test("content filtering and access denial cannot be relabeled as retryable recovery", async () => {
  for (const code of [
    "content_filtered",
    "guardrail_intervened",
    "bedrock_access",
  ]) {
    await expect(
      buildCouncilReport(
        await recoveredRuns(code, 500),
        source,
        530,
        execution(4),
      ),
    ).rejects.toThrow("non-transient");
  }
});

test("source-span evidence and Grok effort provenance never relabel historical first rounds", async () => {
  const report = await buildCouncilReport(
    await trackedRuns([[finding("Review")], [], []]),
    source,
    20,
    execution(),
  );
  expect(firstReviewEvidenceMethod(report)).toContain("Model-selected lines");
  for (const model of BEDROCK_MODELS)
    expect(firstReviewReasoningEffort(report, model.id)).toBe(
      model.id === BEDROCK_MODELS[2].id ? "medium" : "provider default",
    );
  for (const policy of [
    "bounded-review-v2-network-recovery",
    "bounded-review-v1",
  ] as const) {
    const historical = structuredClone(report);
    historical.execution!.prompt_version = "independent-review-v2";
    historical.execution!.policy_version = policy;
    Object.assign(historical.execution!, legacyLimits);
    expect(await validateCouncil(historical, source)).toEqual(historical);
    expect(firstReviewEvidenceMethod(historical)).toContain(
      "Model-provided excerpt",
    );
    expect(firstReviewReasoningEffort(historical, BEDROCK_MODELS[2].id)).toBe(
      "provider default",
    );
    historical.models[0].review!.findings[0].evidence.excerpt =
      "invented source";
    await expect(validateCouncil(historical, source)).rejects.toThrow();
  }
  const impossible = structuredClone(report);
  impossible.execution!.policy_version = "bounded-review-v1";
  await expect(validateCouncil(impossible, source)).rejects.toThrow("policy");
});

test("reader-focused prompts preserve the prior source-span protocol on imported reports", async () => {
  const report = await buildCouncilReport(
    await trackedRuns([[finding("Review")], [], []]),
    source,
    20,
    execution(),
  );
  const prior = structuredClone(report);
  prior.execution!.prompt_version =
    "independent-review-v3-source-spans-grok-medium";
  prior.execution!.policy_version = "bounded-review-v2-network-recovery";
  Object.assign(prior.execution!, legacyLimits);
  expect(await validateCouncil(prior, source)).toEqual(prior);
  expect(firstReviewEvidenceMethod(prior)).toContain("Model-selected lines");
  expect(firstReviewReasoningEffort(prior, BEDROCK_MODELS[2].id)).toBe(
    "medium",
  );
  expect(prior.execution!.prompt_version).not.toBe(PROMPT_VERSION);
  prior.execution!.policy_version = "bounded-review-v1";
  await expect(validateCouncil(prior, source)).rejects.toThrow("policy");
});

for (const code of [
  "invalid_report",
  "invalid_evidence",
  "bedrock_model_timeout",
] as const) {
  test(`extended first-round policy accepts ${code} recovery without granting it to historical reports`, async () => {
    const models = await recoveredRuns(code, 500);
    const report = await buildCouncilReport(models, source, 530, execution(4));
    expect(await validateCouncil(report, source)).toEqual(report);
    expect(report.findings[0].agreement).toBe(1);
    for (const prompt of [
      "independent-review-v2",
      "independent-review-v3-source-spans-grok-medium",
      "independent-review-v4-reader-focused-source-spans-grok-medium",
    ] as const) {
      const historical = structuredClone(report);
      Object.assign(historical.execution!, legacyLimits, {
        policy_version: "bounded-review-v2-network-recovery",
        prompt_version: prompt,
      });
      await expect(validateCouncil(historical, source)).rejects.toThrow(
        "non-transient",
      );
    }
  });
}

test("nine bounded requests retain three independent results and legacy limits remain immutable", async () => {
  const models = await trackedRuns([[finding()], [finding()], [finding()]]);
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
        error_code: "bedrock_unavailable",
        retry_delay_ms: 500,
      },
      {
        attempt: 3,
        status: "succeeded",
        elapsed_ms: 12,
        error_code: null,
        retry_delay_ms: 30_000,
      },
    ];
    model.elapsed_ms = 200_512;
  }
  const report = await buildCouncilReport(
    models,
    source,
    200_520,
    execution(9),
  );
  expect(await validateCouncil(report, source)).toEqual(report);
  expect(report.execution!.total_attempts).toBe(9);
  expect(report.findings[0].agreement).toBe(3);
  expect(report.findings[0].members).toHaveLength(3);
  expect(
    councilMarkdown(await analyzeStatic("Vault.sol", source), report),
  ).toContain("Requests made: 9 / 9 maximum");
  const historical = await buildCouncilReport(
    await trackedRuns([[finding()], [], []]),
    source,
    20,
    {
      ...execution(),
      ...legacyLimits,
      policy_version: "bounded-review-v2-network-recovery",
      prompt_version:
        "independent-review-v4-reader-focused-source-spans-grok-medium",
    },
  );
  expect(await validateCouncil(historical, source)).toEqual(historical);
  expect(
    councilMarkdown(await analyzeStatic("Vault.sol", source), historical),
  ).toContain("Requests made: 3 / 6 maximum");
  for (const altered of [
    { model_timeout_ms: 180_001 },
    { overall_timeout_ms: 210_001 },
    { max_attempts_per_model: 3 },
    { total_attempts: 7 },
  ]) {
    const invalid = structuredClone(historical);
    Object.assign(invalid.execution!, altered);
    await expect(validateCouncil(invalid, source)).rejects.toThrow("policy");
  }
});

test("extended first-round imports reject forged late success while preserving timeout and historical records", async () => {
  const report = await buildCouncilReport(
    await trackedRuns([[finding()], [], []]),
    source,
    20,
    execution(),
  );
  const late = structuredClone(report);
  late.models[0].elapsed_ms = 270_011;
  late.models[0].attempts![0].elapsed_ms = 270_011;
  late.elapsed_ms = 270_012;
  await expect(validateCouncil(late, source)).rejects.toThrow(
    "execution deadline",
  );
  const earlierRound = structuredClone(report);
  earlierRound.execution!.overall_timeout_ms = 10;
  earlierRound.models[0].elapsed_ms = 21;
  earlierRound.models[0].attempts![0].elapsed_ms = 21;
  earlierRound.elapsed_ms = 22;
  await expect(validateCouncil(earlierRound, source)).rejects.toThrow(
    "execution deadline",
  );
  const historical = structuredClone(late);
  Object.assign(historical.execution!, legacyLimits, {
    policy_version: "bounded-review-v2-network-recovery",
    prompt_version:
      "independent-review-v4-reader-focused-source-spans-grok-medium",
  });
  expect(await validateCouncil(historical, source)).toEqual(historical);
  late.models[0].status = "failed";
  late.models[0].review = null;
  late.models[0].error = { code: "timeout", detail: "Model deadline reached." };
  late.models[0].attempts![0].status = "failed";
  late.models[0].attempts![0].error_code = "timeout";
  const timedOut = await buildCouncilReport(
    late.models,
    source,
    late.elapsed_ms,
    execution(),
  );
  expect(timedOut.status).toBe("partial");
  expect(timedOut.models[0].error!.code).toBe("timeout");
});
