"""Build the three-page written orchestration brief with ReportLab 4.4.9.

The committed PDF needs no runtime authoring dependency or external font fetch.
Run: python3 scripts/build_orchestration_design.py
"""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps/web/public/docs/DTCC_Orchestration_Design.pdf"
W, H = 595.28, 841.89
M = 44
WIDTH = W - 2 * M
GREEN = colors.HexColor("#063E31")
INK = colors.HexColor("#19382D")
MUTED = colors.HexColor("#5A6D63")
LINE = colors.HexColor("#CCDAD0")
PALE = colors.HexColor("#F0F5EF")
WHITE = colors.white

for name, filename in [
    ("Manrope", "Manrope-Regular.ttf"),
    ("Manrope-Semibold", "Manrope-Semibold.ttf"),
]:
    pdfmetrics.registerFont(TTFont(name, ROOT / "docs/assets" / filename))
pdfmetrics.registerFontFamily(
    "Manrope",
    normal="Manrope",
    bold="Manrope-Semibold",
    italic="Manrope",
    boldItalic="Manrope-Semibold",
)

STYLES = {
    "title": ParagraphStyle(
        "title",
        fontName="Manrope-Semibold",
        fontSize=24,
        leading=30,
        textColor=GREEN,
        spaceAfter=12,
    ),
    "subtitle": ParagraphStyle(
        "subtitle", fontName="Manrope", fontSize=11, leading=16, textColor=MUTED, spaceAfter=17
    ),
    "body": ParagraphStyle(
        "body", fontName="Manrope", fontSize=10.2, leading=15.1, textColor=INK, spaceAfter=10
    ),
    "section": ParagraphStyle(
        "section",
        fontName="Manrope-Semibold",
        fontSize=12,
        leading=17,
        textColor=GREEN,
        spaceBefore=10,
        spaceAfter=8,
    ),
    "small": ParagraphStyle(
        "small", fontName="Manrope", fontSize=8.8, leading=12.5, textColor=MUTED, spaceAfter=7
    ),
    "cell": ParagraphStyle(
        "cell", fontName="Manrope", fontSize=9.1, leading=13, textColor=INK, alignment=TA_LEFT
    ),
    "head": ParagraphStyle(
        "head", fontName="Manrope-Semibold", fontSize=9, leading=12, textColor=WHITE
    ),
}


def para(value, style="body"):
    return Paragraph(value, STYLES[style])


def table(headers, rows, widths):
    data = [[para(h, "head") for h in headers]]
    data += [[para(cell, "cell") for cell in row] for row in rows]
    t = Table(data, colWidths=widths, hAlign="LEFT", repeatRows=1)
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), GREEN),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [PALE, WHITE]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
                ("LINEBELOW", (0, 1), (-1, -1), 0.5, LINE),
            ]
        )
    )
    return t


def page_chrome(c, doc):
    c.saveState()
    c.setFillColor(GREEN)
    c.rect(0, H - 6, W, 6, stroke=0, fill=1)
    c.rect(0, 0, W, 6, stroke=0, fill=1)
    c.drawImage(
        str(ROOT / "apps/web/public/dtcc-logo.png"),
        M,
        H - 48,
        width=88,
        height=22,
        preserveAspectRatio=True,
        mask="auto",
    )
    c.setFillColor(GREEN)
    c.setFont("Manrope-Semibold", 8)
    c.drawRightString(W - M, H - 39, "DIGITAL ASSET SECURITY / DESIGN BRIEF")
    c.setStrokeColor(LINE)
    c.setLineWidth(0.6)
    c.line(M, H - 63, W - M, H - 63)
    c.line(M, 39, W - M, 39)
    labels = [
        "INDEPENDENCE & RECONSIDERATION",
        "EXECUTION & DECISION CONTRACT",
        "PAIRED EVALUATION & REVIEW",
    ]
    section = labels[min(doc.page - 1, 2)]
    c.setFont("Manrope", 8)
    c.setFillColor(MUTED)
    c.drawString(M, 24, section)
    c.drawRightString(W - M, 24, f"{doc.page:02d} / 03")
    c.bookmarkPage(f"design-{doc.page}")
    c.addOutlineEntry(section.title(), f"design-{doc.page}", 0)
    c.restoreState()


story = [
    para("Orchestration design", "title"),
    para(
        "Multi-Agent AI for Smart Contract Audit<br/>and Cybersecurity Risk Assessment", "subtitle"
    ),
    para(
        "<b>Workspace flow.</b> Run Bedrock Review, inspect Findings, then open Second Review and select Run Second Review. Final Report follows an accepted second-round result or a stated reason that no review is eligible. No second round starts automatically."
    ),
    para(
        "GPT-6 Astra, Claude Opus 5.5 and Grok 4.7 provide judgments through Amazon Bedrock. A deterministic supervisor schedules their work, validates evidence and consolidates outputs. It adds no fourth model."
    ),
    para("Two iterations. Traceable assignments.", "section"),
    table(
        ["Stage", "Input and responsibility", "Retained output"],
        [
            [
                "1. Independent review",
                "Same numbered source and prompt variant. No static findings or peer answers.",
                "Original findings, execution outcomes and independent agreement.",
            ],
            [
                "2. Targeted plan",
                "Select up to 12 queued claims. Assign peer findings a reviewer omitted; also reassess severity disputes.",
                "Exact IDs per model, unassigned reviewers and deferred claims.",
            ],
            [
                "3. Second Review",
                "Explicit user action sends source and assignments. Empty assignments make no call; failed initial models remain unavailable.",
                "Support, rejection or uncertainty, with rationale and exact evidence.",
            ],
            [
                "4. Final Report",
                "Read risk explanations and actions first; expand model judgments and evidence. Preserve both original rounds.",
                "First discoverers, later decisions, coverage and separate severity alignment.",
            ],
        ],
        [106, 215, WIDTH - 321],
    ),
    Spacer(1, 10),
    para("Typed decisions, not automatic truth", "section"),
    para(
        "The JEV reading motivates constrained decisions. A stable 12-slot grammar holds assigned judgments and null unused slots. The server validates every slot before binding original claim IDs. All models cite source spans; exact text is retrieved after validation."
    ),
    para(
        "Peer omissions are the primary assignment rule; severity reassessment is an extension. Failed reassessment retains a valid original opinion and severity as first-round evidence, with pending work explicit. It adds no new vote.",
        "small",
    ),
    PageBreak(),
    para("A bounded decision process", "title"),
    para("One final view, with original evidence and later judgments kept distinct.", "subtitle"),
    table(
        ["Effective positions across three models", "Final disposition"],
        [
            [
                "All three support, using labeled first- or second-round evidence",
                "Supported; severity differences and pending reassessment still require review",
            ],
            ["All three explicitly do not support", "Not supported"],
            [
                "Missing, mixed or uncertain judgments, or deferred work",
                "Unresolved; retain for human review",
            ],
        ],
        [WIDTH * 0.63, WIDTH * 0.37],
    ),
    Spacer(1, 9),
    para(
        "Final Report retains the last valid opinion. An accepted second-round decision supersedes it; a failed reassessment preserves original evidence and remains pending. Partial execution is shown explicitly. Cancelled requests without a report do not unlock Final Report."
    ),
    para("Execution contract", "section"),
    table(
        ["Boundary", "Enforced limit"],
        [
            ["Model / pass", "Up to 3 attempts; 660 seconds locally or 270 seconds on Vercel"],
            [
                "Server request",
                "720 seconds locally or 285 seconds on Vercel; separate requests per pass",
            ],
            [
                "Second-round work",
                "One round; up to 12 claims; only nonempty assignments to successful first-pass models",
            ],
            ["Provider calls", "Up to 9 per pass; 18 per contract; 90 for five paired cases"],
        ],
        [130, WIDTH - 130],
    ),
    Spacer(1, 9),
    para(
        "Only an explicit output-token stop can raise the allowance from 32,768 to 65,536. The incomplete reply is discarded. Service retries and evidence correction share the same remaining attempts. Cancellation, refusal and access errors are terminal. Accepted peers are never rerun."
    ),
    para(
        "Second Review uses the exact baseline; hashes are not signatures. A stable native schema avoids assignment-count changes; latency is not guaranteed. Grok uses medium effort. Keys stay in tab/request memory. Accepted AWS work may be billed; guards are not global quotas.",
        "small",
    ),
    PageBreak(),
    para("Evaluate the same evidence", "title"),
    para(
        "Pair each second round with its exact baseline. DAO Treasury can run separately; the five-case benchmark stays fixed.",
        "subtitle",
    ),
    table(
        ["Question", "Required evidence"],
        [
            [
                "Does it execute?",
                "Completion, attempts, validation failures, latency, available usage and unstarted work.",
            ],
            [
                "Did opinions change?",
                "Same claim and baseline; original discovery versus later support, rejection or uncertainty.",
            ],
            [
                "Are findings correct?",
                "Human labels tied to source and baseline: confirmed, refuted, uncertain or unreviewed.",
            ],
            [
                "What was missed?",
                "A complete reviewed issue inventory, including issues absent from every model report.",
            ],
            [
                "Did review regress?",
                "New false positives and lost true findings alongside any gains; retain coverage gaps.",
            ],
        ],
        [130, WIDTH - 130],
    ),
    Spacer(1, 10),
    para("Practical evaluation", "section"),
    para(
        "<b>1.</b> Open Review settings for five-case validation. Select its own follow-up setting and run sequentially. Export all outcomes, including filtered, failed, skipped and deferred work."
    ),
    para(
        "<b>2.</b> Review distinct root causes and locations independently of model agreement. Import source-bound adjudication data; leave uncertain or unreviewed claims explicit."
    ),
    para(
        "<b>3.</b> Compare eligible paired counts. The final view's retained opinions do not count as successful second-round judgments. Precision requires reviewed predictions; recall also requires a complete issue inventory."
    ),
    para(
        "The final report supports risk triage and traceability in existing security workflows. Higher agreement alone is not improved accuracy. These five teaching fixtures are not a held-out benchmark; simulated tests establish implementation behavior, not live model quality.",
        "small",
    ),
    para(
        '<link href="https://typesafe.ai/blog/introducing-system-one-models-and-jev">JEV reading</link>  |  <link href="https://dtcc-multi-agent-audit.vercel.app/documentation">Documentation</link>  |  <link href="https://dtcc-multi-agent-audit.vercel.app/docs/DTCC_Platform_Overview.pdf">Platform overview</link>',
        "small",
    ),
]
OUT.parent.mkdir(parents=True, exist_ok=True)
doc = SimpleDocTemplate(
    str(OUT),
    pagesize=(W, H),
    leftMargin=M,
    rightMargin=M,
    topMargin=80,
    bottomMargin=50,
    title="DTCC | Orchestration design",
    author="Chao Li | Duke FinTech",
    subject="Independent smart contract review and bounded peer-informed reconsideration",
    creator="DTCC audit workspace | design documentation",
    invariant=1,
)
doc.build(story, onFirstPage=page_chrome, onLaterPages=page_chrome)
print(OUT)
