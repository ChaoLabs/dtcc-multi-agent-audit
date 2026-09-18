"""Build the standalone platform brief (optional authoring dependency: reportlab 4.4.9).

Run from any directory: python scripts/build_platform_overview.py
The generated PDF is committed so normal web builds need no PDF dependencies.
Content is based on the supplied summer presentation and the implemented platform.
The consulting case informs layout only; no case content or proprietary figures are reused.
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
GREEN = colors.HexColor("#063E31")
INK = colors.HexColor("#19382D")
MUTED = colors.HexColor("#5A6D63")
LINE = colors.HexColor("#CCDAD0")
PALE = colors.HexColor("#F0F5EF")
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
c.setSubject("Project background, platform capabilities and evidence-based review")
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
    label(section.upper(), M, 567, 560)
    text(f"{number:02d} / 04", W - M - 45, 565, 45, 9, MUTED)


def table(y, headers, rows, widths, row_heights):
    x = M
    box(M, y, WIDTH, 29, GREEN)
    for h, w in zip(headers, widths):
        text(h, x + 10, y + 8, w - 20, 9, WHITE, True, 12)
        x += w
    y += 29
    for row_index, (row, height) in enumerate(zip(rows, row_heights)):
        if row_index % 2 == 0:
            box(M, y, WIDTH, height, PALE)
        x = M
        for i, (v, w) in enumerate(zip(row, widths)):
            size = 10 if i else 10.5
            used = text(v, x + 10, y + 8, w - 20, size, INK if i == 0 else MUTED, i == 0, 14)
            assert used + 16 <= height, (v, used, height)
            x += w
        y += height
        rule(y)
    return y


# Page 1: a clear investment in source-level risk review, without unsupported metrics.
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
    "A source-review platform for identifying potential vulnerabilities, inspecting evidence and documenting security decisions.",
    M,
    167,
    WIDTH,
    12,
    MUTED,
    leading=17,
)
rule(215, color=GREEN, thickness=1)
col = (WIDTH - 48) / 3
sections = [
    (
        "THE CONTEXT",
        "Code governs the asset",
        "Smart contracts encode permissions, transfers and interactions in digital asset workflows. A defect in those controls can affect custody, transaction integrity or availability.",
    ),
    (
        "THE REVIEW PROBLEM",
        "A finding needs evidence",
        "A code pattern can be benign in context; a plausible AI explanation can still be wrong. Reviewers need the exact source, a clear rationale and a way to trace each claim.",
    ),
    (
        "THE PLATFORM RESPONSE",
        "Make findings inspectable",
        "Combine a reproducible static baseline with optional Bedrock reasoning. Preserve the source record and keep model findings identifiable for human review.",
    ),
]
for i, (k, t, b) in enumerate(sections):
    x = M + i * (col + 24)
    label(k, x, 236, col, GREEN)
    text(t, x, 258, col, 17, GREEN, True, 21)
    text(b, x, 294, col, 11, MUTED, leading=16)
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

# Page 2: browser and visitor-key API capabilities.
header(
    2,
    "Platform capabilities",
    "One workspace. Two analysis modes.",
    "Inspect a single Solidity file, investigate candidate findings and export a source-linked report.",
)
col = (WIDTH - 28) / 2
for i, (k, title, body, detail) in enumerate(
    [
        (
            "STATIC ANALYSIS",
            "Run checks on-device",
            "15 pattern rules examine the submitted source directly in the browser. No API key or backend is required.",
            "The public website and local workspace both support this mode. The source remains in the browser.",
        ),
        (
            "API ANALYSIS",
            "Add Bedrock reasoning",
            "Enter your Bedrock key in the website. Its server sends the source and static baseline to GPT-6 Astra.",
            "The user starts the request explicitly. Static and model findings remain distinct, and model evidence is checked before acceptance.",
        ),
    ]
):
    x = M + i * (col + 28)
    box(x, 174, col, 171, PALE)
    label(k, x + 18, 191, col - 36, GREEN)
    text(title, x + 18, 211, col - 36, 18, GREEN, True)
    text(body, x + 18, 246, col - 36, 11, MUTED, leading=16)
    text(detail, x + 18, 302, col - 36, 9.5, MUTED, leading=13)
label("WORKSPACE FUNCTIONS", M, 366, WIDTH, GREEN)
table(
    387,
    ["Task", "Interaction", "What the reviewer receives"],
    [
        [
            "Prepare the source",
            "Upload .sol, edit code or open a reference case",
            "A numbered source snapshot for inspection",
        ],
        [
            "Investigate findings",
            "Filter by severity, search and expand a finding",
            "Rationale, source evidence and recommended action",
        ],
        [
            "Inspect & share",
            "Jump to source lines; export JSON or Markdown",
            "Source hash, analysis metadata and accepted findings",
        ],
    ],
    [155, 317, 340],
    [40, 40, 40],
)
text(
    "API review uses your key through the website server. Keys stay in tab/request memory; AWS usage is charged to your account.",
    M,
    541,
    WIDTH,
    8.5,
    MUTED,
    leading=10,
)
c.showPage()

# Page 3: representative coverage; patterns do not establish exploitability.
header(
    3,
    "Risk coverage",
    "Prioritize risk. Preserve the context.",
    "The static baseline flags recognizable patterns. Each candidate still needs contextual review.",
)
table(
    174,
    ["Risk family", "Signals examined", "Questions for the reviewer"],
    [
        [
            "Access control & custody",
            "tx.origin authorization, ownership changes and asset-transfer patterns",
            "Who is permitted to act? Are recipients and state changes consistent with intended business rules?",
        ],
        [
            "External interactions",
            "Calls before balance updates, unchecked call/send results and caller-controlled callbacks",
            "Can control re-enter the contract? What state is visible? How are failures handled?",
        ],
        [
            "Execution authority",
            "delegatecall and selfdestruct expressions",
            "Who controls the target? What authorization, storage and chain-specific assumptions apply?",
        ],
        [
            "Economic & time assumptions",
            "Block-data randomness, predictable game outcomes and timestamp-sensitive logic",
            "Can a participant influence inputs, timing or payouts? What information is already public?",
        ],
        [
            "Configuration & availability",
            "Legacy or missing compiler declarations and potentially unbounded iteration",
            "Which compiler is intended? Can execution grow beyond a usable gas budget?",
        ],
    ],
    [175, 282, 355],
    [60, 60, 60, 60, 60],
)
text(
    "Severity is a proposed prioritization aid. A matched expression is not proof of an exploitable vulnerability.",
    M,
    521,
    WIDTH,
    10,
    MUTED,
)
c.showPage()

# Page 4: the source-to-finding contract and review boundaries.
header(
    4,
    "Evidence & reporting",
    "Every conclusion should be traceable.",
    "Read the claim, inspect the cited lines and assess the proposed action against the contract's intended behavior.",
)
left = 382
right = 402
rx = M + left + 28
label("ILLUSTRATIVE FINDING  /  STATIC", M, 176, left, GREEN)
text("External call before balance update", M, 198, left, 18, GREEN, True, 23)
text(
    "A call before the balance update can leave state exposed during an external interaction. The reviewer must determine whether re-entry is possible and economically meaningful.",
    M,
    255,
    left,
    11,
    MUTED,
    leading=16,
)
box(M, 326, left, 78, GREEN)
c.setFillColor(colors.HexColor("#D2E8D9"))
c.setFont("PlexMono", 9)
for j, line in enumerate(
    [
        '(bool ok, ) = msg.sender.call{value: amt}("");',
        'require(ok, "transfer failed");',
        "balances[msg.sender] -= amt;",
    ]
):
    c.drawString(M + 14, H - 345 - j * 18, line)
text("Review action", M, 421, left, 11, GREEN, True)
text(
    "Check the call path and guards. Consider updating state before the call or using an appropriate reentrancy guard; validate the change with targeted tests.",
    M,
    442,
    left,
    10.5,
    MUTED,
    leading=15,
)
label("REPORT CONTENTS", rx, 176, right, GREEN)
entries = [
    ("Finding", "Proposed severity, origin, category, rationale and recommended action."),
    ("Evidence", "Source line range and excerpt linked to the submitted source."),
    ("Provenance", "Filename, source SHA-256, run metadata and model identity when used."),
]
y = 198
for title, body in entries:
    text(title, rx, y, 91, 11, GREEN, True)
    text(body, rx + 100, y, right - 100, 10.5, MUTED, leading=15)
    rule(y + 42, rx, right)
    y += 58
label("VALIDATION & REVIEW BOUNDARIES", rx, 390, right, GREEN)
text(
    "Model output must satisfy the report schema and quote source excerpts that match the submitted file. Invalid model output is rejected; the static baseline remains available.",
    rx,
    411,
    right,
    10.5,
    MUTED,
    leading=15,
)
text(
    "This workflow does not compile contracts, resolve imports, execute exploits, modify code or deploy on-chain. Human review is needed to determine exploitability and remediation.",
    rx,
    466,
    right,
    10.5,
    MUTED,
    leading=15,
)
text(
    "Based on the supplied Duke FinTech / DTCC presentation and the platform's implemented behavior. No performance or loss-reduction claims are implied.",
    M,
    538,
    WIDTH,
    8,
    MUTED,
    leading=10,
)
c.save()
print(OUT)
