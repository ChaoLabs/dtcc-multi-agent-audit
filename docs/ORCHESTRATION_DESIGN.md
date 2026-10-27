# Orchestration design: independent review and bounded reconsideration

This design separates three things: independent model evidence, a controlled opportunity to reconsider disputed claims, and human judgment about whether a vulnerability exists. It uses GPT-6.1 Sol, Claude Opus 5.5 and Grok 4.7 through Amazon Bedrock. A deterministic TypeScript supervisor manages execution; there is no fourth adjudicating model or managed Bedrock Agents deployment.

The [three-page design brief](../apps/web/public/docs/DTCC_Orchestration_Design.pdf) is the shareable summary. The [technical method](ORCHESTRATION.md) and [evaluation protocol](EVALUATION.md) provide the detailed contracts.

## 1. First pass: preserve an independent baseline

All three models receive the same source snapshot, numbered lines, selected prompt variant and output schema. They do not receive static findings or peer answers. The server validates the report structure and exact cited source before accepting a review. The browser validates the resulting report again.

The supervisor groups compatible claims by weakness and source location. It retains every accepted original contribution and records one vote per distinct model. A failed reviewer is unavailable, not a negative vote. A successful reviewer that does not mention a claim has not explicitly rejected it. LOW, MEDIUM and HIGH agreement describe one, two and three model supporters; these labels are not probabilities of correctness.

Severity differences, non-reporting by successful reviewers and unavailable coverage enter a manual-review queue. The first-pass report and agreement remain unchanged after the second review.

## 2. Second pass: reconsider selected claims with peer context

The second pass is an explicit action after the first pass, through a separate `POST /api/reviews/second-round` request. It requires a validated first-pass report with at least two successful reviewers. Those successful reviewers reassess the same selected queue items; a first-pass failed model is not silently recovered or replaced.

| Decision | Design |
| --- | --- |
| Selection | First 12 queued claims in stable first-pass order: severity, source line, then finding ID |
| Remainder | Recorded as deferred for manual review, never silently discarded |
| Shared context | Original source and selected first-pass claims with their retained model contributions |
| Reviewer task | Reconsider each selected claim, including the reviewer's own claim; withdrawal is allowed |
| Required response | Candidate ID, supported / not supported / uncertain, rationale and exact source evidence |
| Severity | A proposed severity is required only for a supported claim; otherwise it is null |
| Evidence | Exact original excerpt at valid 1-based lines, at most 12 lines per assessment |
| Round limit | One reconsideration round; no automatic debate or self-improvement loop |

The peer context omits model names, vote counts and consensus labels. It distinguishes the reviewer's own prior claims from peer claims so a model can reconsider its own position without being told that a majority or a particular provider must be right.

The full first-pass snapshot is fingerprinted and validated so second-pass records cannot be accidentally attached to a different source or baseline. A fingerprint is content binding, not an AWS signature or proof that a client-supplied report came from a particular provider.

The second pass can correct an original author's interpretation or ask a reviewer to consider a peer's claim. It does not discover new findings outside the selected queue. A vulnerability missed by every first-pass model will not enter this stage. Claims outside the first 12 remain deferred; first-pass unanimous claims without queue reasons are not reconsidered automatically.

## 3. Summarize without manufacturing independence

Each model assessment remains visible. The application derives a separate peer-informed summary:

| Observed second-pass assessments | Summary |
| --- | --- |
| All three configured models support the claim and propose the same severity | Supported after peer review |
| All three explicitly do not support the claim | Not supported after peer review |
| Mixed decisions, uncertainty, a missing assessment/reviewer, deferred claim or severity difference | Unresolved |

Even when the two eligible reviewers agree, a missing third reviewer leaves the summary unresolved. “Not supported” does not certify a false positive, and “supported” does not prove exploitability. Since reviewers have seen peer claims, these assessments are correlated and are never added to first-pass independent votes.

A completed second-review execution means all assigned reviewers returned valid assessments. It does not mean all claims were resolved: two eligible reviewers can complete while every claim remains unresolved because the third reviewer is missing.

The before/after record preserves original agreement, original contributions, reconsidered decisions, reviewer failures, deferred items and change indicators. It supports a human comparison rather than overwriting the initial result with a more confident-looking score.

## 4. Bound latency, attempts and exposure

The existing retry policy applies to both passes. Each model has an absolute 180-second deadline and at most two attempts. Each server request has a 210-second deadline inside a 240-second Vercel function. A retry does not reset any deadline. The second pass is a separate request, so the two passes are never packed into one oversized serverless execution.

Only explicit HTTP 429, 500, 502, 503 and 504 responses are eligible for one retry. Backoff uses 500-1,000 ms jitter by default, with bounded Retry-After handling. Authentication, permission, malformed requests, invalid evidence, truncated/invalid output, network ambiguity and local timeouts are terminal. HTTP 408 and 424 are not part of this automatic-retry allowlist.

| User action | Maximum provider requests |
| --- | --- |
| First pass for one contract | 6 |
| Optional second pass | 6 additional |
| One contract, both passes | 12 |
| Five cases, first pass only | 30; 20-minute browser batch ceiling |
| Five cases, second review enabled | 60; 40-minute browser batch ceiling |

The five cases run sequentially; within a pass, eligible model tasks run in parallel. Each pass has a 235-second browser wait ceiling. Access or rate-limit failures stop later cases rather than repeatedly spending under the same condition. Cancellation prevents new work and preserves completed records, but cannot reverse processing or charges for requests AWS already accepted.

The visitor's key stays in tab memory and active request memory. Both passes use the current credential and fixed AWS routing. Per-instance concurrency guards are resource controls, not distributed user quotas or separate account budgets. Returned usage can omit failed or cancelled work; request limits are not a guaranteed dollar ceiling.

## 5. Evaluate the same five contracts as paired observations

Enable the second review for one five-case run to pair each original first-pass report with its own second-pass outcome. Do not generate a different first-pass sample and treat it as the same baseline. Keep all failed, skipped and deferred outcomes in the export.

Evaluate execution separately from findings. Record accepted reviews, retry attempts, timeouts, format/evidence failures, latency, returned tokens and unresolved claims. For quality, reviewers label distinct root-cause/location claims before consulting the peer-informed summary, then compare the same claims afterward. The review template includes separate first-pass and second-pass judgments, including unsupported and unresolved outcomes.

False-positive reduction requires human evidence that an initially reported claim is unsupported and that the later workflow handles it appropriately. Missed-issue analysis requires an independently reviewed vulnerability inventory. A model changing its mind, unanimous discussion or a smaller finding count does not establish either improvement. Reviewers must also track supported first-pass findings that the second pass wrongly rejects.

Keep the five preserved fixtures unchanged. Their informative comments, limited scope and teaching origins constrain generalization; the delegatecall source also contains compiler-incompatible syntax. Standard and guided prompt variants remain separate explicit experiments. When both passes are enabled for both variants, the combined maximum is 120 provider requests, subject to early stops and skipped reviews.

## Acceptance evidence

Automated tests establish bounded retries, cancellation, schema/evidence validation, baseline binding, reviewer eligibility, immutable first-pass agreement, deferred claims and report consistency using simulated responses. Live account availability and any change in vulnerability-detection quality require separate authorized runs and human-reviewed results. No measured accuracy or hallucination-reduction claim follows from the implementation alone.
