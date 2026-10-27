# Bedrock API analysis

The website runs **GPT-6.1 Sol, Claude Opus 5.5 and Grok 4.7** independently and in parallel through Amazon Bedrock. A deterministic application orchestrator consolidates accepted findings and preserves each model's original review. There is no additional adjudicating model; bounded retries use the same three model identities. [Orchestration details](ORCHESTRATION.md) explain matching, votes and incomplete results.

## Generate a fresh key through DevX

1. Sign in through the DTCC-provided DevX account and open the project's AWS console.
2. Select **US East (N. Virginia), us-east-1** before generating the key.
3. Open **Amazon Bedrock → API keys → Short-term API keys → Generate short-term API keys**.
4. Copy only the complete value beginning `bedrock-api-key-`, without the shell `export` command or quotation marks.
5. Open [the platform](https://dtcc-multi-agent-audit.vercel.app/), select **API analysis**, paste the key, and select **Use API key**.
6. Choose **Run API analysis** on a short contract. Verify the outcome for each of the three models.

A short-term key expires at the earlier of 12 hours or the generating AWS session's expiry. Generate it in `us-east-1`; keys are Region-bound. One key is sufficient for all three models if the generating IAM identity has their required permissions. Replacing a key does not grant new permissions or revoke an earlier short-term key. The platform cannot create a new AWS credential without an authenticated AWS session.

Visitors complete this workflow in the browser. They do not need an OpenAI, Anthropic or xAI account/key, a local Python service, a terminal, or an AWS secret configured on Vercel.

## Models and routing

| Model | Bedrock Runtime inference profile |
| --- | --- |
| GPT-6.1 Sol | `us.openai.gpt-6.1-sol` |
| Claude Opus 5.5 | `us.anthropic.claude-opus-5-5` |
| Grok 4.7 | `us.xai.grok-4.7` |

All requests use Converse at `https://bedrock-runtime.us-east-1.amazonaws.com/model/{modelId}/converse`. The `us.` prefix selects US cross-Region inference; requests may run in another US destination Region. The website accepts no arbitrary destination URL or user-selected model ID.

Claude Opus 5.5 has adaptive thinking always enabled. The request leaves optional model-specific sampling and reasoning parameters at their defaults. Output limits include reasoning where the provider counts it. Only final text blocks are parsed into findings, and the application validates JSON and exact source evidence after generation.

All three models use Converse `outputConfig.textFormat` with the same JSON Schema derived from the report contract, and receive the full formatting contract in their system instructions. GPT-6.1 Sol additionally receives `additionalModelRequestFields.text.format.strict: true`, as required by its Converse interface. The provider receives supported structural constraints; the application retains the stricter length, finding-count, line-range and exact-source checks. See the model cards linked below and [Bedrock structured-output API and schema limits](https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html).

Models supply evidence as `line_start`, `line_end` and `excerpt`. The server checks the integer range, span length, exact source excerpt and duplicate findings before adding `validation: "source-bound"`. A legacy model-supplied `validation` annotation is ignored; it cannot establish or bypass source binding. No source text, line number or substantive finding is repaired to force acceptance. The substantive evidence contract remains unchanged; execution provenance is recorded separately.

AWS may take additional time to compile a new output schema on its first use. The model deadline still applies; an expired request remains an explicit failure and is not automatically retried.

## Account permissions

The key inherits the permissions of its IAM principal. An administrator should verify:

- `bedrock:CallWithBearerToken` is permitted for the key's identity.
- `bedrock:InvokeModel` is permitted for the three inference profiles and their foundation models in all destination Regions. Converse uses this permission.
- The account's default project resource is allowed where required, including Grok: `arn:aws:bedrock:{region}:{account-id}:project/default`.
- Organization policies and regional controls permit the selected US cross-Region routing.
- The account has completed any required first-use model enablement. Most commercial-Region models are enabled on first invocation, but a permitted administrator may need to complete Marketplace subscription first. Anthropic may require the first-time use-case form.

Visibility in the Model catalog does not establish invocation permission. Saving a key checks local format only. A successful response from each model establishes access for that run. If one provider returns AccessDenied, check that model's account setup instead of repeatedly generating new keys.

## Website request and result behavior

For the first pass, the browser sends the current source and key to its own `POST /api/reviews` route. The Node.js function sends three concurrent requests with the same review task, formatting instructions and numbered source. Each first-pass model works without seeing static findings or another model's output. Static analysis remains a separate view and never contributes a consensus vote.

After a valid first pass with at least two successful models, an explicit second review can send the same source and selected queued claims to `POST /api/reviews/second-round`. Only successful first-pass reviewers participate, and their peer-informed assessments remain separate from first-pass agreement. At most twelve queued claims are reconsidered; remaining claims are deferred.

A complete first-pass run has three accepted reviews. A partial run retains successful reviews and names the failed model(s). An all-failed run is explicitly failed. A successful empty finding array, partial coverage, or absence of results never establishes safety.

The application holds the key in the current tab's memory and active server request. Credentials never enter a model prompt, report export, cookie, localStorage, database, shared process environment or application log. Unsaved input clears when the dialog closes. Refresh or **Clear key** removes the browser connection; replacing/clearing the key aborts an active request and prevents stale results from appearing.

Running API analysis sends the contract through this site's server to AWS. The AWS account's permissions, invocation logging settings and model charges apply. The Vercel owner pays function compute. Cancelling cannot guarantee that already-started AWS work stops or is not billed.

| Limit | Value |
| --- | --- |
| Source | 48,000 UTF-8 bytes / 1,200 lines / 2,000 characters per line |
| First-pass request body | 128,000 bytes; 10-second read deadline |
| Second-pass request body | 1,500,000 bytes including the baseline; 10-second read deadline |
| Second-pass source/claim context | 256,000 serialized bytes per reviewer; rejected before calls when exceeded |
| Model calls | Up to three parallel model tasks per pass; at most two attempts each, six calls per pass; no fallback models |
| Output per attempt | 8,192 tokens / 256,000 response bytes |
| Deadline | 180 seconds per model; 210 seconds per pass request; second review uses a separate request |
| Function duration | 240 seconds, with Vercel Fluid compute enabled |

Per-instance guards allow one simultaneous analysis and twelve pass starts per minute per key hash, with four active passes per runtime. Both route imports share the guard only within one runtime. Separate serverless functions/instances do not share this memory; these resource bounds are not distributed quotas. Invalid JSON, truncated output or invented source evidence fails the affected model review. The first-pass **2.1.0** report retains model outcomes, accepted original reviews, consensus membership, agreement/severity metadata, prompt provenance and attempt history. Historical **2.0.0** first-pass reports remain readable but cannot start a second review. The separate second-review **1.0.0** report binds the exact first-pass snapshot and records decisions without changing its votes.

The supervisor retries only explicit HTTP 429, 500, 502, 503 and 504 responses, at most once per model. Backoff is bounded and never resets the model or overall deadline. Authentication, permission, invalid request, output-validation, network-ambiguity and local-timeout failures do not automatically retry. HTTP 408 and 424 are outside the retry allowlist; refreshing does not change a terminal failure into a temporary one. Accepted reviews are not rerun to fill a missing vote. See [the orchestration policy](ORCHESTRATION.md).

For a controlled comparison, select standard instructions or guided examples before running analysis. The same variant is used by all three models. The five-case validation workflow sends the five existing reference contracts sequentially. First-pass-only mode makes at most 30 provider requests per variant; selecting Include second review allows at most 60. Each second review is paired with its own first-pass baseline, and the export retains both outcomes. This is an explicitly started API operation billed to the supplied key's account.

## Troubleshooting

| Outcome | Action |
| --- | --- |
| Expired/invalid key | Generate a fresh `us-east-1` key from the active DevX AWS session and replace it in the website. |
| Access denied for one model | Verify its inference-profile, foundation-model and applicable default-project permissions; complete first-use requirements. |
| Wrong Region | Generate the key in `us-east-1`; changing the browser display does not re-scope a key. |
| Quota or throttling | The supervisor may retry once within the original deadline. If it still fails, wait or ask the administrator to inspect that model's quota. Repeated reruns do not grant capacity. |
| Timeout | Use a shorter contract or retry manually when appropriate. Preserve successful partial reviews for inspection. |
| Report format rejected | Open the model status to see the rejected field and constraint. This means returned JSON failed the local schema. The diagnostic excludes raw model values and unknown property names. |
| Invalid/truncated model output | Treat that model as failed; inspect other outcomes. Do not interpret a parsing failure as a clean contract. |

## Verification boundary

Automated web checks use mocked Bedrock responses and synthetic fixtures to verify request shape, parallel dispatch, evidence binding, consolidation and failure behavior. They do not use DTCC credentials, establish real account access, or measure detection accuracy. Perform a separate authorized live check and inspect all three model outcomes before reporting the connection as verified.

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

### Legacy endpoint profiles

| Protocol | Endpoint | Model ID |
| --- | --- | --- |
| `converse` (default) | `bedrock-runtime.{region}.amazonaws.com/model/{modelId}/converse` | Use the exact approved Converse model or inference profile ID from your AWS account |
| `mantle` (summer compatibility) | `bedrock-mantle.{region}.api.aws/anthropic/v1/messages` | An approved Anthropic Messages model ID; not used for GPT-6 Astra |

Mantle uses `x-api-key`, the Anthropic version header and the `default` workspace. Converse uses Bearer authorization. They are different API surfaces and model IDs are not interchangeable. The application never accepts an arbitrary destination URL from the browser.

Alternatively, supply `AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION`, `BEDROCK_MODEL_ID` and `BEDROCK_PROTOCOL` in the API process environment. The old `BEDROCK_API_KEY` variable remains a fallback. No `NEXT_PUBLIC_` secret is used. Plain `scripts/start_api.py` starts without interactive prompts and uses the environment as configured.

### Legacy request and result behavior

- One request to one model; no automatic retries or tool execution. Maximum output: 4,096 tokens; wall-clock limit: 55 seconds; upstream response cap: 128 KB.
- One concurrent review per local API process. This is a local resource bound, not a distributed hosting quota.
- Exact source, bounded input and static evidence are supplied as untrusted data. The model cannot invoke tools, resolve imports, fetch URLs or execute a proposed action.
- JSON shape, severity values, finding count, evidence spans and exact excerpts are checked server-side and again in the browser. Truncation, invented evidence and invalid output reject the model review.
- Static and model findings remain separate. The model cannot silently delete the baseline. An empty model array is valid and does not replace static findings.
- On model failure, the interface shows the error and keeps the completed static report. Exports include only accepted results and actual model metadata/token counts where supplied.
- Editing, changing a case or cancelling prevents late responses from overwriting a newer snapshot. Cancelling stops the browser wait; AWS may already be processing the request and may still bill it.
- Source is sent only when the user starts API analysis. No source database, browser persistence or raw-response logging is implemented. AWS account logging settings remain outside this repository.

The Python service is retained for compatibility. Its single-model results and limits do not describe the web orchestration workflow above.

### Legacy verification boundary

Automated tests use HTTPX mock transports for both AWS protocols and browser fixtures for model success/failure. They verify application behavior without AWS credentials or charges. Real account permissions, credentials, endpoint connectivity and model quality have **not** been verified by those tests.

Launcher regression tests use a synthetic key longer than 8,000 characters and a mocked macOS clipboard. They cover full-length loading, rejected clipboard content, read failures, cancellation and non-disclosure in terminal output. These are not native macOS or live AWS tests.

## Primary references

- [Bedrock API keys and console generation](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html)
- [API key permissions](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys-permissions.html)
- [Inference-profile prerequisites](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-prereq.html)
- [First-use model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)
- [GPT-6.1 Sol](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-openai-gpt-6-1-sol.html)
- [Claude Opus 5.5](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-opus-5-5.html)
- [Grok 4.7](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-7.html)
- [Converse API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html)
