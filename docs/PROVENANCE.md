# Provenance and contribution boundary

The user supplied two historical archives. The later `dtcc-project-main(2).zip` is the migration baseline; `Smart-Contract-Audit-AI-main.zip` is earlier reference material. Archive names identify user-provided inputs, not a public upstream license or independent authorship claim.

| Input | SHA-256 |
| --- | --- |
| Later archive | `0e807a1622683961ee8340038774f837957bd7a2510b8980579285f7b341ba85` |
| Earlier archive | `ad58974eec80c3c5a656c7454210c50f75276f46c137553c563c8d0f7e6657cc` |

## Carried forward

- `legacy_rules.py`: the later `audit_agent.py` helpers and `scan()` logic only. Cloud/CLI/Slither/ReAct execution was not imported. Imports and module description were narrowed; detector branding was changed to `legacy-static-rules`. Historical taxonomy fields and rule behavior remain internal for traceability.
- Five `.sol` files copied unchanged into `contracts/fixtures/originals`. Their original names/comments are retained for attribution. Compile-incompatible teaching code is not silently repaired.
- Regression expectations cover the inherited fixture behaviors. New tests exercise the new API/schema/UI, not the old Flask service or removed action parser.

## New in M0

Monorepo structure, source-bound Pydantic report model, rule adapter with uncertainty-aware language, FastAPI request boundary, generated web contract, Next.js interface, immutable report export, recorded showcase generation, reproducible setup and CI/browser-test configuration.

The new adapter omits inherited confidence and SWC/OWASP tags from published reports. It revises misleading `delegatecall`, `selfdestruct`, callback, randomness and asset-transfer explanations without pretending to improve the detector's semantic coverage.

## Workspace redesign and single-model restoration

The browser scanner ports the 15 inherited heuristics into TypeScript, with separate engine attribution and parity tests. Rule descriptions are generated from the Python source and adapter overrides. This preserves a comparable baseline; it does not claim a new detection algorithm.

The bounded Bedrock adapter restores the summer single-model review capability with structured validation and exact source binding. It replaces the unbounded text-action loop, silent fallback and model-result replacement behavior. Converse is the default; Mantle remains available for the prior endpoint profile. Multi-model orchestration is not implemented.

The owner supplied `886d6c31-55d8-4f75-8900-1de4e7f62c35.png`; `apps/web/public/dtcc-logo.png` is an unchanged byte copy. The white display treatment is CSS only. Manrope and IBM Plex Mono are served through Fontsource with the packages' bundled license files. Layout and SVG interface icons are repository code, not copied site assets. Visual references: [DTCC](https://www.dtcc.com/) and [Linear](https://linear.app/).

## Excluded

Historical credentials, personal onboarding or meeting records, databases, caches, virtual environments, archived ZIPs, obsolete UI branding, unbounded model loops and imports that initiate cloud requests.

## Publication gate

Confirm permission to redistribute the inherited scanner and fixture code before the first public push. User-provided access alone is not a documented license grant. No corporate endorsement or sole authorship of historical work is asserted. A repository-wide license is pending this confirmation; do not apply a blanket license to inherited material automatically.

The repo name identifies the DTCC project context, not ownership by DTCC. The owner should maintain a weekly contribution log that distinguishes inherited work, independent changes, collaborators' work and AI-assisted implementation.
