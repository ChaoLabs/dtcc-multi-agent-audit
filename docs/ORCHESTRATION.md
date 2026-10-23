# Model orchestration and consensus

## Execution design

A run dispatches GPT-6.1 Sol, Claude Opus 5.5 and Grok 4.7 concurrently through Bedrock Converse. Each receives the same source snapshot, numbered lines, review task, complete format contract and provider-native JSON Schema constraint. GPT also receives its required strict-format flag. No model sees static findings or another model's answer.

The application orchestrator is a deterministic TypeScript supervisor. It manages bounded model attempts, deadlines and failure outcomes, validates model outputs, consolidates compatible findings, calculates distinct-model support and produces a traceable report. It does not invoke a fourth LLM or deploy Amazon Bedrock managed Agents. This implementation gives the platform a reproducible baseline for evaluating orchestration strategies.

## Validation before consolidation

Every successful review is bound to the source SHA-256 and model identity. The response must satisfy the expected schema and bounds, including allowed severities, finding counts, line spans and exact excerpts. Truncated, malformed or source-inconsistent output fails that model review. Only accepted original findings enter consolidation; raw AWS response bodies are not treated as evidence or placed in exports.

The server, rather than a model, assigns the evidence's `source-bound` validation annotation after exact-source checks. It ignores only legacy model-supplied validation metadata; the source evidence and substantive finding fields must still pass every check. A model cannot declare its own evidence verified. The source-evidence contract remains unchanged; execution provenance is separate from the model-authored review.

These checks establish report integrity and source grounding. They do not determine whether a claim is a real vulnerability.

## Finding identity and grouping

The orchestrator uses a canonical weakness category together with source evidence location. It normalizes known category aliases and refines broad `access-control` or `other` labels only when the title explicitly identifies a recognized weakness. Different canonical categories remain separate.

Before locating operations, it masks comments and strings while preserving offsets. It then applies these matching rules:

1. For supported weakness categories, a cited span containing exactly one recognized operation is anchored to that operation's source offset. Two findings can merge when they identify the same operation and weakness despite different titles or excerpt windows.
2. An explicitly missing caller restriction can be anchored to a containing function, constructor, fallback, receive function or modifier. This is limited to missing-restriction claims; different authorization bugs in one function are not automatically equivalent.
3. Ambiguous windows, unsupported syntax and other cases use exact line span plus normalized title. The algorithm does not guess which operation a multi-operation excerpt refers to.

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
| Attempts | At most two per model, including the initial request |
| Retry eligibility | Explicit HTTP 429, 500, 502, 503 or 504 only |
| Terminal failures | Authentication/permission, invalid model request, invalid output/evidence, network ambiguity or local timeout |
| Backoff | 500-1,000 ms jitter by default; honor a longer Retry-After only up to 5 seconds and when at least 1 second remains for an attempt |
| Absolute deadlines | 180 seconds per model; 210 seconds for the server request; retries do not reset either clock |
| Provider requests | At most six per analysis; a completed review is not rerun |
| Output bound | 8,192 tokens and 256,000 response bytes per attempt |
| Cancellation | Stop waiting and prevent further attempts/cases; preserve completed case records |

The supervisor records each attempt's outcome, elapsed time, sanitized error code and scheduled preceding retry delay. Model-run elapsed time includes actual waiting; the delay field records the planned backoff. Invalid output is not repaired or retried until it happens to pass. An exhausted budget becomes an explicit model failure; accepted peer reviews remain inspectable. Browser cancellation, changing source or replacing a key prevents late responses from overwriting newer state. Work already accepted by AWS may still be billed.

Rate guards are local to a server instance: one active analysis per key hash, six analysis starts per minute per key hash and four active analyses overall. These are not distributed account quotas. Retries occur inside the acquired analysis slot and do not create additional parallel model tasks.

## In-context prompt variants

Standard instructions provide the baseline. Guided examples add small, fixed synthetic examples showing evidence format and the distinction between a suspicious operation and a supported vulnerability claim. Examples are separate from the five reference fixtures. They are not model training, do not change model weights and are not evidence for the submitted contract.

A run uses one variant consistently across all three models. Neither variant supplies static findings, expected fixture labels or peer answers. Prompt variant/version and execution policy are part of the report so an exported result can be attributed to the actual experiment. A separate invocation is required to compare variants. No quality improvement is claimed before a reviewed evaluation.

## Reports and reproducibility

New version **2.1.0** multi-model responses/exports preserve execution-policy and prompt provenance, per-attempt outcomes, and the source identity, model identities, original accepted reviews, failure states, timestamps, elapsed times, available token usage, consolidated findings and group membership. JSON supports downstream inspection; Markdown provides a readable record. Static results remain separately attributed and retain their original schema.

Consensus IDs bind the source hash, consolidation-algorithm revision, canonical category and grouping location. The grouping algorithm remains at revision 2.0.0; the 2.1.0 envelope adds execution provenance without changing finding identities. Findings are sorted by descending severity, source line and stable ID. The browser recomputes the consolidation from the source-bound original reviews and rejects inconsistent group membership, agreement or provenance.

Agreement counts can be reproduced from the accepted member findings without another paid model call. Exporting the report does not expose the API key. The original independent reviews remain available to audit the consolidation decision and compare it with alternative algorithms. The API returns the council object; JSON downloads wrap it with the static report and a matching export schema version. Historical **2.0.0** reports remain supported without inventing missing attempt history.

## Evaluation needed

The browser can run the existing five contracts sequentially for one prompt variant and export the full outcomes. Each suite is limited to five analyses and at most 30 provider requests. Cancellation prevents subsequent cases; completed records remain available. See [the fixed five-case protocol](EVALUATION.md).

Mocked transport tests and deterministic examples verify the implementation's behavior. Real model quality requires reviewed data, benign controls, held-out contracts and comparisons against each individual model. Relevant measures include precision/recall, false-positive rate, missed vulnerabilities, disagreement, latency and cost. No reliability improvement is claimed before that evaluation.
