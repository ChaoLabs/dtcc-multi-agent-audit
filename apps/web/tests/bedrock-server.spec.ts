import { test, expect } from "@playwright/test";
import { handleReview, createLimiter } from "../src/server/bedrock";
import { BEDROCK } from "../src/lib/bedrock-config";

const key = "bedrock-api-key-SYNTHETIC_SERVER_TEST";
const source = "pragma solidity ^0.8.20;\ncontract Vault {}";
const origin = "https://audit.example";
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
const noNetwork: typeof fetch = async () => {
  throw new Error("Unexpected network request");
};

test("server uses only the request key and fixed AWS endpoint; no secret enters prompts or results", async () => {
  const longKey = "bedrock-api-key-" + "SYNTHETIC_".repeat(800);
  let calls = 0;
  const transport: typeof fetch = async (url, init) => {
    calls++;
    expect(String(url)).toBe(
      `https://bedrock-runtime.us-east-1.amazonaws.com/model/${BEDROCK.model}/converse`,
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${longKey}`,
    );
    expect(init?.body).not.toContain(longKey);
    expect(init?.redirect).toBe("error");
    expect(init?.cache).toBe("no-store");
    const body = JSON.parse(init?.body as string);
    expect(body.inferenceConfig.maxTokens).toBe(8192);
    expect(body.tools).toBeUndefined();
    expect(body.messages[0].content[0].text).toContain("static_candidates");
    return Response.json(payload());
  };
  const result = await handleReview(
    request({ api_key: longKey }),
    transport,
    createLimiter(),
  );
  expect(result.status).toBe(200);
  expect(calls).toBe(1);
  expect(result.headers.get("cache-control")).toContain("no-store");
  expect(result.headers.get("set-cookie")).toBeNull();
  const body = await result.json();
  expect(Object.keys(body)).toEqual(["model_review"]);
  expect(body.model_review.model_id).toBe(BEDROCK.model);
  expect(JSON.stringify(body)).not.toContain(longKey);
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
  ["bad filename", { filename: "../Vault.sol" }, {}, 400],
  ["empty source", { source: "" }, {}, 400],
  ["large source", { source: "x".repeat(48_001) }, {}, 400],
  ["cross origin", {}, { origin: "https://untrusted.example" }, 403],
  ["missing origin", {}, { origin: "" }, 403],
  ["cross site", {}, { "sec-fetch-site": "cross-site" }, 403],
  ["non JSON", {}, { "content-type": "text/plain" }, 415],
  ["oversized request", { api_key: "x".repeat(128_001) }, {}, 413],
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
  test(`AWS ${status} returns sanitized actionable error without retries`, async () => {
    let calls = 0;
    const result = await handleReview(
      request(),
      async () => {
        calls++;
        return new Response(`${key} PRIVATE_AWS_RESPONSE`, { status });
      },
      createLimiter(),
    );
    expect(calls).toBe(1);
    expect(result.status).toBe(
      status === 401 || status === 403 ? 401 : status === 429 ? 429 : 502,
    );
    expect(result.headers.get("cache-control")).toContain("no-store");
    const text = await result.text();
    expect(text).not.toContain(key);
    expect(text).not.toContain("PRIVATE_AWS_RESPONSE");
  });
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
    validation: "source-bound",
  },
};
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
] as const) {
  test(`server rejects ${name}`, async () => {
    const result = await handleReview(
      request(),
      async () =>
        typeof response === "string"
          ? new Response(response)
          : Response.json(response),
      createLimiter(),
    );
    expect(result.status).toBe(502);
    expect(await result.text()).not.toContain(key);
  });
}

test("server bounds streamed output even without Content-Length", async () => {
  const response = await handleReview(
    request(),
    async () => new Response("x".repeat(256_001)),
    createLimiter(),
  );
  expect(response.status).toBe(413);
});

test("concurrent users keep separate keys and reports; duplicate requests are rejected and locks release", async () => {
  const limiter = createLimiter();
  let unblock: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  let start: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const first = handleReview(
    request(),
    async (_, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${key}`,
      );
      start();
      await wait;
      return Response.json(payload());
    },
    limiter,
  );
  await started;
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
  unblock();
  expect((await first).status).toBe(200);
  const retry = await handleReview(
    request(),
    async () => Response.json(payload()),
    limiter,
  );
  expect(retry.status).toBe(200);
});

test("failed transport releases its slot and does not reveal its exception", async () => {
  const limiter = createLimiter();
  const failed = await handleReview(
    request(),
    async () => {
      throw new Error(key);
    },
    limiter,
  );
  expect(await failed.text()).not.toContain(key);
  expect(
    (
      await handleReview(
        request(),
        async () => Response.json(payload()),
        limiter,
      )
    ).status,
  ).toBe(200);
});

test("cancellation propagates to the AWS request and returns a sanitized timeout", async () => {
  const controller = new AbortController();
  const result = await handleReview(
    request({}, {}, controller.signal),
    async (_, init) => {
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      throw new Error(key);
    },
    createLimiter(),
  );
  expect(result.status).toBe(504);
  expect(await result.text()).not.toContain(key);
});

test("production route is present and rejects invalid requests without AWS or Python", async ({
  request: client,
}) => {
  const url = "http://127.0.0.1:3100/api/reviews";
  const response = await client.post(url, {
    headers: { origin: "http://127.0.0.1:3100" },
    data: { filename: "Vault.sol", source, api_key: "invalid" },
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

test("request guard caps repeated attempts without retaining raw credentials", async () => {
  const limiter = createLimiter();
  for (let i = 0; i < 6; i++) limiter(key)();
  expect(() => limiter(key)).toThrow("Analysis is busy");
});
