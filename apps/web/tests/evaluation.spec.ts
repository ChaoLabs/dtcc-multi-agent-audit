import { expect, test } from "@playwright/test";
import cases from "../src/generated/cases.json";
import { BEDROCK, BEDROCK_MODELS } from "../src/lib/bedrock-config";
import {
  EVALUATION_CASES,
  runEvaluation,
  type EvaluationReport,
} from "../src/lib/evaluation";
import { buildCouncilReport, type ModelRun } from "../src/lib/orchestration";
import {
  POLICY_VERSION,
  PROMPT_VERSION,
  promptInstructions,
  type PromptVariant,
} from "../src/lib/review-policy";
import { sha256 } from "../src/lib/static-analysis";

const key = "bedrock-api-key-SYNTHETIC_EVALUATION_ONLY";
async function review(
  source: string,
  variant: PromptVariant = "baseline",
  options: { legacy?: boolean; failed?: string; unknownTokens?: boolean } = {},
) {
  const hash = await sha256(source);
  const models: ModelRun[] = BEDROCK_MODELS.map((model, index) => {
    const failed = index === 0 && !!options.failed;
    return {
      model_id: model.id,
      label: model.label,
      status: failed ? "failed" : "succeeded",
      elapsed_ms: 5,
      error: failed
        ? { code: options.failed!, detail: "Synthetic provider failure." }
        : null,
      review: failed
        ? null
        : {
            provider: "aws-bedrock",
            model_id: model.id,
            region: BEDROCK.region,
            protocol: BEDROCK.protocol,
            source_sha256: hash,
            created_at: new Date().toISOString(),
            elapsed_ms: 5,
            input_tokens: options.unknownTokens && index === 1 ? null : 100,
            output_tokens: 25,
            summary: "Synthetic workflow validation; no live model was called.",
            findings: [],
          },
      ...(options.legacy
        ? {}
        : {
            attempts: [
              {
                attempt: 1,
                status: failed ? ("failed" as const) : ("succeeded" as const),
                elapsed_ms: 5,
                error_code: failed ? options.failed! : null,
                retry_delay_ms: 0,
              },
            ],
          }),
    };
  });
  return buildCouncilReport(
    models,
    source,
    7,
    options.legacy
      ? undefined
      : {
          policy_version: POLICY_VERSION,
          prompt_variant: variant,
          prompt_version: PROMPT_VERSION,
          max_attempts_per_model: 2,
          model_timeout_ms: 180_000,
          overall_timeout_ms: 210_000,
          total_attempts: 3,
        },
  );
}
type Input = {
  filename: string;
  source: string;
  api_key: string;
  prompt_variant: PromptVariant;
};
const requestInput = (init?: RequestInit): Input =>
  JSON.parse(String(init?.body));
function options(transport: typeof fetch, variant: PromptVariant = "baseline") {
  return {
    apiKey: key,
    promptVariant: variant,
    signal: new AbortController().signal,
    transport,
  };
}

test("validation uses exactly the original five sources in sequence with no outer retry", async () => {
  const requests: Input[] = [];
  let active = 0,
    maximumActive = 0;
  const progress: EvaluationReport[] = [];
  const transport: typeof fetch = async (url, init) => {
    expect(url).toBe("/api/reviews");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
    const body = requestInput(init);
    requests.push(body);
    maximumActive = Math.max(maximumActive, ++active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    const response = Response.json(
      await review(body.source, body.prompt_variant),
    );
    active--;
    return response;
  };
  const result = await runEvaluation({
    ...options(transport),
    onProgress: (snapshot) => progress.push(snapshot),
  });
  expect(maximumActive).toBe(1);
  expect(
    requests.map(({ filename, source }) => ({ filename, source })),
  ).toEqual(
    cases.map((item) => ({
      filename: item.report.input.filename,
      source: item.report.input.source,
    })),
  );
  expect(requests).toHaveLength(5);
  expect(
    requests.every(
      (body) => body.api_key === key && body.prompt_variant === "baseline",
    ),
  ).toBe(true);
  expect(
    requests.every(
      (body) =>
        Object.keys(body).sort().join(",") ===
        "api_key,filename,prompt_variant,source",
    ),
  ).toBe(true);
  expect(result.status).toBe("completed");
  expect(result.metrics).toMatchObject({
    completed_cases: 5,
    fully_reviewed_cases: 5,
    partial_cases: 0,
    successful_model_reviews: 15,
    total_model_slots: 15,
    observed_attempts: 15,
    input_tokens: 1500,
    output_tokens: 375,
  });
  expect(result.cases.every((item) => item.status === "completed")).toBe(true);
  expect(result.cases.map((item) => item.source_sha256)).toEqual(
    EVALUATION_CASES.map((item) => item.source_sha256),
  );
  expect(JSON.stringify({ progress, result })).not.toContain(key);
  expect(progress[0].cases[0].status).toBe("running");
  expect(progress[0].cases[1].status).toBe("pending");
});

test("progress snapshots cannot mutate later results or source manifests", async () => {
  const result = await runEvaluation({
    ...options(async (_, init) =>
      Response.json(await review(requestInput(init).source)),
    ),
    onProgress: (snapshot) => {
      snapshot.cases[0].title = "mutated observer";
      snapshot.metrics.completed_cases = 999;
    },
  });
  expect(result.cases[0].title).toBe(EVALUATION_CASES[0].title);
  expect(result.metrics.completed_cases).toBe(5);
  expect(Object.isFrozen(EVALUATION_CASES)).toBe(true);
  expect(EVALUATION_CASES.every(Object.isFrozen)).toBe(true);
});

test("cancelling an active second case preserves the first and starts no later case", async () => {
  const abort = new AbortController();
  let calls = 0;
  const transport: typeof fetch = async (_, init) => {
    if (++calls === 1)
      return Response.json(await review(requestInput(init).source));
    abort.abort();
    throw new DOMException("Synthetic cancellation", "AbortError");
  };
  const result = await runEvaluation({
    ...options(transport),
    signal: abort.signal,
  });
  expect(calls).toBe(2);
  expect(result.status).toBe("cancelled");
  expect(result.cases.map((item) => item.status)).toEqual([
    "completed",
    "cancelled",
    "pending",
    "pending",
    "pending",
  ]);
  expect(result.cases[0].report?.models).toHaveLength(3);
  expect(result.metrics.successful_model_reviews).toBe(3);
  expect(result.metrics.observed_attempts).toBe(3);
});

test("an already cancelled run never invokes the route", async () => {
  const abort = new AbortController();
  abort.abort();
  let calls = 0;
  const result = await runEvaluation({
    ...options(async () => {
      calls++;
      return Response.json({});
    }),
    signal: abort.signal,
  });
  expect(calls).toBe(0);
  expect(result.status).toBe("cancelled");
  expect(result.cases.every((item) => item.status === "pending")).toBe(true);
});

for (const status of [401, 403, 429]) {
  test(`HTTP ${status} stops the batch and preserves prior reports`, async () => {
    let calls = 0;
    const result = await runEvaluation(
      options(async (_, init) =>
        ++calls === 1
          ? Response.json(await review(requestInput(init).source))
          : new Response(key, { status }),
      ),
    );
    expect(calls).toBe(2);
    expect(result.status).toBe("stopped");
    expect(result.cases.map((item) => item.status)).toEqual([
      "completed",
      "failed",
      "pending",
      "pending",
      "pending",
    ]);
    expect(result.metrics.completed_cases).toBe(1);
    expect(JSON.stringify(result)).not.toContain(key);
  });
}
for (const error of ["bedrock_access", "bedrock_rate_limit"]) {
  test(`${error} inside a partial report also stops unnecessary subsequent calls`, async () => {
    let calls = 0;
    const result = await runEvaluation(
      options(async (_, init) => {
        calls++;
        return Response.json(
          await review(requestInput(init).source, "baseline", {
            failed: error,
          }),
        );
      }),
    );
    expect(calls).toBe(1);
    expect(result.status).toBe("stopped");
    expect(result.cases[0].report?.status).toBe("partial");
    expect(result.metrics.successful_model_reviews).toBe(2);
    expect(
      result.cases.slice(1).every((item) => item.status === "pending"),
    ).toBe(true);
  });
}

test("provider unavailability preserves other cases and explicit incomplete model coverage", async () => {
  let calls = 0;
  const result = await runEvaluation(
    options(async (_, init) =>
      Response.json(
        await review(requestInput(init).source, "baseline", {
          failed: ++calls === 1 ? "bedrock_unavailable" : undefined,
        }),
      ),
    ),
  );
  expect(calls).toBe(5);
  expect(result.status).toBe("completed");
  expect(result.metrics).toMatchObject({
    completed_cases: 5,
    fully_reviewed_cases: 4,
    partial_cases: 1,
    successful_model_reviews: 14,
    total_model_slots: 15,
    observed_attempts: 15,
    input_tokens: 1400,
  });
  expect(result.cases[0].report?.status).toBe("partial");
});

test("malformed reports and network errors are failures, never empty successful reviews", async () => {
  let calls = 0;
  const result = await runEvaluation(
    options(async (_, init) => {
      calls++;
      if (calls === 1) throw new Error(`synthetic transport error ${key}`);
      if (calls === 2)
        return Response.json({ models: [], source_sha256: "invalid" });
      return Response.json(await review(requestInput(init).source));
    }),
  );
  expect(result.cases[0].status).toBe("failed");
  expect(result.cases[1].status).toBe("failed");
  expect(result.cases.slice(2).every((item) => item.status !== "running")).toBe(
    true,
  );
  expect(JSON.stringify(result)).not.toContain(key);
});

test("guided validation sends one fixed prompt variant and verifies provenance", async () => {
  const requests: Input[] = [];
  const result = await runEvaluation(
    options(async (_, init) => {
      const body = requestInput(init);
      requests.push(body);
      return Response.json(await review(body.source, "few-shot"));
    }, "few-shot"),
  );
  expect(requests).toHaveLength(5);
  expect(requests.every((item) => item.prompt_variant === "few-shot")).toBe(
    true,
  );
  expect(result.prompt_variant).toBe("few-shot");
  expect(result.prompt_version).toBe(PROMPT_VERSION);
  expect(result.metrics.completed_cases).toBe(5);
});

for (const stale of ["different variant", "legacy report"] as const) {
  test(`${stale} cannot be counted as the requested experiment and stops later calls`, async () => {
    let calls = 0;
    const result = await runEvaluation(
      options(async (_, init) => {
        calls++;
        return Response.json(
          await review(requestInput(init).source, "baseline", {
            legacy: stale === "legacy report",
          }),
        );
      }, "few-shot"),
    );
    expect(calls).toBe(1);
    expect(result.status).toBe("stopped");
    expect(result.metrics.successful_model_reviews).toBe(0);
    expect(result.cases[0].status).toBe("failed");
    expect(
      result.cases.slice(1).every((item) => item.status === "pending"),
    ).toBe(true);
  });
}

test("legacy standard reports also lack the provenance needed for controlled evaluation", async () => {
  let calls = 0;
  const result = await runEvaluation(
    options(async (_, init) => {
      calls++;
      return Response.json(
        await review(requestInput(init).source, "baseline", { legacy: true }),
      );
    }),
  );
  expect(calls).toBe(1);
  expect(result.status).toBe("stopped");
  expect(result.metrics.successful_model_reviews).toBe(0);
  expect(result.metrics.observed_attempts).toBe(0);
});

test("unknown successful token usage remains unknown instead of a misleading zero", async () => {
  const result = await runEvaluation(
    options(async (_, init) =>
      Response.json(
        await review(requestInput(init).source, "baseline", {
          unknownTokens: true,
        }),
      ),
    ),
  );
  expect(result.metrics.input_tokens).toBeNull();
  expect(result.metrics.output_tokens).toBe(375);
});

test("invalid credentials fail before any evaluation traffic", async () => {
  let calls = 0;
  await expect(
    runEvaluation({
      ...options(async () => {
        calls++;
        return Response.json({});
      }),
      apiKey: "invalid",
    }),
  ).rejects.toThrow();
  expect(calls).toBe(0);
});

test("guided examples do not include evaluation sources, filenames, or expected rule labels", () => {
  expect(promptInstructions("baseline")).toBe("");
  const instructions = promptInstructions("few-shot");
  expect(instructions.length).toBeGreaterThan(200);
  for (const fixture of EVALUATION_CASES) {
    expect(instructions).not.toContain(fixture.source);
    expect(instructions).not.toContain(fixture.filename);
  }
  expect(instructions).not.toMatch(/\bSC-\d{3}\b/);
  expect(instructions).not.toContain("expected_rules");
});
