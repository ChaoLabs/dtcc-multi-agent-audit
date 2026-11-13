import { test, expect } from "@playwright/test";
import { deliverReview as deliver } from "../src/server/review-heartbeat";
import { readCouncilJson, reviewHeaders } from "../src/lib/review-http";

// Exercise the self-hosted profile independent of the machine running CI.
const deliverReview = (
  ...args: [Request, Parameters<typeof deliver>[1], typeof fetch]
) => deliver(...args, true, 5);

function req(negotiated = true) {
  return new Request("http://localhost/api/reviews", {
    method: "POST",
    body: "{}",
    headers: negotiated ? reviewHeaders : {},
  });
}
const upstream: typeof fetch = async () => Response.json({});

test("a framework-wrapped incoming request delivers its original bytes and headers once", async () => {
  const body = '{"source":"一行\\nsource","api_key":"offline-only"}';
  const original = new Request("http://localhost/api/reviews/second-round", {
    method: "POST",
    body,
    headers: { ...reviewHeaders, origin: "http://localhost" },
  });
  // Like Next's route wrapper, property getters use the underlying Request
  // as receiver, but the wrapper itself does not own native private fields.
  const wrapped = new Proxy(original, {
    get: (target, key) => Reflect.get(target, key, target),
  });
  let dispatches = 0;
  const result = await deliverReview(
    wrapped,
    async (scoped, send) => {
      expect(scoped.url).toBe(original.url);
      expect(scoped.method).toBe("POST");
      expect(scoped.headers.get("origin")).toBe("http://localhost");
      expect(await scoped.text()).toBe(body);
      await send("https://example.invalid");
      return Response.json({ delivered: true });
    },
    async () => {
      dispatches++;
      return Response.json({});
    },
  );
  expect(await result.json()).toEqual({ delivered: true });
  expect(dispatches).toBe(1);
  expect(original.bodyUsed).toBe(true);
});

// Exercise the framework boundary even when no Bedrock account is configured.
// The offline test runner excludes "production route" tests; E2E starts both servers.
test("development and production routes accept heartbeat requests before key validation", async ({
  request,
}) => {
  for (const origin of ["http://127.0.0.1:3000", "http://127.0.0.1:3100"]) {
    for (const path of ["/api/reviews", "/api/reviews/second-round"]) {
      const response = await request.post(origin + path, {
        headers: { ...reviewHeaders, origin },
        data: {
          filename: "Treasury.sol",
          source: "contract Treasury {}",
          api_key: "invalid",
          ...(path.endsWith("second-round") ? { baseline: {} } : {}),
        },
      });
      expect(response.status()).toBe(400);
      expect(await response.json()).toMatchObject({ code: "invalid_key" });
    }
  }
});

test("an admitted review sends only whitespace until the same request returns its final JSON", async () => {
  let complete!: (response: Response) => void;
  let calls = 0;
  const wait = new Promise<Response>((resolve) => {
    complete = resolve;
  });
  const result = await deliverReview(
    req(),
    async (_request, send) => {
      calls++;
      await send("https://example.invalid");
      return wait;
    },
    upstream,
  );
  const reader = result.body!.getReader();
  const pulse = await reader.read();
  expect(new TextDecoder().decode(pulse.value).trim()).toBe("");
  expect(result.headers.get("content-type")).toBe("application/json");
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("\n");
  complete(Response.json({ status: "partial", findings: [] }));
  expect(
    JSON.parse(new TextDecoder().decode((await reader.read()).value)),
  ).toEqual({ status: "partial", findings: [] });
  expect((await reader.read()).done).toBe(true);
  expect(calls).toBe(1);
});
for (const status of [403, 409, 429]) {
  test(`a delayed pre-admission ${status} retains status and body without any model call`, async () => {
    const original = Response.json(
      { code: status === 403 ? "origin" : "busy", provider_calls_started: 0 },
      { status },
    );
    const result = await deliverReview(
      req(),
      async () => {
        await new Promise<void>((r) => setImmediate(r));
        return original;
      },
      () => {
        throw new Error("not admitted");
      },
    );
    expect(result).toBe(original);
    expect(result.status).toBe(status);
  });
}
test("post-admission errors cannot masquerade as a clean report", async () => {
  const result = await deliverReview(
    req(),
    async (_request, send) => {
      await send("https://example.invalid");
      return Response.json({ detail: "private failure" }, { status: 500 });
    },
    upstream,
  );
  await expect(
    readCouncilJson(result, new AbortController().signal),
  ).rejects.toThrow();
});
test("closing a heartbeat body aborts the same scoped request without a second call", async () => {
  let signal!: AbortSignal;
  let calls = 0;
  const result = await deliverReview(
    req(),
    async (request, send) => {
      signal = request.signal;
      await send("https://example.invalid");
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return Response.json({});
    },
    async () => {
      calls++;
      return Response.json({});
    },
  );
  await result.body!.cancel();
  expect(signal.aborted).toBe(true);
  expect(calls).toBe(1);
});
test("ordinary API callers retain the original response, and an oversized error cannot reach JSON parsing", async () => {
  const raw = Response.json({ message: "x".repeat(20_000) }, { status: 429 });
  const result = await deliverReview(
    req(false),
    async (_request, send) => {
      await send("https://example.invalid");
      return raw;
    },
    upstream,
  );
  expect(result).toBe(raw);
  await expect(
    readCouncilJson(result, new AbortController().signal),
  ).rejects.toThrow("size limit");
});

test("a short-budget deployment keeps the ordinary response even when a client opts in", async () => {
  const raw = Response.json({ status: "completed" });
  const result = await deliver(
    req(),
    async (_request, send) => {
      await send("https://example.invalid");
      return raw;
    },
    upstream,
    false,
  );
  expect(result).toBe(raw);
});

test("report reader distinguishes proxy pages, empty heartbeat EOF and damaged JSON without exposing response text", async () => {
  const cases: [Response, string][] = [
    [
      new Response("<!DOCTYPE html><title>secret proxy text</title>", {
        status: 502,
      }),
      "HTTP 502): an HTML page",
    ],
    [
      new Response("<html>" + "private".repeat(20000), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
      "HTTP 500): an HTML page",
    ],
    [new Response(" \r\n"), "HTTP 200): the response ended without a report"],
    [
      new Response('{"secret":"private'),
      "HTTP 200): the response was incomplete or was not valid JSON",
    ],
    [
      new Response(Uint8Array.of(0xe2, 0x82)),
      "HTTP 200): the response was not valid UTF-8",
    ],
  ];
  for (const [response, diagnosis] of cases) {
    await expect(
      readCouncilJson(response, new AbortController().signal),
    ).rejects.toThrow(diagnosis);
  }
  const split = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of new TextEncoder().encode(' \n{"title":"收益"}'))
        controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  await expect(
    readCouncilJson(new Response(split), new AbortController().signal),
  ).resolves.toEqual({ title: "收益" });
});
