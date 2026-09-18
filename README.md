# Multi-Agent AI for Smart Contract Audit and Cybersecurity Risk Assessment

**DTCC · Duke FinTech Capstone**

A smart contract analysis workspace extending the summer *Agentic AI for Smart Contract Audit and Digital Asset Risk Management* project. The semester research goal is to evaluate whether three independent model analyses and an orchestration agent improve vulnerability analysis reliability.

The current implementation provides **on-device static analysis** and **optional single-model AWS Bedrock review**. Multi-agent orchestration, compiler-backed validation and reliability evaluation are future milestones.

## Capabilities

- Paste, edit, upload or inspect single-file Solidity contracts; five preserved reference cases are included.
- Run 15 inherited static rule heuristics directly in the browser, including the Vercel build. No backend or AWS key is required for static analysis.
- Enter your own Bedrock key in the website and run GPT-6 Astra review through a same-origin Next.js server route. No visitor terminal or Python service is required.
- Inspect source-bound evidence, search findings, filter proposed severity and export JSON or Markdown reports.
- Preserve static evidence alongside model findings. Edits invalidate stale results; failed API calls do not become fabricated model reports.
- Track source SHA-256, engine/model, run ID, timestamps and available model token usage.

Rule matches and model findings are review candidates, not confirmed vulnerabilities. The scanner is a regex baseline; it does not compile contracts or resolve dependencies. Source binding verifies a location, not correctness. See [limitations](docs/LIMITATIONS.md) and [evaluation plan](docs/EVALUATION.md).

## Run locally

Requirements: Git, Node.js **24 LTS** (or Node 22.14+ within Node 22), npm. Python **3.12–3.14** is required only for the optional legacy API, report generation and Python tests. macOS/Linux commands; use WSL2 on Windows.

```bash
git clone https://github.com/ChaoLabs/dtcc-multi-agent-audit.git
cd dtcc-multi-agent-audit
npm ci --prefix apps/web
npm --prefix apps/web run dev
```

Open [the workbench](http://127.0.0.1:3000). Static analysis works immediately. Source is processed in memory; report downloads are explicit, and this application does not save uploaded source in localStorage or a database.

For the complete Python + web setup:

```bash
bash scripts/setup.sh
bash scripts/check.sh
```

If needed, select a particular installed Python: `PYTHON_BIN=python3.13 bash scripts/setup.sh`.

## API analysis

Choose **API analysis**, paste a valid Bedrock key, and select **Use API key**. Then choose **Run API analysis**. The website calls GPT-6 Astra through the `us.openai.gpt-6-astra` US inference profile in `us-east-1` using Bedrock Converse. No separate backend terminal is required.

Keys remain in the current tab's memory and the active server request. Refresh or **Clear key** removes the browser connection. The application does not put keys in cookies, localStorage, a database, logs or report exports. Analysis sends the key and source through the website's server to AWS; charges and permissions belong to the key's AWS account. Adding a key validates its format, not AWS access.

See the [Bedrock connection guide](docs/BEDROCK.md) for request limits, errors and the optional retained Python API. Multi-model orchestration remains future work.

## Vercel

| Setting | Value |
| --- | --- |
| Framework | Next.js |
| Root Directory | `apps/web` |
| Node.js | 24.x |
| Install | `npm ci` |
| Build | `npm run build` |
| Output Directory | Framework default |
| Deployment AWS credentials | None; each visitor supplies their own key in the website |
| Functions | Fluid compute enabled; route duration 120 seconds |

The public site includes browser analysis, source editing, exports and a server-side Bedrock route. It never calls a visitor's localhost. Static analysis works without credentials; API review requires the visitor's key and supported model access. Vercel serves the UI and runs the Node.js function from the same deployment.

No Vercel deployment URL is claimed until it has actually been published and verified. See [deployment steps](docs/DEPLOYMENT.md).

## Reproduce and test

```bash
bash scripts/check.sh
cd apps/web
npx playwright install chromium
npm run test:e2e
```

The test suite starts the loopback API, development UI on port 3000 and production UI on port 3100. Stop manually running servers before isolated browser tests. Tests cover all 15 browser rules against the Python baseline, source integrity, both Bedrock transport profiles with mocked AWS responses, failures, exports and desktop/mobile viewport behavior. See [verification](docs/VERIFICATION.md) for actual results and remaining limits.

After deliberate rule or schema changes:

```bash
.venv/bin/python scripts/generate_showcase.py
npm --prefix apps/web run generate:types
```

Generation creates new actual static run IDs and timestamps. The `--check` option compares committed reports against the engine without changing recorded metadata. `uv.lock` is the Python dependency source of truth; `requirements-dev.lock` is its pip-compatible export. JavaScript uses `apps/web/package-lock.json`. Fonts are bundled locally through Fontsource.

## Architecture and semester roadmap

| Component | Responsibility |
| --- | --- |
| `apps/web` | Next.js UI, browser static scanner, Bedrock server route, validation and export |
| `services/audit-api` | Local FastAPI boundary and bounded single-model Bedrock adapter |
| `packages/audit-core` | Preserved Python static baseline and evidence-bound schema |
| `contracts/fixtures/originals` | Five unchanged historical teaching contracts |
| `evaluations` | Regression cases and planned reliability evaluation |
| `docs` | Architecture, provenance, API setup, limitations and verification |

1. **Foundation:** portable workbench, browser/static baseline, restored single-model review, GitHub and Vercel publication.
2. **Model baselines:** verify approved model access and collect comparable single-model outputs.
3. **Multi-agent analysis:** three independent analyses plus a separate orchestration/adjudication role; preserve disagreements.
4. **Evidence and review:** isolated compiler/static tools, asset/control context and human-review records.
5. **Reliability evaluation:** held-out reviewed data, benign controls, ablations, precision/recall, latency and cost.
6. **Portfolio cases:** reproducible findings and evidence-backed contribution records.

Application-managed orchestration and Amazon Bedrock Agents managed collaboration are different designs. The choice is a semester architecture decision. Model agreement alone is not validation.

## Project context

This repository documents a Duke FinTech capstone associated with the DTCC project. The DTCC logo was supplied for the interface by the project owner; DTCC trademarks remain with their owner. Repository publication does not imply a production product or security certification. No repository-wide license is assigned to inherited materials; see [provenance](docs/PROVENANCE.md).

## Platform overview and help

Open **Documentation** in the workspace for the [platform overview PDF](apps/web/public/docs/DTCC_Platform_Overview.pdf).
It introduces the background, platform functions, risk coverage and evidence review without a project timeline.
**Analysis method** and **Report details** open workspace dialogs; **Local setup** opens the same-site `/guide` page.
Desktop layouts fit the viewport, with a **Focus** control for additional code and results space.
On small screens, findings follow the source in a natural page flow.
See [PDF authoring notes](docs/PLATFORM_DOCUMENTATION.md) for reproducible document updates.
