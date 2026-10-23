# Fixed five-contract reliability evaluation

The immediate evaluation keeps the existing five Solidity sources unchanged. Its first question is whether the platform completes bounded, inspectable reviews consistently. Detection quality is a separate question that requires human-reviewed labels.

## Fixed cases and interpretation

| Case | Focus | Interpretation constraint |
| --- | --- | --- |
| Vault withdrawal | State ordering, caller authorization and unchecked calls | Planted patterns in a teaching fixture; comments expose intended weaknesses |
| Caller-controlled callback | Trust boundaries across contracts | Attack-side code alone does not establish a vulnerable victim |
| Delegated execution | Execution authority and ownership mutation | Preserved source contains compiler-incompatible syntax; no successful compilation is implied |
| Block-data guessing game | Randomness assumptions and payouts | A conditional transfer candidate requires human review, not automatic true/false labeling |
| Two-player parity game | Public choices and predictable outcomes | Preserved missing pragma; no bytecode or execution test is implied |

`evaluations/cases.json` lists expected static-rule presence for historical regression. The five sources emit ten static candidates while nine reference expectations are covered. Neither 9/9 expectation coverage nor ten emitted findings is a precision/recall estimate. The API evaluation does not send these expectations or static outputs to models.

## Run from the website

1. Add a current authorized Bedrock key and verify a single short-contract analysis first.
2. Select **Standard** or **Guided examples**. Keep that selection fixed for the suite.
3. Open **Validate 5 cases**. Review the scope before starting: five analyses, one contract at a time, three model tasks per contract and at most 30 provider requests including retries.
4. Select **Run five-case validation**. The browser has a 20-minute suite ceiling and a 235-second per-case wait limit, outside the server's stricter 210-second request deadline. Inspect case completion and model outcomes; cancel when needed. Cancellation stops subsequent cases and retains already completed records. An authentication, permission or rate-limit failure can stop the suite early to avoid repeatedly submitting more contracts under the same failure condition.
5. Select **Download validation JSON**. It retains case/source identities, run settings, accepted model reports, failures and operational metrics. It contains no API key.
6. Start the other prompt variant separately only when ready to incur another bounded set of calls. A complete two-variant comparison can issue up to 60 provider requests.

Do not repeatedly rerun failed suites to select only favorable outputs. Record interruptions, failures and the reason for any manual rerun. An exported record is the evidence; the UI's key-ready indicator is not a successful model-access test.

## Measure execution before detection quality

| Measure | Definition / reading |
| --- | --- |
| Cases with results | Cases with at least one accepted model review out of five; partial cases count, while all-failed cases do not. This does not mean complete three-model coverage |
| Full / partial coverage | Cases with three accepted model reviews, or with one/two accepted reviews, respectively; record unstarted/cancelled cases separately |
| Model completion | Accepted model reviews out of the planned 15; also inspect completion among models actually started |
| Retry use | Count recorded attempts and extra attempts per model; requests without a validated returned report may have unreported attempts. A retry is not an additional independent vote |
| Failures | Keep sanitized reason codes, including access, throttling, timeout, format and evidence errors |
| Latency | Record per-case elapsed time and suite wall time; compare comparable successful/failed cases rather than discarding failures |
| Token usage | Sum only counters actually returned for accepted reviews; failed-attempt usage may be unknown |
| Disagreement | Record severity differences and incomplete support; lack of a finding is not an explicit rebuttal |
| Finding quality | Human review of the claim, source location, mechanism and recommendation; unavailable from completion or agreement alone |

Reported token totals are not a full invoice or a firm cost ceiling. Each attempt has a bounded output allowance, but failed or cancelled upstream work may still consume billable resources without returning usage. The application does not guarantee global AWS quotas or cancellation of accepted upstream requests.

## In-context learning comparison

The standard prompt is the baseline. Guided examples add two fixed synthetic examples: a fee-setting function missing authorization, with a qualified impact statement, and a Solidity 0.8 checked-arithmetic example with no supported overflow finding. Both variants use the same three models, source, output schema, deadlines, retry policy and output limit. This isolates the prompt-example change as far as the service permits.

Examples must remain separate from the five evaluation contracts and their reference expectations. Do not modify examples after reading a particular test result and then claim an unbiased comparison on that same result. The existing contracts are small, public teaching examples with informative comments; they cannot establish generalization to unseen smart contracts.

For a practical first comparison:

1. Run each variant once on all five cases and save both exports with commit, date, Region, prompt version and model IDs.
2. If access and budget permit, repeat each variant at least three times, alternating the order of variants. Keep failure records. Treat results as a small descriptive study, not a statistically established improvement.
3. Have team members review findings independently before comparing model agreement. Mark each distinct claim as supported, unsupported or unresolved, with a source location and explanation. Reconcile reviewer disagreements explicitly.
4. Compare completion, retries, timeouts, format/evidence rejections, claim stability, duplicate claims, severity differences and reviewed false positives. Report missing information rather than converting it to zero.
5. Report precision/recall only after the team has a sufficiently complete, agreed vulnerability inventory and documented root-cause/location matching. These five teaching fixtures alone do not support broad accuracy claims.

In-context learning changes the information presented in a prompt; it does not fine-tune weights. It can help task consistency, but can also bias outputs or correlate model errors. Its effect on this platform remains an empirical question.

## Team review record

Use [the blank review template](evaluation_review_template.csv); duplicate a case row for each distinct claim and leave judgments blank until review. For each issue, capture the case ID, source hash, prompt variant, run ID or exported timestamp, model(s), claim location, reviewer decision, rationale and unresolved question. Assign review responsibilities during the meeting instead of attributing work to a teammate who has not agreed to it.

Before expanding the dataset, agree on what counts as an actionable finding, how unavailable models affect comparisons, the permitted call budget and the evidence needed to call this five-case workflow stable. Additional datasets, compiler-backed checks and held-out evaluation should follow that agreement.

## References

- [AWS Converse API and error definitions](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html)
- [Language Models are Few-Shot Learners](https://arxiv.org/abs/2005.14165)
- [Fantastically Ordered Prompts and Where to Find Them](https://aclanthology.org/2022.acl-long.556/)
- [IBM: In-context learning](https://www.ibm.com/think/topics/in-context-learning)
