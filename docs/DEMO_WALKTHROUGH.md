# Platform and code walkthrough

For the supplied DAO contract, open **Reference cases → DAO Treasury**. Select **Run Bedrock Review** only after confirming AWS permissions and source-sharing approval. If no issues are reported, show the coverage and empty Final Report: there are no disagreements to send to a second round, and no claim of safety. To illustrate a disagreement instead, choose a teaching fixture. Keep the five original sources unchanged for evaluation. If presenting a saved or simulated result, identify it explicitly.

| Show | Explain | Code to open |
| --- | --- | --- |
| Add contract; Static Analysis → Run Static Analysis | A reproducible, on-device pattern baseline. It supplies candidate locations and does not vote in model agreement. | `apps/web/src/lib/static-analysis.ts` |
| Bedrock Review → Run Bedrock Review | Each model received the same source independently. Missing service coverage is shown separately from a successful review with no finding. | `apps/web/src/server/bedrock.ts` |
| First-round finding contributions | Compatible claims are grouped conservatively while the original model statements remain available. One distinct model contributes at most one vote. | `apps/web/src/lib/orchestration.ts` |
| Second-review plan | A reviewer receives peer findings it did not report. Severity-disputed claims are an explicit reassessment extension. An empty assignment causes no provider call. | `apps/web/src/lib/second-review.ts` |
| Second-round judgments | Show supported, not supported and uncertain decisions with their evidence. A missing judgment is never counted as a rejection. | `apps/web/src/server/second-review.ts` |
| Final Report → Unresolved or disputed | All original claims remain visible. Identify first-round discoverers, later judgments, unavailable coverage and unresolved severity. The first report is unchanged. | `apps/web/src/lib/final-report.ts` |
| Export | One report includes the final view and original records so another reviewer can reconstruct the decision. | `apps/web/src/lib/second-review-export.ts` |
| Review settings → Validate 5 cases | Run each source sequentially; pair each second round with its exact first-round baseline. Import reviewed labels to evaluate quality separately from agreement. | `apps/web/src/lib/evaluation.ts`; `evaluation-adjudication.ts` |
| Error handling | Retry only eligible explicit transient failures within the original time and attempt budget. Preserve completed peer results. | `apps/web/src/server/bedrock-transport.ts` |

## Simple browser sequence

1. Choose a reference case, select **Upload contract**, or paste source using **Edit source**. For the deterministic baseline, run **Static Analysis → Run Static Analysis**.
2. Choose **Bedrock Review**, connect an authorized key and select **Run Bedrock Review**. Wait for first-round **Findings**; show model coverage and independent contributions.
3. Open **Second Review**. Explain the assigned peer findings and severity disputes, then select **Run Second Review**. This is an explicit action, with up to nine additional provider calls.
4. After a validated second-round result, select **View Final Report**. The report opens directly. Start with the risk summary, risk explanation and recommended action. Expand model judgments only when discussing original discoverers, later decisions or pending reassessments. An unsuccessful reassessment retains valid earlier evidence without counting it as a new response. If no second review is eligible, show the stated reason. A cancelled request or request error preserves initial findings but does not count as a second-round result.
5. Download JSON or Markdown. Use **Review settings** only when demonstrating prompt comparisons or the five-case evaluation.

If a model is blocked by a content filter, say: “This provider stopped its response. The other reviews remain available, and this model is shown as missing coverage. The application does not retry or rewrite the input to bypass that decision.” Two completed assigned second-round reviews still do not make it a three-model result.

## Business explanation

Smart contracts can control transfers, permissions and state transitions in digital asset workflows. A defect may affect custody, transaction integrity or availability. The platform makes candidate risks easier to investigate by bringing the source, model opinions and disagreement history into one review record.

Its value is traceability and review prioritization: a reviewer can see where an issue was found, which models contributed, what changed after peer evidence and what remains unresolved. This supports an existing security review process; it does not replace security ownership or certify a contract.

Demonstrate one concrete sequence: a first-round claim reported by one model, the omitted-claim assignment to a peer, that peer's evidence-backed judgment and the resulting final row. If the peer remains uncertain, retain that outcome rather than presenting a forced consensus.

## Explain evaluation accurately

“Model agreement describes what the models said. Accuracy requires reviewed labels. We compare the same first-round baseline with its own second-round result, keep coverage gaps visible and use a source-bound issue inventory when measuring missed issues.”

Do not claim a percentage improvement, a time saving or a reduction in false negatives until the corresponding reviewed results exist. The five teaching contracts are useful for controlled workflow experiments and are not a broad held-out benchmark.
