# Bedrock API analysis

The API mode restores the summer project's **static evidence + single-model review** capability. Three-model analysis and orchestration remain semester work. A successful request is a model review, not a comprehensive audit or proof of safety.

## Website connection (Vercel and local Next.js)

1. Select **API analysis** and paste only the complete `bedrock-api-key-...` value.
2. Choose **Use API key**. This validates the format without contacting AWS.
3. Choose **Run API analysis**. A successful result establishes actual AWS access.

The web configuration is GPT-6 Astra, `us.openai.gpt-6-astra`, `us-east-1`, Converse. It uses US cross-Region inference. No Python process, OpenAI key, Vercel environment key or account setup inside this app is required. Visitors still need access to the model in their AWS account.

The browser calls the site's own `/api/reviews` route. That Node.js function receives the key and source over HTTPS on Vercel, recomputes static candidates, sends one bounded request to AWS, validates the result and returns only the model review. The original browser static report is preserved. Credentials never enter the model prompt, report, cookie, browser storage, shared process environment or application logs. The application holds the key in tab memory and the active request; **Clear key** or refresh removes the browser connection. Unsaved key input clears when the dialog closes. Replacing/clearing the key aborts an active request and prevents stale results from appearing.

Web limits: 48,000 source bytes / 1,200 lines / 2,000 characters per line; 128,000 request-body bytes; one model request; 8,192 maximum output tokens; 110-second request deadline; 256,000 response bytes. The function duration is 120 seconds. Per-instance guards allow one simultaneous review and six attempts per minute per key hash, with four active calls total. This is not a distributed user quota. AWS may charge for a cancelled request that it already processed.

Expired keys or denied model permissions produce an actionable error. The static report remains available. No automatic retries, fallback models, generated confidence scores or fabricated findings are used.

## Optional Python service (terminal workflow)

The retained Python service supports scanner parity checks and the earlier direct API workflow. The website no longer calls it. Its instructions and limits below apply only to that optional service.

### Start locally

Install dependencies with `bash scripts/setup.sh`, then run in the repository root:

```bash
.venv/bin/python scripts/start_api.py --bedrock
```

The terminal prompts for region, protocol, model ID and a hidden API key. Settings live only in that server process; no credential is written to a file or browser storage. Press Ctrl+C to stop. Restart with a fresh key when your short-term credential expires.

### macOS: long session keys and GPT-6 Astra

If pasting a long key beeps, stalls, or is truncated, use the explicit clipboard entry point:

```bash
AWS_REGION=us-east-1 \
BEDROCK_PROTOCOL=converse \
BEDROCK_MODEL_ID=us.openai.gpt-6-astra \
.venv/bin/python scripts/start_api.py --bedrock-clipboard
```

Press Enter at the first three prompts to keep these settings. **After** the terminal says `Copy ONLY the Bedrock API key now`, copy the current key from AWS, return to the terminal, and press Enter. Do not paste the key into the terminal. Copy only the value starting with `bedrock-api-key-`, without an `export` command or quotes. Copy the key after the launch command, since copying that command replaces the clipboard.

This opt-in mode reads `/usr/bin/pbpaste` once after Enter, avoiding the terminal's line-input buffer. It does not execute clipboard text, print the key, save a credential file, or put the key in a subprocess command argument. Invalid clipboard contents stop startup; an old environment key is not silently substituted. The clipboard itself is left unchanged. Ctrl+C cancels before reading.

The selected Astra profile uses US cross-Region inference through `bedrock-runtime`; keep the `us.` prefix. Model catalog visibility does not establish account permission. Configuration checks are local, and the actual review must succeed to verify AWS access. The legacy `mantle` option below is an Anthropic Messages adapter, not an OpenAI-compatible adapter.

The retained service exposes `/api/audits`, `/api/config` and `/api/reviews` on `127.0.0.1:8000` for direct API clients. Use the web key form for the current website workflow.

## Endpoint profiles

| Protocol | Endpoint | Model ID |
| --- | --- | --- |
| `converse` (default) | `bedrock-runtime.{region}.amazonaws.com/model/{modelId}/converse` | Use the exact approved Converse model or inference profile ID from your AWS account |
| `mantle` (summer compatibility) | `bedrock-mantle.{region}.api.aws/anthropic/v1/messages` | An approved Anthropic Messages model ID; not used for GPT-6 Astra |

Mantle uses `x-api-key`, the Anthropic version header and the `default` workspace. Converse uses Bearer authorization. They are different API surfaces and model IDs are not interchangeable. The application never accepts an arbitrary destination URL from the browser.

Alternatively, supply `AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`, `BEDROCK_MODEL_ID` and `BEDROCK_PROTOCOL` in the API process environment. The old `BEDROCK_API_KEY` variable remains a fallback. No `NEXT_PUBLIC_` secret is used. Plain `scripts/start_api.py` starts without interactive prompts and uses the environment as configured.

## Request and result behavior

- One request to one model; no automatic retries or tool execution. Maximum output: 4,096 tokens; wall-clock limit: 55 seconds; upstream response cap: 128 KB.
- One concurrent review per local API process. This is a local resource bound, not a distributed hosting quota.
- Exact source, bounded input and static evidence are supplied as untrusted data. The model cannot invoke tools, resolve imports, fetch URLs or execute a proposed action.
- JSON shape, severity values, finding count, evidence spans and exact excerpts are checked server-side and again in the browser. Truncation, invented evidence and invalid output reject the model review.
- Static and model findings remain separate. The model cannot silently delete the baseline. An empty model array is valid and does not replace static findings.
- On model failure, the interface shows the error and keeps the completed static report. Exports include only accepted results and actual model metadata/token counts where supplied.
- Editing, changing a case or cancelling prevents late responses from overwriting a newer snapshot. Cancelling stops the browser wait; AWS may already be processing the request and may still bill it.
- Source is sent only when the user starts API analysis. No source database, browser persistence or raw-response logging is implemented. AWS account logging settings remain outside this repository.

The Vercel build supports both on-device static analysis and visitor-key model review through the Next.js route. Application accounts, sponsor-funded usage, distributed quotas and multi-agent job orchestration remain separate future work.

## Verification boundary

Automated tests use HTTPX mock transports for both AWS protocols and browser fixtures for model success/failure. They verify application behavior without AWS credentials or charges. Real account permissions, credentials, endpoint connectivity and model quality have **not** been verified by those tests.

Launcher regression tests use a synthetic key longer than 8,000 characters and a mocked macOS clipboard. They cover full-length loading, rejected clipboard content, read failures, cancellation and non-disclosure in terminal output. These are not native macOS or live AWS tests.

## Primary references

- [AWS Bedrock API keys](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-use.html)
- [GPT-6 Astra: IDs, regions and supported APIs](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-astra.html)
- [Converse API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html)
- [Anthropic Messages API on Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-messages-api.html)
- [Bedrock endpoint differences](https://docs.aws.amazon.com/bedrock/latest/userguide/endpoints.html)
