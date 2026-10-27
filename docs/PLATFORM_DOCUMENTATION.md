# Platform documentation

The workspace's **Documentation** link opens the same-site `/documentation`
page. It presents the eight-page **Platform overview** and three-page
**Orchestration design**, with separate controls to open or download each PDF.
Both files are included in the repository and served by Next.js locally and
Vercel. No external document host is required. Document titles, displayed labels,
PDF body text and filenames contain no release dates.

The stable document URLs are `/docs/DTCC_Platform_Overview.pdf` and
`/docs/DTCC_Orchestration_Design.pdf`. Updates replace their content in place.

The brief covers project background, the two analysis modes, the three-model
review council, source-evidence validation, agreement and severity,
representative risk classes, report interpretation, bounded execution, optional
peer-informed second review, controlled five-case prompt comparison and browser
connection. Clickable links lead to the platform, documentation page and
companion orchestration design brief. The design brief links back to the platform
overview and documentation page.
The supplied summer presentation informs context; implemented behavior determines
capability claims. The supplied consulting case informs the typographic hierarchy,
alignment and tables only. It contains no timeline, development-status filler
or unverified performance figures.

The API workflow uses one visitor-provided Bedrock key for independent parallel
reviews by GPT-6.1 Sol, Claude Opus 5.5 and Grok 4.7. In the first pass, each
model receives the
same numbered source and formatting instructions; it does not receive static
findings or another model's answer. The second review deliberately shares selected
queued claims among successful first-pass reviewers and preserves the baseline.
Application logic validates source evidence
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
measured quality improvement. Second-pass decisions are peer-informed and never
added to independent first-pass agreement. Deferred, uncertain and missing-review
outcomes remain visible.

**Analysis method** opens an in-workspace explanation. **Report details** opens
the current source provenance in a dialog. **Local setup** and Bedrock's
**Connection guide** use the same-site `/guide` page. GitHub is reserved for the
explicit source-repository link.

## Written orchestration design

The separate three-page brief at `/docs/DTCC_Orchestration_Design.pdf` explains
first-pass independence, queue selection, one bounded reconsideration round,
reviewer decision rules, resource budgets and paired human evaluation. It is
available alongside the platform overview in Documentation, and is intended
for teammates to review the design without needing to read the code.
The Markdown source of the design is [ORCHESTRATION_DESIGN.md](ORCHESTRATION_DESIGN.md).

It makes no measured accuracy, hallucination-reduction or live availability
claim. A completed execution, an unsupported claim or higher agreement is not
substituted for human-reviewed vulnerability labels. Its three pages are A4
portrait; the platform overview retains the landscape DTCC layout.

## Rebuild the PDFs

Normal application setup does not require PDF authoring dependencies. To edit
and rebuild the brief, use a separate authoring environment:

```bash
python3 -m venv .venv-docs
.venv-docs/bin/python -m pip install reportlab==4.4.9
.venv-docs/bin/python scripts/build_platform_overview.py
.venv-docs/bin/python scripts/build_orchestration_design.py
```

The scripts write `apps/web/public/docs/DTCC_Platform_Overview.pdf` and
`apps/web/public/docs/DTCC_Orchestration_Design.pdf`, with embedded fonts and
section bookmarks. After content changes, render and inspect all eight overview
pages and all three design-brief pages. Source scripts and font assets are
committed so both PDFs can
be reproduced without downloading fonts or accessing the original uploads.

The font instances under `docs/assets` derive from the same pinned Manrope and
IBM Plex Mono packages used by the site. Their notices are in
`docs/assets/FONT-LICENSES.txt`. The supplied DTCC logo remains unchanged.
