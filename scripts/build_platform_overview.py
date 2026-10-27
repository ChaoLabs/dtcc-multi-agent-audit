"""Build the eight-page platform brief (authoring dependency: reportlab 4.4.9).

Run from any directory: python scripts/build_platform_overview.py
The generated PDF is committed so normal web builds need no PDF dependencies.
Capability claims follow the implemented browser and Bedrock review workflow.
The supplied presentation informs context and the consulting case informs layout only.
"""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps/web/public/docs/DTCC_Platform_Overview.pdf"
W, H = 900, 600
M = 44
WIDTH = W - 2 * M
PAGES = 8
GREEN = colors.HexColor("#063E31")
INK = colors.HexColor("#19382D")
MUTED = colors.HexColor("#5A6D63")
LINE = colors.HexColor("#CCDAD0")
PALE = colors.HexColor("#F0F5EF")
MINT = colors.HexColor("#D2E8D9")
WHITE = colors.white

OUT.parent.mkdir(parents=True, exist_ok=True)
for name, file in [
    ("Manrope", "Manrope-Regular.ttf"),
    ("Manrope-Semibold", "Manrope-Semibold.ttf"),
    ("PlexMono", "IBMPlexMono-Regular.ttf"),
]:
    pdfmetrics.registerFont(TTFont(name, ROOT / "docs/assets" / file))
pdfmetrics.registerFontFamily(
    "Manrope",
    normal="Manrope",
    bold="Manrope-Semibold",
    italic="Manrope",
    boldItalic="Manrope-Semibold",
)
c = canvas.Canvas(str(OUT), pagesize=(W, H), pageCompression=1, invariant=1)
c.setTitle("Multi-Agent AI for Smart Contract Audit and Cybersecurity Risk Assessment")
c.setAuthor("Chao Li | Duke FinTech")
c.setSubject("Platform capabilities, independent model review and evidence orchestration")
c.setCreator("DTCC audit workspace | platform documentation")


def box(x, y, w, h, color):
    c.setFillColor(color)
    c.rect(x, H - y - h, w, h, stroke=0, fill=1)


def rule(y, x=M, w=WIDTH, color=LINE, thickness=0.6):
    c.setStrokeColor(color)
    c.setLineWidth(thickness)
    c.line(x, H - y, x + w, H - y)


def text(value, x, y, w, size=11, color=INK, bold=False, leading=None):
    style = ParagraphStyle(
        "body",
        fontName="Manrope-Semibold" if bold else "Manrope",
        fontSize=size,
        leading=leading or size * 1.4,
        textColor=color,
        spaceAfter=0,
        allowWidows=0,
        allowOrphans=0,
    )
    p = Paragraph(value, style)
    _, h = p.wrap(w, H)
    assert y + h < (H - 10 if y >= 557 else H - 44), f"Text exceeds safe area: {value[:60]}"
    p.drawOn(c, x, H - y - h)
    return h


def label(value, x, y, w=WIDTH, color=MUTED):
    return text(value, x, y, w, size=8.5, color=color, bold=True, leading=11)


def header(number, section, title=None, subtitle=None):
    box(0, 0, W, 7, GREEN)
    box(0, H - 7, W, 7, GREEN)
    c.drawImage(
        str(ROOT / "apps/web/public/dtcc-logo.png"),
        M,
        H - 51,
        width=88,
        height=22,
        preserveAspectRatio=True,
        mask="auto",
    )
    label("DIGITAL ASSET SECURITY  /  PLATFORM OVERVIEW", 442, 34, 414, GREEN)
    rule(67)
    c.bookmarkPage(f"page{number}")
    c.addOutlineEntry(section, f"page{number}", level=0)
    if title:
        text(title, M, 91, WIDTH, 26, GREEN, True, 30)
    if subtitle:
        text(subtitle, M, 132, WIDTH, 11, MUTED)
    rule(557)
    label(section.upper(), M, 567, 650)
    text(f"{number:02d} / {PAGES:02d}", W - M - 45, 565, 45, 9, MUTED)


def table(y, headers, rows, widths, row_heights):
    assert sum(widths) == WIDTH
    assert len(headers) == len(widths)
    assert len(rows) == len(row_heights)
    x = M
    box(M, y, WIDTH, 29, GREEN)
    for heading, width in zip(headers, widths, strict=True):
        text(heading, x + 10, y + 8, width - 20, 9, WHITE, True, 12)
        x += width
    y += 29
    for row_index, (row, height) in enumerate(zip(rows, row_heights, strict=True)):
        if row_index % 2 == 0:
            box(M, y, WIDTH, height, PALE)
        x = M
        for i, (value, width) in enumerate(zip(row, widths, strict=True)):
            used = text(
                value,
                x + 10,
                y + 8,
                width - 20,
                10 if i else 10.5,
                INK if i == 0 else MUTED,
                i == 0,
                14,
            )
            assert used + 16 <= height, (value, used, height)
            x += width
        y += height
        rule(y)
    return y


def connector(points, arrow=False):
    c.setStrokeColor(colors.HexColor("#8EAA99"))
    c.setLineWidth(0.9)
    path = c.beginPath()
    path.moveTo(points[0][0], H - points[0][1])
    for x, y in points[1:]:
        path.lineTo(x, H - y)
    c.drawPath(path)
    if arrow:
        x, y = points[-1]
        c.line(x - 3, H - y + 4, x, H - y)
        c.line(x + 3, H - y + 4, x, H - y)


def link_card(x, y, width, title, display, url):
    box(x, y, width, 84, PALE)
    label(title, x + 14, y + 14, width - 28, GREEN)
    text(display, x + 14, y + 34, width - 28, 9.5, MUTED, leading=14)
    c.linkURL(url, (x, H - y - 84, x + width, H - y), relative=0, thickness=0)


# 1. Context and the platform's decision-support purpose.
header(1, "Context & purpose")
text(
    "Multi-Agent AI for Smart Contract Audit<br/>and Cybersecurity Risk Assessment",
    M,
    90,
    WIDTH,
    27,
    GREEN,
    True,
    32,
)
text(
    "Investigate smart contract risks through reproducible checks, independent model reviews and source-linked evidence.",
    M,
    167,
    WIDTH,
    12,
    MUTED,
    leading=17,
)
rule(215, color=GREEN, thickness=1)
col = (WIDTH - 48) / 3
for i, (kicker, title, body) in enumerate(
    [
        (
            "THE CONTEXT",
            "Code governs the asset",
            "Smart contracts encode permissions, transfers and interactions in digital asset workflows. A defect in those controls can affect custody, transaction integrity or availability.",
        ),
        (
            "THE REVIEW PROBLEM",
            "A finding needs evidence",
            "A recognizable pattern may be benign in context. Model explanations may disagree. Reviewers need the relevant source, the reasoning behind each claim and a record of differences.",
        ),
        (
            "THE PLATFORM RESPONSE",
            "Make findings inspectable",
            "Combine an independent static baseline with three model reviews. Validate cited source evidence, reconcile compatible findings and preserve the original contributions for review.",
        ),
    ]
):
    x = M + i * (col + 24)
    label(kicker, x, 236, col, GREEN)
    text(title, x, 258, col, 17, GREEN, True, 21)
    text(body, x, 294, col, 11, MUTED, leading=16)
label("CONNECT TECHNICAL FINDINGS TO DIGITAL ASSET EXPOSURE", M, 402, WIDTH, GREEN)
table(
    426,
    ["Review question", "Potential exposure", "Evidence to inspect"],
    [
        [
            "Who can change or move value?",
            "Unauthorized actions or asset transfers",
            "Caller checks, state changes and recipients",
        ],
        [
            "What happens across a contract call?",
            "Repeated withdrawals or inconsistent state",
            "Call order, state updates and return values",
        ],
        [
            "Which assumptions drive outcomes?",
            "Manipulated payouts or unavailable functions",
            "Inputs, timing, randomness and iteration",
        ],
    ],
    [254, 264, 294],
    [31, 31, 31],
)
c.showPage()

# 2. Complementary analysis modes and shared browser capabilities.
header(
    2,
    "Workspace & analysis modes",
    "One workspace. Two analysis modes.",
    "Prepare a single Solidity file, investigate candidate findings and export a source-linked report.",
)
col = (WIDTH - 28) / 2
for i, (kicker, title, body, detail) in enumerate(
    [
        (
            "STATIC ANALYSIS",
            "Run checks on-device",
            "15 pattern rules inspect the submitted source in the browser. No API key or backend is required.",
            "The source stays on-device in this mode. Results provide a reproducible baseline with matched lines and recommended review actions.",
        ),
        (
            "API ANALYSIS",
            "Compare independent reviews",
            "Three parallel model reviews, using one Bedrock key:<br/>GPT-6.1 Sol, Claude Opus 5.5 and Grok 4.7.",
            "The first pass reviews the source independently. An optional second review reconsiders selected claims with peer context.",
        ),
    ]
):
    x = M + i * (col + 28)
    box(x, 174, col, 171, PALE)
    label(kicker, x + 18, 191, col - 36, GREEN)
    text(title, x + 18, 211, col - 36, 18, GREEN, True)
    text(body, x + 18, 246, col - 36, 11, MUTED, leading=16)
    text(detail, x + 18, 302, col - 36, 9.5, MUTED, leading=13)
label("FROM SOURCE TO REVIEWABLE RESULTS", M, 366, WIDTH, GREEN)
table(
    387,
    ["Task", "Workspace interaction", "Review output"],
    [
        [
            "Prepare",
            "Upload .sol, edit source or choose a reference case",
            "A numbered source snapshot; focus view for inspection",
        ],
        [
            "Investigate",
            "Search; filter severity or model agreement; expand findings",
            "Rationale, source excerpt, model contributions and action",
        ],
        [
            "Document",
            "Jump to cited lines; open report details; download results",
            "Source provenance and JSON or Markdown exports",
        ],
    ],
    [118, 344, 350],
    [40, 40, 40],
)
text(
    "The hosted website supports the complete browser workflow. The same workspace can also run locally from the repository.",
    M,
    541,
    WIDTH,
    8.5,
    MUTED,
    leading=10,
)
c.showPage()

# 3. The actual source fan-out and deterministic application orchestrator.
header(
    3,
    "Independent first pass",
    "Independent reviews. Explicit orchestration.",
    "Three independent model tasks share bounded execution and one deterministic reconciliation process.",
)
source_x, source_w = 239, 422
box(source_x, 174, source_w, 47, PALE)
label("SHARED INPUT", source_x + 16, 183, source_w - 32, GREEN)
text(
    "Numbered source + selected prompt variant + output schema",
    source_x + 16,
    199,
    source_w - 32,
    9.5,
    MUTED,
    leading=13,
)
model_w = (WIDTH - 32) / 3
centers = [M + i * (model_w + 16) + model_w / 2 for i in range(3)]
connector([(W / 2, 221), (W / 2, 235)])
connector([(centers[0], 235), (centers[2], 235)])
for i, (name, provider) in enumerate(
    [("GPT-6.1 Sol", "OPENAI"), ("Claude Opus 5.5", "ANTHROPIC"), ("Grok 4.7", "XAI")]
):
    x = M + i * (model_w + 16)
    connector([(centers[i], 235), (centers[i], 247)], arrow=True)
    box(x, 248, model_w, 62, PALE)
    label(provider, x + 15, 260, model_w - 30, GREEN)
    text(name, x + 15, 279, model_w - 30, 17, GREEN, True, 22)
    connector([(centers[i], 310), (centers[i], 327)])
connector([(centers[0], 327), (centers[2], 327)])
connector([(W / 2, 327), (W / 2, 342)], arrow=True)
box(M, 344, WIDTH, 67, GREEN)
label("DETERMINISTIC ORCHESTRATOR  /  TYPESCRIPT APPLICATION LOGIC", M + 18, 357, WIDTH - 36, MINT)
text(
    "Bound execution. Validate evidence. Reconcile findings. Preserve differences.",
    M + 18,
    378,
    WIDTH - 36,
    14,
    WHITE,
    True,
    19,
)
for i, (title, body) in enumerate(
    [
        (
            "01  Supervise",
            "Enforce attempt and time limits. Retry eligible temporary failures once, retaining completed peer reviews.",
        ),
        (
            "02  Validate & reconcile",
            "Accept exact source evidence, then match compatible weaknesses. Keep ambiguous claims separate.",
        ),
        (
            "03  Preserve",
            "Retain individual model outcomes and original findings so reviewers can inspect each contribution.",
        ),
    ]
):
    x = M + i * (model_w + 16)
    text(title, x, 432, model_w, 12, GREEN, True, 17)
    text(body, x, 458, model_w, 10.5, MUTED, leading=15)
text(
    "First-pass prompts exclude static findings and peer answers. The optional second review is a separate, peer-informed stage.",
    M,
    536,
    WIDTH,
    8.5,
    MUTED,
    leading=11,
)
c.showPage()

# 4. Source binding, fixed-denominator support and severity interpretation.
header(
    4,
    "Evidence & agreement",
    "Evidence validation and model agreement",
    "Inspect what was checked, how many models support a claim and how its proposed severity was selected.",
)
col = (WIDTH - 30) / 2
rx = M + col + 30
label("SOURCE EVIDENCE ACCEPTANCE", M, 176, col, GREEN)
for i, (title, body) in enumerate(
    [
        (
            "Validate the response structure",
            "Required fields, allowed severity labels and content limits must satisfy the review schema.",
        ),
        (
            "Bind the evidence to the source",
            "The stated line range must be valid. The excerpt must reproduce those original source lines exactly, with at most 12 lines per finding.",
        ),
        (
            "Record the server's validation",
            "The server records source validation only after these checks pass. A model cannot certify its own evidence as verified.",
        ),
    ]
):
    y = 200 + i * 79
    text(f"0{i + 1}", M, y, 30, 11, GREEN, True)
    text(title, M + 37, y, col - 37, 11.5, GREEN, True, 16)
    text(body, M + 37, y + 24, col - 37, 10.5, MUTED, leading=15)
label("AGREEMENT-BASED CONFIDENCE", rx, 176, col, GREEN)
mini_w = (col - 20) / 3
for i, (support, confidence) in enumerate(
    [("1 / 3", "LOW"), ("2 / 3", "MEDIUM"), ("3 / 3", "HIGH")]
):
    x = rx + i * (mini_w + 10)
    box(x, 200, mini_w, 72, PALE)
    text(support, x + 12, 210, mini_w - 24, 22, GREEN, True, 26)
    label(confidence, x + 12, 247, mini_w - 24, GREEN)
text(
    "Each distinct supporting model counts once. Duplicate findings add no votes. Static matches and missing model results add no votes; the denominator remains three.",
    rx,
    288,
    col,
    10.5,
    MUTED,
    leading=15,
)
label("SEVERITY & DIFFERENCES", rx, 353, col, GREEN)
text(
    "The highest proposed severity is displayed. Severity differences and incomplete support identify claims to compare. First-pass agreement remains unchanged after any peer-informed second review.",
    rx,
    375,
    col,
    10.5,
    MUTED,
    leading=15,
)
box(M, 473, WIDTH, 57, PALE)
text(
    "A HIGH-severity finding may have LOW agreement (1 / 3 models).",
    M + 16,
    484,
    WIDTH - 32,
    12,
    GREEN,
    True,
    16,
)
text(
    "Severity expresses proposed impact; agreement expresses breadth of model support. Both remain available for review.",
    M + 16,
    507,
    WIDTH - 32,
    10,
    MUTED,
    leading=14,
)
text(
    "Source matching does not prove exploitability. Agreement is not a calibrated probability of correctness.",
    M,
    541,
    WIDTH,
    8.5,
    MUTED,
    leading=10,
)
c.showPage()

# 5. A peer-informed second review preserves independent first-pass evidence.
header(
    5,
    "Peer-informed second review",
    "Reconsider claims. Preserve the baseline.",
    "One optional round revisits selected queued claims; its decisions stay separate from independent agreement.",
)
text(
    "Successful first-pass reviewers inspect the same source and selected peer claims, including their own. Each returns support, rejection or uncertainty with rationale and exact source evidence.",
    M,
    174,
    WIDTH,
    12,
    MUTED,
    leading=17,
)
card_w = (WIDTH - 32) / 3
for i, (value, title, detail) in enumerate(
    [
        ("12 claims", "DETERMINISTIC SELECTION", "Remaining queue entries are deferred."),
        (
            "2+ reviewers",
            "FIRST-PASS ELIGIBILITY",
            "Only successful first-pass models participate.",
        ),
        ("1 round", "EXPLICIT SECOND REVIEW", "At most six additional provider requests."),
    ]
):
    x = M + i * (card_w + 16)
    box(x, 226, card_w, 84, PALE)
    text(value, x + 15, 239, card_w - 30, 21, GREEN, True, 26)
    label(title, x + 15, 273, card_w - 30, GREEN)
    text(detail, x + 15, 291, card_w - 30, 8.8, MUTED, leading=12)
table(
    332,
    ["Second-pass observation", "Peer-informed summary", "Meaning for the reviewer"],
    [
        [
            "All three support; same proposed severity",
            "Supported",
            "A shared position to inspect, not proof of exploitability",
        ],
        [
            "All three explicitly reject the claim",
            "Not supported",
            "A reconsidered claim, not a certified false positive",
        ],
        [
            "Mixed, uncertain, missing or deferred",
            "Unresolved",
            "Retain differences and incomplete coverage for human review",
        ],
    ],
    [287, 176, 349],
    [48, 48, 48],
)
text(
    "Original authors may withdraw claims. Two agreeing reviewers with a missing third still leave the claim unresolved.",
    M,
    518,
    WIDTH,
    10,
    GREEN,
    True,
    14,
)
text(
    "This stage reconsiders existing selected claims. It does not discover issues missed by every first-pass model or add independent votes.",
    M,
    541,
    WIDTH,
    8.5,
    MUTED,
    leading=10,
)
c.showPage()

# 6. Representative static coverage and the exported evidence record.
header(
    6,
    "Risk coverage & reporting",
    "Connect risk findings to an audit trail.",
    "Review recognizable source patterns, then retain the evidence and model context behind each result.",
)
col = (WIDTH - 30) / 2
rx = M + col + 30
label("REPRESENTATIVE STATIC RISK FAMILIES", M, 176, col, GREEN)
for i, (title, body) in enumerate(
    [
        (
            "Access control & custody",
            "tx.origin authorization, ownership changes and asset-transfer patterns.",
        ),
        (
            "External interactions",
            "Calls before balance updates, unchecked call/send results and caller-controlled callbacks.",
        ),
        (
            "Execution authority",
            "delegatecall and selfdestruct expressions, with their target and authorization assumptions.",
        ),
        (
            "Economic & time assumptions",
            "Block-data randomness, predictable game outcomes and timestamp-sensitive logic.",
        ),
        (
            "Configuration & availability",
            "Legacy or missing compiler declarations and potentially unbounded iteration.",
        ),
    ]
):
    y = 199 + i * 64
    text(title, M, y, col, 11.5, GREEN, True, 16)
    text(body, M, y + 23, col, 10.5, MUTED, leading=15)
    if i < 4:
        rule(y + 56, M, col)
label("PROVENANCE & REVIEW RECORD", rx, 176, col, GREEN)
for i, (title, body) in enumerate(
    [
        ("Source", "Filename and SHA-256 identify the analyzed source snapshot."),
        (
            "Run",
            "Source identity, prompt settings, execution limits and separate first/second-pass records.",
        ),
        (
            "Models",
            "Model identities, attempts, outcomes, timings and available token usage; failed-attempt usage may be unknown.",
        ),
    ]
):
    y = 199 + i * 61
    text(title, rx, y, 76, 11, GREEN, True, 16)
    text(body, rx + 88, y, col - 88, 10.5, MUTED, leading=15)
    rule(y + 47, rx, col)
label("EXPORT FOR FOLLOW-UP", rx, 391, col, GREEN)
text("JSON", rx, 414, 76, 11, GREEN, True)
text(
    "Static and first-pass records, validated reviews, optional second-pass decisions and provenance.",
    rx + 88,
    414,
    col - 88,
    10.5,
    MUTED,
    leading=15,
)
text("Markdown", rx, 474, 76, 11, GREEN, True)
text(
    "Readable findings, attempts and contributions, with before/after decisions when a second review exists.",
    rx + 88,
    474,
    col - 88,
    10.5,
    MUTED,
    leading=15,
)
text(
    "Review scope: one Solidity source file. Contracts are not compiled, imports are not resolved and exploits are not executed.",
    M,
    541,
    WIDTH,
    8.5,
    MUTED,
    leading=10,
)
c.showPage()

# 7. Bounded model execution and an explicit five-case prompt comparison.
header(
    7,
    "Execution & evaluation",
    "Bounded execution. Controlled evaluation.",
    "Inspect operational reliability on the same five contracts before drawing conclusions about detection quality.",
)
card_w = (WIDTH - 32) / 3
for i, (value, title, detail) in enumerate(
    [
        (
            "2 attempts",
            "PER MODEL / PASS, MAXIMUM",
            "One initial call plus one eligible transient retry.",
        ),
        (
            "180 seconds",
            "PER MODEL / PASS, ABSOLUTE",
            "210 seconds per server request. Retry time is included.",
        ),
        (
            "60 calls",
            "FIVE CASES WITH BOTH PASSES, MAXIMUM",
            "First pass only: 30 calls. Second review is optional.",
        ),
    ]
):
    x = M + i * (card_w + 16)
    box(x, 174, card_w, 104, PALE)
    text(value, x + 15, 188, card_w - 30, 22, GREEN, True, 27)
    label(title, x + 15, 222, card_w - 30, GREEN)
    text(detail, x + 15, 244, card_w - 30, 9.5, MUTED, leading=13)
col = (WIDTH - 30) / 2
rx = M + col + 30
label("FIRST-PASS PROMPT COMPARISON", M, 299, col, GREEN)
text("Standard prompt", M, 324, col, 12, GREEN, True, 17)
text(
    "Shared review instructions and output schema provide the baseline for all three models.",
    M,
    348,
    col,
    10.5,
    MUTED,
    leading=15,
)
text("Guided examples", M, 391, col, 12, GREEN, True, 17)
text(
    "Separate synthetic examples illustrate grounded claims and benign lookalikes. No reference-case answers or peer findings are supplied.",
    M,
    415,
    col,
    10.5,
    MUTED,
    leading=15,
)
label("FIVE-CASE VALIDATION", rx, 299, col, GREEN)
for i, (title, body) in enumerate(
    [
        (
            "01  Fix the conditions",
            "Choose a prompt variant and whether to include second review. Keep the five sources unchanged.",
        ),
        (
            "02  Run sequentially",
            "Pair each second review with its own first-pass report. Cancel to stop new work and keep completed records.",
        ),
        (
            "03  Export and compare",
            "Retain execution and before/after decisions. Human-reviewed labels are needed to assess quality.",
        ),
    ]
):
    y = 324 + i * 54
    text(title, rx, y, col, 11, GREEN, True, 15)
    text(body, rx, y + 18, col, 9.5, MUTED, leading=13)
box(M, 485, WIDTH, 48, PALE)
text(
    "A bounded retry addresses an eligible temporary error; it does not repair permissions or invalid evidence.",
    M + 14,
    495,
    WIDTH - 28,
    10.5,
    GREEN,
    True,
    15,
)
text(
    "Compare execution outcomes first. Quality claims require human-reviewed findings; model agreement is not accuracy.",
    M + 14,
    515,
    WIDTH - 28,
    9.5,
    MUTED,
    leading=13,
)
text(
    "Cancellation cannot reverse work already accepted by AWS. Returned token totals may omit usage from failed attempts.",
    M,
    541,
    WIDTH,
    8.5,
    MUTED,
    leading=10,
)
c.showPage()

# 8. Practical browser connection, outcome interpretation and useful destinations.
header(
    8,
    "Connection & use",
    "Connect, review and share from your browser.",
    "Use a valid Amazon Bedrock key with access to the three configured models in US East (N. Virginia).",
)
col = (WIDTH - 30) / 2
rx = M + col + 30
label("BROWSER WORKFLOW", M, 176, col, GREEN)
for i, (title, body) in enumerate(
    [
        (
            "Prepare your source",
            "Open a reference case, upload one .sol file or edit the source directly.",
        ),
        (
            "Add your Bedrock key",
            "Select API analysis, paste the complete key and choose Use API key. Adding it checks format; analysis verifies model access.",
        ),
        (
            "Run and inspect",
            "Choose Run API analysis, then inspect all three model outcomes, consolidated findings and original contributions.",
        ),
        (
            "Export and clear",
            "Download JSON or Markdown. Select Clear key or refresh the page to remove the active key from the tab.",
        ),
    ]
):
    y = 199 + i * 57
    label(f"0{i + 1}", M, y + 2, 27, GREEN)
    text(title, M + 35, y, col - 35, 11.5, GREEN, True, 16)
    text(body, M + 35, y + 20, col - 35, 10, MUTED, leading=14)
label("FIRST-PASS MODEL COVERAGE", rx, 176, col, GREEN)
for i, (status, detail) in enumerate(
    [
        ("Completed", "3 / 3 models returned validated reviews."),
        ("Partial", "1 or 2 succeeded. Their reviews remain available; failures stay explicit."),
        (
            "Failed",
            "No validated model review is available. The independent static baseline remains usable.",
        ),
    ]
):
    y = 199 + i * 49
    text(status, rx, y, 78, 11, GREEN, True, 16)
    text(detail, rx + 90, y, col - 90, 10, MUTED, leading=14)
    rule(y + 39, rx, col)
text(
    "Your key stays in this tab's memory and in server-request memory. API analysis sends the source and key through the site's server to AWS; your account's permissions and usage charges apply.",
    rx,
    354,
    col,
    10,
    MUTED,
    leading=14,
)
text(
    "A successful empty review, partial coverage or a completed run does not establish that a contract is safe.",
    rx,
    417,
    col,
    8.5,
    MUTED,
    leading=11,
)
card_w = (WIDTH - 32) / 3
for i, (title, display, url) in enumerate(
    [
        (
            "OPEN THE PLATFORM",
            "dtcc-multi-agent-audit.vercel.app",
            "https://dtcc-multi-agent-audit.vercel.app/",
        ),
        (
            "ORCHESTRATION DESIGN",
            "Independent review, reconsideration<br/>and evaluation - three-page brief",
            "https://dtcc-multi-agent-audit.vercel.app/docs/DTCC_Orchestration_Design.pdf",
        ),
        (
            "DOCUMENTATION",
            "Read and download both<br/>platform documents",
            "https://dtcc-multi-agent-audit.vercel.app/documentation",
        ),
    ]
):
    link_card(M + i * (card_w + 16), 457, card_w, title, display, url)
c.save()
print(OUT)
