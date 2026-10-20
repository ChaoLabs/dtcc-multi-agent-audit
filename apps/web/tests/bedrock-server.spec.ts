import { test, expect } from "@playwright/test";
import Ajv from "ajv";
import { handleReview, createLimiter } from "../src/server/bedrock";
import { BEDROCK, BEDROCK_MODELS } from "../src/lib/bedrock-config";

const key = "bedrock-api-key-SYNTHETIC_SERVER_TEST";
const source = "pragma solidity ^0.8.20;\ncontract Vault {}";
const origin = "https://audit.example";
const modelIds = [
  "us.openai.gpt-6.1-sol",
  "us.anthropic.claude-opus-5-5",
  "us.xai.grok-4.7",
];

function request(
  changes: Record<string, unknown> = {},
  headers: Record<string, string> = {},
  signal?: AbortSignal,
) {
  return new Request(`${origin}/api/reviews`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", origin, ...headers },
    body: JSON.stringify({
      filename: "Vault.sol",
      source,
      api_key: key,
      ...changes,
    }),
  });
}

function payload(
  content: unknown = {
    summary: "No additional candidates identified; manual review is required.",
    findings: [],
  },
  stopReason = "end_turn",
) {
  return {
    stopReason,
    output: { message: { content: [{ text: JSON.stringify(content) }] } },
    usage: { inputTokens: 50, outputTokens: 25 },
  };
}

const finding = {
  title: "Candidate",
  category: "Access control",
  proposed_severity: "LOW",
  rationale: "Inspect the supplied source.",
  recommendation: "Review permissions.",
  evidence: {
    line_start: 2,
    line_end: 2,
    excerpt: "contract Vault {}",
  },
};

const noNetwork: typeof fetch = async () => {
  throw new Error("Unexpected network request");
};

test("three independent requests use fixed Bedrock endpoints and never transmit credentials in prompts or reports", async () => {
  const longKey = "bedrock-api-key-" + "SYNTHETIC_".repeat(800);
  const urls: string[] = [];
  const prompts: string[] = [];
  const transport: typeof fetch = async (url, init) => {
    urls.push(String(url));
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${longKey}`,
    );
    expect(init?.body).not.toContain(longKey);
    expect(init?.redirect).toBe("error");
    expect(init?.cache).toBe("no-store");
    const body = JSON.parse(init?.body as string);
    expect(body.inferenceConfig).toEqual({ maxTokens: 8192 });
    expect(body.tools).toBeUndefined();
    expect(body.toolConfig).toBeUndefined();
    if (String(url).includes(modelIds[0])) {
      expect(body.additionalModelRequestFields).toEqual({
        text: { format: { strict: true } },
      });
    } else {
      expect(body.additionalModelRequestFields).toBeUndefined();
    }
    const prompt = body.messages[0].content[0].text;
    prompts.push(prompt);
    const context = JSON.parse(prompt);
    expect(context.source_lines).toEqual([
      { line: 1, text: "pragma solidity ^0.8.20;" },
      { line: 2, text: "contract Vault {}" },
    ]);
    expect(context.static_candidates).toBeUndefined();
    expect(context.source_candidates).toBeUndefined();
    return Response.json(payload());
  };
  const result = await handleReview(
    request({ api_key: longKey }),
    transport,
    createLimiter(),
  );
  expect(BEDROCK_MODELS.map((model) => model.id)).toEqual(modelIds);
  expect(urls.sort()).toEqual(
    modelIds
      .map(
        (id) =>
          `https://bedrock-runtime.${BEDROCK.region}.amazonaws.com/model/${id}/converse`,
      )
      .sort(),
  );
  expect(new Set(prompts).size).toBe(1);
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toContain("no-store");
  expect(result.headers.get("vercel-cdn-cache-control")).toBe("no-store");
  expect(result.headers.get("set-cookie")).toBeNull();
  const body = await result.json();
  expect(body.schema_version).toBe("2.0.0");
  expect(body.engine).toBe("evidence-consensus");
  expect(body.status).toBe("completed");
  expect(
    body.models.map((model: { model_id: string }) => model.model_id),
  ).toEqual(modelIds);
  expect(body.models).toHaveLength(3);
  for (const model of body.models) {
    expect(model.status).toBe("succeeded");
    expect(model.error).toBeNull();
    expect(model.review.model_id).toBe(model.model_id);
    expect(model.elapsed_ms).toBeGreaterThanOrEqual(0);
  }
  expect(body.model_review).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain(longKey);
});

test("all three models receive the same native JSON schema and prompt with server-owned evidence validation", async () => {
  let calls = 0;
  let structuredCalls = 0;
  const schemas: string[] = [];
  const instructions: string[] = [];
  const result = await handleReview(
    request(),
    async (url, init) => {
      calls++;
      const body = JSON.parse(init?.body as string);
      expect(body.toolConfig).toBeUndefined();
      if (String(url).includes(modelIds[0])) {
        expect(body.additionalModelRequestFields).toEqual({
          text: { format: { strict: true } },
        });
      } else {
        expect(body.additionalModelRequestFields).toBeUndefined();
      }
      structuredCalls++;
      schemas.push(body.outputConfig.textFormat.structure.jsonSchema.schema);
      instructions.push(JSON.stringify(body.system));
      const format = body.outputConfig.textFormat;
      expect(format.type).toBe("json_schema");
      const definition = format.structure.jsonSchema;
      expect(definition.name).toBe("smart_contract_review");
      expect(definition.description).toEqual(expect.any(String));
      expect(definition.description.length).toBeGreaterThan(0);
      const schema = JSON.parse(definition.schema);
      const ajv = new Ajv({ strict: false });
      expect(ajv.validateSchema(schema)).toBe(true);
      const validate = ajv.compile(schema);
      const canonicalFinding = { ...finding, category: "access-control" };
      const content = {
        summary: "Review candidate.",
        findings: [canonicalFinding],
      };
      expect(validate(content)).toBe(true);
      expect(validate({ findings: [] })).toBe(false);
      expect(validate({ ...content, unexpected: true })).toBe(false);
      expect(validate({ ...content, summary: 42 })).toBe(false);
      expect(
        schema.properties.findings.items.properties.evidence.required,
      ).toEqual(["line_start", "line_end", "excerpt"]);
      expect(
        schema.properties.findings.items.properties.evidence.properties,
      ).not.toHaveProperty("validation");
      for (const change of [
        { recommendation: undefined },
        { proposed_severity: "CRITICAL" },
        { evidence: { ...finding.evidence, line_start: "2" } },
        { evidence: { ...finding.evidence, excerpt: undefined } },
        { evidence: { ...finding.evidence, validation: "unverified" } },
        { evidence: { ...finding.evidence, unexpected: true } },
        { unexpected: true },
      ]) {
        expect(
          validate({
            ...content,
            findings: [{ ...canonicalFinding, ...change }],
          }),
        ).toBe(false);
      }
      function checkProviderSchema(value: unknown) {
        if (Array.isArray(value)) {
          value.forEach(checkProviderSchema);
          return;
        }
        if (!value || typeof value !== "object") return;
        const node = value as Record<string, unknown>;
        for (const keyword of [
          "minimum",
          "maximum",
          "exclusiveMinimum",
          "exclusiveMaximum",
          "minLength",
          "maxLength",
          "minItems",
          "maxItems",
        ])
          expect(node).not.toHaveProperty(keyword);
        if (node.type === "object") {
          expect(node.additionalProperties).toBe(false);
          expect([...(node.required as string[])].sort()).toEqual(
            Object.keys(node.properties as Record<string, unknown>).sort(),
          );
        }
        Object.values(node).forEach(checkProviderSchema);
      }
      checkProviderSchema(schema);
      return Response.json(payload());
    },
    createLimiter(),
  );
  expect(calls).toBe(3);
  expect(structuredCalls).toBe(3);
  expect(new Set(schemas).size).toBe(1);
  expect(new Set(instructions).size).toBe(1);
  expect(result.status).toBe(200);
  expect((await result.json()).status).toBe("completed");
});

test("all three model requests begin before any model response is available", async () => {
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started: string[] = [];
  const run = handleReview(
    request(),
    async (url) => {
      started.push(String(url));
      await pending;
      return Response.json(payload());
    },
    createLimiter(),
  );
  try {
    await expect.poll(() => started.length).toBe(3);
  } finally {
    release();
  }
  const result = await run;
  expect(result.status).toBe(200);
  expect((await result.json()).status).toBe("completed");
});

for (const [name, changes, headers, status] of [
  ["missing key", { api_key: "" }, {}, 400],
  [
    "pasted export",
    { api_key: "export AWS_BEARER_TOKEN_BEDROCK=secret" },
    {},
    400,
  ],
  ["key with newline", { api_key: key + "\nsecret" }, {}, 400],
  ["arbitrary endpoint", { endpoint: "https://untrusted.example" }, {}, 400],
  ["untrusted candidates", { candidates: [] }, {}, 400],
  ["client-selected model", { model_id: modelIds[0] }, {}, 400],
  ["bad filename", { filename: "../Vault.sol" }, {}, 400],
  ["empty source", { source: "" }, {}, 400],
  ["large source", { source: "x".repeat(48_001) }, {}, 400],
  ["cross origin", {}, { origin: "https://untrusted.example" }, 403],
  ["missing origin", {}, { origin: "" }, 403],
  ["cross site", {}, { "sec-fetch-site": "cross-site" }, 403],
  ["non JSON", {}, { "content-type": "text/plain" }, 415],
  ["oversized request", { api_key: "x".repeat(128_001) }, {}, 413],
  ["oversized declared body", {}, { "content-length": "128001" }, 413],
] as const) {
  test(`server rejects ${name} before contacting AWS`, async () => {
    let calls = 0;
    const result = await handleReview(
      request(changes, headers),
      async () => {
        calls++;
        return noNetwork("");
      },
      createLimiter(),
    );
    expect(result.status).toBe(status);
    expect(calls).toBe(0);
    expect(await result.text()).not.toContain(key);
  });
}

for (const status of [401, 403, 429, 400, 404, 500]) {
  test(`AWS ${status} is a sanitized per-model failure without retries or a false completed report`, async () => {
    let calls = 0;
    const result = await handleReview(
      request(),
      async () => {
        calls++;
        return new Response(`${key} PRIVATE_AWS_RESPONSE`, { status });
      },
      createLimiter(),
    );
    expect(calls).toBe(3);
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    const body = await result.json();
    expect(body.status).toBe("failed");
    expect(body.models).toHaveLength(3);
    for (const model of body.models) {
      expect(model.status).toBe("failed");
      expect(model.review).toBeNull();
      expect(model.error.code).toEqual(expect.any(String));
      expect(model.error.detail).toEqual(expect.any(String));
    }
    expect(body.findings).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(key);
    expect(JSON.stringify(body)).not.toContain("PRIVATE_AWS_RESPONSE");
  });
}

test("one denied model preserves both successful reviews and marks the report partial", async () => {
  const result = await handleReview(
    request(),
    async (url) =>
      String(url).includes(modelIds[1])
        ? new Response("PRIVATE_AWS_RESPONSE", { status: 403 })
        : Response.json(
            payload({ summary: "Review candidate.", findings: [finding] }),
          ),
    createLimiter(),
  );
  expect(result.status).toBe(200);
  const body = await result.json();
  expect(body.status).toBe("partial");
  expect(body.models.map((model: { status: string }) => model.status)).toEqual([
    "succeeded",
    "failed",
    "succeeded",
  ]);
  expect(body.models[1].review).toBeNull();
  expect(body.models[1].error.code).toBe("bedrock_access");
  expect(body.models[0].review.findings).toHaveLength(1);
  expect(body.models[2].review.findings).toHaveLength(1);
  expect(body.findings).toHaveLength(1);
});

for (const [name, annotation] of [
  ["missing", undefined],
  ["incorrect legacy", "model-verified"],
  ["correct legacy", "source-bound"],
] as const) {
  test(`Claude ${name} validation annotation is stamped only after exact source evidence passes`, async () => {
    let calls = 0;
    const result = await handleReview(
      request(),
      async (url) => {
        calls++;
        return Response.json(
          String(url).includes(modelIds[1])
            ? payload({
                summary: "Review candidate.",
                findings: [
                  {
                    ...finding,
                    evidence: { ...finding.evidence, validation: annotation },
                  },
                ],
              })
            : payload(),
        );
      },
      createLimiter(),
    );
    expect(calls).toBe(3);
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.status).toBe("completed");
    expect(body.models[1].status).toBe("succeeded");
    expect(body.models[1].review.findings[0]).toEqual({
      ...finding,
      evidence: { ...finding.evidence, validation: "source-bound" },
    });
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0].agreement).toBe(1);
    expect(body.findings[0].evidence.validation).toBe("source-bound");
    expect(JSON.stringify(body)).not.toContain("model-verified");
  });
}

const evidenceRangeSource = [
  "pragma solidity ^0.8.20;",
  "contract Vault {",
  ...Array.from({ length: 12 }, (_, index) => `  // source line ${index + 3}`),
  "}",
].join("\n");

for (const [name, input, evidence, duplicate] of [
  [
    "fabricated excerpt",
    source,
    { ...finding.evidence, excerpt: "INVENTED_SOURCE_MARKER" },
    false,
  ],
  [
    "reversed range",
    source,
    { ...finding.evidence, line_start: 2, line_end: 1 },
    false,
  ],
  ["range outside source", source, { ...finding.evidence, line_end: 3 }, false],
  [
    "more than twelve exact lines",
    evidenceRangeSource,
    {
      line_start: 1,
      line_end: 13,
      excerpt: evidenceRangeSource.split("\n").slice(0, 13).join("\n"),
    },
    false,
  ],
  ["duplicate finding", source, finding.evidence, true],
] as const) {
  test(`Claude ${name} is rejected even when it claims source-bound validation`, async () => {
    const candidate = {
      ...finding,
      evidence: { ...evidence, validation: "source-bound" },
    };
    const result = await handleReview(
      request({ source: input }),
      async (url) =>
        Response.json(
          String(url).includes(modelIds[1])
            ? payload({
                summary: "Review candidate.",
                findings: duplicate ? [candidate, candidate] : [candidate],
              })
            : payload(),
        ),
      createLimiter(),
    );
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.status).toBe("partial");
    expect(body.models[1].status).toBe("failed");
    expect(body.models[1].review).toBeNull();
    expect(body.models[1].error.code).toBe("invalid_evidence");
    expect(body.models[0].status).toBe("succeeded");
    expect(body.models[2].status).toBe("succeeded");
    expect(body.findings).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("INVENTED_SOURCE_MARKER");
  });
}

for (const encoding of ["plain", "JSON-escaped"] as const) {
  test(`a ${encoding} credential echo in ignored legacy validation is rejected before normalization`, async () => {
    const content = {
      summary: "Review candidate.",
      findings: [
        { ...finding, evidence: { ...finding.evidence, validation: key } },
      ],
    };
    const result = await handleReview(
      request(),
      async (url) => {
        if (!String(url).includes(modelIds[1])) return Response.json(payload());
        if (encoding === "plain") return Response.json(payload(content));
        const escapedKey = key.replace(
          /./g,
          (character) =>
            `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
        );
        return Response.json({
          ...payload(),
          output: {
            message: {
              content: [
                { text: JSON.stringify(content).replace(key, escapedKey) },
              ],
            },
          },
        });
      },
      createLimiter(),
    );
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.status).toBe("partial");
    expect(body.models[1].status).toBe("failed");
    expect(body.models[1].review).toBeNull();
    expect(body.models[0].status).toBe("succeeded");
    expect(body.models[2].status).toBe("succeeded");
    expect(body.findings).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(key);
  });
}

for (const [name, response] of [
  ["invalid JSON", "bad"],
  ["truncated result", payload(undefined, "max_tokens")],
  [
    "extra content property",
    payload({ summary: "Review", findings: [], confidence: 100 }),
  ],
  [
    "invented source",
    payload({
      summary: "Review",
      findings: [
        {
          ...finding,
          evidence: { ...finding.evidence, excerpt: "fake source" },
        },
      ],
    }),
  ],
  [
    "duplicate evidence",
    payload({ summary: "Review", findings: [finding, finding] }),
  ],
  ["credential echo", payload({ summary: key, findings: [] })],
  [
    "JSON-escaped credential echo",
    payload({
      summary: "placeholder",
      findings: [],
    }),
  ],
] as const) {
  test(`server rejects ${name} for its model while retaining the remaining reviews`, async () => {
    const result = await handleReview(
      request(),
      async (url) => {
        if (!String(url).includes(modelIds[0])) return Response.json(payload());
        if (name === "JSON-escaped credential echo") {
          const escapedKey = key.replace(
            /./g,
            (character) =>
              `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
          );
          return Response.json({
            ...payload(),
            output: {
              message: {
                content: [
                  { text: `{"summary":"${escapedKey}","findings":[]}` },
                ],
              },
            },
          });
        }
        return typeof response === "string"
          ? new Response(response)
          : Response.json(response);
      },
      createLimiter(),
    );
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.status).toBe("partial");
    expect(body.models[0].status).toBe("failed");
    expect(body.models[0].review).toBeNull();
    expect(body.models[0].error).not.toBeNull();
    expect(body.models[1].status).toBe("succeeded");
    expect(body.models[2].status).toBe("succeeded");
    expect(body.findings).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(key);
    expect(JSON.stringify(body)).not.toContain("fake source");
  });
}

for (const [name, content, field] of [
  ["missing summary", { findings: [] }, "summary"],
  [
    "wrong findings type",
    { summary: "Review", findings: "PRIVATE_VALUE_MARKER" },
    "findings",
  ],
  [
    "missing recommendation",
    {
      summary: "Review",
      findings: [{ ...finding, recommendation: undefined }],
    },
    "recommendation",
  ],
  [
    "invalid severity",
    {
      summary: "Review",
      findings: [{ ...finding, proposed_severity: "PRIVATE_VALUE_MARKER" }],
    },
    "proposed_severity",
  ],
  [
    "wrong evidence line type",
    {
      summary: "Review",
      findings: [
        {
          ...finding,
          evidence: { ...finding.evidence, line_start: "PRIVATE_VALUE_MARKER" },
        },
      ],
    },
    "line_start",
  ],
  [
    "extra root property",
    { summary: "Review", findings: [], PRIVATE_PROPERTY_MARKER: true },
    null,
  ],
  [
    "extra evidence property",
    {
      summary: "Review",
      findings: [
        {
          ...finding,
          evidence: {
            ...finding.evidence,
            PRIVATE_PROPERTY_MARKER: "PRIVATE_VALUE_MARKER",
          },
        },
      ],
    },
    "evidence",
  ],
  ["empty summary", { summary: "", findings: [] }, "summary"],
  [
    "oversized summary",
    { summary: "PRIVATE_VALUE_MARKER".repeat(160), findings: [] },
    "summary",
  ],
  [
    "oversized finding title",
    {
      summary: "Review",
      findings: [{ ...finding, title: "PRIVATE_VALUE_MARKER".repeat(10) }],
    },
    "title",
  ],
  [
    "too many findings",
    { summary: "Review", findings: Array.from({ length: 25 }, () => finding) },
    "findings",
  ],
  [
    "out-of-range evidence line",
    {
      summary: "Review",
      findings: [
        { ...finding, evidence: { ...finding.evidence, line_start: 0 } },
      ],
    },
    "line_start",
  ],
] as const) {
  test(`Grok ${name} produces a safe field diagnostic and preserves both successful models`, async () => {
    let calls = 0;
    const result = await handleReview(
      request(),
      async (url) => {
        calls++;
        return Response.json(
          payload(
            String(url).includes(modelIds[2])
              ? content
              : { summary: "Review candidate.", findings: [finding] },
          ),
        );
      },
      createLimiter(),
    );
    expect(calls).toBe(3);
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.status).toBe("partial");
    expect(body.models[0].status).toBe("succeeded");
    expect(body.models[1].status).toBe("succeeded");
    expect(body.models[2].status).toBe("failed");
    expect(body.models[2].review).toBeNull();
    expect(body.models[2].error.code).toBe("invalid_report");
    if (field) expect(body.models[2].error.detail).toContain(field);
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0].agreement).toBe(2);
    expect(body.findings[0].supporting_models).toEqual(modelIds.slice(0, 2));
    const text = JSON.stringify(body);
    expect(text).not.toContain(key);
    expect(text).not.toContain("PRIVATE_PROPERTY_MARKER");
    expect(text).not.toContain("PRIVATE_VALUE_MARKER");
  });
}

test("server bounds streamed model output even without Content-Length", async () => {
  const response = await handleReview(
    request(),
    async () => new Response("x".repeat(256_001)),
    createLimiter(),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.status).toBe("failed");
  expect(body.models).toHaveLength(3);
  for (const model of body.models) {
    expect(model.review).toBeNull();
    expect(model.error.code).toBe("too_large");
  }
});

test("concurrent users keep separate keys and reports; duplicate runs are rejected and locks release", async () => {
  const limiter = createLimiter();
  let unblock: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  let calls = 0;
  const first = handleReview(
    request(),
    async (_, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${key}`,
      );
      calls++;
      await wait;
      return Response.json(payload());
    },
    limiter,
  );
  try {
    await expect.poll(() => calls).toBe(3);
    const duplicate = await handleReview(request(), noNetwork, limiter);
    expect(duplicate.status).toBe(429);
    const other = await handleReview(
      request({ api_key: key + "_OTHER" }),
      async (_, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          `Bearer ${key}_OTHER`,
        );
        return Response.json(payload());
      },
      limiter,
    );
    expect(other.status).toBe(200);
    const body = await other.json();
    expect(body.status).toBe("completed");
    expect(JSON.stringify(body)).not.toContain(key);
  } finally {
    unblock();
  }
  expect((await first).status).toBe(200);
  const retry = await handleReview(
    request(),
    async () => Response.json(payload()),
    limiter,
  );
  expect(retry.status).toBe(200);
});

test("failed transports release the run slot and never reveal exceptions", async () => {
  const limiter = createLimiter();
  const failed = await handleReview(
    request(),
    async () => {
      throw new Error(`${key} PRIVATE_TRANSPORT_EXCEPTION`);
    },
    limiter,
  );
  const body = await failed.json();
  expect(body.status).toBe("failed");
  expect(JSON.stringify(body)).not.toContain(key);
  expect(JSON.stringify(body)).not.toContain("PRIVATE_TRANSPORT_EXCEPTION");
  const retry = await handleReview(
    request(),
    async () => Response.json(payload()),
    limiter,
  );
  expect(retry.status).toBe(200);
  expect((await retry.json()).status).toBe("completed");
});

test("cancellation reaches all three in-flight AWS calls and returns a sanitized timeout", async () => {
  const controller = new AbortController();
  const signals: AbortSignal[] = [];
  const run = handleReview(
    request({}, {}, controller.signal),
    async (_, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error("Missing cancellation signal");
      signals.push(signal);
      return new Promise<Response>((_, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new Error(`${key} PRIVATE_ABORT_EXCEPTION`)),
          { once: true },
        );
      });
    },
    createLimiter(),
  );
  try {
    await expect.poll(() => signals.length).toBe(3);
  } finally {
    controller.abort();
  }
  const result = await run;
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(result.status).toBe(504);
  const body = await result.json();
  expect(body.code).toBe("timeout");
  expect(JSON.stringify(body)).not.toContain(key);
  expect(JSON.stringify(body)).not.toContain("PRIVATE_ABORT_EXCEPTION");
});

test("an already cancelled request returns timeout before contacting AWS", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const result = await handleReview(
    request({}, {}, controller.signal),
    async () => {
      calls++;
      return noNetwork("");
    },
    createLimiter(),
  );
  expect(calls).toBe(0);
  expect(result.status).toBe(504);
  expect((await result.json()).code).toBe("timeout");
});

test("cancellation wins when the request stream closes without bytes at the same time", async () => {
  const controller = new AbortController();
  let readStarted = false;
  const body = new ReadableStream<Uint8Array>({
    pull(stream) {
      readStarted = true;
      controller.abort();
      stream.close();
    },
  });
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body,
    duplex: "half",
    signal: controller.signal,
  };
  let calls = 0;
  const result = await handleReview(
    new Request(`${origin}/api/reviews`, init),
    async () => {
      calls++;
      return noNetwork("");
    },
    createLimiter(),
  );
  expect(readStarted).toBe(true);
  expect(calls).toBe(0);
  expect(result.status).toBe(504);
  expect((await result.json()).code).toBe("timeout");
});

test("production route rejects invalid requests without AWS or Python", async ({
  request: client,
}) => {
  const url = "http://127.0.0.1:3100/api/reviews";
  const response = await client.post(url, {
    headers: { origin: "http://127.0.0.1:3100" },
    data: {
      filename: "Vault.sol",
      source,
      api_key: "invalid",
    },
  });
  expect(response.status()).toBe(400);
  expect((await response.json()).code).toBe("invalid_key");
  expect((await client.get(url)).status()).toBe(405);
});

test("proxy request compares the actual Host and rejects forged forwarded-host values", async () => {
  const good = request({ api_key: "invalid" }, { host: "audit.example" });
  const internal = new Request("http://localhost:3000/api/reviews", good);
  expect(
    (await handleReview(internal, noNetwork, createLimiter())).status,
  ).toBe(400);
  const forged = request(
    {},
    {
      origin: "https://attacker.example",
      host: "audit.example",
      "x-forwarded-host": "attacker.example",
    },
  );
  expect((await handleReview(forged, noNetwork, createLimiter())).status).toBe(
    403,
  );
});

test("request guard caps repeated runs without retaining raw credentials", async () => {
  const limiter = createLimiter();
  for (let i = 0; i < 6; i++) limiter(key)();
  expect(() => limiter(key)).toThrow("Analysis is busy");
});
