# Deployment and release acceptance

Live platform: https://dtcc-multi-agent-audit.vercel.app/

## Apply and verify locally

Apply the supplied patch to the intended checkout only after its preflight succeeds. Preserve unrelated changes; do not force a failing patch or use `git reset --hard` to recover. The patch does not create commits, push to GitHub or change AWS permissions.

Run the supplied offline checks and production build. Check case selection, upload/edit behavior, static analysis, source evidence, model status, consensus membership and JSON/Markdown exports. Also check prompt selection, attempt history, second-review eligibility and source invalidation, unchanged first-pass agreement, before/after exports, the five-case validation modes and cancellation. Offline model tests use mocks and do not incur AWS charges.

For live acceptance, use a fresh authorized visitor key and a short reference contract. Confirm the interface records **all three models as successful** before calling the three-model connection verified. A saved key or a successful response from only one model is insufficient. Examine partial/all-failed behavior and Clear key. No accuracy claim follows from a successful connection test.

## GitHub

Review `git status` and the exact diff before committing. Exclude credentials, `.env` files, personal notes, databases and unintended archives. Push through the team's normal branch/PR process. A local test pass is separate from the hosted CI result; check the actual workflow for the pushed commit.

## Vercel

| Setting | Value |
| --- | --- |
| Repository | `ChaoLabs/dtcc-multi-agent-audit` |
| Framework | Next.js |
| Root Directory | `apps/web` |
| Node.js | 24.x |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output Directory | Framework default, no static export override |
| Fluid compute | Enabled |
| Route duration | 300 seconds for each route (`/api/reviews` and `/api/reviews/second-round`) |
| Client cancellation | Enabled for the review function in the bundled `vercel.json`; passed through to active requests |
| AWS credentials / backend URL | None required in deployment environment variables |

On Vercel, three model tasks run concurrently with 270 seconds per model and 285 seconds for the round. The browser waits 295 seconds inside the configured 300-second function. Locally or on a compatible self-hosted server, the clocks are 660 / 720 / 745 seconds (model / round / browser). Ensure any self-hosted reverse proxy allows the request to finish. Vercel and AWS enforce their own [hosting limits](https://vercel.com/docs/functions/limitations) and quotas: a longer local deadline cannot extend them. Each round uses a separate Next.js request. Both host profiles request 32,768 tokens initially and can escalate to 65,536 after an explicit token stop. Service retries, output escalation and validation correction share up to three attempts per model and nine calls per round. Static-only export cannot serve the two API routes; the legacy Python service is not needed.

After deployment, open the production URL in an incognito window while local servers are stopped. Verify the workspace, `/guide`, documentation PDF, reference cases, static analysis and downloads. Then perform the authorized small-contract API check described above. Once that succeeds, use the five-case validation workflow to record operational outcomes for the fixed reference set. Start each prompt variant separately; do not infer accuracy from completion or agreement. Network requests should use same-origin `/api/reviews` and `/api/reviews/second-round`, with no calls to a visitor's port 8000. Do not share screenshots containing request bodies or keys.

Future pushes to the configured production branch update the site. Use preview deployments to review substantial changes before merging. Check the deployed commit, build log and effective function settings if a deployment behaves differently from local production.

## Credential and usage controls

Each visitor provides a Bedrock key in the website. No shared AWS secret or `NEXT_PUBLIC_` credential is needed. Expired or unauthorized credentials affect that visitor's API analysis; static analysis remains available.

Model usage is charged to the visitor's AWS account; function compute is charged to the Vercel owner. The application applies in-memory per-runtime limits. Separate serverless route functions or instances do not share these counters; they are not distributed quotas or a deployment-wide concurrency guarantee. Configure hosting usage controls appropriate to the deployment and avoid request-body logging or session replay on credential inputs. Cancelling the browser request does not ensure that AWS will cancel or waive charges for work already started.

## Verification record

Record the commit, check commands and results for each release. Keep mocked/offline verification separate from live AWS acceptance. The multi-model patch contains no DTCC credentials and does not by itself verify DTCC account permissions or real model outputs. See [Bedrock setup](BEDROCK.md) for account prerequisites.
