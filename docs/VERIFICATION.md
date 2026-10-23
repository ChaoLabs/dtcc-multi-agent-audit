# Verification records

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
