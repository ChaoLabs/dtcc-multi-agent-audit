# Orchestration design: independent review and targeted reconsideration

The platform separates independent model evidence, peer-informed reconsideration and human validation. GPT-6.1 Sol, Claude Opus 5.5 and Grok 4.7 provide the model judgments through Amazon Bedrock. A deterministic TypeScript supervisor selects work, enforces budgets, validates evidence and consolidates reports. It uses the existing reviewers as bounded LLM tools; it adds no fourth provider or managed Bedrock Agents deployment.

The [three-page design brief](../apps/web/public/docs/DTCC_Orchestration_Design.pdf) is the shareable summary. The [requirements map](MUXIANG_REQUIREMENTS.md) relates the implementation to Muxiang's slides and the JEV reading. [Technical method](ORCHESTRATION.md) and [evaluation protocol](EVALUATION.md) define the detailed contracts.

The browser presents **Bedrock Review → Findings → Second Review → Final Report**. **Run Bedrock Review** runs only the independent stage. After inspecting its findings, the user explicitly selects **Run Second Review** for eligible differences. The final report follows a validated second-round result, including a partial result, or a stated reason when no second review is eligible. The two stages retain separate requests, budgets and records.

## 1. Preserve the independent baseline

All three models receive the same source snapshot, numbered lines, prompt variant and output contract. They receive no static findings or peer reports. Accepted reviews must satisfy the schema and cite exact source text. The supervisor retains the originals, conservatively groups compatible weakness/location claims and counts each distinct model once.

A successful model that omits a claim has not rejected it. A failed model contributes unavailable coverage. LOW, MEDIUM and HIGH agreement describe one, two and three model supporters; they are not probabilities of correctness. The independent report and its agreement remain unchanged after reconsideration.

## 2. Route peer omissions to the relevant reviewer

The second pass uses `POST /api/reviews/second-round` only after the user selects **Run Second Review**. It requires a validated first-pass baseline with at least two successful models. The supervisor selects up to twelve queue items in stable order and records the remainder as deferred.

| Decision | Contract |
| --- | --- |
| Primary assignment | Give a successful model the source and selected peer findings it did not report |
| Severity extension | Assign severity-disputed claims to successful reviewers, including original discoverers |
| Empty assignment | No provider call; the model is recorded as unassigned |
| Failed first-pass model | Remains unavailable; this stage does not silently recover or replace it |
| Typed response | Twelve stable required slots: assigned slots hold supported / not supported / uncertain judgments; unused slots are null |
| Severity | Required for support; null for rejection or uncertainty |
| Evidence | All models select valid source lines; the server retrieves exact original text, at most twelve lines per assessment |
| Round limit | One reconsideration round; no automatic third round or debate loop |

Peer context withholds model names, vote counts and consensus labels. It distinguishes a reviewer's own original contributions from peer claims, without instructing it to agree with a majority. Both source and peer text are untrusted data. The provider returns all twelve named slots using a stable shared schema. Assigned slots must contain judgments and unused slots must be null. After full validation, the server binds only the assigned slots to trusted original claim IDs and emits the unchanged canonical assessment array. Missing or extra slots, null assigned answers and populated unused slots fail validation; no decision is invented. A stable grammar avoids assignment-count-dependent schema compilation; it does not guarantee provider latency.

A full-baseline SHA-256 binds each second-round report to the precise first-round record, in addition to the source hash. Export validation checks the same binding. This prevents accidental mixing of runs; it is not a provider signature or proof of authenticity.

## 3. Produce one final report without erasing the path

Every first-round finding appears in the final ledger, including unanimous findings, selected claims, deferred work and claims not reviewed in round two. Per-model rows show original discovery, later decision, opinion source and source evidence.

The derived final report follows the last valid recorded opinion. An accepted second-round judgment, including uncertainty or rejection, becomes that model's position. If an assigned review fails, a valid original discovery and its severity are retained as first-round evidence, with reassessment explicitly pending. If the model never reported the claim and supplies no new judgment, its position remains unknown. Retained first-round support is never presented as a second-round confirmation.

| Current model positions | Final disposition |
| --- | --- |
| All three support | Supported; severity agreement is a separate field |
| All three explicitly do not support | Not supported |
| Missing, mixed or uncertain positions, or deferred work | Unresolved |

A supported finding may still have disputed severity or a pending reassessment; both remain in the further-review queue. The report leads with risk priority, the model-grounded explanation and recommended action. Technical evidence and per-model history remain expandable. Incomplete execution in either round is shown as partial coverage, even when the first round completed. No model disposition proves exploitability, certifies a false positive or establishes contract safety. Since second-round reviewers have seen peers' evidence, their opinions are correlated and never increase the first-round independent vote count.

The JSON/Markdown report includes the versioned final view (schema 1.1.0, `last-valid-opinion-v1`) and the retained original records. Raw second-round summaries and paired quality metrics are unchanged; retained evidence is not treated as a fresh second-round outcome. The controller's memory is the immutable run data and bounded tab history, not durable cross-user agent memory.

## 4. Bound execution and preserve recoverable work

Each model receives at most three attempts within one absolute 270-second deadline. Each pass has a 285-second server deadline, a 295-second browser wait and a 300-second Vercel function duration. The two passes use separate requests. HTTP 429, 500, 502, 503 and 504, a Bedrock HTTP 408 model-timeout response, or allowlisted temporary connection errors can use a remaining attempt. Both rounds may also regenerate a complete response after local format or evidence rejection. These paths share the same three-attempt total; a successful model is not rerun. Correction adds only application-authored constraints; the source, assignments, model and native schema remain unchanged. Rejected text is never echoed, and the replacement must pass every check. Provider Retry-After waits fit the remaining deadline; no attempt resets a clock. Authentication, permission, filtering, guardrails, provider JSON parsing, credential echo, unknown/permanent transport errors and local abort/timeout remain terminal. Filtering is not bypassed by rewriting input. Historical reports retain their original execution policies, and no result is relabeled as successful without an accepted response.

| Action | Maximum provider requests |
| --- | --- |
| First pass for one contract | 9 |
| Targeted second pass | Up to 9 additional; empty assignments make no call |
| One contract with both passes | 18 |
| Five cases, first pass only | 45; 25-minute 5-second browser batch ceiling |
| Five cases, paired review | 90; 49-minute 40-second browser batch ceiling |

All models use source-span citations in both rounds. Grok receives explicit medium reasoning effort; the same limits apply, and no measured latency or accuracy improvement is asserted.

The five cases run sequentially; assigned model tasks within one pass run in parallel. Follow-up completion counts assigned tasks, separately from all-three-model coverage. Two assigned follow-ups can finish while one independent model is still unavailable. A completed follow-up does not mean all claims were resolved. Partial execution retains successful peers. An unavailable model or an unknown result is not a rejection.

The key remains in tab and active request memory. Fixed AWS routing and per-runtime concurrency controls limit exposure. These controls are not distributed account quotas or a guaranteed dollar cap. Cancellation prevents new work but cannot reverse work already accepted by AWS; returned usage can omit failed or cancelled attempts.

## 5. Evaluate exactly paired observations

Keep the five existing contracts unchanged. Pair each first-round result with its own second-round result, including source and full-baseline fingerprints. A new first-round sample is a new experiment, not the same before snapshot.

Record execution completion, attempt counts, timeouts, validation failures, latency and returned usage separately from claim quality. Human review identifies distinct root-cause/location claims and labels them confirmed, refuted, uncertain or unreviewed with supporting rationale. An explicit reference issue inventory is required to assess missed issues, including vulnerabilities no model reported.

The platform can import/export these adjudications and compute eligible paired counts. Missing labels do not become zeros or model-generated ground truth. Precision and F1 require reviewed predictions; recall and false-negative counts additionally require a complete reviewed issue inventory. Coverage remains visible when reviewers or cases are excluded from a comparable pair.

A reduction in unresolved claims or an increase in agreement is an observable workflow result, not proof of higher accuracy. Track new false positives, lost true findings and unchanged uncertainty alongside any improvements. The second round cannot discover a vulnerability absent from all first-round candidates.

## Acceptance evidence and reuse

Automated tests verify schema/evidence binding, targeted assignments, empty-call avoidance, preserved originals, bounded retry and final-report consistency using simulated responses. Actual account availability and measured detection improvement require fresh authorized model calls and completed human labels. The five teaching fixtures, including informative comments and preserved source limitations, are not a held-out benchmark.

The JEV reading informs typed decisions and explicit uncertainty. Its vendor claims do not establish calibrated confidence or hallucination-free judgments for this platform. Reuse in another domain requires a new evidence contract and reviewed evaluation set; the architecture-review slide does not imply an implemented cloud-diagram audit tool.
