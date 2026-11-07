# Architecture

## Analysis paths

The Next.js application provides two independent analysis paths. Static analysis runs a bounded TypeScript port of the inherited 15-rule scanner in the browser. API analysis sends one source snapshot and a visitor-owned Bedrock key to the same-origin `POST /api/reviews` route.

For the first pass, the server dispatches three concurrent Converse requests to GPT-6.1 Sol, Claude Opus 5.5 and Grok 4.7 through fixed US inference profiles in `us-east-1`. All receive the same review task, numbered source lines, full report-format contract and a provider-native JSON Schema output configuration. GPT additionally requires its documented strict-format flag. They receive no static candidates, peer findings or credentials in their prompts. No tool execution, source compilation or external retrieval is available to the models.

Each response is validated before entering the application orchestrator. The orchestrator groups compatible findings by canonical weakness and evidence location, counts distinct supporting models and preserves membership in the original reviews. It supervises bounded attempts and deadlines, records prompt provenance and identifies findings needing comparison. The supervisor itself performs no inference. **Run Bedrock Review** ends at first-round **Findings**. A separate **Run Second Review** action starts an eligible second stage against that exact accepted snapshot. The browser never starts it automatically. **Final Report** follows a validated second-round result, including a partial result, or a stated ineligibility reason when no second-round assignment can run. Saving credentials or switching modes does not start analysis. The second stage asks the same eligible models to reconsider selected claims with peer context. This is application-managed orchestration, not an Amazon Bedrock managed Agents deployment. See [the algorithm and reporting semantics](ORCHESTRATION.md).

The optional second stage uses `POST /api/reviews/second-round` after the first stage completes. It validates the source and first-pass snapshot, requires at least two successful first-pass reviewers and selects at most twelve queued claims. For each successful reviewer, the supervisor selects peer claims it did not report. Severity-disputed claims are also assigned for explicit reassessment. Models with no assigned claims receive no call; unavailable first-pass models remain unavailable. Claims beyond the limit are deferred. The first-pass report is immutable; peer-informed decisions are retained separately and do not alter independent agreement. Second-pass context distinguishes a reviewer's own prior claims from peer claims, while withholding peer model names, vote counts, consensus labels and static findings.

## Evidence and report contracts

The original static report schema remains separate from the first-pass **2.1.0** report and the second-review **1.1.0** report. Historical second-review **1.0.0** reports retain the earlier all-reviewer assignment policy. The browser also accepts historical **2.0.0** reports, which have no execution-policy record. Static candidate IDs bind source, engine version, rule and location. The lexical scanner emits engine version **0.1.1** after comment/string masking and flexible call-syntax handling; source-bound historical **0.1.0** reports remain readable. Browser validation checks source hash, report provenance and exact source excerpts.

A multi-model run records all three model identities, success/failure outcomes, accepted original reviews, available token usage and elapsed times. The consensus report retains its member references, model support, agreement level and severity disagreement. JSON and Markdown exports preserve this information. Raw AWS payloads and hidden reasoning blocks are not exported as findings.

A model response must have the expected JSON shape, allowed severity values and bounded findings. Source excerpts must match the submitted snapshot at the claimed locations. Invalid, truncated or unbound output is not accepted. In either round, local schema or evidence rejection can request a complete corrected generation within the remaining shared attempt budget; transport parsing and incomplete responses remain terminal. Passing these checks establishes structural grounding, not the correctness of a vulnerability explanation.

Source-binding metadata belongs to the server. In both rounds, all current provider wire formats contain only source line bounds. The server validates the complete response and credential-echo checks, resolves valid spans to exact immutable source text, then applies canonical validation and its `source-bound` annotation. It never repairs a line range, invents evidence or silently drops a finding. Historical quote-based reports retain exact-quotation validation; their provenance is not rewritten. Browser validation still checks the complete canonical source excerpt.
Second-round wire formats use a stable `assessments` object with all twelve required `assessment_1` through `assessment_12` slots. Each slot uses a shared assessment definition or null. Assigned slots must contain explicit judgments; unused slots must be null. These assignment-specific checks run locally after native-schema validation. The source context supplies each trusted `response_slot`; the model generates no finding ID. Only validated assigned answers are bound to original IDs and emitted in the existing canonical array. Missing, extra, wrongly populated or invalid slots reject the complete model response. The native grammar no longer changes with the assignment count or claim IDs.

All models use the explicit `NOT_APPLICABLE` string marker for non-applicable second-round severity, converted to canonical null only for non-support verdicts. Shared definitions and twelve nullable slots keep the native schema within Bedrock's union-property limit. All three models select integer, ordered, in-source spans of at most twelve lines. The server validates the complete wire response before retrieving exact excerpts. Blank/oversized excerpts, unexpected fields and invalid verdict/severity pairs are rejected. Source-text retrieval does not verify the model's reasoning.

Current prompts are `independent-review-v5-bounded-evidence-correction-grok-medium` and `targeted-peer-review-v7-bounded-evidence-correction-grok-medium`. Both ask for source-grounded evidence and retain Grok `reasoning_effort: "medium"`; the first retains reader-focused risk explanations and actions, and the second retains the twelve-slot grammar. Current policies `bounded-review-v3-validation-recovery` and `targeted-peer-review-v5-extended-recovery` record the extended deadlines and three-attempt budget, with safe local-validation correction available in both rounds. Historical first-round v4/v3 and second-round v7/v6/v5 prompts retain their source-span provenance. First-round v2 and earlier peer prompts retain their original evidence rules. Historical policies retain their own two-attempt, 180-second model and 210-second round caps; importing an older report cannot give it newer recovery privileges. Canonical first- and second-round schemas remain **2.1.0** and **1.1.0**. No runtime-model replacement is introduced.
The browser independently validates received results and their binding to the current source before display or export. Static findings never vote. The unified final view retains every first-pass finding and each model's original discovery and later judgment. Its schema **1.1.0** and `last-valid-opinion-v1` policy are unchanged: a valid second-round judgment supersedes the earlier position; a failed reassessment retains original evidence with reassessment explicitly pending. Missing output never becomes a new vote. Canonical second-round summaries and paired evaluation keep their original semantics. Hash binding detects content mismatch, not provider authenticity.

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
| Model calls | Up to three parallel tasks per pass; at most three attempts each. Nine calls per pass, eighteen across two passes; no replacement models |
| Model output | 8,192 tokens and 256,000 response bytes per attempt |
| Deadlines | 270 seconds per model; 285 seconds per server request; separate requests for each pass |
| Browser / Next.js function | 295-second browser wait; 300-second function with Vercel Fluid compute |

The per-instance guard permits one active analysis and twelve pass starts per minute per key hash, with four active passes per runtime and at most 1,000 retained hashes. Each pass can have three upstream requests active at once, so four active passes can represent twelve simultaneous upstream requests within one runtime. Retries are sequential within each model task; the worst-case total is nine calls per pass. Inactive expired entries are discarded. The guard is shared by route imports within one runtime, but separate Vercel functions or instances do not share memory. It is not a distributed user quota, a deployment-wide concurrency guarantee or visitor authentication.

A model may use its two remaining attempts after HTTP 429, 500, 502, 503 or 504, a Bedrock HTTP 408 model-timeout response, or an allowlisted temporary connection error classified as `bedrock_network`. Local jitter remains capped at five seconds; longer provider Retry-After waits are honored only when the unchanged absolute deadline leaves time for another attempt. Both rounds may use the same remaining attempts after local schema or evidence rejection. A corrective system instruction contains only application-authored constraints and trusted source/assignment bounds. Source, assignments and baseline stay unchanged. Rejected text is never echoed; the complete replacement must pass all checks without clamping, dropping or inventing evidence. Credentials, access denial, unsupported requests, filtering, guardrails, credential echo and provider JSON parsing remain terminal. Unknown/permanent transport errors and local abort/timeout do not trigger retries. Successful reviews are not rerun. Cancellation stops new attempts but cannot guarantee cancellation of work already accepted by AWS; a connection failure does not prove the upstream work was not processed or billed.

First-pass execution policy `bounded-review-v3-validation-recovery` records the new recovery and deadline contract. Historical `bounded-review-v2-network-recovery` keeps network recovery without local-validation correction, and `bounded-review-v1` keeps HTTP-only eligibility and its five-second delay cap. Second-review v4 keeps its earlier validation correction within two attempts; v3 keeps network recovery and v2 keeps HTTP-only recovery. None inherits the new third attempt or remote model-timeout retry.

## Controlled evaluation

The prompt variant is selected before execution and applies identically to all three models. Standard instructions provide the baseline; guided examples add fixed synthetic examples that are separate from the five reference contracts. Prompt version and execution policy are retained with the report. No static findings or expected fixture labels are added to the model input.

The five-case validation workflow runs one contract at a time using the current tab key. First-pass-only mode can issue at most 45 provider requests for one prompt variant; enabling the optional second review raises the maximum to 90. Each second review is paired with the first pass from that same case execution, not a separately sampled baseline. Cancellation prevents subsequent cases and preserves already completed records. The run captures completion, latency, retries, available usage and disagreement; these are operational measures, not detection accuracy. A bounded tab-memory history and validated JSON import preserve run records. Human adjudication is bound to source and baseline hashes; quality metrics are withheld until their label and inventory prerequisites are met. See [the evaluation protocol](EVALUATION.md).

## Credentials and hosting

The key exists in tab memory, a masked input while editing, and the active server request. It travels in an HTTPS POST body to the site's function and in authorization headers to AWS. It never enters model prompts, URLs, cookies, browser persistence, a source database, shared process environment or application logs. No server-owned credential fallback is configured. Refresh or Clear key drops the active browser reference; closing the dialog clears unsaved key input.

These are application storage guarantees. Hosting request logging, AWS account invocation logging, browser extensions and provider memory disposal have separate controls. The deployment owner pays Vercel compute; the visitor's AWS account pays model usage. The public route is a bring-your-own-key service without application accounts, durable jobs, distributed quotas or sponsor-funded model access.

## Retained Python service

`services/audit-api` remains an optional loopback-only FastAPI service for the original Python scanner, parity checks and earlier single-model review workflow. Its `/api/audits`, `/api/config` and `/api/reviews` endpoints are separate from the current Next.js route. The website does not call it. Legacy Python transport limits and schema generation do not define the web multi-model contract.

## Evaluation boundary

Regression tests with mocked model responses can establish dispatch, validation, consolidation and failure behavior. They cannot establish actual AWS account permissions, real model latency, or improved detection accuracy. The five teaching fixtures are not a held-out evaluation corpus. Compiler-backed validation, completed human labels, benign controls and broader held-out comparisons remain required research work. The supplied architecture slide illustrates a possible reuse domain; this platform does not analyze arbitrary cloud diagrams. See [the requirements map](MUXIANG_REQUIREMENTS.md).

## References

- [Bedrock Converse](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html)
- [Bedrock API keys](https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html)
- [Managed Bedrock multi-agent collaboration](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-multi-agent-collaboration.html)
