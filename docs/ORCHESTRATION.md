# Model orchestration and consensus

## Execution design

A run dispatches GPT-6.1 Sol, Claude Opus 5.5 and Grok 4.7 concurrently through Bedrock Converse. Each receives the same source snapshot, numbered lines, review task, complete format contract and provider-native JSON Schema constraint. GPT also receives its required strict-format flag. No model sees static findings or another model's answer.

The application orchestrator is deterministic TypeScript code. It validates model outputs, consolidates compatible findings, calculates distinct-model support and produces a traceable report. It does not invoke a fourth LLM or deploy Amazon Bedrock managed Agents. This implementation gives the platform a reproducible baseline for evaluating orchestration strategies.

## Validation before consolidation

Every successful review is bound to the source SHA-256 and model identity. The response must satisfy the expected schema and bounds, including allowed severities, finding counts, line spans and exact excerpts. Truncated, malformed or source-inconsistent output fails that model review. Only accepted original findings enter consolidation; raw AWS response bodies are not treated as evidence or placed in exports.

The server, rather than a model, assigns the evidence's `source-bound` validation annotation after exact-source checks. It ignores only legacy model-supplied validation metadata; the source evidence and substantive finding fields must still pass every check. A model cannot declare its own evidence verified. The resulting public report schema is unchanged.

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

Absence of a finding in a successful review is not an explicit rejection. A failed model contributes no vote, and its failure is not counted as evidence for or against a vulnerability. Static findings do not vote.

## Complete, partial and failed runs

| Model outcomes | Run interpretation |
| --- | --- |
| Three successful reviews | Complete model coverage for the supplied source and bounded requests |
| One or two successful reviews | Partial coverage; retain accepted reviews and show each failure |
| No successful reviews | Failed run; no accepted model assessment |

A successful empty finding list does not establish safety. A consensus group with three supporters remains a candidate for human review. The platform does not execute exploits, compile imports or certify repairs.

There are no automatic paid retries or silent replacement models. Each model has a 180-second deadline within a 210-second server request deadline. Cancellation or source changes prevent old results from overwriting newer state. Work already accepted by AWS may still be billed.

## Reports and reproducibility

The version **2.0.0** multi-model response/export preserves the source identity, model identities, original accepted reviews, failure states, timestamps, elapsed times, available token usage, consolidated findings and group membership. JSON supports downstream inspection; Markdown provides a readable record. Static results remain separately attributed and retain their original schema.

Consensus IDs bind the source hash, orchestrator version, canonical category and grouping location. Findings are sorted by descending severity, source line and stable ID. The browser recomputes the consolidation from the source-bound original reviews and rejects inconsistent group membership, agreement or provenance.

Agreement counts can be reproduced from the accepted member findings without another paid model call. Exporting the report does not expose the API key. The original independent reviews remain available to audit the consolidation decision and compare it with alternative algorithms. The API returns the council object; JSON downloads wrap it as `{schema_version: "2.0.0", static_report, council}`.

## Evaluation needed

Mocked transport tests and deterministic examples verify the implementation's behavior. Real model quality requires reviewed data, benign controls, held-out contracts and comparisons against each individual model. Relevant measures include precision/recall, false-positive rate, missed vulnerabilities, disagreement, latency and cost. No reliability improvement is claimed before that evaluation.
