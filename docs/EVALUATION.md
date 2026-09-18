# Reliability evaluation plan

M0 establishes a reproducible baseline. It does not establish improved detection accuracy.

`evaluations/cases.json` lists expected rule presence for historical regression. The five sources emit ten candidates while nine reference expectations are covered. The extra guessing-game transfer candidate requires review; do not automatically label it true or false. Neither 9/9 coverage nor 10 emitted findings is a precision/recall estimate.

## Later experimental design

1. Review rights, sources, compiler settings, vulnerable/fixed variants and benign lookalikes. Preserve original/fixed relationships.
2. Define root-cause and location matching, severity guidance, annotation uncertainty and reviewer adjudication. Have a second reviewer resolve disputed labels where feasible.
3. Split by source/project family. Keep held-out labels out of prompts and tuning. Account for potentially memorized public examples.
4. Compare static rules and Slither; each comparable single-model run; three-model aggregation; and orchestration with evidence checks. Separate model diversity from role/prompt effects. Include a compute-budget-matched single-model comparison where feasible.
5. Record precision/recall/F1 only where labels support them; false positives per contract, misses, duplicate/citation errors, unresolved claims, completion rate, latency, token usage and measured/dated cost assumptions. Define denominators and failed-run handling.
6. Report repeated-run variability, sample size, uncertainty and limitations. Agreement is not truth; source binding is not semantic validation.

Until that study is performed, suitable resume language is “built a source-bound auditing workbench and evaluation foundation,” not “reduced hallucinations by X%” or “production-grade multi-agent auditor.”
