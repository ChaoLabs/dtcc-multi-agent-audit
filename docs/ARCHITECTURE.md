# Architecture

## Analysis paths

The Next.js application provides two independent analysis paths. Static analysis runs a bounded TypeScript port of the inherited 15-rule scanner in the browser. API analysis sends one source snapshot and a visitor-owned Bedrock key to the same-origin `POST /api/reviews` route.

For the first pass, the server dispatches three concurrent Converse requests to GPT-6.1 Sol, Claude Opus 5.5 and Grok 4.7 through fixed US inference profiles in `us-east-1`. All receive the same review task, numbered source lines, full report-format contract and a provider-native JSON Schema output configuration. GPT additionally requires its documented strict-format flag. They receive no static candidates, peer findings or credentials in their prompts. No tool execution, source compilation or external retrieval is available to the models.

Each response is validated before entering the application orchestrator. The orchestrator groups compatible findings by canonical weakness and evidence location, counts distinct supporting models and preserves membership in the original reviews. It supervises bounded attempts and deadlines, records prompt provenance and identifies findings needing comparison. The supervisor itself performs no inference. An explicitly requested second stage asks the same eligible models to reconsider selected claims with peer context. This is application-managed orchestration, not an Amazon Bedrock managed Agents deployment. See [the algorithm and reporting semantics](ORCHESTRATION.md).

The optional second stage uses `POST /api/reviews/second-round` after the first stage completes. It validates the source and first-pass snapshot, requires at least two successful first-pass reviewers and selects at most twelve queued claims. All eligible reviewers assess the same claims with source evidence. Claims beyond the limit are deferred. The first-pass report is immutable; peer-informed decisions are retained separately and do not alter independent agreement. Second-pass context distinguishes a reviewer's own prior claims from peer claims, while withholding peer model names, vote counts, consensus labels and static findings.

## Evidence and report contracts

The original static report schema remains separate from the first-pass **2.1.0** report and the second-review **1.0.0** report. The browser also accepts historical **2.0.0** reports, which have no execution-policy record. Static candidate IDs bind source, engine version, rule and location. Browser validation checks source hash, report provenance and exact source excerpts.

A multi-model run records all three model identities, success/failure outcomes, accepted original reviews, available token usage and elapsed times. The consensus report retains its member references, model support, agreement level and severity disagreement. JSON and Markdown exports preserve this information. Raw AWS payloads and hidden reasoning blocks are not exported as findings.

A model response must have the expected JSON shape, allowed severity values and bounded findings. Source excerpts must match the submitted snapshot at the claimed locations. Invalid, truncated or unbound output fails that model's review. Passing these checks establishes structural grounding, not the correctness of a vulnerability explanation.

Source-binding metadata belongs to the server. Incoming evidence contains only start/end lines and the excerpt. After checking the full response for credential echoes, the server removes any legacy model-supplied `evidence.validation` annotation, validates the remaining content strictly, checks actual source binding and then assigns `source-bound`. It never repairs evidence or silently drops a finding. The same evidence validator is used when accepting the final report in the browser.

The browser independently validates received results and their binding to the current source before display or export. Static findings are never counted as a model vote. Second-pass candidate IDs, model eligibility, source evidence and baseline fingerprints are checked before display. The browser recomputes the derived second-pass summaries. Hash binding detects content mismatch, not provider authenticity.

## Failure and lifecycle behavior

Three successful reviews constitute complete model coverage. One or two successful reviews produce an explicitly partial run; only accepted findings participate in consolidation. Three failures produce a failed run, not a zero-finding safety result. A successful model with an empty findings array is recorded as successful, but absence of a claim is not an explicit rebuttal of another model's claim.

Changing source, filename or reference case invalidates results and aborts the browser request. Replacing or clearing the key also prevents late responses from overwriting newer state. Static results remain independently available after API failure. Cancellation stops the application's wait; it cannot guarantee that AWS has stopped processing or billing a request already received.

## Resource bounds

| Boundary | Limit |
| --- | --- |
| Solidity input | 48,000 UTF-8 bytes; 1,200 lines; 2,000 characters per line |
| First-pass request | 128,000 bytes; 10-second body-read deadline |
| Second-pass request | 1,500,000 bytes including the baseline; 10-second body-read deadline |
| Second-pass context | 256,000 bytes of serialized source/claim context per model before dispatch |
| Model calls | Up to three parallel tasks per pass; at most two attempts each. Six calls per pass, twelve across two explicit passes; no replacement models |
| Model output | 8,192 tokens and 256,000 response bytes per attempt |
| Deadlines | 180 seconds per model; 210 seconds per server request; separate requests for each pass |
| Next.js function | 240 seconds; Vercel Fluid compute |

The per-instance guard permits one active analysis and twelve pass starts per minute per key hash, with four active passes per runtime and at most 1,000 retained hashes. Each pass can have three upstream requests active at once, so four active passes can represent twelve simultaneous upstream requests within one runtime. Retries are sequential within each model task; the worst-case total is six calls per pass. Inactive expired entries are discarded. The guard is shared by route imports within one runtime, but separate Vercel functions or instances do not share memory. It is not a distributed user quota, a deployment-wide concurrency guarantee or visitor authentication.

A model may retry once after HTTP 429, 500, 502, 503 or 504, with bounded backoff and an unchanged absolute deadline. Invalid credentials, access denial, unsupported model requests, malformed output and invalid evidence are terminal. Network ambiguity and local timeout do not trigger automatic retries. A browser cancellation stops new attempts, but cannot guarantee cancellation of work already accepted by AWS.

## Controlled evaluation

The prompt variant is selected before execution and applies identically to all three models. Standard instructions provide the baseline; guided examples add fixed synthetic examples that are separate from the five reference contracts. Prompt version and execution policy are retained with the report. No static findings or expected fixture labels are added to the model input.

The five-case validation workflow runs one contract at a time using the current tab key. First-pass-only mode can issue at most 30 provider requests for one prompt variant; enabling the optional second review raises the maximum to 60. Each second review is paired with the first pass from that same case execution, not a separately sampled baseline. Cancellation prevents subsequent cases and preserves already completed records. The run captures completion, latency, retries, available usage and disagreement; these are operational measures, not detection accuracy. See [the evaluation protocol](EVALUATION.md).

## Credentials and hosting

The key exists in tab memory, a masked input while editing, and the active server request. It travels in an HTTPS POST body to the site's function and in authorization headers to AWS. It never enters model prompts, URLs, cookies, browser persistence, a source database, shared process environment or application logs. No server-owned credential fallback is configured. Refresh or Clear key drops the active browser reference; closing the dialog clears unsaved key input.

These are application storage guarantees. Hosting request logging, AWS account invocation logging, browser extensions and provider memory disposal have separate controls. The deployment owner pays Vercel compute; the visitor's AWS account pays model usage. The public route is a bring-your-own-key service without application accounts, durable jobs, distributed quotas or sponsor-funded model access.

## Retained Python service

`services/audit-api` remains an optional loopback-only FastAPI service for the original Python scanner, parity checks and earlier single-model review workflow. Its `/api/audits`, `/api/config` and `/api/reviews` endpoints are separate from the current Next.js route. The website does not call it. Legacy Python transport limits and schema generation do not define the web multi-model contract.

## Evaluation boundary

Regression tests with mocked model responses can establish dispatch, validation, consolidation and failure behavior. They cannot establish actual AWS account permissions, real model latency, or improved detection accuracy. The five teaching fixtures are not a held-out evaluation corpus. Compiler-backed validation, reviewed labels, benign controls and single-model versus multi-model comparisons remain required research work.

## References

- [Bedrock Converse](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html)
- [Bedrock API keys](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html)
- [Managed Bedrock multi-agent collaboration](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-multi-agent-collaboration.html)
