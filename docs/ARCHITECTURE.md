# Architecture

## Analysis paths

The Next.js application provides two independent analysis paths. Static analysis runs a bounded TypeScript port of the inherited 15-rule scanner in the browser. API analysis sends one source snapshot and a visitor-owned Bedrock key to the same-origin `POST /api/reviews` route.

The server dispatches three concurrent Converse requests to GPT-6.1 Sol, Claude Opus 5.5 and Grok 4.7 through fixed US inference profiles in `us-east-1`. All receive the same review task, numbered source lines, full report-format contract and a provider-native JSON Schema output configuration. GPT additionally requires its documented strict-format flag. They receive no static candidates, peer findings or credentials in their prompts. No tool execution, source compilation or external retrieval is available to the models.

Each response is validated before entering the application orchestrator. The orchestrator groups compatible findings by canonical weakness and evidence location, counts distinct supporting models and preserves membership in the original reviews. It performs no additional inference. This is application-managed orchestration, not an Amazon Bedrock managed Agents deployment. See [the algorithm and reporting semantics](ORCHESTRATION.md).

## Evidence and report contracts

The original static report schema remains separate from the version **2.0.0** multi-model response/export. Static candidate IDs bind source, engine version, rule and location. Browser validation checks source hash, report provenance and exact source excerpts.

A multi-model run records all three model identities, success/failure outcomes, accepted original reviews, available token usage and elapsed times. The consensus report retains its member references, model support, agreement level and severity disagreement. JSON and Markdown exports preserve this information. Raw AWS payloads and hidden reasoning blocks are not exported as findings.

A model response must have the expected JSON shape, allowed severity values and bounded findings. Source excerpts must match the submitted snapshot at the claimed locations. Invalid, truncated or unbound output fails that model's review. Passing these checks establishes structural grounding, not the correctness of a vulnerability explanation.

Source-binding metadata belongs to the server. Incoming evidence contains only start/end lines and the excerpt. After checking the full response for credential echoes, the server removes any legacy model-supplied `evidence.validation` annotation, validates the remaining content strictly, checks actual source binding and then assigns `source-bound`. It never repairs evidence or silently drops a finding. The same evidence validator is used when accepting the final report in the browser.

The browser independently validates received results and their binding to the current source before display or export. Static findings are never counted as a model vote.

## Failure and lifecycle behavior

Three successful reviews constitute complete model coverage. One or two successful reviews produce an explicitly partial run; only accepted findings participate in consolidation. Three failures produce a failed run, not a zero-finding safety result. A successful model with an empty findings array is recorded as successful, but absence of a claim is not an explicit rebuttal of another model's claim.

Changing source, filename or reference case invalidates results and aborts the browser request. Replacing or clearing the key also prevents late responses from overwriting newer state. Static results remain independently available after API failure. Cancellation stops the application's wait; it cannot guarantee that AWS has stopped processing or billing a request already received.

## Resource bounds

| Boundary | Limit |
| --- | --- |
| Solidity input | 48,000 UTF-8 bytes; 1,200 lines; 2,000 characters per line |
| Incoming request | 128,000 bytes; 10-second body-read deadline |
| Model calls | Three parallel calls; no automatic retries or fallback models |
| Model output | 8,192 tokens and 256,000 response bytes per model |
| Deadlines | 180 seconds per model; 210 seconds overall server request |
| Next.js function | 240 seconds; Vercel Fluid compute |

The per-instance guard permits one active analysis and six attempts per minute per key hash, with four active analyses overall and at most 1,000 retained hashes. Each analysis can issue three model calls, so four active analyses can represent twelve upstream requests. Inactive expired entries are discarded. These guards are not distributed user quotas and do not authenticate a visitor.

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
