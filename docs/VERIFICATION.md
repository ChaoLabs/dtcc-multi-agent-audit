# Verification records

These are release-specific verification records; counts, model names and limits refer to the release being described. For current limits see [Bedrock Review](BEDROCK.md#models-and-routing).

## Final report ordering and severity details

The final report sorts its derived findings by the latest proposed severity (high,
medium, low, then unrated), preserving stable ordering within each level. The two
original round records, finding identifiers and judgments are unchanged. The
collapsed model table and consolidated Markdown table display each model's latest
valid severity, including conflicting retained original ratings. The static
appendix now clarifies that its isolated execution statuses do not describe the
Bedrock reviews above.

- The full offline check passed: **118 Python tests and 563 TypeScript/controller/
  React SSR tests**, Ruff, ESLint, TypeScript, formatting, generated-source parity
  and the Next.js production build.
- After aligning the Markdown severity column, all **162 affected report,
  orchestration and second-review tests** passed again, together with ESLint,
  TypeScript, formatting and a fresh production build.
- The new regressions cover reordered severities, stable ties, preservation of
  both original records, conflicting retained ratings, accepted reassessment
  supersession and absent ratings. Existing bounded execution controls are
  unchanged. No new live AWS calls or browser interaction tests were performed.

## Extended execution and first-round recovery

The current execution policy allows **three attempts per model, 270 seconds per model, 285 seconds per round and nine provider requests per round**. Browser waits are 295 seconds and review functions allow 300 seconds. Both rounds share their finite attempt budget between eligible service/network recovery, an upstream Bedrock HTTP 408 model timeout and safe local-validation correction. The first-round prompt and both execution policies are versioned; historical records retain their original limits and retry semantics. Successful models are not rerun, and no attempt resets a deadline. Source/assignment binding, strict evidence validation, the manual three-stage workflow and last-valid-opinion aggregation remain unchanged.

The latest screenshot establishes incomplete first-round coverage but does not expose the failed model's underlying error. It cannot establish whether the cause was a timeout, provider rejection or invalid response.

- **118 Python tests and 561 TypeScript/controller/React SSR tests passed.** Provider responses are simulated. Coverage includes third-attempt service and validation recovery, successful-model retention, bounded remote HTTP 408 recovery, cancellation, immutable source and schema, historical policy limits, and rejection of impossible late-success records under the new policy.
- Browser deadline tests use controlled timers to verify that a valid response can survive the former cutoff, stalled requests still stop without outer retries, and both five-case validation modes reserve enough time for every round.
- Ruff, ESLint, TypeScript, formatting, generated-source checks and the Next.js production build passed. The two existing Python dependency deprecation warnings remain.
- The eight-page platform overview and three-page orchestration design were rebuilt deterministically without visible dates. All eleven pages were rendered; four changed pages were visually checked and the other seven were pixel-identical to the previously verified versions.
- **No live AWS request, GitHub change, deployment or browser-interaction run was performed.** These checks verify the exercised recovery behavior and do not guarantee model availability or successful correction of every response.

Run `bash scripts/check.sh` to reproduce the code checks. The delivery bundle is an incremental patch against the installed Second Review Recovery baseline.

The records below describe earlier patches under their then-current limits. They do not describe the new execution policy.

## Bounded correction of second-review format and evidence failures

The supplied consolidated Markdown report records Claude's successful first round and a second-round `invalid_evidence` failure after **18,085 ms**: its citation did not satisfy the integer, ordered, in-source, at-most-twelve-line constraint. That diagnostic does not preserve the actual rejected numbers, so it cannot distinguish which range condition failed. It is a local response-validation failure, not the recorded outcome of an API-key check or timeout. GPT recovered from a temporary service error on its second attempt, and Grok completed its second review in this same record.

Second Review now uses policy `targeted-peer-review-v4-validation-correction` and prompt `targeted-peer-review-v7-bounded-evidence-correction-grok-medium`. After a local wire, canonical or evidence validation failure, the same model may use its remaining attempt to generate a new complete response. Feedback consists only of application-authored validation constraints, trusted slot names and source bounds. The rejected response is not echoed. Source, assignments, native grammar, first-round records and aggregation rules are unchanged. Both service recovery and validation correction share **two attempts per model, 180 seconds per model, 210 seconds per round and six requests per round**. A response must pass every check; evidence is not clamped, fabricated or partially accepted. First-round validation and upstream parsing, authentication, filtering, credential detection and local cancellation remain terminal.

- **118 Python tests and 532 TypeScript/controller/React SSR tests passed.** The 22 new regressions cover corrected invalid ranges and slots, identical model/source/assignments, strict complete-response acceptance, sanitized feedback, isolation of successful models, both service/validation failure orders, repeated failure, cancellation during backoff, insufficient remaining budget, historical policy compatibility and unchanged vote/evaluation accounting. Model responses are simulated.
- Ruff, ESLint, TypeScript, formatting, generated-source checks and the Next.js production build passed. The two existing Python dependency deprecation warnings remain.
- Historical network-recovery reports retain their original policy and cannot acquire correction provenance by importing them. A second request is an attempt by the same model, not another model vote. Raw reports and the final report's last-valid-opinion policy are preserved.
- The platform overview and orchestration design remain **eight and three pages**, with no visible dates. All pages were rendered; the three changed pages were visually inspected, the other eight remain pixel-identical to the previously checked baseline, and deterministic regeneration passed.
- **No live AWS request, GitHub change, deployment or new browser-interaction run was performed.** UI changes are limited to the existing execution-limit explanation and guide text. Offline recovery tests establish behavior for the exercised failures; they do not establish that the model will always correct its output or that the external service will always be available.

Reproduce offline checks with `bash scripts/check.sh`. Existing browser checks remain available through `npm --prefix apps/web run test:e2e`. New correction behavior applies to subsequent runs, not to already exported historical records.

## Risk report refinement and last-valid-opinion aggregation

This incremental patch applies to the installed Professional Review baseline. The manual **Findings → Second Review → Final Report** workflow and the **Static Analysis / Bedrock Review** terminology remain. Findings and the final report prioritize risk explanations and recommended actions; source evidence, model judgments and execution details remain available in collapsed sections. Coverage presentation accounts for both rounds. Selecting Final Report opens the report directly.

The derived final-report schema is **1.1.0**, with aggregation policy `last-valid-opinion-v1`; the combined JSON envelope is **1.2.0**. When an assigned second review fails, an accepted original finding from that model remains the last valid opinion, including its severity and evidence. Pending reassessment is recorded separately and still requires review. Retention is never counted as a new second-round judgment. A valid explicit second-round rejection or uncertain judgment supersedes that model's original support. Original first-round and second-round records and paired evaluation metrics are unchanged.

The second-round native response grammar now uses the same twelve required nullable slots for every model and assignment count. Local validation requires assigned slots to contain complete judgments and unused slots to be null, then binds judgments to trusted claim IDs and exact source spans. This removes assignment-count-dependent native grammars without relaxing validation or increasing the existing two-attempt, 180-second model, 210-second round or six-call limits. The reader-focused independent prompt and stable-slot peer prompt have distinct new versions; historical reports retain their original provenance. These changes do not establish the upstream cause of the supplied Grok timeout or guarantee live completion.

- **118 Python tests and 510 TypeScript/controller/React SSR tests passed**, including retained support/severity after failed reassessment, explicit counterjudgments, export provenance, complete slot validation across 1–12 assignments, legacy prompt compatibility, safe rendering and risk-first report presentation. Provider responses are simulated.
- Ruff, ESLint, TypeScript, formatting, generated-source checks and the Next.js production build passed. The two existing Python dependency deprecation warnings remain.
- The eight-page platform overview and three-page design brief were rebuilt deterministically. All eleven rendered pages were visually inspected. Public document content has no release dates.
- **Browser interaction tests were updated and discovered, but not executed for this patch.** The managed preview service could not acquire its lock because another preview was active. The existing preview was not interrupted. SSR checks do not establish browser interaction or responsive behavior.
- **No live AWS request, GitHub change or deployment was performed.** Agreement is not an accuracy score, and this verification does not establish improved detection accuracy or uninterrupted provider availability.

Reproduce offline checks with `bash scripts/check.sh`; run `npm --prefix apps/web run test:e2e` in a working local or CI browser environment. The package's installation verification is recorded separately in its verification notes.

## Bounded network recovery and required second-review answer slots

This patch changes the actual model-request path. Recognized temporary outbound fetch and response-body errors now become `bedrock_network` and can receive one retry inside the original two-attempt, 180-second model and 210-second round limits. Provider Retry-After delays may exceed the local five-second jitter cap only when the original deadline leaves time for another attempt. The successful models are not rerun. Authentication, filtering, local cancellation, unknown/permanent transport errors and invalid reports remain terminal.

Second-round provider output now has one required named answer slot per assigned claim. After validating the entire response, the server binds each slot to the trusted original claim ID and produces the existing canonical assessment array. Source evidence, explicit judgments, original discoveries and missing-vote rules remain unchanged. This addresses the recorded assessment-count failure class; a missing or invalid answer is never fabricated to finish a report. New policy and prompt versions distinguish these changes from historical imports.

- **118 Python tests and 444 TypeScript/controller/React SSR tests passed.** The 34 new regressions exercise transient connection and body-read recovery, Retry-After beyond the local cap, cancellation and deadlines, historical retry provenance, required slot completeness and immutable claim binding for 1, 3 and 12 assignments across all three model adapters. Provider responses in these tests are simulated.
- Ruff, ESLint, TypeScript, formatting, generated-source checks and the Next.js production build passed. The two existing Python dependency deprecation warnings remain.
- The actual uploaded paired five-case JSON still imports successfully and retains all five original first-round and second-round policy versions. This checks compatibility; it does not rerun those contracts against AWS.
- The eight-page platform overview and three-page design brief were regenerated deterministically. All eleven rendered pages were visually inspected; public document content has no release dates.
- The single replacement package supports both the Diagnostics baseline and the previously supplied Guided Review baseline. It selects by exact file hashes and records the selected baseline in Git metadata for safe reversal. It includes the guided UI changes without requiring separate patch installation.
- **No new live AWS request, GitHub change or deployment was performed.** The supplied Claude first-round `content_filtered` result is an upstream refusal. This patch does not establish that Claude now accepts that contract and cannot guarantee uninterrupted provider service.
- **Browser interaction tests remain unexecuted.** The managed preview adapter passes incompatible Vite flags to Next.js. No server workaround was introduced. The UI controller and SSR tests passed, but they do not establish browser interaction or responsive behavior.

Reproduce offline checks with `bash scripts/check.sh`. Run `npm --prefix apps/web run test:e2e` in a working local/CI browser environment. A live acceptance run must use the user's authorized account and retain the exported results, including any unfavorable outcomes.

## Guided review workflow and explicit filtering outcomes

The supplied Caller-controlled callback report now identifies Claude's first-round failure as `AWS stop reason: content_filtered`, returned after 1.740 seconds. This is a recorded provider filtering outcome, not evidence of a timeout or an expired key. GPT and Grok returned valid initial reviews and both completed their assigned follow-up reviews. Overall initial coverage remains **2 / 3**, even though follow-up completion is **2 / 2**. Uncertainty about the missing caller implementation remains a legitimate unresolved judgment.

The guided interface separates contract selection, review and report reading. AI review includes one eligible follow-up by default, with a visible opt-out and usage notice before starting. It uses the exact accepted initial report and retains existing per-round limits, terminal filtering behavior, assignment rules and missing-vote accounting. No source rewriting, provider fallback, filter bypass or hidden recovery call was added. Similar findings remain separate when the evidence-grouping rules cannot safely establish identity.

- **118 Python tests and 410 TypeScript/controller/React SSR tests passed.** Added coverage includes terminal filter classification, old-report explanations, safe error rendering, initial-versus-assigned coverage, automatic follow-up eligibility, duplicate-start prevention, cancellation and stale results. These use simulated provider responses.
- Ruff, ESLint, TypeScript, formatting, generated-source checks and the Next.js production build passed. The original five Solidity examples, model configuration, prompts and strict report validators are unchanged.
- The eight-page platform overview and three-page orchestration brief were regenerated, all eleven pages rendered and visually inspected, and deterministic regeneration verified. Public document titles and visible content have no release dates.
- The patch installer is checked for preflight without writes, exact application, idempotence, rollback, an optional focused local commit, conflict/symlink refusal and preservation of unrelated work.
- **Browser interaction tests were updated but not executed.** The managed preview adapter injects Vite-only flags into Next.js and cannot start the preview. No application workaround or alternate server was introduced. SSR and code review do not establish responsive browser behavior.
- **No new live AWS calls or deployment were performed.** This patch improves workflow and truthful handling of provider outcomes; it cannot guarantee that a provider will accept a contract or that model agreement establishes accuracy.

Reproduce offline checks with `bash scripts/check.sh`. Browser checks remain `npm --prefix apps/web run test:e2e` in a working local/CI browser environment. For an authorized live check, use one contract, retain the exported report even when coverage is partial, and inspect the recorded reason before deciding whether another paid run is justified.

## Five-case live record and bounded diagnostics

The supplied paired Standard-prompt validation export passes the application's import validator, source/baseline checks and recomputed metrics. The batch finished in 888,107 ms. Completion means all five cases were attempted, not that every model succeeded.

| Case | Accepted independent reviews | Accepted assigned peer reviews | Remaining execution failures |
| --- | --- | --- | --- |
| Vault withdrawal | 2 / 3 | 2 / 2 | Grok first pass reached the 180-second deadline |
| Caller-controlled callback | 2 / 3 | 1 / 1 | Claude first pass returned generic `incomplete` |
| Delegated execution | 3 / 3 | 3 / 3 | None in this record |
| Block-data guessing game | 3 / 3 | 3 / 3 | None in this record |
| Two-player parity game | 2 / 3 | 1 / 2 | Grok first pass returned generic `incomplete`; Claude second pass failed assessment count validation |

There were 26 provider attempts, 22 accepted model reviews and no automatic retries. The two incomplete records do not retain the actual Bedrock stop reason, so they cannot establish output-token exhaustion, filtering or another cause. Claude's rejected peer response was assigned three claims, but its returned count was not retained. No access-denied error appears. Both assigned Grok peer-review requests succeeded, with no new source-citation rejection in this record.

The 17 new supporting assessments are model-claim opinions, not 17 new vulnerabilities or a measured accuracy improvement. Sixteen unresolved candidates include missing coverage. The two deferred Vault findings had no actionable assignment among successful reviewers; they did not exceed the twelve-candidate limit.

This follow-up exposes exact allowlisted stop reasons and numeric expected/returned assessment counts, while retaining terminal rejection of incomplete or invalid reports. It corrects deferred and unresolved wording. It does not change prompts, schemas, model identities, assignment rules, output budgets, retry eligibility or deadlines, and cannot retroactively recover missing diagnostics. It does not claim to fix a provider timeout or make model output reliable. Live follow-up should retain unfavorable results and inspect the new detail before changing resource limits or provider configuration.

Validation for this follow-up: **118 Python tests and 392 TypeScript/SSR tests passed**, including 21 additional diagnostics regressions. Ruff, ESLint, TypeScript, Prettier, generated-artifact checks and the Next.js production build passed. Eleven installer checks passed, including preflight, application, idempotence, rollback and conflict refusal. The two existing Python dependency deprecation warnings remain. No browser interaction test or new live AWS call was made for this patch. Earlier entries below retain the evidence and limitations available for those updates.

## Grok second-review source-span citations

The latest user-provided live export contains accepted first-round reviews from all three models and accepted second-round judgments from GPT and Claude. Grok's second-round response failed the exact excerpt check after **100,905 ms**: `assessments[0].evidence.excerpt` did not match its cited source lines. The rejected quote was not preserved, so the evidence cannot distinguish a whitespace difference from altered text or a wrong range. It does not identify an expired key or service outage. Claude's successful response establishes that the previous compatibility adapter worked for that run.

The focused change removes excerpt generation from Grok's second-round wire schema. Grok selects the source span; the application retrieves its exact text only after strict wire and span validation, then runs the canonical schema and existing source-binding checks. Unexpected quote fields and invalid spans remain failures. GPT and Claude evidence formats, first-round requests, assignments, judgments, retry limits and deadlines remain unchanged. New prompt provenance distinguishes application-resolved Grok excerpts from historical model-provided excerpts.

Automated coverage for this change uses synthetic provider responses, not DTCC credentials or paid AWS calls. It exercises exact source-text retrieval, invalid spans and fields, assignment and verdict constraints, canonical output and backward compatibility. It cannot establish provider acceptance, response latency or detection accuracy. An authorized live rerun remains necessary to verify Grok's new citation format in the user's account.

Validation: **118 Python tests and 371 TypeScript/SSR tests passed**, including 18 new server regressions and three report-provenance/compatibility regressions. Ruff, ESLint, TypeScript, Prettier, generated-artifact checks and the Next.js production build passed. The two existing Python dependency deprecation warnings remain. Browser interaction and live AWS execution were not tested in this verification run.

## Claude second-review wire compatibility

The next supplied live export shows accepted GPT and Grok second-round judgments; Claude again received HTTP 400, now classified as a structured-output `ValidationException`. Its first-round review succeeded. This supports targeting the second-round output configuration, but the exact rejected schema feature remains unproven.

The compatibility adapter uses an all-string severity enum for Claude's second round and translates the explicit non-applicable marker to canonical null only after strict wire validation. Canonical validation and source binding then run unchanged. The automated provider fixture rejects the old nullable form and accepts the simpler form; this is a simulated compatibility regression, not proof of AWS acceptance.

- **118 Python and 350 TypeScript/SSR tests passed**, including 11 additional adapter regressions; lint, type checks, formatting, generated-artifact checks and Next.js production build passed.
- Tests cover supported/not-supported/uncertain conversion, refusal of raw null and invalid markers, inconsistent verdict/severity pairs, extra fields and bad evidence, unchanged GPT/Grok encoding, stable per-provider grammars, unchanged first-round records, canonical exports and unchanged request budgets.
- No real AWS call or browser interaction test was performed for this compatibility update. A live rerun is required before calling the Claude issue resolved. Existing accepted and failed reports retain their original content and status.

## Second-review failure diagnostics

The supplied live Markdown export shows three accepted first-round reviews. In the second round GPT-6.1 Sol succeeded, Claude received HTTP 400 and Grok's response failed local evidence/assignment validation. The older export discarded both the upstream error body and the exact binding failure. It cannot establish Claude's rejected parameter or which Grok constraint failed. This follow-up fixes that diagnostic gap; it does not claim to have repaired or revalidated live provider execution.

- Full offline check: **118 Python tests and 339 TypeScript/SSR tests passed**, including 20 additional diagnostic regressions; lint, types, formatting, generated-artifact checks and the Next.js production build passed.
- Rejected requests are labelled separately from unavailable services. HTTP 400 classification is bounded and only exposes fixed hints and known exception names; raw messages, keys and unknown fields remain excluded.
- Second-round validation reports the precise known field/constraint for schema, duplicate assignment, severity consistency, range and excerpt failures. It still rejects the entire invalid model response, retains accepted peer results and leaves the independent baseline unchanged.
- Request formats, model selection, prompts, validation acceptance rules, retry limits and consensus arithmetic are unchanged. No live AWS calls or browser interaction tests were performed for this follow-up. Provider failures must be diagnosed from a new run after applying it; old error records cannot be recovered.

## Targeted orchestration and human-adjudicated evaluation

This record applies to the update built from the supplied repository archive. Earlier sections below describe historical releases and do not establish browser coverage for this update.

| Check | Result |
| --- | --- |
| Python unit/API/artifact suite | **118 passed**; two existing test-client deprecation warnings |
| TypeScript server, client, orchestration, evaluation and static parity suite | **319 passed**, including three real React server-render checks |
| ESLint, TypeScript, Prettier and Ruff | Passed |
| Generated showcase/schema drift and type regeneration | Passed; regenerated types are byte-identical |
| Original five Solidity contracts | Byte-identical to the supplied archive |
| Next.js production build | Passed; first/second review API routes, workspace, guide and documentation present |
| Eight-page overview and three-page design brief | All 11 pages rendered and inspected; no visible dates; deterministic byte-identical regeneration |
| Patch installer | Read-only preflight, exact text/binary application, idempotence, rollback, four focused local commits, edited/staged/untracked conflict refusal, symlink refusal and preservation of unrelated work checked |
| Browser end-to-end interaction tests | **Not executed for this update**: the managed preview service injects Vite-only flags into Next.js; no application or infrastructure workaround was introduced |
| Live AWS / production deployment | **Not performed**; no credentials from the conversation were used |

The executable checks cover targeted per-model peer omissions, the documented severity-review extension, empty assignments making no calls, exact candidate/evidence validation, retained original support, explicit missing opinions, deferred claims and exact-baseline export binding. The unified report includes every accepted first-round claim. The grouping fix has an explicit aggregation version, and genuine legacy arithmetic reports remain readable. New static reports use engine 0.1.1; accepted 0.1.0 reports retain their original identities.

Evaluation tests use simulated provider responses on the five unchanged sources. Human labels bind to both source and independent-baseline hashes. Metrics compare the same eligible model cohort, distinguish abstention from rejection and withhold unsupported accuracy measures. Agreement, typed output and exact source excerpts do not establish exploitability or improved accuracy.

Recovery tests permit one explicit browser admission retry only after the server proves that no provider request started. Ambiguous interruption does not silently create another round. Replacing a key preserves completed reports; the browser regression cases cover dialog minimization and key replacement, but those interaction cases still require execution in a working browser environment. React server rendering validates report labels and escaping, not browser events or responsive layout.

Reproduce the offline checks with `bash scripts/check.sh`. Run `npm --prefix apps/web run test:e2e` after installing the configured Playwright browser for desktop/mobile interaction verification. The existing CI workflow retains these browser checks. Authorized live calls, human adjudication and a deployed-site smoke test remain separate acceptance evidence.

## Documentation access and undated PDF resources

Date: 2026-10-27. Included in the same unapplied second-review installer, based on merged PR #19.

- Added the same-site `/documentation` page with separate reading and download controls for the eight-page platform overview and three-page orchestration design brief. Stable filenames and visible document content contain no release dates. The PDFs link to each other and the document page.
- **6 desktop/mobile browser checks passed**: resource navigation, exact published and downloaded PDF bytes, download filenames, viewport layout, guide navigation and retention of the workspace's memory-only key when documentation opens in a new tab.
- Production build, TypeScript, ESLint, formatting and patch whitespace checks passed. The new page is prerendered; no additional API or authoring dependency is required at runtime.
- Both changed PDF pages were rendered and visually inspected; all earlier page text remains unchanged. Eight/three page counts, bookmarks, crosslinks and byte-identical regeneration were verified. Desktop/mobile document-page screenshots were inspected.
- Core analysis, model transport, report validation and evaluation implementation remain byte-for-byte unchanged from the previously tested second-review package. The rebuilt full installer passed preflight, conflict protection, backups, exact application and idempotence checks again.

## Bounded second review and paired evaluation

Date: 2026-10-27. Reviewed base: `a69b4e645712558522abc383e569cb92274ff272` (main after merged PR #19). No live Bedrock calls were made for these checks.

| Check | Result |
| --- | --- |
| Python unit/API/artifact suite | **102 passed** |
| TypeScript transport, orchestration, client and evaluation tests | **264 passed** |
| Desktop/mobile workspace and static checks | **78 passed**: 60 retained checks and 18 new second-review/paired-evaluation checks |
| Final production-route checks | **4 passed**: first- and second-review routes under both browser projects, without contacting AWS |
| Final UI review | Eight desktop/mobile screenshots inspected; focused final-build checks also passed |
| ESLint, TypeScript, Prettier and Ruff | Passed |
| Generated schema/types and five-case drift | Passed; reference sources unchanged |
| Next.js production build | Passed; includes `/api/reviews` and `/api/reviews/second-round` |
| Platform and orchestration PDFs | Eight-page overview and three-page design brief visually inspected; deterministic regeneration, links and bookmarks verified |
| Self-contained patch installer | Read-only preflight; conflict, untracked-collision and symlink refusal before writes; exact installed bytes/modes; original-file backups; preservation of unrelated edits; idempotent reapplication |

Synthetic transport tests cover finite attempts and deadlines, bounded Retry-After handling, cancellation during calls and backoff, partial-model retention, strict candidate/evidence validation, stable native output grammar, untrusted peer context and credential-echo rejection before and after JSON decoding. They establish application behavior with simulated upstream responses, not live model availability or valid account access.

Second-review checks verify that the full first-pass snapshot is content-bound, its original reports and agreement never change, and missing reviewers, uncertainty, severity differences and deferred claims remain unresolved. A model can withdraw its own initial claim. A completed second pass is not automatically a resolved or correct finding. Fewer than two successful first-pass reviewers takes precedence over an empty review queue.

Paired evaluation tests use the exact accepted first-pass report for each of the same five contracts. They verify sequential execution, explicit opt-in, no outer retry, separate round outcomes and metrics, access/rate-limit early stops, cancellation preserving completed records, unresolved counts after failed second reviews, and skipped second reviews after first-pass failure. The browser checks exercise exactly five first-pass and five second-pass requests with synthetic results and credential-free exports.

Runtime: Python 3.12.14, Node 24.22.1, Playwright 1.58.2 and test-only Chromium 153.0.8010.0 on Linux. Mobile checks emulate a viewport; they are not native iOS/Safari tests. Existing Starlette/httpx and AnyIO deprecation warnings remain. No dependencies were changed by this release.

**Not established:** real Bedrock second-review behavior, live DTCC permissions or quotas, a production Vercel deployment, calibrated confidence, exploitability, reduced false negatives or improved accuracy. Those require authorized live paired runs and independent human review. Per-instance request guards are not a distributed quota, and a content fingerprint is not provider authentication. No credential from the conversation was used; no GitHub push, merge or remote deployment was performed.

## Bounded orchestration and controlled evaluation

Date: 2026-10-23. Reviewed base: `0f26c3af418871e6baaa1beca02583f23cb3b201` (main after PR #18). No live Bedrock calls were made for these checks.

| Check | Result |
| --- | --- |
| Python unit/API/artifact suite | **102 passed** |
| TypeScript transport, orchestration and evaluation tests | **160 passed**: 81 transport, 61 orchestration, 18 evaluation |
| Desktop/mobile workspace and static parity checks | **60 passed**: 52 browser workflows and 8 static checks |
| Final production-build regression | **10 passed**: 8 targeted UI repeats after responsive fixes, plus 2 compiled API-route checks |
| ESLint, TypeScript, Prettier and Ruff | Passed |
| Generated schema/types and five-case drift | Passed; reference source files unchanged |
| Next.js production build | Passed; compiled `/api/reviews`, workspace and guide |
| Updated platform PDF | Seven pages visually inspected; deterministic regeneration, bookmarks and links verified |
| Self-contained patch installer | Read-only preflight, conflict refusal before writes, exact applied bytes/modes, preservation of unrelated files and idempotent reapplication passed |

Mocked provider tests cover the six-request ceiling, selective transient retries, Retry-After, absolute deadlines including backoff, cancellation, partial-result retention, rejection of malformed or ungrounded evidence, strict attempt accounting and prompt provenance. The evaluation suite checks exactly five sequential cases, no outer retries, cancellation retaining completed reports, access/rate-limit early stops, unknown token usage and rejection of legacy/mismatched experiment metadata. UI tests cover guided prompts, the five-case workflow, cancellation, exports, attempt history and disagreement review.

The test browser is Chromium 153; the mobile configuration emulates a viewport and is not a native Safari test. Existing Starlette/httpx and AnyIO deprecation warnings remain in the Python environment. These checks establish local application behavior, not live DTCC account access, service availability, exploitability, calibrated confidence or an improvement in model accuracy. Live baseline/guided comparisons and human review remain required before quality claims.

## Original M0 initialization

Date: 2026-09-17 UTC. Scope: initialization patch, release 0.1.0. These are measured local checks, not a production security certification.

## Executed

| Check | Result |
| --- | --- |
| Python unit/API/artifact suite | **58 passed** |
| Browser suite | **16 passed**: 8 desktop + 8 mobile-viewport Chromium tests |
| Ruff checks and formatting | Passed |
| ESLint, generated route types and TypeScript | Passed |
| Prettier | Passed |
| Next.js production build | Passed; showcase route prerendered |
| Showcase/schema drift | Passed; 5 actual reports match current engine/source |
| Original fixture hashes | All 5 match supplied later archive bytes |
| Python lock → pip export consistency | Passed |
| npm advisory scan, including development dependencies | 0 reported vulnerabilities at verification time |
| Basic repository credential-pattern scan | No matches; this is not exhaustive secret detection |
| Empty-repository patch application | `git apply --check --whitespace=error-all` and actual application passed |
| Clean dependency installation | New Python virtual environment + `npm ci`; checks/build passed |

Browser tests exercise production-mode isolation, actual local API requests, source edits invalidating exports, empty results without safety claims, JSON/Markdown content, source-evidence scrolling, schema-error rejection, API-failure display, escaped source markup, all five cases and viewport overflow. Screenshots at desktop and mobile dimensions were inspected. Mocked failure tests are distinct from real API success tests.

## Environment and reproducibility

- Linux x86_64; Python 3.12.14; Node 24.19.0; npm 11.9.0.
- Next.js 16.3.5, React 19.3.0, TypeScript 5.9.3; full versions in committed locks.
- The default Playwright browser CDN timed out in this environment. Browser tests instead ran with Playwright 1.58.2 and locally extracted Chromium 153.0.8010.0 from the `@sparticuz/chromium` 153.0.0 package. That test-only package is **not** an application dependency or shipped binary. The environment override in the Playwright config permits a supplied local executable; no browser cross-origin security was disabled.
- Normal users/CI use `npx playwright install chromium --only-shell` followed by `npm run test:e2e`. The default downloaded browser installation was not verified here. Mobile tests emulate a viewport/device configuration; they do not test native iOS Safari.
- The clean replay used a new empty Git repository and fresh dependency directories. The final delivery is also compared byte-for-byte against its applied source tree.

## Visible upstream warnings

- ESLint 9.39.5 emits an end-of-support warning. It is pinned because this Next.js config's React plugin crashed under ESLint 10.10.0 (`getFilename` compatibility). Lint itself passes. Re-evaluate the complete plugin/toolchain when updating; do not silently suppress checks.
- Starlette's test client emits HTTPX/AnyIO deprecation warnings. All API tests pass; those warnings are not suppressed. Plan the supported test-client migration alongside dependency updates.
- This execution environment emits npm proxy/color configuration warnings. They do not indicate an application failure.

## Not verified / not performed

Actual AWS calls or token validity; model availability/permissions; Bedrock Agents; multi-agent reliability; Slither/solc compilation; exploit execution; real-chain behavior; macOS/Windows-specific execution; Python 3.13/3.14 or Node 22 runtime execution; Safari/Firefox; hosted GitHub Actions; GitHub push; Vercel deployment; public-source licensing approval.

No AWS credential from the conversation was used, stored or placed in this patch. Public cloud deployment remains a separate, user-operated acceptance step.

## Workspace redesign and API restoration — 2026-09-18 UTC

This delivery replaces the unaccepted first UI refinement. It applies directly to the original M0 initialization tree; the intermediate UI patch is not a prerequisite.

| Check | Result |
| --- | --- |
| Python unit/API/artifact/Bedrock transport checks | 82 passed |
| Frontend automation | 36 passed: 28 browser workflow executions and 8 scanner/integrity executions across the two projects |
| Browser/Python rule parity | All five reference fixtures and all 15 rule families checked |
| Ruff, ESLint, TypeScript, formatting, schema/report drift | Passed |
| Next.js production build | Passed |
| npm dependency advisory scan | 0 reported vulnerabilities at verification time |
| User logo bytes | Unchanged copy; display inversion is CSS |
| Desktop/mobile screenshots | Inspected; no page-level horizontal overflow in tested viewports |
| Incremental patch on original M0 | Checked and applied; fresh setup and checks/build passed; changed files compared byte-for-byte |

Browser tests exercise real on-device analysis without an API, real local Python static analysis, source editing and filename invalidation, file upload limits, case selection, keyboard disclosure, evidence navigation, filters/search, JSON/Markdown downloads, API configuration, invalid results, API failure and late-response invalidation. Model success in browser tests is explicitly mocked; test screenshots labelled with mocked content are not demonstration evidence of an actual AWS call.

Transport tests verify the request contract for Converse and Mantle, single-request behavior, no redirect following, HTTP errors, timeouts, size bounds, strict output schema, empty model findings, duplicate/fabricated evidence rejection and preservation of static evidence. They use HTTPX mock transports without credentials or network calls to AWS.

The final UI uses locally served Manrope and IBM Plex Mono packages. Fonts, logo and code are part of the portable build. The browser scanner is an attributed port of the inherited heuristics, not a verified semantic analyzer.

**Not established:** real AWS account/key/model availability; live Bedrock end-to-end success; model accuracy; complete smart contract coverage; multi-agent orchestration or reliability improvements; hosted GitHub Actions; GitHub push or Vercel deployment. Chromium viewport tests are not native Safari/iOS certification. No claim of error-free or complete security analysis is made.

## Workspace polish and platform PDF (2026-09-18)

- 82 Python tests passed. Ruff, generated-artifact checks, ESLint, TypeScript,
  Prettier and the Next.js production build passed.
- 40 Playwright checks passed on desktop and mobile. New checks cover the
  same-site PDF response, setup route and anchors, dialog focus restoration,
  mobile source evidence navigation, stationary desktop controls at 1440x900,
  1280x720 and 1024x768, Focus mode and the short-window fallback.
- Desktop, Focus and mobile production screenshots were visually reviewed.
- All four PDF pages were rendered and inspected. The brief has embedded
  Manrope / IBM Plex Mono fonts and section bookmarks. Its authoring script
  reproduces the same PDF bytes. Content checks confirm the exact title,
  analysis-mode boundaries and absence of a timeline or old performance claims.
- The installer is checked against both original M0 and Workspace Redesign;
  resulting files must match the verified working source, including the PDF.
  Re-running is a no-op; an incompatible change must fail without mutation.
- Bedrock success/failure tests use simulated upstream responses. This update
  does not establish real AWS access or model quality.

## Web Bedrock connection — 2026-09-18 UTC

- 102 Python tests passed; Ruff, schema drift, ESLint, TypeScript, Prettier and production build passed.
- 106 Playwright checks passed in 51.3 seconds. This is 53 checks executed under each desktop/mobile project, including server transport tests; it is not 106 distinct browser user flows.
- The production build now contains the Node.js `/api/reviews` route. A real HTTP request against the production server was correctly validated and rejected before AWS for an invalid key; unsupported methods return 405. Incoming Host validation also covers Next.js reverse-proxy internal URLs without trusting arbitrary forwarded hosts.
- Mocked AWS tests verify fixed model/region/endpoint, long keys, no key in prompts or results, separate concurrent-user credentials, request bounds, 401/403/429/400/404/500 failures, no retries, cancellation, invalid JSON, incomplete results, fabricated/duplicate evidence and oversized responses.
- Browser checks exercise masked key entry, format rejection, no model request when a key is added, absence of application cookies/localStorage/sessionStorage, clear/reload behavior, production-mode model result/export with mocked transport, and preservation of static results on failure. Screenshots contain synthetic values only or empty key inputs.
- Desktop and mobile connection screenshots were inspected. The platform guide and PDF now describe the website connection; all four rendered PDF pages were inspected.
- The one-click patch installer is checked for normal application, identical reruns and conflict rejection without partial mutation.

No real AWS credential was used in these tests. Live Bedrock permissions, model availability and real model results remain unverified by the automated suite. No GitHub push, hosted Actions run or Vercel deployment is claimed. Vercel firewall settings, third-party logging and distributed rate limits are outside the tested per-instance request guard.

## Three-model evidence orchestration — 2026-10-20 UTC

Base: GitHub `main` commit `c675c492dde381ef5fe601393fa2393d14a8eb04`, matching the supplied repository ZIP. The update is delivered as one reversible installer; no remote commit or deployment was performed during preparation.

- Python regression suite: **102 passed**. Ruff and generated showcase/schema drift checks passed. The retained Python service is still the optional legacy single-model path.
- Standalone web unit/transport suite: **77 passed**. This includes three-request concurrency, per-model failures, partial/all-failed runs, fixed endpoints, cancellation, source/evidence validation, duplicate votes, distinct operation sites, category aliases, inherited-property input names, consistency validation and credential isolation. These tests do not contact AWS.
- Browser workspace suite: **44 passed**, comprising 22 workflows under desktop and mobile Chromium projects. Checks cover static analysis, key memory and clearing, current-source invalidation, model confidence, partial/all-failed outcomes, severity disagreement, original contributions, JSON/Markdown export and responsive controls. Successful model responses are explicit fixtures, not live AI results.
- Real local production HTTP route checks verify POST validation and GET rejection before contacting AWS. Build includes the dynamic `/api/reviews` function. Web lint, TypeScript, formatting and production build pass.
- Desktop and mobile screenshots were inspected. The short desktop API layout now leaves a usable reading area and uses page flow; explicit Focus mode retains the fixed workspace. Source evidence navigation and result-view scrolling remain functional.
- The platform overview PDF has five pages. All five were rendered and visually inspected; script lint/format and compilation checks pass.
- Installer checks cover a clean checkout of the reviewed base, compatibility-only operation, byte-for-byte result verification, identical reapplication, and rejection of conflicting local edits without mutation. Backups are stored outside the repository. It does not install dependencies, create credentials, commit, push or deploy.

Runtime: Node 24.19.0 and Python 3.12 on Linux. Browser checks use Playwright 1.58.2 with a test-only Chromium 153.0.8010.0 executable, because the default browser download returned an invalid archive in this environment. This browser package is outside the repository and is not shipped. Mobile coverage is viewport emulation, not native Safari/iOS verification.

Official AWS model cards were checked for the three US inference profile IDs and Converse support. **No live DTCC key, model entitlement, billed Bedrock response, production Vercel upgrade, or measured accuracy gain was verified.** Account acceptance must run with a newly generated key on the user's deployment. Lexical consolidation is conservative and can leave semantic duplicates unresolved; source agreement and model agreement do not prove exploitability.

## Grok report-format repair — 2026-10-20 UTC

A user-provided live screenshot showed accepted GPT-6.1 Sol and Claude Opus 5.5 reviews, with Grok rejected by the local report-schema check. That error occurs after a successful AWS response, completed generation and JSON parsing. The screenshot does not establish the specific rejected field; raw model output was not supplied.

Grok now receives the documented Converse JSON Schema output configuration, derived from the generated report contract using provider-supported structural keywords. Its prompt also includes the full contract. Local length, count and source-evidence checks remain strict. Schema failures expose only recognized field paths and trusted constraint descriptions. No automatic retries, model substitutions or additional calls were added.

- Standalone unit/transport suite: **90 passed** (52 transport and 38 orchestration checks), including 13 new structured-output and sanitized-diagnostic regressions.
- ESLint, TypeScript, Prettier, production build and patch whitespace checks passed.
- Installer verification reconstructs the installed v1.1 state, checks exact resulting file bytes, preserves unrelated files, supports identical reapplication and rejects later local conflicts before writing.
- Tests use synthetic responses and do not call AWS. The repaired native schema request still requires live account verification. Provider grammar compilation can add first-use latency within the existing deadline.

## Server-owned evidence validation — 2026-10-20 UTC

A later live screenshot identified Claude's precise local validation failure: `findings[0].evidence.validation` did not equal `source-bound`. GPT and Grok completed in that run. This is a report-contract failure after AWS returned completed JSON, not evidence of an expired key or an upstream outage. The actual annotation value was not supplied and is not assumed.

Models now supply only the evidence lines and excerpt. The server ignores a legacy validation annotation, strictly validates all remaining report fields, checks exact source binding and duplicates, and only then assigns `source-bound`. Credential-echo rejection runs before normalization, including decoded JSON content. The public report/export schema is unchanged. No evidence repair, dropped findings, automatic retries or model substitution was introduced.

All three fixed model requests now carry the same native JSON Schema and complete format instructions. GPT's documented Converse strict-format flag is applied only to GPT. Current official model cards were checked for structured-output support; local mocks cannot verify account-level acceptance.

- Unit/transport suite: **100 passed** (62 transport and 38 orchestration checks). Ten added regressions cover Claude annotation variants, false evidence despite a claimed validation marker, and credential echoes inside ignored metadata.
- ESLint, TypeScript, Prettier and Next.js production build passed. The shared evidence validator retains exact excerpt matching, duplicate detection, source bounds and the 12-line maximum, and explicitly checks safe integer line numbers.
- Installer verification reconstructs the installed three-model plus Grok-fix state, checks compatibility without writes, applies the eight-file change, compares exact resulting bytes, confirms identical reapplication and rejects conflicting edits before writing. No dependencies or UI layout changed.
- Tests use synthetic model responses. No live AWS credential or billed model call was used for this repair; a live run on the user's account is still required. No remote commit or deployment was performed.

## Platform documentation refresh — 2026-10-20 UTC

The platform brief is now six pages, aligned with the implemented three-model workflow. It corrects the earlier statement that models receive static findings: all three receive the source independently, and the static baseline is separate. The brief explains server-owned evidence validation, conservative reconciliation, agreement versus severity, partial coverage, exports and browser-based connection. It includes clickable platform, guide and repository links without a project timeline or claimed accuracy improvement.

- All six pages were rendered and visually inspected. Text extraction checks the exact project title, three model names, key workflow and agreement semantics. Page size, embedded fonts, section bookmarks and link destinations were checked.
- The authoring script passes Python compilation, Ruff lint and formatting. Two consecutive builds produce identical PDF bytes. The prebuilt PDF remains included in the repository; users do not need ReportLab to apply the patch or run the website.
- The production server serves the updated same-site PDF with the expected content type and exact file bytes; existing Documentation links keep their original path.
- The four-file installer was checked against the previous three-model documentation state with both transport fixes applied. Compatibility-only operation, exact application, unchanged unrelated files, identical reruns and conflict rejection before writes were verified.

This update changes only the PDF, its authoring script and documentation records. No application logic, model request, dependency, GitHub remote or Vercel deployment was changed.


## Professional Review replacement

This patch restores Static Analysis / Bedrock Review terminology and makes Findings,
Second Review and Final Report separate manual stages. Evidence and model judgments
remain available through expandable details. It removes automatic second-round calls.

The complete offline check passed: **118 Python tests and 488 TypeScript/transport,
controller and server-rendered UI tests**, Ruff, generated-artifact parity, ESLint,
TypeScript, Prettier and the Next.js production build. Simulated upstream cases cover
both rounds, all-model source-span binding, exact source reconstruction, malformed
whole-batch rejection, historical provenance, transient recovery, time bounds,
cancellation and incomplete model coverage. No mocked result is evidence of live AWS
success or measured model accuracy.

All three models now select source line spans in both rounds; the server retrieves
and checks the submitted source text. New prompt versions identify this protocol.
Historical reports retain their original citation method. Grok's documented medium
reasoning setting is recorded for new runs; latency, cost and quality effects have
not been measured with live calls.

The updated eight-page Platform Overview and three-page Orchestration Design were
rendered and visually inspected in full. Two builds produced identical bytes. The
PDFs contain no visible dates. Browser interaction specifications were updated and
discovered, but were not executed: the managed preview adapter supplied unsupported
Vite startup flags to the Next.js application. No browser rendering or responsive
interaction success is claimed for this replacement.

The reversible installer supports the previously verified Diagnostics, Guided
Review and Runtime Recovery file profiles. It checks exact bytes before writing,
retains prior receipts, preserves unrelated changes, and refuses unsupported or
conflicting source versions. Installation never commits, pushes or deploys.

No live AWS credentials or billed model calls were used, and no GitHub/Vercel changes
were made. The supplied Claude result was an upstream content-filter refusal; this
patch does not override that refusal or mark missing model output as successful.
Permission errors and provider outages remain explicit. Final Report eligibility is
separate from full three-model coverage: an accepted partial second-round report can
be inspected, but a cancelled/request-rejected run without a report cannot unlock it.
