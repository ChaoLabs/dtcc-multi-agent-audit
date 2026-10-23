# Platform documentation

The workspace's **Documentation** link opens the same-site, seven-page PDF at
`/docs/DTCC_Platform_Overview.pdf`. It is included in the repository and served
by both Next.js locally and Vercel. No external document host is required.

The brief covers project background, the two analysis modes, the three-model
review council, source-evidence validation, agreement and severity,
representative risk classes, report interpretation, bounded execution, controlled five-case prompt comparison
and the browser connection workflow. Clickable links lead to the live platform, its connection guide and
the source repository.
It uses the supplied summer
presentation for context and the implemented application for capability
claims. The supplied consulting case informs the typographic hierarchy,
alignment and tables only. It contains no timeline, development-status filler
or unverified performance figures.

The API workflow uses one visitor-provided Bedrock key for independent parallel
reviews by GPT-6.1 Sol, Claude Opus 5.5 and Grok 4.7. Each model receives the
same numbered source and formatting instructions; it does not receive static
findings or another model's answer. Application logic validates source evidence
before assigning its validation annotation and reconciles matching findings
without a fourth model. The static baseline remains separate and never votes.
Agreement-based confidence records support from one, two or three distinct
models as low, medium or high, separately from severity. It is not a calibrated
probability or evidence of benchmarked accuracy. The highest proposed severity
is retained within a group, while severity disagreements, original
contributions and partial failures remain visible for review. A bounded supervisor
allows at most one retry per model for eligible transient responses, with unchanged
absolute deadlines. Standard and guided prompt variants are recorded with the
results; five-case validation runs sequentially and exports operational outcomes.
The examples are separate from the reference cases and do not establish a
measured quality improvement.

**Analysis method** opens an in-workspace explanation. **Report details** opens
the current source provenance in a dialog. **Local setup** and Bedrock's
**Connection guide** use the same-site `/guide` page. GitHub is reserved for the
explicit source-repository link.

## Rebuild the PDF

Normal application setup does not require PDF authoring dependencies. To edit
and rebuild the brief, use a separate authoring environment:

```bash
python3 -m venv .venv-docs
.venv-docs/bin/python -m pip install reportlab==4.4.9
.venv-docs/bin/python scripts/build_platform_overview.py
```

The script writes `apps/web/public/docs/DTCC_Platform_Overview.pdf`, including
embedded fonts and PDF section bookmarks. Review all seven rendered pages after
content changes. The source script and font assets are committed so the PDF can
be reproduced without downloading fonts or accessing the original uploads.

The font instances under `docs/assets` derive from the same pinned Manrope and
IBM Plex Mono packages used by the site. Their notices are in
`docs/assets/FONT-LICENSES.txt`. The supplied DTCC logo remains unchanged.
