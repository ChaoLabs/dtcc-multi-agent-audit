# Architecture — portable analysis workspace

## Current design

The Next.js application runs a bounded TypeScript port of the inherited 15-rule scanner in the browser. The production Vercel build and local development UI both support source editing, uploads, rule analysis and report export without a backend. Source stays in memory until explicitly downloaded or sent for API review.

The website posts source and an explicitly entered visitor key to its same-origin Next.js `POST /api/reviews` route. It fixes the AWS endpoint, region and GPT-6 Astra inference profile, recomputes static candidates, and returns only a validated `model_review`. The browser retains its own static baseline and combines the two only after source/provenance validation. No client-supplied candidates or destination URL are accepted.

The optional local FastAPI service retains the original Python baseline and adds a single-model Bedrock review adapter. `/api/audits` remains available for Python static analysis and scanner parity checks. `/api/config` exposes configuration status without credentials. `/api/reviews` runs the Python baseline and one Bedrock review.

The retained Python API is loopback-only, with trusted-host, Origin/CORS and 64 KB request-body checks. Source limits are 48,000 UTF-8 bytes, 1,200 lines and 2,000 Unicode characters per line. Browser validation applies the same limits. There is no compiler, import resolution, subprocess, blockchain write or source database.

## Evidence contracts

Python models generate JSON Schema and TypeScript types. The browser checks schema, source hash, candidate identity and exact source excerpts. Static candidate IDs bind the source, engine, version, rule and location. The browser engine has a distinct `browser-static-rules` identity and `browser` execution value; existing recorded Python reports keep their actual metadata.

The browser scanner ports heuristic behavior, including known limitations. Tests compare all reference case rule locations/severities and all 15 rule families with the real Python API. This establishes regression coverage, not vulnerability accuracy or full equivalence for every possible Unicode/formatting input.

An enhanced export is an envelope containing `static_report` and `model_review`. Static findings are retained. Model findings are separately attributed and must contain exact source evidence. Invalid, truncated or unbound model output rejects that review. Agreement, valid JSON and exact source location do not establish semantic correctness.

## Request lifecycle

Source/filename changes and case changes advance a request generation, abort the active browser request and invalidate previous reports/exports. Late responses cannot restore stale data. A completed static report remains available when the subsequent model request fails. That result is explicitly labelled static, and no failed or pending model result is exported.

Web Bedrock requests are bounded to one model call, 8,192 output tokens, 110 seconds and 256 KB of upstream response. Request bodies are limited to 128 KB with a 10-second read deadline; source limits remain 48 KB. The Next.js function allows 120 seconds and the browser waits at most 125 seconds. Redirects, automatic retries and model tools are disabled. A per-instance limiter permits one concurrent call and six attempts per minute per key hash, four simultaneous calls overall, and at most 1,000 retained hashes. Expired inactive entries are discarded. These limits are not distributed across Vercel instances. The separate Python adapter retains its original 4,096-token / 55-second / 128-KB limits. Cancelling a browser wait does not guarantee cancellation or non-billing of a request already received by AWS.

Web credentials live in a browser ref, an initially masked input while editing, and the active server request. They are sent in a JSON POST body over HTTPS on Vercel, never in URLs, cookies or shared process environment. Closing the dialog clears the unsaved input; refresh, unmount or Clear key drops the active browser reference. Replacement and clearing abort active requests and invalidate late results. No credential database, localStorage, logging, environment fallback or report field is implemented. Runtime/provider memory disposal, browser extensions and hosting-level request logging are outside those application guarantees. See [Bedrock setup](BEDROCK.md).

## Public hosting

Vercel needs only the web project. Each paid model request requires the caller's own key; no deployment-owned AWS credential is provisioned or used as a fallback. Same-origin and JSON checks guard the browser boundary, but are not account authentication. Browser static analysis remains fully available. Fonts and logo are served as local assets; no external font service is required.

Vercel compute is billed to the deployment owner even when visitors provide their own AWS keys. Use hosting firewall/rate-limit controls and monitor usage when making the URL public. A future sponsor-funded multi-user API needs application authentication, distributed quotas, per-user budgets, durable jobs and retention decisions; this bring-your-own-key route does not implement those services.

## Semester direction

The three-model architecture and orchestration role are not implemented. Planned model baselines should use identical source/scope and preserve each model's original candidates. Orchestration should reconcile conflicts with evidence, while retaining unresolved claims. A reviewed held-out dataset and controlled comparisons determine whether reliability improves.

## References

- [Next.js deployment](https://nextjs.org/docs/app/getting-started/deploying)
- [Bedrock Converse](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html)
- [Bedrock Messages API](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-messages-api.html)
- [Managed Bedrock multi-agent collaboration](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-multi-agent-collaboration.html)
