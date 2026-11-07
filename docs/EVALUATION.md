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
2. Open **Review settings** and select **Standard** or **Guided examples**. Keep that selection fixed for the suite.
3. Open **Validate 5 cases** under **Review settings**. This is a separate explicit batch, independent of the workspace's manually initiated second round. Leave **Include second review** off for first-pass-only evaluation, or enable it to pair each first-pass result with a bounded reconsideration. The five contracts run sequentially. First-pass-only mode allows at most 45 provider requests; paired mode allows at most 90, including retries.
4. Select **Run five-case validation**. The browser has a 25-minute 5-second ceiling for first-pass-only mode and 49 minutes 40 seconds when second review is enabled. Each pass has a 295-second browser wait ceiling outside the server's stricter 285-second request deadline. Inspect case completion and model outcomes; cancel when needed. Cancellation stops subsequent cases and retains already completed records. An authentication, permission or rate-limit failure can stop the suite early to avoid repeatedly submitting more contracts under the same failure condition.
5. Select **Download validation JSON**. It retains case/source identities, run settings, accepted model reports, failures and operational metrics. Paired mode also retains the exact first-pass baseline, second-pass outcomes and before/after summaries, including skipped or deferred work. It contains no API key.
6. Start the other prompt variant separately only when ready to incur another bounded set of calls. Comparing both prompt variants can issue at most 90 provider requests in first-pass-only mode, or 180 with second review enabled for both. These are separate explicit batches.

Do not repeatedly rerun failed suites to select only favorable outputs. Record interruptions, failures and the reason for any manual rerun. An exported record is the evidence; the UI's key-ready indicator is not a successful model-access test.

A batch status of `completed` means that the case loop finished, not that all fifteen independent model reviews succeeded. Second-round completion uses only the assignments actually planned for that baseline; it does not recover a failed first-round model. Two completed follow-up assignments can coexist with two-of-three overall independent coverage. A content-filter or guardrail stop is terminal, not an automatic-retry candidate or a successful empty review. Read completion counts together with coverage and failure details. Unresolved findings include missing model coverage as well as differing judgments.

## Measure execution before detection quality

| Measure | Definition / reading |
| --- | --- |
| Cases with results | Cases with at least one accepted model review out of five; partial cases count, while all-failed cases do not. This does not mean complete three-model coverage |
| Full / partial coverage | Cases with three accepted model reviews, or with one/two accepted reviews, respectively; record unstarted/cancelled cases separately |
| Model completion | Accepted model reviews out of the planned 15; also inspect completion among models actually started |
| Retry use | Count recorded attempts and extra attempts per model; requests without a validated returned report may have unreported attempts. A retry is not an additional independent vote |
| Failures | Keep sanitized reason codes, including access, throttling, timeout, content filtering, guardrail intervention, format and evidence errors |
| Latency | Record per-case elapsed time and suite wall time; compare comparable successful/failed cases rather than discarding failures |
| Token usage | Sum only counters actually returned for accepted reviews; failed-attempt usage may be unknown |
| Disagreement | Record severity differences and incomplete support; lack of a finding is not an explicit rebuttal |
| Finding quality | Human review of the claim, source location, mechanism and recommendation; unavailable from completion or agreement alone |

Reported token totals are not a full invoice or a firm cost ceiling. Each attempt has a bounded output allowance, but failed or cancelled upstream work may still consume billable resources without returning usage. The application does not guarantee global AWS quotas or cancellation of accepted upstream requests.

## Paired second-review comparison

Use the same first-pass report as the before snapshot and as the input to its second review. Re-running the first pass creates a different stochastic sample and is not a paired before/after observation. Preserve the exported baseline fingerprint, source hash, prompt settings and all reviewer outcomes.

The second review requires at least two successful first-pass reviewers and selects at most twelve actionable queued claims. Each reviewer receives omitted peer findings plus severity-disputed claims; empty assignments cause no call. Failed first-pass models remain unavailable. Remaining claims are deferred, including claims with only unavailable coverage and no eligible peer assignment. Deferred does not necessarily mean a selection limit was reached. A case with no eligible assignments is skipped without a model call; skipped work is not a failed invocation or an improvement.

| Comparison | Record | What it does not establish |
| --- | --- | --- |
| Coverage | Eligible reviewers, selected/deferred claims, completed second-pass assessments | General vulnerability coverage |
| Change of position | Original support, explicit support/rejection/uncertainty, author withdrawal | That the changed position is correct |
| Disagreement | Mixed decisions, severity differences, unavailable reviewers and unresolved claims | Calibrated confidence |
| Execution | Added attempts, latency and returned usage for the second pass | Complete billing for failed/cancelled requests |
| Human quality | Before/after judgments on the same root-cause/location claim | Accuracy without reviewed labels and matching rules |

The derived Final Report uses the last accepted position from each model, with its round of origin labeled. Accepted second-round judgments supersede prior positions. When a reassessment fails, a valid original finding and its severity remain recorded, with pending reassessment and retained provenance explicit. Three recorded supporters can therefore coexist with an incomplete reassessment; pending work still requires review. Severity alignment and explicit rejection remain separate. This final display policy does not alter canonical second-round summaries or the eligible paired cohort below. Retained first-round opinions are not counted as successful second-round responses or accuracy gains.

### Human-reviewed accuracy

The **Human-reviewed accuracy** section supports an explicit reviewed dataset rather than deriving correctness from model agreement.

1. Select **Download review template** for the selected run. It creates a JSON file with all accepted baseline findings marked `unreviewed`, empty reference inventories and `inventory_complete: false`.
2. Supply the human reviewer name. For each distinct root-cause/location issue, record a reference ID, title, category, source lines and rationale in `reference_issues`. Include independently identified issues absent from every model report.
3. Label each reported finding `confirmed`, `refuted`, `uncertain` or `unreviewed`. Reviewed labels require rationale; confirmed claims must reference a known issue ID. Do not use model agreement as the label.
4. Mark an inventory complete only after reviewing the entire supplied source and recording why the inventory is sufficient. Leaving it incomplete is valid and keeps recall unavailable.
5. Choose **Import human review**. Source SHA-256, exact first-round baseline SHA-256, IDs, source bounds, label shape and duplicate records are checked. Files are limited to 1 MB. A review for another run or modified source is rejected.
6. Select **Export reviewed comparison** to retain the raw run, labels and derived metrics in `dtcc-adjudicated-comparison.json`. Exporting creates no provider call and includes no API key.

| Metric | Definition and eligibility |
| --- | --- |
| True positives | Supported predictions matched to human-confirmed reference issues, deduplicated by issue per model |
| False positives | Supported predictions explicitly refuted by human review |
| Precision | TP / (TP + FP); unavailable while any positive prediction is uncertain or unreviewed, or the denominator is empty |
| False negatives | Reviewed reference issues without a supported matched prediction; unavailable unless the inventory is explicitly complete |
| Recall | TP / (TP + FN); requires complete inventory and reviewed prediction conditions; unavailable with no reference issues |
| F1 | Harmonic mean of eligible precision and recall; unavailable when either prerequisite is missing |
| Coverage | Shows which cases and models contribute to a comparable pair; excluded or missing work is not evidence of correctness |

Counts are micro-averaged over model/issue predictions, not over consensus groups. First- and second-round metrics use the same eligible model cohort. A failed second-round reviewer is excluded from both sides of the paired comparison, with the coverage loss disclosed. Valid assigned judgments replace that reviewer's original support; unassigned claims retain their original position. `uncertain` is not a positive prediction and is not a human refutation. Second-round abstentions are counted separately from explicit rejections: a fall in false-positive predictions caused by abstention is not evidence that those claims were disproved. Duplicate confirmed findings that refer to the same issue count once per model.

These metrics evaluate the supplied human judgments and chosen matching inventory. They do not verify the human labels themselves. A small set of teaching contracts cannot establish general accuracy. Report counts and exclusions alongside ratios, and retain disagreement about labels as uncertainty.

The older [CSV worksheet](evaluation_review_template.csv) remains an optional manual note-taking format. The website imports the structured JSON template, not that CSV.

### Saved runs and reproducibility

**Recent runs in this tab** retains the latest ten run records, including partial and cancelled runs. It is in memory only; refresh removes the history. Export records before closing the page. **Import saved run** accepts a bounded JSON export of at most 5 MB, validates it against the five fixed source snapshots, checks source/baseline binding and recomputes derived metrics. Importing and comparing a saved run do not call AWS. It does not import a key or turn an unsigned file into proof of provider authenticity.

Keep failure records rather than selecting only favorable runs. A different source hash, prompt variant or first-round baseline describes a different experiment. The second round cannot discover an issue that all first-round models missed; an independent reference inventory is necessary to observe that gap.

## In-context learning comparison

The standard prompt is the baseline. Guided examples add two fixed synthetic examples: a fee-setting function missing authorization, with a qualified impact statement, and a Solidity 0.8 checked-arithmetic example with no supported overflow finding. Both variants use the same three models, source, first-pass output schema, deadlines, retry policy and output limit. Keep the second-review setting the same across variants when comparing them; the second stage uses its own shared peer-informed prompt. This isolates the prompt-example change as far as the service permits.

Examples must remain separate from the five evaluation contracts and their reference expectations. Do not modify examples after reading a particular test result and then claim an unbiased comparison on that same result. The existing contracts are small, public teaching examples with informative comments; they cannot establish generalization to unseen smart contracts.

For a practical first comparison:

1. Run each variant once on all five cases and save both exports with commit, date, Region, prompt version and model IDs.
2. If access and budget permit, repeat each variant at least three times, alternating the order of variants. Keep failure records. Treat results as a small descriptive study, not a statistically established improvement.
3. Review findings against the source before comparing model agreement. Mark each distinct claim as supported, unsupported or unresolved, with a source location and explanation. Reconcile reviewer disagreements explicitly.
4. Compare completion, retries, timeouts, format/evidence rejections, claim stability, duplicate claims, severity differences and reviewed false positives. Report missing information rather than converting it to zero.
5. Report precision/recall only after the required human labels, complete issue inventory and documented root-cause/location matching are available. These five teaching fixtures alone do not support broad accuracy claims.

In-context learning changes the information presented in a prompt; it does not fine-tune weights. It can help task consistency, but can also bias outputs or correlate model errors. Its effect on this platform remains an empirical question.

## Review record and acceptance

Record the source hash, prompt version, execution policy, exact baseline, human reviewer, issue identity, label rationale and unresolved questions. Keep runs using the bounded second-review correction policy distinguishable from older runs: an extra valid generation may change execution coverage, but does not establish better accuracy. Preserve evidence for false positives correctly challenged, false positives retained, true findings retained and true findings lost. Keep unknown labels visible rather than treating them as negatives.

Before expanding the dataset, verify that the five-case workflow preserves original reports, produces correct assignments and final rows, respects resource limits and retains failures. Then use repeated authorized runs and reviewed labels to assess stability. Larger datasets, compiler-backed checks and held-out evaluation remain separate extensions.

## References

- [AWS Converse API and error definitions](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html)
- [Language Models are Few-Shot Learners](https://arxiv.org/abs/2005.14165)
- [Fantastically Ordered Prompts and Where to Find Them](https://aclanthology.org/2022.acl-long.556/)
- [IBM: In-context learning](https://www.ibm.com/think/topics/in-context-learning)
