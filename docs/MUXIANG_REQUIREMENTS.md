# Requirements and implementation map

This maps the supplied **Multi-Agent AI** slides to the implemented smart-contract review workflow. The slide deck is the design reference; the code and its verification results determine the platform's actual capabilities.

| Reference | Requirement | Implementation | Verification entry point |
| --- | --- | --- | --- |
| Multi-Agent AI Framework | Three specialized agents contribute to an orchestration layer | Fixed GPT-6 Astra, Claude Opus 5.5 and Grok 4.7 reviewers; deterministic scheduling, validation and report consolidation | `apps/web/src/server/bedrock.ts`; `tests/bedrock*.spec.ts` |
| Framework: input, LLM, tools, memory, output | Explicit orchestration components | Input is a source snapshot; the existing reviewers provide LLM judgment; tools are bounded review calls and evidence validators; memory is the immutable report plus tab-scoped history; output is an auditable unified report | `src/lib/orchestration.ts`; `src/lib/final-report.ts`; `src/lib/evaluation.ts` |
| Two Iterations: first pass | Send the same code independently to all three agents | No static findings or peer reports in first-pass prompts; accepted original contributions retained | `tests/bedrock-server.spec.ts`; `tests/orchestration.spec.ts` |
| Two Iterations: targeted second pass | Give a model code and findings reported by peers but not by that model | Per-model candidate assignments; no call for an empty assignment; failed first-pass models remain unavailable | `src/lib/second-review.ts`; `src/server/second-review.ts`; `tests/second-review*.spec.ts` |
| Two Iterations: consensus remarks | Consolidate all findings and show which models identified or agreed with each | All first-pass findings remain in the final report, with first-round discoverers, second-round judgments, coverage, outstanding issues and separate severity alignment | `src/lib/final-report.ts`; `src/lib/second-review-export.ts`; final-report UI |
| Meeting requirement: severity differences | Make substantive differences inspectable | Explicit extension: severity-disputed findings are reassessed by the successful reviewers, including original discoverers; withdrawal remains possible for assigned claims | Second-review plan and summary regression tests |
| Framework: reduce false positives and false negatives | Evaluate quality rather than infer it from agreement | Source- and baseline-bound human labels; reference issue inventory; paired before/after metrics only when review conditions are satisfied | `src/lib/evaluation-adjudication.ts`; `tests/evaluation*.spec.ts` |
| Meeting requirement: execution reliability | Bounded retry, time limits and resource controls | Up to three attempts per model within one absolute deadline; partial results retained; no unlimited debate | `src/server/bedrock-transport.ts`; transport and server tests |
| Security Architecture Review | Consider trust boundaries and reuse | Architecture review of this platform's browser, application and AWS boundaries; the restaurant/IoT diagram illustrates another domain, not an implemented product feature | [Architecture](ARCHITECTURE.md); [limitations](LIMITATIONS.md) |

Paths in the table are relative to `apps/web/` where prefixed with `src/` or `tests/`. Test files use simulated responses unless explicitly stated otherwise in [verification](VERIFICATION.md).

Open **Reference cases → DAO Treasury** to review the supplied contract independently of the five original test cases. The goal is to inspect what the agents report, including a possible empty result; no planted risk or expected model decision is assigned.

## Decisions made explicit

The orchestration controller is application code. It invokes the existing LLM reviewers for typed judgments; it is not a fourth autonomous model, an Amazon Bedrock managed Agents deployment or persistent agent memory. The framework's LLM/tools/memory labels describe roles; they do not require a new provider account. This preserves the three-model comparison and an inspectable, bounded control plane.

The second iteration is targeted at peer omissions. A model's failure or an omitted finding is not a rejection. Original support remains labeled as first-round evidence when that model is not assigned a new judgment. Severity disagreement is a separately documented extension, not an excuse to rescan every model on every claim. Claims beyond the bounded queue remain visible as deferred.

## JEV reading: the adopted principle

The [TypeSafe introduction to System One Models and JEV](https://typesafe.ai/blog/introducing-system-one-models-and-jev) motivates typed decisions that software can consume. The platform applies that principle with explicit decision enums, strict schema checks, source-evidence checks and an `uncertain` outcome. It does not add JEV as a provider or claim that its own model responses have calibrated probabilities.

Schema validity is different from semantic correctness. Exact source matching shows that cited code exists; it does not establish exploitability. A higher agreement score after shared context is not independent confirmation or measured accuracy.

## Scope of the architecture review

The source and peer reports are untrusted input. They cannot select arbitrary endpoints, execute source code, alter the review schema or change retry limits. API keys stay out of prompts and exported reports. Public HTTPS routes, fixed AWS destinations, request-size limits, controlled retries and source-bound outputs form the main review boundaries.

The platform does not compile a complete project, resolve dependencies, execute exploits, validate an arbitrary cloud architecture or certify digital assets. Extending to another domain requires its own input schema, evidence validators and independently reviewed evaluation cases.
