# Platform documentation

The workspace's **Documentation** link opens the same-site, four-page PDF at
`/docs/DTCC_Platform_Overview.pdf`. It is included in the repository and served
by both Next.js locally and Vercel. No external document host is required.

The brief covers project background, platform capabilities, representative
risk classes and evidence/report interpretation. It uses the supplied summer
presentation for context and the implemented application for capability
claims. The supplied consulting case informs the typographic hierarchy,
alignment and tables only. It contains no timeline, development status,
unverified performance figures or claims that multi-model review is active.

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
embedded fonts and PDF section bookmarks. Review all four rendered pages after
content changes. The source script and font assets are committed so the PDF can
be reproduced without downloading fonts or accessing the original uploads.

The font instances under `docs/assets` derive from the same pinned Manrope and
IBM Plex Mono packages used by the site. Their notices are in
`docs/assets/FONT-LICENSES.txt`. The supplied DTCC logo remains unchanged.
