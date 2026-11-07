# Bedrock API analysis

The website runs **GPT-6.1 Sol, Claude Opus 5.5 and Grok 4.7** independently and in parallel through Amazon Bedrock. A deterministic application orchestrator consolidates accepted findings and preserves each model's original review. There is no additional adjudicating model; bounded retries use the same three model identities. [Orchestration details](ORCHESTRATION.md) explain matching, votes and incomplete results.

## Generate a fresh key through DevX

1. Sign in through the DTCC-provided DevX account and open the project's AWS console.
2. Select **US East (N. Virginia), us-east-1** before generating the key.
3. Open **Amazon Bedrock → API keys → Short-term API keys → Generate short-term API keys**.
4. Copy only the complete value beginning `bedrock-api-key-`, without the shell `export` command or quotation marks.
5. Open [the platform](https://dtcc-multi-agent-audit.vercel.app/), select **Bedrock Review**, paste the key, and select **Use API key**.
6. Choose **Run Bedrock Review** on a short contract and inspect **Findings**. Explicitly select **Run Second Review** for eligible differences, then open **Final Report**. The second round can add up to nine calls; it never starts automatically. If no eligible assignment exists, read the stated reason and inspect the available final report.

A short-term key expires at the earlier of 12 hours or the generating AWS session's expiry. Generate it in `us-east-1`; keys are Region-bound. One key is sufficient for all three models if the generating IAM identity has their required permissions. Replacing a key does not grant new permissions or revoke an earlier short-term key. The platform cannot create a new AWS credential without an authenticated AWS session.

Visitors complete this workflow in the browser. They do not need an OpenAI, Anthropic or xAI account/key, a local Python service, a terminal, or an AWS secret configured on Vercel.

## Models and routing

| Model | Bedrock Runtime inference profile |
| --- | --- |
| GPT-6.1 Sol | `us.openai.gpt-6.1-sol` |
| Claude Opus 5.5 | `us.anthropic.claude-opus-5-5` |
| Grok 4.7 | `us.xai.grok-4.7` |

All requests use Converse at `https://bedrock-runtime.us-east-1.amazonaws.com/model/{modelId}/converse`. The `us.` prefix selects US cross-Region inference; requests may run in another US destination Region. The website accepts no arbitrary destination URL or user-selected model ID.

Claude Opus 5.5 has adaptive thinking always enabled and retains its optional parameter defaults. Grok receives `reasoning_effort: "medium"` in both rounds instead of its default high effort, within the same output, attempt and time limits. This is a request setting, not a measured latency or accuracy claim. Output limits include reasoning where the provider counts it. Only final text blocks are parsed into findings, and the application validates JSON and exact source evidence after generation.

In the first round, all three models use Converse `outputConfig.textFormat` with the same JSON Schema derived from the report contract, and receive the full formatting contract in their system instructions. The second round uses the provider-specific wire representations described below and validates them against one canonical assessment contract. GPT-6.1 Sol additionally receives `additionalModelRequestFields.text.format.strict: true`, as required by its Converse interface. The provider receives supported structural constraints; the application retains the stricter length, finding-count, line-range and exact-source checks. See the model cards linked below and [Bedrock structured-output API and schema limits](https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html).

In both rounds, all three models supply evidence as `line_start` and `line_end` only. The server validates the complete wire response, requires integer, ordered, in-source spans of at most twelve lines, and retrieves the exact text from the immutable source before canonical validation and `validation: "source-bound"` annotation. Models do not retype excerpts or certify their own evidence. Blank or oversized retrieved text and unexpected fields are rejected. No line number or substantive finding is repaired to force acceptance. Historical quote-based reports retain exact-quotation checks. Source binding establishes a location in the submitted file, not that the cited code supports the model's judgment.

AWS documents up to approximately 90 seconds for a new grammar and a 24-hour cache for identical schemas in the same account. The stable second-round schema avoids changing that grammar solely because the number of assignments changes. This is a potential latency contributor, not proof of the cause of a particular timeout. Compilation and inference share the extended 270-second model deadline. A Bedrock HTTP 408 model-timeout response may retry while budget remains; reaching the local deadline stops further attempts.

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

The browser stops after accepting the first-pass result and displays **Findings**. Only an explicit **Run Second Review** action sends the same source and selected queued claims to `POST /api/reviews/second-round`, after a valid first pass with at least two successful models. Only successful first-pass reviewers with nonempty assignments participate. Assignments cover omitted peer findings and severity disputes; their peer-informed assessments remain separate from first-pass agreement. At most twelve queued claims are reconsidered; remaining claims are deferred. Saving a key or switching modes does not start analysis. A new source, key change, cancellation or unmount aborts active work and ignores stale results. Accepted first-pass findings remain available if the second round fails. The final report follows a validated second-review result, including a partial result, or an explicit eligibility explanation when no second review can run.

Follow-up completion counts assigned reviewers only. If Claude failed in the first stage and the assigned GPT and Grok follow-ups both finish, that is two of two follow-up tasks, with overall coverage still two of three. The follow-up does not recover the failed independent reviewer.

A complete first-pass run has three accepted reviews. A partial run retains successful reviews and names the failed model(s). An all-failed run is explicitly failed. A successful empty finding array, partial coverage, or absence of results never establishes safety.

The application holds the key in the current tab's memory and active server request. Credentials never enter a model prompt, report export, cookie, localStorage, database, shared process environment or application log. Unsaved input clears when the dialog closes. Refresh or **Clear key** removes the browser connection; replacing/clearing the key aborts an active request and prevents stale results from appearing.

Running API analysis sends the contract through this site's server to AWS. The AWS account's permissions, invocation logging settings and model charges apply. The Vercel owner pays function compute. Cancelling cannot guarantee that already-started AWS work stops or is not billed.

| Limit | Value |
| --- | --- |
| Source | 48,000 UTF-8 bytes / 1,200 lines / 2,000 characters per line |
| First-pass request body | 128,000 bytes; 10-second read deadline |
| Second-pass request body | 1,500,000 bytes including the baseline; 10-second read deadline |
| Second-pass source/claim context | 256,000 serialized bytes per reviewer; rejected before calls when exceeded |
| Model calls | Up to three parallel model tasks per pass; at most three attempts each, nine calls per pass; no fallback models |
| Output per attempt | 8,192 tokens / 256,000 response bytes |
| Deadline | 270 seconds per model; 285 seconds per pass request; second review uses a separate request |
| Function duration | 300 seconds, with Vercel Fluid compute enabled; 295-second browser wait |

Per-instance guards allow one simultaneous analysis and twelve pass starts per minute per key hash, with four active passes per runtime. Both route imports share the guard only within one runtime. Separate serverless functions/instances do not share this memory; these resource bounds are not distributed quotas. Invalid JSON, truncated output or invented source evidence is never accepted. Either round's local validation can use remaining attempts for a corrected generation; provider JSON parsing and incomplete responses are terminal. The first-pass **2.1.0** report retains model outcomes, accepted original reviews, consensus membership, agreement/severity metadata, prompt provenance and attempt history. Historical **2.0.0** first-pass reports remain readable but cannot start a second review. The separate second-review **1.1.0** report binds the exact first-pass snapshot and records per-model assignments and decisions without changing its votes. Historical **1.0.0** reports remain readable with their original policy.

The supervisor retries explicit HTTP 429, 500, 502, 503 and 504 responses, Bedrock HTTP 408 model-timeout responses, and allowlisted temporary connection errors classified as `bedrock_network`. Retries and local validation corrections share three attempts per model. Local jitter remains capped at five seconds; longer provider Retry-After waits are honored only while time remains for another attempt. Backoff never resets a clock. Either round may regenerate a complete response after local format or source-evidence rejection, without echoing rejected text or changing evidence to force acceptance. Authentication, permission, filtering, guardrails, invalid requests, credential echo, provider JSON parsing, unknown/permanent transport errors and local abort/timeout remain terminal. HTTP 424 and other unlisted statuses are outside the retry allowlist. Successful reviews are not rerun. A failed connection can follow upstream acceptance, so a retry does not guarantee exactly-once processing or billing. See [the orchestration policy](ORCHESTRATION.md).

For a controlled comparison, open **Review settings** and select standard instructions or guided examples before running analysis. The same variant is used by all three models. The five-case validation workflow sends the five existing reference contracts sequentially. First-pass-only mode makes at most 45 provider requests per variant; selecting Include second review allows at most 90. Each second review is paired with its own first-pass baseline, and the export retains both outcomes. This is an explicitly started API operation billed to the supplied key's account.

## Troubleshooting

| Outcome | Action |
| --- | --- |
| Expired/invalid key | Generate a fresh `us-east-1` key from the active DevX AWS session and replace it in the website. |
| Access denied for one model | Verify its inference-profile, foundation-model and applicable default-project permissions; complete first-use requirements. |
| Request rejected / HTTP 400 | Expand the model row. The report keeps the AWS request ID and, when recognized, a fixed hint about schema, context, inference parameters or model/profile configuration. This is a rejected request, not evidence of a temporary outage. Do not change models or keys solely from this label. |
| Wrong Region | Generate the key in `us-east-1`; changing the browser display does not re-scope a key. |
| Quota or throttling | The supervisor may retry within the shared three-attempt total and original deadline. If it still fails, wait or ask the administrator to inspect that model's quota. Repeated reruns do not grant capacity. |
| Temporary connection error (`bedrock_network`) | An allowlisted transport error may use remaining attempts within the same three-attempt and time budgets. Unknown, permanent and local-abort errors are not treated as transient. Accepted peer results remain available. |
| Remote model timeout | A Bedrock HTTP 408 model-timeout response may use a remaining attempt inside the original deadline. Local deadline expiry and cancellation remain terminal. |
| Local timeout / cancellation | The local request budget was exhausted or the request was cancelled. No further attempt is started. Preserve accepted results and inspect the recorded reason. |
| Report format rejected | Open the model status for the application-authored field and constraint. Either round can use a remaining attempt for a complete corrected generation; no rejected output is accepted or echoed. |
| Invalid/truncated model output | Treat that model as failed; inspect other outcomes. Do not interpret a parsing failure as a clean contract. |
| Content blocked (`content_filtered`) | The provider stopped the response with its content filter. Keep accepted peer results. Refreshing, a new key or a longer timeout is not an established fix. If the legitimate security-review use case requires this model, ask the AWS account administrator/provider to review the permitted use case. No automatic retry or input rewrite is performed. |
| Guardrail blocked (`guardrail_intervened`) | A guardrail stopped the response. Ask the AWS administrator to review the approved guardrail policy and use case; the app does not remove or work around it. |
| Incomplete response | Expand the model row for the allowlisted Bedrock stop reason. An output-token limit, context limit, malformed output and an unexpected/missing reason are different outcomes. A historical generic `incomplete` record without a preserved reason cannot establish which occurred. |

The supplied callback-contract export recorded Claude first-round `content_filtered` after 1,740 ms, while GPT and Grok returned accepted reviews. That evidence identifies a content-filter stop for that invocation; it does not demonstrate a bad key, a timeout or an AWS outage. The two successful follow-up assignments do not change the missing Claude coverage. Similar wording in separate claims also does not justify silently merging their recorded identities.

New responses retain dedicated `content_filtered` and `guardrail_intervened` codes. Older `incomplete` records with the exact recognized stop-reason detail display the same actionable explanation without rewriting the saved record. Historical records lacking that detail remain generic.

Second-round validation distinguishes missing or unexpected required answer slots, invalid verdict/severity combinations, out-of-range evidence spans and non-matching excerpts. Historical array-format reports retain their assignment-count and ID checks. Diagnostics contain only application-authored constraints, trusted slot names, numeric counts and bounded assessment indices. They never display raw model output or arbitrary property names. An unrecognized provider rejection remains generic; a hint is a diagnostic clue, not a confirmed root cause.

For an HTTP-success response that did not end normally, the server exposes only recognized stop-reason names and fixed explanations. Missing or unknown reasons remain generic. Failed-response token usage is not added to accepted-review usage totals. The incomplete output remains rejected, even if it contains parseable JSON. Stop-reason detail does not expand the retry allowlist, extend a deadline or change the output limit. A new authorized run is required to collect a reason that an older export did not preserve.

HTTP 400 diagnostics read at most 16 KiB for at most one second within the existing request deadline. Empty, malformed, oversized or slow error bodies fall back to the existing safe HTTP status and request ID. These diagnostics introduce no extra provider call, schema fallback, automatic correction or HTTP 400 retry. A new run is needed to collect these details for failures produced by an older version.

The Final Report retains each model's last accepted opinion. If an assigned second review fails, an existing first-round finding and its proposed severity remain labeled as original evidence, with reassessment pending. A missing response is not a rejection, a fresh confirmation or grounds to lower severity. An accepted second-round rejection or uncertainty does supersede the prior position. Coverage is partial whenever either round is incomplete. Historical raw second-round summaries remain unchanged and may show different counts from this versioned final projection.

### Required second-review answer slots

A supplied paired evaluation recorded a Claude second-review failure because the assessment count did not match its three assigned claims. The previous provider grammar omitted unsupported array-count constraints, leaving assignment coverage to local rejection after generation.

The current response requires `{summary, assessments}` with all twelve `assessment_1` through `assessment_12` slots. A shared assessment definition or null gives each slot a stable native grammar. Assigned slots must contain explicit judgments; every unused slot must be null. Each input claim carries its trusted `response_slot`; the model does not generate a finding ID. After the complete response validates, the server binds only assigned answers to original IDs and creates the existing canonical array. Missing or extra slots, null assigned answers and populated unused slots reject the entire response. No missing answer is synthesized. Second Review may regenerate the whole batch within the shared three-attempt budget; every required slot must then pass validation. The schema is independent of assignment counts and source-specific IDs. This addresses avoidable schema churn, not upstream filtering or guaranteed execution.

### Claude second-review output compatibility

The live Claude profile accepted the first-round grammar but rejected the second-round structured-output configuration with HTTP 400 `ValidationException`. The available diagnostic identifies the configuration class, not the exact rejected keyword. The second-round grammar introduced a nullable severity with a mixed string/null enum; the first-round severity is a string enum. AWS documents null and unions generally, so this observation does not establish that Claude universally rejects them.

The compatibility repair first applied a homogeneous string enum to `us.anthropic.claude-opus-5-5`. The current stable-slot grammar uses that same encoding for all three models: `HIGH`, `MEDIUM`, `LOW`, `NOT_APPLICABLE`. The prompt requires `NOT_APPLICABLE` for `not_supported` and `uncertain`. After strict wire validation, the server translates only that exact marker on those two verdicts into canonical `null`, then runs the unchanged canonical schema and source-binding checks. Supported findings still require a real severity. Raw null, unknown markers, inconsistent verdict/severity pairs and incorrect evidence are rejected. This is a fixed encoding adapter, not inferred repair of a model's judgment.

This encoding adapter preserves the public report shape, first-round requests, assignment policy, retry budget and deadlines. It adds no fallback call or weaker prompt-only output mode. A subsequent user-provided live export contains an accepted Claude second-round response, establishing acceptance for that run. The shared source-span citation protocol is described below.

### Source-span citations and report provenance

All current model requests use **model-selected source references with application-resolved excerpts**. The application copies source text, not a model judgment; it does not infer or certify the model's reasoning. Both rounds reject non-integer, reversed, out-of-source or oversized spans and unexpected evidence fields. The adapters themselves only validate and retrieve source text. Either round's supervisor may request a complete corrected generation after local rejection, within the shared three-attempt budget; it never changes a cited line number to make it valid. The non-support severity marker is now shared by all three models.

First-round prompt `independent-review-v5-bounded-evidence-correction-grok-medium` keeps reader-focused titles, explanations, recommended actions, all-model source-span citations and Grok medium effort while recording safe corrective instructions. Historical first-round v4/v3 prompts retain their source-span provenance; v2 retains exact-quote provenance. Second-round reports retain `targeted-peer-review-v7-bounded-evidence-correction-grok-medium` and the same twelve-slot grammar. Historical v6 and v5 retain their earlier stable-slot and count-dependent grammar provenance; v4/v3 keep Grok-only source spans. Earlier prompts retain their original quote-based evidence rules.

Current policies are `bounded-review-v3-validation-recovery` and `targeted-peer-review-v5-extended-recovery`. They permit three attempts within the extended 270-second model and 285-second round deadlines, plus the upstream HTTP 408 model-timeout retry. Historical first-round v2 retains network recovery without validation correction. Historical second-round v4 retains validation correction, and v3 retains network recovery without correction. Older policies keep HTTP-only retry rules and the five-second delay cap. All historic policies retain their original two-attempt, 180-second model and 210-second round caps. Import never grants new behavior retroactively. Models, Region, canonical records, assignment rules and the separately versioned last-valid-opinion aggregation policy are unchanged.

### Bounded second-review validation correction

A supplied consolidated export records Claude's second-round `invalid_evidence` after 18,085 ms. The rejected `assessments[1].evidence` did not satisfy the ascending, in-range, one-to-twelve-line source constraint. The export does not expose the actual rejected numbers, so it cannot establish which part of that constraint failed. This was a local evidence-validation failure, not the 180-second timeout. In the same run, GPT recovered from `bedrock_unavailable` on its second attempt and Grok returned an accepted second-round review.

Both review endpoints can now use a remaining attempt for complete regeneration after local wire schema, canonical schema or source-evidence rejection. The model, source, native grammar and assigned work stay unchanged. Only safe application-authored constraints are added to the system instructions; rejected text is not echoed. Evidence is never clamped, invented or silently removed. The replacement must pass all validation gates. Service/network recovery, upstream HTTP 408 model-timeout recovery and validation correction share three attempts, a 270-second model deadline and a nine-call round cap. Filtering, invalid access, credential echo, provider JSON parsing, incomplete responses and local cancellation do not enter correction. This supplies bounded recovery for the observed failure class without claiming that every model or service response will succeed.

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
- [AWS: Grok reasoning effort through Converse](https://aws.amazon.com/blogs/machine-learning/grok-4-7-is-now-available-on-amazon-bedrock/)
- [Converse API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html)
- [AWS: understanding Bedrock content-filter blocks](https://aws.amazon.com/blogs/publicsector/this-content-has-been-blocked-by-our-content-filters-on-amazon-bedrock-now-what/)
