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


story = []
story += [
    para("Orchestration design", "title"),
    para(
        "Multi-Agent AI for Smart Contract Audit<br/>and Cybersecurity Risk Assessment", "subtitle"
    ),
    para(
        "<b>Design objective.</b> Preserve independent evidence, give reviewers one controlled opportunity to reconsider disputed claims, and retain a transparent before/after record."
    ),
    para(
        "GPT-6.1 Sol, Claude Opus 5.5 and Grok 4.7 run through Amazon Bedrock. A deterministic TypeScript supervisor manages execution and validates reports. It does not add a fourth adjudicating model or use managed Bedrock Agents."
    ),
    para("One baseline. One optional reconsideration.", "section"),
    table(
        ["Stage", "Input and responsibility", "Retained output"],
        [
            [
                "1. Independent review",
                "Same numbered source and prompt variant for all three models. No static findings or peer answers.",
                "Source-bound original findings, model outcomes and independent agreement.",
            ],
            [
                "2. Queue selection",
                "Identify severity differences, non-reporting and unavailable coverage. Select the first 12 queued claims in stable order.",
                "Selected IDs, original contributions and explicitly deferred claims.",
            ],
            [
                "3. Second review",
                "At least two first-pass models must have succeeded. Those reviewers reconsider the same claims with peer context, including their own.",
                "Support, rejection or uncertainty with rationale and exact source evidence.",
            ],
            [
                "4. Separate summary",
                "Validate every assessment and derive a peer-informed summary. Preserve the first-pass snapshot unchanged.",
                "Before/after decisions, missing reviewers, failures and unresolved items.",
            ],
        ],
        [108, 211, WIDTH - 319],
    ),
    Spacer(1, 12),
    para("Why preserve the first pass?", "section"),
    para(
        "First-pass agreement is independent corroboration among model outputs, not a probability of correctness. Second-pass reviewers have seen peer claims, so their responses are correlated. Their decisions must not be added to the original votes or used to inflate the confidence display."
    ),
    para(
        "Scope: the second review reconsiders selected existing claims. It cannot discover a vulnerability missed by every first-pass model, recover a failed reviewer or automatically revisit unanimous unqueued findings.",
        "small",
    ),
    PageBreak(),
    para("A bounded decision process", "title"),
    para(
        "Explicit reviewer decisions, finite requests and separate records for each pass.",
        "subtitle",
    ),
    table(
        ["Second-pass evidence", "Derived summary"],
        [
            [
                "All three configured models support a claim and propose the same severity",
                "Supported after peer review",
            ],
            ["All three explicitly do not support the claim", "Not supported after peer review"],
            [
                "Mixed decisions, uncertainty, different severities, a missing reviewer or deferred work",
                "Unresolved",
            ],
        ],
        [WIDTH * 0.64, WIDTH * 0.36],
    ),
    Spacer(1, 11),
    para(
        "Two agreeing reviewers with a missing third remain unresolved. A reviewer may withdraw its own original claim. Neither a supported summary nor a rejected claim is a human-validated security conclusion."
    ),
    para("Execution budget", "section"),
    table(
        ["Boundary", "Enforced limit"],
        [
            ["Per model, per pass", "At most 2 attempts within one absolute 180-second deadline"],
            [
                "Per server request",
                "210 seconds inside a 240-second Vercel function; each pass is a separate request",
            ],
            [
                "Second review scope",
                "One round; at most 12 queued claims; only successful first-pass reviewers",
            ],
            ["Provider requests", "At most 6 per pass, or 12 for one contract with both passes"],
            [
                "Five-case batch",
                "First only: at most 30 calls / 20 minutes. With second review: 60 calls / 40 minutes.",
            ],
        ],
        [145, WIDTH - 145],
    ),
    Spacer(1, 11),
    para("Selective retry within the deadline", "section"),
    para(
        "Only explicit HTTP 429, 500, 502, 503 and 504 responses may receive one retry. Bounded backoff stays inside the original deadline. Authentication, permission, invalid evidence, malformed output, network ambiguity and local timeout failures are terminal. A retry never adds an independent vote."
    ),
    para(
        "The key stays in tab and active request memory. Cancellation stops new work but cannot reverse AWS work already accepted. Returned usage may omit failed attempts. In-memory guards are per runtime, not a distributed account quota or guaranteed dollar cap.",
        "small",
    ),
    PageBreak(),
    para("Evaluate the same evidence", "title"),
    para(
        "Keep the five existing contracts fixed. Pair every second review with its own original first-pass report.",
        "subtitle",
    ),
    para(
        "Enable <b>Include second review</b> in five-case validation to collect both stages. Each case runs sequentially; its first-pass record is the baseline for reconsideration. Keep failures, skipped reviews and deferred claims in the export. Run Standard and Guided examples as separate explicit experiments."
    ),
    para("Separate operational results from quality", "section"),
    table(
        ["Measure", "Evidence required"],
        [
            [
                "Execution reliability",
                "Model completion, attempts, errors, timeouts, elapsed time and available usage for each pass",
            ],
            [
                "Decision changes",
                "Same candidate ID and baseline; original support versus explicit second-pass support, rejection or uncertainty",
            ],
            [
                "False positives",
                "Human judgment that a reported claim is unsupported, followed by review of how the second pass treated it",
            ],
            [
                "Missed issues",
                "An independently reviewed issue inventory, including vulnerabilities absent from every model report",
            ],
            [
                "Regression risk",
                "Supported first-pass findings incorrectly rejected or obscured after reconsideration",
            ],
        ],
        [128, WIDTH - 128],
    ),
    Spacer(1, 12),
    para("Human review protocol", "section"),
    para(
        "<b>1.</b> Review each distinct root-cause/location claim before consulting the peer-informed summary. Mark it supported, unsupported or unresolved, with a reason."
    ),
    para(
        "<b>2.</b> Record the second-pass judgment separately. Preserve any disagreement between reviewers; do not treat a changed model opinion as ground truth."
    ),
    para(
        "<b>3.</b> Compare paired counts and execution outcomes, retaining skipped/deferred cases. A smaller finding count or greater agreement alone does not establish higher accuracy."
    ),
    para(
        "The five sources are teaching fixtures with informative comments, not a held-out benchmark. Automated tests verify implementation behavior with simulated provider responses. Live availability and quality improvements require authorized runs and reviewed labels.",
        "small",
    ),
    Spacer(1, 8),
    para(
        '<link href="https://dtcc-multi-agent-audit.vercel.app/">Open the platform</link>  |  <link href="https://dtcc-multi-agent-audit.vercel.app/documentation">Documentation</link>  |  <link href="https://dtcc-multi-agent-audit.vercel.app/docs/DTCC_Platform_Overview.pdf">Platform overview</link>',
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
