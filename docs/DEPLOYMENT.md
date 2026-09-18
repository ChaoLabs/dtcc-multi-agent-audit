# M0 release checklist

## Local acceptance first

- Apply the initialization patch only to the empty project clone after `git apply --check` succeeds.
- Run setup, offline checks, production build and the local workbench.
- Verify case selection, candidate source lines, local edits, failed API behavior and JSON/Markdown exports.
- Preserve unrelated changes; never use `git reset --hard` or force-apply a failing patch to recover.
- Do not push until local acceptance, source/fixture publication permission and the attribution statement are confirmed.

## GitHub — user-operated

Review the exact files and confirm no keys, `.env`, personal notes, databases or unintended archives are staged. Then make the first checkpoint commit and push to the empty `ChaoLabs/dtcc-multi-agent-audit` repository. The patch does not push, create commits or change the remote.

The GitHub workflow is configuration until it actually runs. A local green test is not a claim that hosted CI is green. Enable branch checks only after the initial workflow succeeds. Configure secret scanning where available in the repository's settings.

## Vercel — user-operated

Import the GitHub repository. Set Root Directory to `apps/web`, select Next.js and Node 24.x. Use `npm ci` and `npm run build`; retain the framework's output directory. No AWS variables, backend URL or Python setup are required. Enable Fluid compute so the Next.js API route can use its 120-second function duration. Keep the optional FastAPI service local; the website does not depend on it.

Verify the resulting public URL in a private/incognito window with the local API stopped. Check all five cases, upload/edit source, run static analysis with the local API stopped, download both report formats, open the web key form, inspect mobile layout and follow the GitHub link. Enter a valid visitor-owned key and run one small contract review to verify actual AWS access. Check failure behavior and Clear key. Inspect the browser network panel: analysis uses same-origin `/api/reviews`, with no browser call to port 8000 or directly to AWS. Do not share screenshots containing the request body or key.

Only after these checks should the README receive the real deployment URL and the milestone be marked deployed. Future pushes to the configured production branch update the Vercel site; review preview deployments before merging substantial changes.

## Credential rules

Do not configure a shared AWS key in Vercel environment variables. Visitors provide their own key in the web form, and the route never uses a deployment-owned fallback. An expired or unauthorized key affects only that visitor's API analysis. Static analysis remains available. Model usage is charged to the visitor's AWS account; function compute is charged to the Vercel owner. Before sharing broadly, set hosting firewall/rate controls and usage alerts appropriate to your plan. Do not enable request-body logging or session replay on the key form.
