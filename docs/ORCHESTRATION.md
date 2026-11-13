# Model orchestration and consensus

## Execution design

A first-pass run dispatches GPT-6 Astra, Claude Opus 5.5 and Grok 4.7 concurrently through Bedrock Converse. Each receives the same source snapshot, numbered lines, review task, complete format contract and provider-native JSON Schema constraint. GPT also receives its required strict-format flag. No model sees static findings or another model's answer.

The application orchestrator is a deterministic TypeScript supervisor. It manages bounded model attempts, deadlines and failure outcomes, validates model outputs, consolidates compatible findings, calculates distinct-model support and produces a traceable report. It does not invoke a fourth LLM or deploy Amazon Bedrock managed Agents. This implementation gives the platform a reproducible baseline for evaluating orchestration strategies.

The browser workflow is **Bedrock Review → Findings → Second Review → Final Report**. **Run Bedrock Review** performs independent analysis and stops at the first-round findings. The user inspects those findings and explicitly selects **Run Second Review** against that exact accepted baseline. There is no automatic second-round trigger. The final report follows a validated second-review result, including a partial result; a plan with no eligible assignments explains why the second round cannot run. Cancellation or a request failure without an accepted second-round report preserves first-round findings and exports, but does not unlock the final report solely because an attempt occurred. Connecting a key or selecting a mode does not trigger paid work.

The separate second pass lets successful first-pass reviewers reconsider selected queued claims using peer context. This is a bounded reconsideration stage, not an endless agent conversation. The first-pass report and independent agreement remain immutable. [Written design](ORCHESTRATION_DESIGN.md) summarizes the end-to-end workflow.

## Validation before consolidation

Every successful review is bound to the source SHA-256 and model identity. The response must satisfy the expected schema and bounds, including allowed severities, finding counts, line spans and exact excerpts. Truncated, malformed or source-inconsistent output fails that model review. Only accepted original findings enter consolidation; raw AWS response bodies are not treated as evidence or placed in exports.

The server, rather than a model, assigns the evidence's `source-bound` validation annotation. All current first- and second-round requests require model-selected `line_start` and `line_end` only. After complete wire validation and valid source-span checks, the application retrieves the exact immutable source text and validates the canonical report. Models cannot declare their own evidence verified. Historical quote-based records retain their original quotation checks and provenance.

These checks establish report integrity and source grounding. They do not determine whether a claim is a real vulnerability.

## Finding identity and grouping

The orchestrator uses a canonical weakness category together with source evidence location. It normalizes known category aliases and refines broad `access-control` or `other` labels only when the title explicitly identifies a recognized weakness. Different canonical categories remain separate.

Before locating operations, it masks comments and strings while preserving offsets. It then applies these matching rules:

1. For supported weakness categories, a cited span containing exactly one recognized operation is anchored to that operation's source offset. Two findings can merge when they identify the same operation and weakness despite different titles or excerpt windows.
2. An explicitly missing caller restriction can be anchored to a containing function, constructor, fallback, receive function or modifier. This is limited to missing-restriction claims; different authorization bugs in one function are not automatically equivalent.
3. For two specific payment risks, both the mechanism and a unique call site must match: a native transfer blocked by its fixed gas stipend, or a call that omits its intended native payment. A nearby arbitrary-call finding is not the same claim. Each original contribution remains in the report; each distinct model counts once.
4. Ambiguous windows, unsupported syntax and other cases use exact line span plus normalized title. The algorithm does not guess which operation a multi-operation excerpt refers to.

These are lexical rules, not AST or data-flow analysis. Findings that cannot be reconciled remain individually visible rather than being silently removed. Approximate scope recognition may miss or misclassify unusual Solidity syntax.

Each consolidated finding retains references to its original model findings. Reviewers can inspect the original severity, rationale, recommendation and evidence. A model contributes at most one vote to a group, regardless of how many of its findings become members. Duplicate wording cannot manufacture a second independent vote.

The application taxonomy is a matching vocabulary, not a claim of externally certified SWC, CWE or OWASP classification. Category normalization and location matching have limitations: reviewers should inspect group membership when a finding's wording or cited span differs materially across models.

## Agreement and severity

| Distinct supporting models | Agreement |
| --- | --- |
| 1 | LOW |
| 2 | MEDIUM |
| 3 | HIGH |

Agreement is an ordinal description of observed support. It is not a probability, confidence calibration or proof of correctness. The denominator is the three configured models, not just the models that completed; a partial run with one successful model cannot become HIGH agreement.

The proposed severity of a group is the highest severity among its members. The displayed title, rationale, recommendation and evidence come from that representative member; ties follow the configured model order. When members disagree on severity, the report records that disagreement and preserves the underlying proposals. Severity and agreement are separate dimensions: a HIGH-severity finding can have LOW agreement.

The JSON `confidence` field stores this LOW/MEDIUM/HIGH agreement label, `agreement` stores the distinct-model count, and `members` identifies each original contribution by model ID and finding index. The field name does not imply statistical confidence.

The manual-review queue records three distinct reasons: severity disagreement, non-reporting by a successful reviewer, and unavailable model coverage. It names the supporting, non-reporting and unavailable models separately; the browser recomputes these reasons from the underlying reviews. A queue entry is a request for human comparison, not a new vulnerability or a calibrated risk score.

Absence of a finding in a successful review is not an explicit rejection. A failed model contributes no vote, and its failure is not counted as evidence for or against a vulnerability. Static findings do not vote.

## Complete, partial and failed runs

| Model outcomes | Run interpretation |
| --- | --- |
| Three successful reviews | Complete model coverage for the supplied source and bounded requests |
| One or two successful reviews | Partial coverage; retain accepted reviews and show each failure |
| No successful reviews | Failed run; no accepted model assessment |

A successful empty finding list does not establish safety. A consensus group with three supporters remains a candidate for human review. The platform does not execute exploits, compile imports or certify repairs.

## Bounded execution policy

| Control | Behavior |
| --- | --- |
| Model tasks | Three in parallel; fixed model identities, no silent replacements |
| Attempts | At most three per model, including the initial request |
| Retry eligibility | Explicit HTTP 429, 500, 502, 503 or 504, Bedrock HTTP 408 model-timeout responses, or allowlisted temporary connection errors classified as `bedrock_network` |
| Validation correction | Either round may regenerate a complete response after local schema or evidence rejection, within the same three-attempt total |
| Terminal failures | Authentication/permission, filtering/guardrails, invalid model requests, transport JSON parsing, credential echo, unknown/permanent transport errors and local abort/timeout |
| Backoff | 500-1,000 ms default jitter, locally capped at 5 seconds; honor longer provider Retry-After waits only when at least 1 second remains for an attempt within the original deadlines |
| Absolute deadlines (model / round / browser) | Local: 660 / 720 / 745 seconds; Vercel: 270 / 285 / 295 seconds. Retries do not reset a clock. |
| Provider requests | At most nine per pass; at most eighteen for first and follow-up passes. Successful attempts are not retried |
| Output per model | 32,768 tokens initially. After an explicit `max_tokens` stop, discard the reply and allow one escalation to 65,536 within the remaining attempts and time. Provider response envelope cap: 2 MiB. |
| Cancellation | Stop waiting and prevent further attempts/cases; preserve completed case records |

The supervisor records each attempt's outcome, elapsed time, sanitized error code and scheduled preceding retry delay. Model-run elapsed time includes actual waiting; the delay field records planned backoff. Either endpoint may regenerate a locally rejected complete response using its remaining attempts. It appends application-authored constraints and trusted source/assignment bounds to the system instructions, keeping source, assignments, models and baseline unchanged. It never echoes rejected text, changes evidence locations, discards judgments or invents support. The replacement must pass every normal check. Service recovery, validation correction and token-limit recovery share three attempts total. Malformed provider JSON and other terminal transport outcomes remain outside correction. An exhausted budget is explicit; accepted peer reviews remain inspectable. Source/mode/key changes and cancellation prevent stale responses from replacing newer state. A second pass requires an explicit click; ineligible plans make no second request. Work accepted by AWS may still be billed, including a request whose connection later failed. A retry is another attempt by the same model, never another independent vote.

New first-pass reports record `bounded-review-v4-output-recovery`; second-pass reports record `targeted-peer-review-v6-output-recovery`. A saved record retains the model identities, attempt budget, deadlines and retry eligibility of its own policy. Earlier first-pass v3 and second-pass v5 already permitted three attempts and service or validation recovery, but did not permit a new generation after an output-token stop.

A provider stop reason of `content_filtered` or `guardrail_intervened` is a dedicated terminal error. The UI explains what happened and the next legitimate action while preserving accepted peers. It does not imply a credential failure, treat a filtered response as an empty successful review, or rewrite/resubmit the input to get around filtering. Legacy `incomplete` reports with a recognized preserved filter reason receive the same explanation; reports without that evidence remain generic.

Rate guards are local to a server instance: one active analysis per key hash, twelve pass starts per minute per key hash and four active analyses overall. Both route modules use the guard within one runtime, but Vercel can run them in separate functions or instances. These are not distributed account quotas or a deployment-wide concurrency guarantee. Retries occur inside the acquired analysis slot and do not create additional parallel model tasks.

## In-context prompt variants

Standard instructions provide the baseline. Guided examples add small, fixed synthetic examples showing evidence format and the distinction between a suspicious operation and a supported vulnerability claim. Examples are separate from the five reference fixtures. They are not model training, do not change model weights and are not evidence for the submitted contract.

A first-pass run uses one variant consistently across all three models. Neither first-pass variant supplies static findings, expected fixture labels or peer answers. The second review uses its own versioned peer-informed instructions and selected first-pass claims. Prompt variant/version and execution policy are part of the report so an exported result can be attributed to the actual experiment. A separate invocation is required to compare variants. No quality improvement is claimed before a reviewed evaluation.

## One targeted second review

`POST /api/reviews/second-round` accepts the source and validated first-pass snapshot. A baseline must use the current first-pass execution contract and contain at least two successful reviewers. The first twelve actionable queue entries are selected in stable first-pass finding order: severity, source line and finding ID. An actionable entry has an omitted peer finding or a severity dispute that a successful first-pass reviewer can reassess. Remaining claims are explicitly deferred. Deferred work includes both claims beyond the selection limit and claims with unavailable coverage but no eligible assignment; it does not necessarily mean the twelve-claim limit was reached.

The supervisor constructs an assignment for each successful first-pass model:

- Assign a selected claim when peers reported it and this model did not. This implements the slides' targeted second iteration.
- Assign a severity-disputed claim to the successful reviewers, including original discoverers. This explicit extension permits reconsideration and withdrawal when severity or interpretation differs.
- Do not call a model with an empty assignment. A failed first-pass model is not recovered by this stage. A queue caused only by unavailable coverage may therefore have no eligible assignment.

Each reviewer receives the full source and the original contributions for its assigned claims. The context distinguishes own prior assessments from peers while omitting peer provider identities, vote counts, consensus labels, static findings and recommendations. Source and peer text are untrusted data, never instructions. Reviewers cannot add findings outside their assigned ID set.

Every assigned ID requires exactly one typed decision: `supported`, `not_supported` or `uncertain`, with a rationale and exact source evidence. Supported decisions require a severity; other verdicts use canonical null severity. The native wire format has twelve required named slots using a shared assessment definition or null. Assigned slots must hold explicit judgments; unused slots must be null. The native grammar is identical across assignment counts and claim IDs, while local validation enforces the exact plan. All models use `NOT_APPLICABLE` for non-support severity, converted to canonical null only after validation. Each input claim carries its trusted `response_slot`; the model does not generate a finding ID. Only after the entire wire response passes validation does the server bind the assigned answers to original IDs and emit the unchanged canonical array. Missing or extra slots, null assigned answers, populated unused slots, malformed judgments and incorrect evidence reject the complete model review; no missing judgment is inferred.

Second-round provider representations preserve that common contract:

| Provider | Wire representation | Canonical validation |
| --- | --- | --- |
| GPT | String severity or `NOT_APPLICABLE`; model-selected line bounds | Stable slot schema; translate a valid non-support marker to null, then check assignment, source binding and the canonical record |
| Claude | String severity or `NOT_APPLICABLE`; model-selected line bounds | Strict wire schema; translate only a valid non-support marker to null; apply the same source-span and canonical checks |
| Grok | String severity or `NOT_APPLICABLE`; model-selected line bounds | Same strict slot, marker, source-span and canonical checks; medium reasoning effort in both rounds |

Every current evidence excerpt is application-resolved source text, not a model quotation. Non-integer, reversed, out-of-source or oversized spans, blank/oversized retrieved text and unexpected excerpt or validation fields are rejected. Source-line retrieval uses the same newline convention as the source supplied to the model and canonical validator. The application never repairs a line range or judgment to force acceptance. Both rounds may request a newly generated complete answer under the shared three-attempt budget, and that answer must pass all checks. A human reviewer must still assess whether the cited code supports the judgment.

### Final evidence ledger

The **Final Report** presents coverage, all findings and unresolved or disputed judgments, with original model positions and source evidence available in expandable details. Its final read model includes **all first-pass findings**, not only the review queue. Each row preserves original discoverers, each model's first-round state, later verdict or absence, opinion source, evidence, outstanding review work and severity alignment.

The derived final view follows `last-valid-opinion-v1`. A valid assigned second-round judgment supersedes that model's prior position, including an explicit rejection or uncertainty. Without a valid new judgment, the model's original support, severity, rationale and evidence are retained when present. A failed assigned reassessment is separately recorded in `pending_reassessment_models`; retained originals also appear in `retained_after_failed_review_models`. Models without an original finding or accepted new judgment remain unknown. `requires_review` remains true for pending reassessment, including findings with three last-valid supporters. Retained evidence never becomes a new second-round vote. The highest recorded severity includes retained proposals, so an outage alone cannot downgrade a risk.

| Effective positions across the three configured models | Final disposition |
| --- | --- |
| All three support | Supported; severity alignment is shown separately |
| All three explicitly do not support | Not supported |
| Missing, mixed or uncertain positions, or deferred work | Unresolved |

A unanimous first-round finding remains visible with its first-round provenance. A claim can have three last-valid supporters while severity is disputed or a reassessment remains pending. Both conditions keep it in the further-review queue. These are observed model positions, not calibrated probabilities or human-validated truth. First-round agreement is unchanged; peer-informed judgments are never added to the independent vote count.

The stage is limited to one round, twelve queued claims and at most nine additional provider requests. It uses the same absolute deadlines and three-attempt bounds in a separate function request. Ineligible and empty-assignment plans skip AWS calls. Execution status is distinct from claim status: all assigned models can complete while some claims remain unresolved. The UI names this **Second Review** and reports assigned-task completion separately from overall first-pass coverage. For example, two of two assigned follow-up tasks can complete while only two of three configured models have an independent review. No completion label fills the missing vote.

The complete first-pass snapshot is fingerprinted. Validation and exports check that exact fingerprint, not only the source hash. A fingerprint detects content mismatch; it does not authenticate a provider or sign a client-supplied report. A second-round failure leaves the first-round report available.

## Reports and reproducibility

First-pass version **2.1.0** reports preserve execution-policy and prompt provenance, per-attempt outcomes, and the source identity, model identities, original accepted reviews, failure states, timestamps, elapsed times, available token usage, consolidated findings and group membership. JSON supports downstream inspection; Markdown provides a readable record. Static results remain separately attributed and retain their original schema.

Consensus IDs bind the source hash, canonical category and grouping key. New reports record `aggregation_version: source-locus-v3` for the payment matching above. The validator replays `source-locus-v2` and earlier unmarked records using their original grouping rules. New grouping does not change an archived report, its claim IDs, or its original model votes. The first-pass envelope remains 2.1.0. Findings are sorted by descending severity, source line and stable ID. The browser recomputes the consolidation from the source-bound original reviews and rejects inconsistent group membership, agreement or provenance.

Agreement counts can be reproduced from the accepted member findings without another paid model call. Exporting the report does not expose the API key. The original independent reviews remain available to audit the consolidation decision and compare it with alternative algorithms. The API returns the council object; JSON downloads wrap it with the static report and a matching export schema version. Historical **2.0.0** first-pass reports remain readable without inventing missing attempt history; they are not eligible baselines for the new second-review stage. Current first-round prompt `independent-review-v5-bounded-evidence-correction-grok-medium` asks for clear risk explanations, relevant preconditions and concrete fixes, retaining all-model source spans and Grok medium effort. Historical `independent-review-v4-reader-focused-source-spans-grok-medium` and `independent-review-v3-source-spans-grok-medium` retain their earlier source-span provenance. Historical `independent-review-v2` keeps exact-quote provenance. The second-review report uses schema **1.1.0**, policy `targeted-peer-review-v6-output-recovery` and prompt `targeted-peer-review-v7-bounded-evidence-correction-grok-medium`. Its twelve-slot native grammar is stable across assignment counts; all models use source spans and Grok retains medium effort. The historical v5 extended-recovery policy keeps its original deadlines and does not retry truncated replies. The historical v4 validation-correction policy keeps the v7 prompt under its original two-attempt bounds. Historical `targeted-peer-review-v6-stable-slots-grok-medium` retains the stable-slot prompt without local-validation correction; its `targeted-peer-review-v3-network-recovery` policy remains unchanged. Historical `targeted-peer-review-v5-source-spans-grok-medium` preserves the earlier count-dependent grammar provenance. Historical `targeted-peer-review-v4-slots` and `targeted-peer-review-v3-source-spans` keep Grok-only source-span provenance. Earlier prompts and historical policies retain their original evidence and retry semantics. The canonical report records exact model assignments, unassigned models, baseline fingerprint, assessment arrays, attempts, summaries and deferred claims. Historical **1.0.0** reports retain their all-reviewer semantics. Workspace downloads use `{schema_version: "1.2.0", kind: "dtcc-consolidated-review", final_report, first_round, second_round, interpretation}` with the static report when available. Before an eligible peer review completes, workspace exports retain the first-round council report; they are not labeled Final Report. A justified no-assignment final export has `second_round: null`. The derived `final_report` has schema **1.1.0** and aggregation policy `last-valid-opinion-v1`; the embedded first-round report retains its 2.1.0 schema. Both original and reconsidered records are preserved. Canonical second-round summaries and paired evaluation do not adopt the derived final view's retention policy. The report shows risk explanations and actions before detailed model history, with incomplete coverage and pending reassessments explicit.

## Evaluation needed

The browser evaluates the same five contracts sequentially: at most 45 provider calls per prompt variant for independent reviews, or 90 with the optional paired second reviews. The suite ceiling is the number of selected passes times the per-pass browser budget, plus 30 seconds. Cancellation prevents subsequent cases; completed records remain available. See [the five-case protocol](EVALUATION.md).

Mocked transport tests and deterministic examples verify the implementation's behavior. Real model quality requires reviewed data, benign controls, held-out contracts and comparisons against each individual model. Relevant measures include precision/recall, false-positive rate, missed vulnerabilities, disagreement, latency and cost. No reliability improvement is claimed before that evaluation.
