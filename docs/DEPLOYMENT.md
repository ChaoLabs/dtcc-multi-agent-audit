# Deployment and release acceptance

Live platform: https://dtcc-multi-agent-audit.vercel.app/

## Apply and verify locally

Apply the supplied patch to the intended checkout only after its preflight succeeds. Preserve unrelated changes; do not force a failing patch or use `git reset --hard` to recover. The patch does not create commits, push to GitHub or change AWS permissions.

Run the supplied offline checks and production build. Check case selection, upload/edit behavior, static analysis, source evidence, model status, consensus membership and JSON/Markdown exports. Also check prompt selection, attempt history, the five-case validation flow and cancellation. Offline model tests use mocks and do not incur AWS charges.

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
| Route duration | 240 seconds (`maxDuration` in `/api/reviews`) |
| Client cancellation | Enabled for the review function in the bundled `vercel.json`; passed through to active requests |
| AWS credentials / backend URL | None required in deployment environment variables |

The three model tasks run concurrently with a fixed 180-second deadline per model and a 210-second overall server deadline. Each can retry one explicitly transient failure; the original deadline includes both attempts and backoff. A single analysis issues at most six provider requests. The function duration leaves room for request parsing and response handling. Keep this as a Next.js deployment; publishing only `public` assets removes the application and API route. The optional Python API is not needed on Vercel.

After deployment, open the production URL in an incognito window while local servers are stopped. Verify the workspace, `/guide`, documentation PDF, reference cases, static analysis and downloads. Then perform the authorized small-contract API check described above. Once that succeeds, use the five-case validation workflow to record operational outcomes for the fixed reference set. Start each prompt variant separately; do not infer accuracy from completion or agreement. Network requests should use same-origin `/api/reviews`, with no calls to a visitor's port 8000. Do not share screenshots containing request bodies or keys.

Future pushes to the configured production branch update the site. Use preview deployments to review substantial changes before merging. Check the deployed commit, build log and effective function settings if a deployment behaves differently from local production.

## Credential and usage controls

Each visitor provides a Bedrock key in the website. No shared AWS secret or `NEXT_PUBLIC_` credential is needed. Expired or unauthorized credentials affect that visitor's API analysis; static analysis remains available.

Model usage is charged to the visitor's AWS account; function compute is charged to the Vercel owner. The application applies per-instance limits, not a distributed quota. Configure hosting usage controls appropriate to the deployment and avoid request-body logging or session replay on credential inputs. Cancelling the browser request does not ensure that AWS will cancel or waive charges for work already started.

## Verification record

Record the commit, check commands and results for each release. Keep mocked/offline verification separate from live AWS acceptance. The multi-model patch contains no DTCC credentials and does not by itself verify DTCC account permissions or real model outputs. See [Bedrock setup](BEDROCK.md) for account prerequisites.
