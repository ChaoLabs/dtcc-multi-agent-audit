# Multi-Agent AI for Smart Contract Audit and Cybersecurity Risk Assessment

**DTCC · Duke FinTech Capstone**

A Solidity security review workspace combining on-device static analysis with three independent AWS Bedrock model reviews, an optional peer-informed second review and bounded orchestration. It extends the summer *Agentic AI for Smart Contract Audit and Digital Asset Risk Management* project.

**[Open the platform](https://dtcc-multi-agent-audit.vercel.app/) · [Documentation](https://dtcc-multi-agent-audit.vercel.app/documentation) · [Connection guide](https://dtcc-multi-agent-audit.vercel.app/guide) · [Written design](docs/ORCHESTRATION_DESIGN.md)**

Documentation contains the eight-page platform overview and three-page orchestration design brief. Both PDFs can be read or downloaded directly from the website, using stable filenames without dates.

## Capabilities

- Paste, edit or upload a single Solidity file, or explore five preserved reference contracts.
- Run 15 static heuristics in the browser without credentials or a backend.
- Enter one Bedrock API key to run **GPT-6.1 Sol, Claude Opus 5.5 and Grok 4.7** concurrently. Each model reviews the same source independently.
- Reassess selected disputed claims in one explicit second round, preserving the independent first-pass report and each reviewer's change of position.
- Consolidate findings by canonical weakness and source location, with distinct-model votes, proposed severity, disagreement indicators and links to the original findings.
- Inspect source excerpts, search and filter findings, and export JSON or Markdown with source provenance and model outcomes.
- Preserve successful reviews when another model fails, with bounded transient retries, absolute deadlines and per-attempt outcomes.
- Compare standard instructions with guided in-context examples, then validate the same five reference contracts sequentially and export a reproducible run record.

The orchestration layer is application code. It does not invoke a fourth adjudicating model or use managed Amazon Bedrock Agents. Agreement describes corroboration among model outputs, not the probability that a vulnerability exists. Evidence matching checks source location, not exploitability. See [limitations](docs/LIMITATIONS.md).

## Run locally

Use Git, Node.js **24 LTS** (or Node 22.14+ within Node 22), and npm. Python is optional for the retained baseline service and Python checks.

```bash
git clone https://github.com/ChaoLabs/dtcc-multi-agent-audit.git
cd dtcc-multi-agent-audit
npm ci --prefix apps/web
npm --prefix apps/web run dev
```

Open [the workspace](http://127.0.0.1:3000). The hosted and local websites use the same workflow; visitors do not need a terminal to use the public platform.

## API analysis

Select **API analysis**, add a valid Bedrock key, then select **Run API analysis**. Generate a short-term key from the DTCC/DevX AWS session in **us-east-1**. A key can invoke all three models when its IAM identity has the required permissions. [Bedrock setup](docs/BEDROCK.md) explains the console steps and access requirements.

| Model | US inference profile |
| --- | --- |
| GPT-6.1 Sol | `us.openai.gpt-6.1-sol` |
| Claude Opus 5.5 | `us.anthropic.claude-opus-5-5` |
| Grok 4.7 | `us.xai.grok-4.7` |

Requests use Bedrock Converse through a same-origin Next.js server route. The first pass excludes static candidates and peer findings. The optional second pass deliberately shares selected first-pass claims and source evidence among the successful first-pass reviewers. Static analysis remains a separate view and does not vote in consensus.

Keys stay in the current tab's memory and active server request. Refresh or **Clear key** removes the browser connection. The application does not save keys in cookies, localStorage, a database, application logs or report exports. API analysis sends the source and key through the site's server to AWS. AWS permissions, logging settings and model charges belong to the key's account. Saving a key checks its format; successful model requests establish access.

## Vercel

| Setting | Value |
| --- | --- |
| Framework | Next.js |
| Root Directory | `apps/web` |
| Node.js | 24.x |
| Install / build | `npm ci` / `npm run build` |
| Output Directory | Framework default |
| Functions | Fluid compute; 240-second route duration |
| AWS environment variables | None required; visitors supply their own keys |

The browser never calls a visitor's localhost. Model requests have a 180-second deadline per model and a 210-second overall server deadline. Each model can make at most two attempts within the same deadline; only explicitly retryable upstream failures receive one automatic retry. Each pass makes at most six provider requests; an explicitly requested first-plus-second review makes at most twelve. The passes use separate server requests. See [deployment](docs/DEPLOYMENT.md).

## Verification

```bash
npm --prefix apps/web run verify
```

This runs web lint, type checks, formatting checks, unit/transport tests and a production build without Python. Tests exercise input and evidence validation, independent model dispatch, consolidation, failure handling and exports with synthetic or mocked model responses. They do not establish real DTCC account access or measure vulnerability-detection accuracy. Live acceptance requires an authorized key and successful responses from all three models.

For the legacy Python baseline and full browser suite:

```bash
bash scripts/setup.sh
bash scripts/check.sh
cd apps/web
npx playwright install chromium
npm run test:e2e
```

This extended workflow needs Python **3.12–3.14** as well as Node.js. Stop manually running development servers before isolated browser tests.

## Repository structure

| Path | Responsibility |
| --- | --- |
| `apps/web` | Next.js workspace, browser scanner, three-model transport, orchestration and reports |
| `services/audit-api` | Optional legacy FastAPI service with single-model review |
| `packages/audit-core` | Preserved Python static baseline and legacy schemas |
| `contracts/fixtures/originals` | Five unchanged historical teaching contracts |
| `evaluations` | Regression cases and reliability evaluation work |
| `docs` | Architecture, connection setup, methodology and provenance |

First-pass multi-model reports use schema **2.1.0**, with execution policy, prompt provenance and per-attempt outcomes. The optional second-review report is versioned separately and bound to the unchanged first-pass snapshot. Existing **2.0.0** reports remain readable. The original static and legacy Python contracts remain versioned separately. [Architecture](docs/ARCHITECTURE.md) describes the boundaries. The [evaluation protocol](docs/EVALUATION.md) keeps the five existing contracts fixed and separates execution reliability from human-reviewed detection quality; no measured accuracy gain is claimed.

## Project context and documentation

This repository documents a Duke FinTech capstone associated with the DTCC project. DTCC trademarks remain with their owner. Publication does not imply security certification. No repository-wide license is assigned to inherited materials; see [provenance](docs/PROVENANCE.md).

The workspace includes a [platform overview PDF](apps/web/public/docs/DTCC_Platform_Overview.pdf), a [three-page orchestration design brief](apps/web/public/docs/DTCC_Orchestration_Design.pdf), a same-site [guide](https://dtcc-multi-agent-audit.vercel.app/guide), report details and a focus layout. The [orchestration specification](docs/ORCHESTRATION.md) is the technical reference for the current multi-model implementation. See [PDF authoring notes](docs/PLATFORM_DOCUMENTATION.md) for document updates.
