# Verification records

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
