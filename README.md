# Multi-Agent AI for Smart Contract Audit and Cybersecurity Risk Assessment

**DTCC · Duke FinTech Capstone**

A Solidity security review workspace combining on-device static analysis with three independent AWS Bedrock model reviews, an explicitly initiated peer-informed second review and bounded orchestration. It extends the summer *Agentic AI for Smart Contract Audit and Digital Asset Risk Management* project.

**[Open the platform](https://dtcc-multi-agent-audit.vercel.app/) · [Documentation](https://dtcc-multi-agent-audit.vercel.app/documentation) · [Connection guide](https://dtcc-multi-agent-audit.vercel.app/guide) · [Written design](docs/ORCHESTRATION_DESIGN.md)**

Documentation contains the eight-page platform overview and three-page orchestration design brief. Both PDFs can be read or downloaded directly from the website, using stable filenames without dates.

## Capabilities

- Paste, edit or upload a single Solidity file, or select one of the five preserved benchmark contracts or the supplemental **DAO Treasury** case.
- Use **Static Analysis** for 15 on-device static heuristics without credentials or a backend. The model workflow is **Bedrock Review → Findings → Second Review → Final Report**.
- Enter one Bedrock API key to run **GPT-6 Astra, Claude Opus 5.5 and Grok 4.7** concurrently. Each model reviews the same source independently.
- Select **Run Bedrock Review**, inspect the first-round **Findings**, then explicitly select **Run Second Review** for eligible differences. The second round never starts automatically. Preserve the first-pass record and every later judgment.
- Inspect one final report covering all original findings, including unanimous, unresolved, unreviewed and deferred claims, with first-round discoverers and second-round decisions clearly separated.
- Consolidate findings by canonical weakness and source location, with distinct-model votes, proposed severity, disagreement indicators and links to the original findings.
- Inspect source excerpts, search and filter findings, and export JSON or Markdown with source provenance and model outcomes.
- Preserve successful reviews when another model fails, with bounded transient retries, absolute deadlines and per-attempt outcomes.
- Compare standard instructions with guided in-context examples, validate the same five contracts sequentially, and retain/import bounded run history.
- Import source-bound human labels and a reviewed issue inventory to calculate eligible paired quality metrics; unlabeled results do not become accuracy scores.

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

## Bedrock Review

Choose an example, upload a file or paste code. Select **Bedrock Review**, add a valid Bedrock key, then select **Run Bedrock Review**. Inspect the first-round **Findings**, including evidence, model agreement and coverage. Select **Run Second Review** to reconsider eligible differences; it can add up to nine provider calls. After a validated second-round result, including a partial result, open **Final Report** to inspect the consolidated result and export both rounds. If no second review is eligible, the workspace explains why before making the final report available. Generate a short-term key from the DTCC/DevX AWS session in **us-east-1**. A key can invoke all three models when its IAM identity has the required permissions. [Bedrock setup](docs/BEDROCK.md) explains the console steps and access requirements.

| Model | US inference profile |
| --- | --- |
| GPT-6 Astra | `us.openai.gpt-6-astra` |
| Claude Opus 5.5 | `us.anthropic.claude-opus-5-5` |
| Grok 4.7 | `us.xai.grok-4.7` |

New reviews use Opus in both rounds. Earlier Fable and Sol reports keep their original model names and judgments. To request a new second round with the current models, start a fresh Bedrock Review.

**Run the Treasury example:** Open **Reference cases → DAO Treasury**, then **Run Static Analysis** or **Run Bedrock Review**. Inspect Findings, run Second Review if differences are eligible, and open Final Report. The supplied source is reviewed as a single file; OpenZeppelin imports are not resolved. Zero findings is a valid result. This example is outside the five-case benchmark.

Requests use Bedrock Converse through a same-origin Next.js server route. The first pass excludes static candidates and peer findings. The optional second pass assigns selected peer claims to successful reviewers that omitted them, plus severity-disputed claims to the successful reviewers. An empty assignment makes no model call. A failed first-pass model is not recovered by the follow-up: two completed assigned reviews still leave overall coverage at two of three. Static analysis remains a separate view and does not vote in consensus. Both rounds use model-selected source spans with application-resolved exact excerpts. The second-round native grammar uses twelve stable slots with explicit nulls for unused slots. Grok uses medium reasoning effort. An explicit output-token stop can trigger one new generation with a larger allowance; no truncated findings are accepted. Final Report leads with risk explanations and recommended actions; if reassessment fails, it retains valid original opinions and severity while marking that work pending. Retained evidence is not a new second-round vote.

Failure messages distinguish invalid credentials, permissions, service errors, rejected output and provider filtering. A `content_filtered` or `guardrail_intervened` result is terminal: the app does not retry or rewrite the input to get around it. Accepted peer results remain available. See [troubleshooting](docs/BEDROCK.md#troubleshooting). Prompt comparisons and five-case evaluation are under **Review settings**.

Keys stay in the current tab's memory and active server request. Refresh or **Clear key** removes the browser connection. The application does not save keys in cookies, localStorage, a database, application logs or report exports. API analysis sends the source and key through the site's server to AWS. AWS permissions, logging settings and model charges belong to the key's account. Saving a key checks its format; successful model requests establish access.

## Vercel

| Setting | Value |
| --- | --- |
| Framework | Next.js |
| Root Directory | `apps/web` |
| Node.js | 24.x |
| Install / build | `npm ci` / `npm run build` |
| Output Directory | Framework default |
| Functions | Fluid compute; 300-second route duration |
| AWS environment variables | None required; visitors supply their own keys |

Each model gets up to three attempts per round. Locally, one model can run for 660 seconds within a 720-second round. On Vercel the review uses shorter deadlines to fit a 300-second function. Each request starts with 32,768 output tokens; if Bedrock explicitly reports `max_tokens`, only that model can retry at 65,536 within its remaining attempts and time. A second truncation at the ceiling is terminal. Valid reviews are retained. See [deployment](docs/DEPLOYMENT.md) for the differences between local and hosted execution.

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

First-pass multi-model reports use schema **2.1.0**, with execution policy, prompt provenance and per-attempt outcomes. The optional second-review report uses schema **1.1.0** and is bound to the unchanged first-pass snapshot; historical **1.0.0** second-pass reports retain their original semantics. Existing **2.0.0** reports remain readable. The original static and legacy Python contracts remain versioned separately. [Architecture](docs/ARCHITECTURE.md) describes the boundaries. The [evaluation protocol](docs/EVALUATION.md) keeps the five existing contracts fixed and separates execution reliability from human-reviewed detection quality; no measured accuracy gain is claimed.

## Project context and documentation

This repository documents a Duke FinTech capstone associated with the DTCC project. DTCC trademarks remain with their owner. Publication does not imply security certification. No repository-wide license is assigned to inherited materials; see [provenance](docs/PROVENANCE.md).

The workspace includes a [platform overview PDF](apps/web/public/docs/DTCC_Platform_Overview.pdf), a [three-page orchestration design brief](apps/web/public/docs/DTCC_Orchestration_Design.pdf), a same-site [guide](https://dtcc-multi-agent-audit.vercel.app/guide), report details and a focus layout. The [orchestration specification](docs/ORCHESTRATION.md) is the technical reference for the current multi-model implementation. See [PDF authoring notes](docs/PLATFORM_DOCUMENTATION.md), the [Muxiang requirements map](docs/MUXIANG_REQUIREMENTS.md) and the [UI/code walkthrough](docs/DEMO_WALKTHROUGH.md).
