"""
ChemTech User Manual PDF Generator
Generates a professional, comprehensive user manual using ReportLab.
"""

import os
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm, inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether, Image
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.graphics import renderPDF
from datetime import datetime

# ─── Output path ──────────────────────────────────────────────────────────────
OUTPUT_PATH = r"c:\Users\sawai\OneDrive\Desktop\frontend-fyp\ChemTech_User_Manual.pdf"
LOGO_PATH   = r"c:\Users\sawai\OneDrive\Desktop\frontend-fyp\logo\logo.png"

# ─── Brand Colours (light/print-friendly theme) ──────────────────────────────
TEAL        = colors.HexColor("#0d9488")   # teal accent (darker, readable on white)
TEAL_DARK   = colors.HexColor("#0f766e")   # darker teal for borders / headers
TEAL_LIGHT  = colors.HexColor("#ccfbf1")   # very light teal for table row tint
BG_DARK     = colors.HexColor("#1e293b")   # dark navy — used for page header/footer bars
BG_PANEL    = colors.HexColor("#f8fafc")   # near-white for alternating table rows
BG_CARD     = colors.HexColor("#f1f5f9")   # light grey for card / info box backgrounds
TEXT_MAIN   = colors.HexColor("#0f172a")   # near-black — primary body text
TEXT_MUTED  = colors.HexColor("#475569")   # dark slate — secondary / muted text
ACCENT_BLU  = colors.HexColor("#0369a1")   # dark blue — h3 headings
WARN_YEL    = colors.HexColor("#b45309")   # amber — warning boxes
ERR_RED     = colors.HexColor("#b91c1c")   # red — error/admin boxes
SUCCESS     = colors.HexColor("#15803d")   # green — success boxes
# Aliases kept for backward-compat with existing code
TEXT_WHITE  = TEXT_MAIN

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm

# ─── Styles ───────────────────────────────────────────────────────────────────
def make_styles():
    styles = {}

    styles["h1"] = ParagraphStyle(
        "h1", fontName="Helvetica-Bold", fontSize=26,
        textColor=TEXT_MAIN, spaceAfter=6, spaceBefore=0,
        leading=32,
    )
    styles["h2"] = ParagraphStyle(
        "h2", fontName="Helvetica-Bold", fontSize=16,
        textColor=TEAL_DARK, spaceAfter=4, spaceBefore=14,
        leading=20,
    )
    styles["h3"] = ParagraphStyle(
        "h3", fontName="Helvetica-Bold", fontSize=12,
        textColor=ACCENT_BLU, spaceAfter=3, spaceBefore=10,
        leading=16,
    )
    styles["h4"] = ParagraphStyle(
        "h4", fontName="Helvetica-Bold", fontSize=10,
        textColor=TEXT_MAIN, spaceAfter=2, spaceBefore=6,
        leading=14,
    )
    styles["body"] = ParagraphStyle(
        "body", fontName="Helvetica", fontSize=9.5,
        textColor=TEXT_MAIN, leading=15, spaceAfter=6,
        alignment=TA_JUSTIFY,
    )
    styles["body_sm"] = ParagraphStyle(
        "body_sm", fontName="Helvetica", fontSize=8.5,
        textColor=TEXT_MUTED, leading=13, spaceAfter=4,
    )
    styles["bullet"] = ParagraphStyle(
        "bullet", fontName="Helvetica", fontSize=9.5,
        textColor=TEXT_MAIN, leading=15, spaceAfter=3,
        leftIndent=14, bulletIndent=4,
    )
    styles["bullet_sm"] = ParagraphStyle(
        "bullet_sm", fontName="Helvetica", fontSize=8.5,
        textColor=TEXT_MUTED, leading=13, spaceAfter=2,
        leftIndent=24, bulletIndent=14,
    )
    styles["note"] = ParagraphStyle(
        "note", fontName="Helvetica-Oblique", fontSize=8.5,
        textColor=WARN_YEL, leading=13, spaceAfter=4,
        leftIndent=10,
    )
    styles["tip"] = ParagraphStyle(
        "tip", fontName="Helvetica-Oblique", fontSize=8.5,
        textColor=TEAL_DARK, leading=13, spaceAfter=4,
        leftIndent=10,
    )
    styles["code"] = ParagraphStyle(
        "code", fontName="Courier", fontSize=8,
        textColor=TEAL_DARK, leading=12, spaceAfter=4,
        leftIndent=14, backColor=BG_CARD,
        borderPad=4,
    )
    styles["toc_h1"] = ParagraphStyle(
        "toc_h1", fontName="Helvetica-Bold", fontSize=10,
        textColor=TEAL_DARK, leading=16, spaceAfter=2,
    )
    styles["toc_h2"] = ParagraphStyle(
        "toc_h2", fontName="Helvetica", fontSize=9,
        textColor=TEXT_MAIN, leading=14, spaceAfter=1,
        leftIndent=16,
    )
    styles["cover_sub"] = ParagraphStyle(
        "cover_sub", fontName="Helvetica", fontSize=12,
        textColor=TEXT_MUTED, leading=18, spaceAfter=4,
        alignment=TA_CENTER,
    )
    styles["cover_version"] = ParagraphStyle(
        "cover_version", fontName="Courier", fontSize=9,
        textColor=TEAL_DARK, leading=14, spaceAfter=4,
        alignment=TA_CENTER,
    )
    styles["section_label"] = ParagraphStyle(
        "section_label", fontName="Courier", fontSize=8,
        textColor=TEAL_DARK, leading=12, spaceAfter=2,
    )
    styles["table_header"] = ParagraphStyle(
        "table_header", fontName="Helvetica-Bold", fontSize=8.5,
        textColor=colors.white, leading=12,
    )
    styles["table_cell"] = ParagraphStyle(
        "table_cell", fontName="Helvetica", fontSize=8.5,
        textColor=TEXT_MAIN, leading=12,
    )
    styles["table_cell_muted"] = ParagraphStyle(
        "table_cell_muted", fontName="Helvetica", fontSize=8,
        textColor=TEXT_MUTED, leading=12,
    )
    return styles


# ─── Drawing helpers ──────────────────────────────────────────────────────────
def color_bar(width=PAGE_W - 2 * MARGIN, height=2, color=TEAL):
    d = Drawing(width, height)
    d.add(Rect(0, 0, width, height, fillColor=color, strokeColor=None))
    return d


def section_divider(label, styles, width=PAGE_W - 2 * MARGIN):
    """Returns a coloured section header bar with label."""
    elems = []
    elems.append(Spacer(1, 8))
    elems.append(color_bar(width, 1.5, TEAL_DARK))
    elems.append(Spacer(1, 3))
    return elems


def info_box(text, styles, bg=BG_CARD, border=TEAL, width=PAGE_W - 2 * MARGIN):
    """Renders a styled info/note box."""
    # Use a dark text style inside info boxes (which have light bg)
    info_style = ParagraphStyle(
        "info_body", parent=styles["body"],
        textColor=TEXT_MAIN,
    )
    data = [[Paragraph(text, info_style)]]
    t = Table(data, colWidths=[width - 12])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LEFTPADDING",  (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING",   (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 8),
        ("BOX", (0, 0), (-1, -1), 2, border),
        ("LINEBEFORE", (0, 0), (0, -1), 4, border),
    ]))
    return t


def role_table(rows, styles, width=PAGE_W - 2 * MARGIN):
    col_w = [width * 0.22, width * 0.78]
    # Header row with teal background
    header_style = ParagraphStyle(
        "th", fontName="Helvetica-Bold", fontSize=8.5,
        textColor=colors.white, leading=12,
    )
    cell_style = ParagraphStyle(
        "tc", fontName="Helvetica", fontSize=8.5,
        textColor=TEXT_MAIN, leading=13,
    )
    data  = []
    for i, (role, desc) in enumerate(rows):
        data.append([
            Paragraph(f"{role}", header_style),
            Paragraph(desc, cell_style),
        ])
    t = Table(data, colWidths=col_w)
    row_bg = [BG_PANEL if i % 2 == 0 else colors.white for i in range(len(data))]
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (0, -1), TEAL_DARK),   # left col always teal
        ("ROWBACKGROUNDS",(1, 0), (1, -1), row_bg),       # right col alternates
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("GRID",          (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def feature_table(rows, styles, col_widths=None, width=PAGE_W - 2 * MARGIN):
    if col_widths is None:
        col_widths = [width * 0.3, width * 0.7]
    header_style = ParagraphStyle(
        "fth", fontName="Helvetica-Bold", fontSize=8.5,
        textColor=colors.white, leading=12,
    )
    cell_style = ParagraphStyle(
        "ftc", fontName="Helvetica", fontSize=8.5,
        textColor=TEXT_MAIN, leading=13,
    )
    data = []
    for label, value in rows:
        data.append([
            Paragraph(label, header_style),
            Paragraph(value, cell_style),
        ])
    row_bg = [BG_PANEL if i % 2 == 0 else colors.white for i in range(len(data))]
    t = Table(data, colWidths=col_widths)
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (0, -1), TEAL_DARK),
        ("ROWBACKGROUNDS",(1, 0), (1, -1), row_bg),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
        ("TOPPADDING",    (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("GRID",          (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
    ]))
    return t


# ─── Page template ────────────────────────────────────────────────────────────
def make_header_footer(canvas, doc):
    canvas.saveState()
    w, h = A4

    # Header bar — dark navy background
    canvas.setFillColor(BG_DARK)
    canvas.rect(0, h - 20 * mm, w, 20 * mm, fill=1, stroke=0)
    # Teal accent stripe at bottom of header
    canvas.setFillColor(TEAL)
    canvas.rect(0, h - 20 * mm, w, 2, fill=1, stroke=0)

    canvas.setFont("Helvetica-Bold", 9)
    canvas.setFillColor(colors.HexColor("#5eead4"))  # light teal on dark bg
    canvas.drawString(MARGIN, h - 12 * mm, "ChemTech")
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#94a3b8"))  # slate on dark bg
    canvas.drawRightString(w - MARGIN, h - 12 * mm, "User Manual  v1.0")

    # Footer bar — dark navy background
    canvas.setFillColor(BG_DARK)
    canvas.rect(0, 0, w, 13 * mm, fill=1, stroke=0)
    # Teal accent stripe at top of footer
    canvas.setFillColor(TEAL)
    canvas.rect(0, 13 * mm, w, 1.5, fill=1, stroke=0)

    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(colors.HexColor("#94a3b8"))
    canvas.drawString(MARGIN, 5 * mm, f"Confidential  ChemTech Molecular Innovation  {datetime.now().strftime('%B %Y')}")
    canvas.setFillColor(colors.HexColor("#5eead4"))
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawRightString(w - MARGIN, 5 * mm, f"{doc.page}")

    canvas.restoreState()


def make_cover_footer(canvas, doc):
    """Minimal footer for cover page."""
    canvas.saveState()
    w, h = A4
    canvas.setFillColor(BG_DARK)
    canvas.rect(0, 0, w, 12 * mm, fill=1, stroke=0)
    canvas.setFillColor(TEAL)
    canvas.rect(0, 12 * mm, w, 1.5, fill=1, stroke=0)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(colors.HexColor("#94a3b8"))
    canvas.drawCentredString(w / 2, 5 * mm, f"(c) {datetime.now().year} ChemTech  All rights reserved")
    canvas.restoreState()


# ─── Cover page ───────────────────────────────────────────────────────────────
def build_cover(styles):
    elems = []
    w, h = A4

    # Dark cover background — fill the whole page
    from reportlab.platypus import Frame
    elems.append(Spacer(1, 40 * mm))

    # Logo
    if os.path.exists(LOGO_PATH):
        try:
            img = Image(LOGO_PATH, width=65 * mm, height=65 * mm, kind="proportional")
            img.hAlign = "CENTER"
            elems.append(img)
        except Exception:
            pass
    elems.append(Spacer(1, 8 * mm))

    # Title
    elems.append(Paragraph(
        "ChemTech",
        ParagraphStyle("ct", fontName="Helvetica-Bold", fontSize=38,
                       textColor=TEAL_DARK, alignment=TA_CENTER, leading=46),
    ))
    elems.append(Spacer(1, 2 * mm))
    elems.append(Paragraph(
        "User Manual",
        ParagraphStyle("um", fontName="Helvetica", fontSize=22,
                       textColor=TEXT_MAIN, alignment=TA_CENTER, leading=28),
    ))
    elems.append(Spacer(1, 4 * mm))
    elems.append(Paragraph(
        "Molecular Innovation  |  Chemical Distribution Platform",
        ParagraphStyle("cs", fontName="Helvetica", fontSize=12,
                       textColor=TEXT_MUTED, alignment=TA_CENTER, leading=18),
    ))
    elems.append(Spacer(1, 6 * mm))

    # Divider line
    d = Drawing(PAGE_W - 2 * MARGIN, 2)
    d.add(Rect(0, 0, PAGE_W - 2 * MARGIN, 2, fillColor=TEAL_DARK, strokeColor=None))
    elems.append(d)
    elems.append(Spacer(1, 6 * mm))

    # Meta info block
    meta_data = [
        ["Version",  "1.0"],
        ["Date",     datetime.now().strftime("%d %B %Y")],
        ["Platform", "Desktop (Electron)  Windows"],
        ["Backend",  "Flask  Python 3.14  Turso / SQLite"],
        ["AI Engine","Groq (llama-3.3-70b-versatile) / Ollama (Local)"],
    ]
    usable = PAGE_W - 2 * MARGIN
    col_w  = [usable * 0.25, usable * 0.75]
    hdr_st = ParagraphStyle("mhdr", fontName="Helvetica-Bold", fontSize=9,
                             textColor=colors.white, leading=13)
    cel_st = ParagraphStyle("mcel", fontName="Helvetica", fontSize=9,
                             textColor=TEXT_MAIN, leading=13)
    rows   = []
    for k, v in meta_data:
        rows.append([
            Paragraph(k, hdr_st),
            Paragraph(v, cel_st),
        ])
    row_bg = [BG_PANEL if i % 2 == 0 else colors.white for i in range(len(rows))]
    t = Table(rows, colWidths=col_w)
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (0, -1), TEAL_DARK),
        ("ROWBACKGROUNDS",(1, 0), (1, -1), row_bg),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
        ("TOPPADDING",    (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("BOX",           (0, 0), (-1, -1), 1.5, TEAL_DARK),
        ("GRID",          (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
    ]))
    elems.append(t)

    elems.append(PageBreak())
    return elems


# ─── Table of Contents ────────────────────────────────────────────────────────
def build_toc_page(styles):
    elems = []
    elems.append(Spacer(1, 6 * mm))
    elems.append(Paragraph("Table of Contents", styles["h1"]))
    elems.append(color_bar())
    elems.append(Spacer(1, 6 * mm))

    chapters = [
        ("1.", "Introduction & Overview", []),
        ("2.", "System Requirements", []),
        ("3.", "Getting Started", [
            ("3.1", "Launching the Application"),
            ("3.2", "Login & Authentication"),
            ("3.3", "User Roles"),
            ("3.4", "Pending Approval"),
        ]),
        ("4.", "Home Screen & Navigation", [
            ("4.1", "Sidebar Panel"),
            ("4.2", "AI Engine Selector"),
            ("4.3", "Notification Bell"),
            ("4.4", "HUD & Animations"),
        ]),
        ("5.", "Chemical Catalog", [
            ("5.1", "Browsing & Searching"),
            ("5.2", "Province Filtering"),
            ("5.3", "Placing an Order"),
            ("5.4", "Location Picker"),
        ]),
        ("6.", "Delivery Tracker", [
            ("6.1", "Viewing Deliveries"),
            ("6.2", "Delivery Status Codes"),
            ("6.3", "Submitting Feedback"),
            ("6.4", "Sharing a Delivery Location"),
        ]),
        ("7.", "AI System (Chatbot)", [
            ("7.1", "Conversational Interface"),
            ("7.2", "Voice Input"),
            ("7.3", "Suggested Queries"),
            ("7.4", "Groq vs Ollama"),
        ]),
        ("8.", "AI Analytics Engine", [
            ("8.1", "Overview"),
            ("8.2", "Data Focus Snapshots"),
            ("8.3", "Suggested Analyses"),
            ("8.4", "Immersive Dashboard"),
        ]),
        ("9.", "Regional Dashboard", [
            ("9.1", "Region Selector"),
            ("9.2", "Chemical Inventory Section"),
            ("9.3", "Delivery Management"),
            ("9.4", "Feedback & Sentiment"),
            ("9.5", "Adding Chemicals"),
        ]),
        ("10.", "Admin Panel", [
            ("10.1", "User Management"),
            ("10.2", "Pending Approvals"),
            ("10.3", "Admin Management"),
            ("10.4", "Add User"),
        ]),
        ("11.", "Notifications System", []),
        ("12.", "API Key Management", []),
        ("13.", "Troubleshooting & FAQ", []),
        ("14.", "Glossary", []),
    ]

    for num, title, subs in chapters:
        elems.append(Paragraph(
            f'<b>{num}</b>  {title}',
            styles["toc_h1"],
        ))
        for snum, stitle in subs:
            elems.append(Paragraph(
                f'<font color="#475569">{snum}</font>  {stitle}',
                styles["toc_h2"],
            ))
        elems.append(Spacer(1, 2))

    elems.append(PageBreak())
    return elems


# ─── Chapter builders ─────────────────────────────────────────────────────────
def ch1_introduction(styles):
    elems = []
    elems.append(Paragraph("01 · Introduction & Overview", styles["h2"]))
    elems.append(color_bar())
    elems.append(Spacer(1, 5))

    elems.append(Paragraph(
        "<b>ChemTech</b> is a full-stack, AI-powered chemical distribution and management platform "
        "designed for the Pakistani market. It combines a modern Electron desktop shell with a "
        "Flask (Python) backend and a Turso/SQLite database to provide real-time inventory "
        "management, AI-driven analytics, intelligent delivery tracking, and multi-role access "
        "control — all within a visually rich, immersive user interface.",
        styles["body"],
    ))
    elems.append(Spacer(1, 4))

    key_features = [
        ("Chemical Catalog",     "Browse, search, and order chemicals across four Pakistani provinces (Punjab, KPK, Sindh, Balochistan)."),
        ("Delivery Tracker",     "Track chemical orders from placement to arrival. Submit text or voice feedback with AI sentiment analysis."),
        ("AI System (Chatbot)",  "Conversational AI with full database access — inventory, sales, deliveries, feedback, and users."),
        ("AI Analytics Engine",  "Ask business questions in plain English. Receive executive-grade reports with charts and KPIs."),
        ("Regional Dashboard",   "Province-level insights: inventory charts, delivery maps, feedback sentiment, and admin tools."),
        ("Admin Panel",          "Approve user registrations, manage roles (User / Regional Admin / Admin), and add accounts."),
        ("Notifications",        "Real-time in-app alerts for order placements, approvals, and delivery updates."),
        ("Dual AI Engine",       "Switch between Groq Cloud (llama-3.3-70b) and Ollama (local LLM) at any time."),
    ]

    elems.append(Paragraph("Key Features", styles["h3"]))
    elems.append(feature_table(key_features, styles))
    elems.append(Spacer(1, 8))

    elems.append(Paragraph("Architecture at a Glance", styles["h3"]))
    arch = [
        ("Frontend",  "HTML5, CSS3 (custom design system), Vanilla JavaScript, Chart.js, Leaflet.js, Three.js"),
        ("Desktop Shell", "Electron (Node.js) — packages the web UI as a native Windows application"),
        ("Backend",   "Python 3 · Flask · Flask-CORS · Werkzeug security"),
        ("Database",  "Turso (libSQL) with SQLite compatibility · accessed via turso_compat module"),
        ("AI/LLM",    "Groq API (cloud) · Ollama (local, OpenAI-compatible endpoint)"),
        ("Auth",      "Google OAuth 2.0 (popup) + manual username/password with bcrypt hashing"),
    ]
    elems.append(feature_table(arch, styles))
    elems.append(PageBreak())
    return elems


def ch2_requirements(styles):
    elems = []
    elems.append(Paragraph("02 · System Requirements", styles["h2"]))
    elems.append(color_bar())
    elems.append(Spacer(1, 5))

    elems.append(Paragraph("Minimum Requirements", styles["h3"]))
    reqs = [
        ("OS",         "Windows 10 (64-bit) or later"),
        ("Processor",  "Intel Core i5 / AMD Ryzen 5 · 2.0 GHz or faster"),
        ("RAM",        "8 GB (16 GB recommended for AI features)"),
        ("Storage",    "500 MB free disk space"),
        ("Display",    "1280 × 720 minimum · 1920 × 1080 recommended"),
        ("Internet",   "Required for Groq AI, Google OAuth, Turso cloud database, and CDN resources"),
        ("Python",     "Python 3.10+ (only needed if running from source)"),
    ]
    elems.append(feature_table(reqs, styles))
    elems.append(Spacer(1, 6))

    elems.append(Paragraph("Optional (Local AI Mode)", styles["h3"]))
    elems.append(Paragraph(
        "To use the <b>Ollama</b> local AI engine, install Ollama from <b>ollama.ai</b> and pull a "
        "compatible model (e.g., <font face='Courier' color='#00e6c3'>ollama pull llama3.2:1b</font>). "
        "Ollama must be running on <font face='Courier' color='#00e6c3'>http://127.0.0.1:11434</font> "
        "before switching to Local mode in the application.",
        styles["body"],
    ))
    elems.append(Spacer(1, 4))
    elems.append(info_box(
        "⚠  NOTE: Ollama local inference is CPU-intensive. For best performance, a system with a "
        "dedicated GPU (CUDA compatible) is recommended for models larger than 1B parameters.",
        styles, bg=BG_CARD, border=WARN_YEL,
    ))
    elems.append(PageBreak())
    return elems


def ch3_getting_started(styles):
    elems = []
    elems.append(Paragraph("03 · Getting Started", styles["h2"]))
    elems.append(color_bar())
    elems.append(Spacer(1, 5))

    # 3.1 Launching
    elems.append(Paragraph("3.1  Launching the Application", styles["h3"]))
    elems.append(Paragraph(
        "ChemTech is distributed as a Windows installer (<b>ChemTech Setup.exe</b>) or as a portable "
        "executable (<b>ChemTech-Portable.exe</b>). After installation, double-click the desktop shortcut "
        "or Start Menu entry to launch.",
        styles["body"],
    ))
    elems.append(Paragraph("On first launch:", styles["h4"]))
    steps = [
        "The Electron shell starts and loads the embedded Flask backend automatically.",
        "A loading screen with the ChemTech logo and a percentage counter is displayed.",
        "The 3D animated sphere background initialises in the background.",
        "The Login Screen appears once all assets have loaded.",
    ]
    for i, s in enumerate(steps, 1):
        elems.append(Paragraph(f"<b>{i}.</b>  {s}", styles["bullet"]))
    elems.append(Spacer(1, 5))

    elems.append(info_box(
        "💡  TIP: If the backend fails to start (e.g., port conflict), close the application, "
        "ensure no other process is using port 5000, and relaunch.",
        styles, border=TEAL,
    ))
    elems.append(Spacer(1, 6))

    # 3.2 Login
    elems.append(Paragraph("3.2  Login & Authentication", styles["h3"]))
    elems.append(Paragraph(
        "ChemTech supports two authentication methods:", styles["body"],
    ))

    auth_rows = [
        ("Google Sign-In", "Click the <b>Google</b> tab then the Google Sign-In button. A secure OAuth popup appears. "
                           "Sign in with your Google account. On success, your profile photo, name, and role badge "
                           "appear in the sidebar."),
        ("Manual Login",   "Click the <b>Manual</b> tab. Enter your <b>Username</b> and <b>Password</b>. "
                           "Click <b>Sign In</b>. If credentials are incorrect, an error message is shown below the form."),
        ("Register",       "Click <b>Create Account</b> on the Manual tab. Enter a username and password. "
                           "Your account will be created with <b>Pending</b> status until an Admin approves it."),
    ]
    elems.append(role_table(auth_rows, styles))
    elems.append(Spacer(1, 6))

    # 3.3 Roles
    elems.append(Paragraph("3.3  User Roles", styles["h3"]))
    elems.append(Paragraph(
        "ChemTech uses a three-tier role system. Your role determines which navigation items and "
        "features are visible to you.",
        styles["body"],
    ))
    role_rows = [
        ("User",           "Can browse the Chemical Catalog, place orders, track their own deliveries, "
                           "submit feedback, and use the AI System chatbot."),
        ("Regional Admin", "All User permissions, plus: access to the Regional Dashboard with province-level "
                           "inventory, delivery management, and sentiment analytics. Can add new chemicals to the catalog."),
        ("Admin",          "All Regional Admin permissions, plus: access to the Admin Panel to approve "
                           "registrations, manage all user accounts, assign roles, and add users directly."),
    ]
    elems.append(role_table(role_rows, styles))
    elems.append(Spacer(1, 6))

    # 3.4 Pending
    elems.append(Paragraph("3.4  Pending Approval", styles["h3"]))
    elems.append(Paragraph(
        "If you created a manual account and see the <b>Access Pending</b> screen, your account "
        "is awaiting Admin approval. Click <b>Return to Login</b> to go back. Once an Admin approves "
        "your account, you can sign in normally. You will be notified via the notification system once approved.",
        styles["body"],
    ))
    elems.append(PageBreak())
    return elems


def ch4_home_navigation(styles):
    elems = []
    elems.append(Paragraph("04 · Home Screen & Navigation", styles["h2"]))
    elems.append(color_bar())
    elems.append(Spacer(1, 5))

    elems.append(Paragraph(
        "After successful login, you are taken to the <b>Home Screen</b> — a full-screen animated "
        "environment with a frosted-glass sidebar panel on the left, floating UI elements, and a "
        "dynamic 3D particle background.",
        styles["body"],
    ))
    elems.append(Spacer(1, 5))

    # 4.1 Sidebar
    elems.append(Paragraph("4.1  Sidebar Panel", styles["h3"]))
    elems.append(Paragraph(
        "The sidebar is the primary navigation hub. It contains the ChemTech logo, navigation links, "
        "live stats, and your profile chip.",
        styles["body"],
    ))
    nav_rows = [
        ("01 · Chemicals",         "Opens the Chemical Catalog panel. (Visible to all authenticated users)"),
        ("02 · My Deliveries",     "Opens the Delivery Tracker panel. (Visible to all authenticated users)"),
        ("03 · AI System",         "Opens the conversational AI chatbot. (Visible to all authenticated users)"),
        ("04 · AI Analytics",      "Opens the AI Analytics Engine. (Visible to Regional Admins and Admins)"),
        ("05 · Regional Dashboard","Opens the Province Dashboard. (Visible to Regional Admins and Admins)"),
        ("06 · Admin Panel",       "Opens the Admin management modal. (Visible to Admins only)"),
        ("07 · Logout System",     "Signs you out and returns to the Login Screen."),
    ]
    elems.append(role_table(nav_rows, styles))
    elems.append(Spacer(1, 5))

    # Stats Row
    elems.append(Paragraph("Live Stats Bar", styles["h4"]))
    elems.append(Paragraph(
        "At the bottom of the sidebar, three live counters display: "
        "<b>Patents (500+)</b>, <b>Countries (47)</b>, and a live <b>UTC clock</b> updated every second.",
        styles["body"],
    ))
    elems.append(Spacer(1, 6))

    # 4.2 AI Engine
    elems.append(Paragraph("4.2  AI Engine Selector", styles["h3"]))
    elems.append(Paragraph(
        "A floating panel in the top-right corner of the home screen lets you choose the AI backend "
        "that powers both the chatbot and the analytics engine.",
        styles["body"],
    ))
    ai_rows = [
        ("Groq (Cloud)", "Default. Uses the Groq API with <b>llama-3.3-70b-versatile</b>. Delivers rich, "
                         "detailed reports and high-quality responses. Requires internet. Faster for analytics."),
        ("Ollama (Local)","Uses an Ollama instance running locally at http://127.0.0.1:11434. "
                         "Works offline. Responses are more concise. Model must be pulled in advance."),
    ]
    elems.append(role_table(ai_rows, styles))
    elems.append(Spacer(1, 4))

    elems.append(Paragraph("Using Your Own Groq API Key", styles["h4"]))
    elems.append(Paragraph(
        "Toggle the <b>Your Groq API Key</b> switch in the AI Engine panel to enable the key input "
        "field. Enter your key (starts with <font face='Courier' color='#00e6c3'>gsk_</font>) and click "
        "<b>Save</b>. Your key is stored locally and used for all subsequent AI requests. Click the ✕ "
        "button to remove the saved key.",
        styles["body"],
    ))
    elems.append(Spacer(1, 6))

    # 4.3 Notifications
    elems.append(Paragraph("4.3  Notification Bell", styles["h3"]))
    elems.append(Paragraph(
        "The 🔔 bell icon appears in the AI Engine panel after login. A red badge shows the count of "
        "unread notifications. Click the bell to open the Notification Panel. Each notification shows "
        "a message and timestamp. Click <b>Clear All</b> to dismiss all notifications at once, or "
        "click the ✕ on individual notifications to dismiss them.",
        styles["body"],
    ))
    elems.append(Spacer(1, 6))

    # 4.4 HUD
    elems.append(Paragraph("4.4  HUD & Animations", styles["h3"]))
    hud_rows = [
        ("HUD Corners",     "Four corner brackets give the interface a sci-fi HUD aesthetic."),
        ("Side Ticker",     "Four dots on the right edge indicate the current scene/section."),
        ("Scan Line",       "An animated horizontal scan line sweeps across the screen."),
        ("HUD Bar",         "Bottom bar displays current frame number and cursor coordinates."),
        ("Cursor Ring",     "A custom cyan ring cursor follows mouse movement with smooth easing."),
        ("Active Compound", "Displays a rotating chemical formula (e.g., H₂O, H₂SO₄) as aesthetic detail."),
    ]
    elems.append(role_table(hud_rows, styles))
    elems.append(PageBreak())
    return elems


def ch5_chemicals(styles):
    elems = []
    elems.append(Paragraph("05 · Chemical Catalog", styles["h2"]))
    elems.append(color_bar())
    elems.append(Spacer(1, 5))

    elems.append(Paragraph(
        "The Chemical Catalog is the central product browser. It displays all chemicals available "
        "in the ChemTech inventory, organised by province, with rich detail cards for each compound.",
        styles["body"],
    ))
    elems.append(Spacer(1, 5))

    # 5.1 Browse
    elems.append(Paragraph("5.1  Browsing & Searching", styles["h3"]))
    elems.append(Paragraph(
        "Each chemical card in the grid displays:", styles["body"],
    ))
    card_info = [
        "Chemical name and molecular formula",
        "Category badge (e.g., Acids, Bases, Solvents, Oxidizers, Minerals, General)",
        "Province of origin",
        "Concentration percentage",
        "Current stock level (kg) — shown with a visual progress bar",
        "Price per kg (PKR)",
        "A description of the compound",
        "An <b>Order</b> button to initiate a purchase",
    ]
    for item in card_info:
        elems.append(Paragraph(f"• {item}", styles["bullet"]))
    elems.append(Spacer(1, 5))

    elems.append(Paragraph("Search Bar", styles["h4"]))
    elems.append(Paragraph(
        "Use the search bar at the top of the catalog to find chemicals by <b>name</b>, <b>formula</b>, "
        "<b>category</b>, or <b>province</b>. Search results update instantly as you type. "
        "Click the ✕ button to clear the search.",
        styles["body"],
    ))
    elems.append(Spacer(1, 5))

    # 5.2 Province filter
    elems.append(Paragraph("5.2  Province Filtering", styles["h3"]))
    elems.append(Paragraph(
        "The province tab bar at the top of the Chemical Catalog lets you filter by region:",
        styles["body"],
    ))
    prov_rows = [
        ("All",          "Shows chemicals from all four provinces simultaneously."),
        ("Punjab",       "Filters to chemicals stocked in Punjab."),
        ("KPK",          "Filters to chemicals stocked in Khyber Pakhtunkhwa."),
        ("Sindh",        "Filters to chemicals stocked in Sindh."),
        ("Balochistan",  "Filters to chemicals stocked in Balochistan."),
    ]
    elems.append(role_table(prov_rows, styles))
    elems.append(Spacer(1, 6))

    # 5.3 Ordering
    elems.append(Paragraph("5.3  Placing an Order", styles["h3"]))
    elems.append(Paragraph(
        "Click the <b>Order</b> button on any chemical card to open the Order Modal. "
        "Fill in the required fields and click <b>Place Order</b>.",
        styles["body"],
    ))
    order_fields = [
        ("Quantity (kg)",       "Enter the amount of chemical you wish to order. Minimum: 0.1 kg."),
        ("Notes (optional)",    "Add any special instructions or notes for this order."),
        ("Assign to user",      "Admins/Regional Admins only: assign this delivery to a specific registered user."),
        ("Delivery Location",   "Admins/Regional Admins only: pin a delivery location on the Pakistan map."),
    ]
    elems.append(feature_table(order_fields, styles))
    elems.append(Spacer(1, 4))
    elems.append(info_box(
        "✅  Once placed, the order creates a delivery record visible in the Delivery Tracker. "
        "Relevant users receive an in-app notification.",
        styles, border=SUCCESS,
    ))
    elems.append(Spacer(1, 6))

    # 5.4 Location Picker
    elems.append(Paragraph("5.4  Location Picker", styles["h3"]))
    elems.append(Paragraph(
        "Click <b>Pick on Map</b> in the Order Modal to open the interactive Pakistan map. "
        "Click anywhere on the map to drop a pin. The selected coordinates are displayed below the map. "
        "Click <b>✓ Confirm Location</b> to save the pin, or <b>Cancel</b> to discard it.",
        styles["body"],
    ))
    elems.append(PageBreak())
    return elems


def ch6_deliveries(styles):
    elems = []
    elems.append(Paragraph("06 · Delivery Tracker", styles["h2"]))
    elems.append(color_bar())
    elems.append(Spacer(1, 5))

    elems.append(Paragraph(
        "The Delivery Tracker gives you a real-time view of all your chemical orders and their "
        "current fulfillment status.",
        styles["body"],
    ))
    elems.append(Spacer(1, 5))

    # 6.1 Viewing
    elems.append(Paragraph("6.1  Viewing Deliveries", styles["h3"]))
    elems.append(Paragraph(
        "Navigate to <b>02 · My Deliveries</b> from the sidebar. Each delivery card displays:",
        styles["body"],
    ))
    del_info = [
        "Delivery ID and chemical name",
        "Quantity ordered (kg)",
        "Current status badge",
        "Order date and estimated delivery date",
        "A <b>View Map</b> button (if a location was pinned)",
        "A <b>Share Location</b> button (if a location is set)",
        "A <b>Leave Feedback</b> button (available after delivery is completed)",
    ]
    for item in del_info:
        elems.append(Paragraph(f"• {item}", styles["bullet"]))
    elems.append(Spacer(1, 5))

    # 6.2 Status codes
    elems.append(Paragraph("6.2  Delivery Status Codes", styles["h3"]))
    status_rows = [
        ("Pending",     "Order received and is awaiting processing by the fulfillment team."),
        ("Processing",  "Order is being prepared for dispatch."),
        ("Dispatched",  "Order has left the warehouse and is en route."),
        ("In Transit",  "Shipment is currently in transit to the destination."),
        ("Delivered",   "Order has been delivered successfully. Feedback can now be submitted."),
        ("Cancelled",   "Order was cancelled. Contact an Admin for details."),
    ]
    elems.append(role_table(status_rows, styles))
    elems.append(Spacer(1, 6))

    # 6.3 Feedback
    elems.append(Paragraph("6.3  Submitting Feedback", styles["h3"]))
    elems.append(Paragraph(
        "After a delivery reaches <b>Delivered</b> status, click <b>Leave Feedback</b> to open the "
        "Feedback Modal. You can provide feedback in two ways:",
        styles["body"],
    ))
    fb_rows = [
        ("Text Feedback",  "Type your delivery experience in the text area and click <b>Submit Feedback</b>."),
        ("Voice Feedback", "Click <b>🎙 Record Voice</b> to start voice recording. Speak your feedback clearly. "
                           "The system will transcribe and analyse the sentiment automatically. "
                           "Click the button again to stop recording."),
    ]
    elems.append(role_table(fb_rows, styles))
    elems.append(Spacer(1, 4))
    elems.append(Paragraph(
        "After submission, an <b>AI sentiment result</b> badge is displayed showing Positive, "
        "Neutral, or Negative sentiment along with a confidence score. This data feeds into the "
        "Regional Dashboard analytics.",
        styles["body"],
    ))
    elems.append(Spacer(1, 6))

    # 6.4 Share
    elems.append(Paragraph("6.4  Sharing a Delivery Location", styles["h3"]))
    elems.append(Paragraph(
        "If your delivery has a pinned location, click <b>Share Location</b> to open the Share "
        "modal. Choose from four sharing methods:",
        styles["body"],
    ))
    share_rows = [
        ("WhatsApp",     "Opens WhatsApp Web/App with a pre-composed message containing the Google Maps link."),
        ("Gmail",        "Opens a new Gmail compose window with the delivery location link."),
        ("SMS",          "Opens the system SMS app (where supported) with a pre-filled message."),
        ("Telegram",     "Opens Telegram with a pre-composed message."),
        ("Copy Link",    "Copies the Google Maps link to the clipboard for manual sharing."),
        ("Share via…",   "On supported browsers/OS, opens the native share sheet."),
    ]
    elems.append(role_table(share_rows, styles))
    elems.append(PageBreak())
    return elems


def ch7_ai_chatbot(styles):
    elems = []
    elems.append(Paragraph("07 · AI System (Chatbot)", styles["h2"]))
    elems.append(color_bar())
    elems.append(Spacer(1, 5))

    elems.append(Paragraph(
        "The AI System is a conversational intelligence module with <b>full access to the live "
        "ChemTech database</b>. Ask it anything about your operations in plain English.",
        styles["body"],
    ))
    elems.append(Spacer(1, 5))

    # 7.1 Interface
    elems.append(Paragraph("7.1  Conversational Interface", styles["h3"]))
    elems.append(Paragraph(
        "Navigate to <b>03 · AI System</b> in the sidebar. The chat interface displays:",
        styles["body"],
    ))
    chat_info = [
        "A scrollable <b>chat history</b> panel showing your conversation.",
        "A <b>text input field</b> at the bottom — type your question and press <b>Send</b> or hit <b>Enter</b>.",
        "A <b>voice input button</b> (microphone icon) to dictate your query.",
        "A <b>Stop Audio</b> button (appears during TTS playback if enabled).",
        "The AI's initial greeting message confirming database access scope.",
    ]
    for item in chat_info:
        elems.append(Paragraph(f"• {item}", styles["bullet"]))
    elems.append(Spacer(1, 5))

    # 7.2 Voice input
    elems.append(Paragraph("7.2  Voice Input", styles["h3"]))
    elems.append(Paragraph(
        "Click the <b>🎤 microphone button</b> to activate speech recognition. Speak your query clearly. "
        "The recognised text automatically populates the input field. Review it, then click <b>Send</b>. "
        "Voice input uses the browser's built-in Web Speech API and requires microphone permission.",
        styles["body"],
    ))
    elems.append(Spacer(1, 5))

    # 7.3 Suggested
    elems.append(Paragraph("7.3  Suggested Queries", styles["h3"]))
    elems.append(Paragraph(
        "Below the chat history, a row of <b>suggestion chips</b> offers quick-start queries:",
        styles["body"],
    ))
    chips = [
        ("Total Sold",      "Asks for total kg of chemicals sold across all time."),
        ("Top Seller",      "Identifies the best-selling chemical and its revenue contribution."),
        ("Low Stock",       "Lists chemicals that are running critically low on inventory."),
        ("Province Compare","Compares revenue performance across all four provinces."),
        ("Sentiment",       "Returns the average customer sentiment score from delivery feedback."),
    ]
    elems.append(role_table(chips, styles))
    elems.append(Spacer(1, 6))

    # 7.4 Groq vs Ollama
    elems.append(Paragraph("7.4  Groq vs Ollama Mode", styles["h3"]))
    compare_rows = [
        ("Groq (Cloud)", "Ollama (Local)"),
        ("Requires internet connection", "Works offline"),
        ("Fast, high-quality responses", "Slower on CPU; concise answers"),
        ("llama-3.3-70b-versatile", "Configurable via OLLAMA_MODEL env var"),
        ("May incur API costs", "Completely free once model is downloaded"),
        ("Automatic failover to local", "Manual selection only"),
    ]
    usable = PAGE_W - 2 * MARGIN
    col_w  = [usable * 0.5, usable * 0.5]
    t = Table(compare_rows, colWidths=col_w)
    row_bg = [BG_PANEL if i % 2 == 0 else colors.white for i in range(1, len(compare_rows))]
    t.setStyle(TableStyle([
        # Header row
        ("BACKGROUND",    (0, 0), (-1, 0), TEAL_DARK),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0), 9),
        # Data rows
        ("FONTNAME",      (0, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE",      (0, 1), (-1, -1), 8.5),
        ("TEXTCOLOR",     (0, 1), (-1, -1), TEXT_MAIN),
        ("ROWBACKGROUNDS",(0, 1), (-1, -1), row_bg),
        ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("GRID",          (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
        ("LEFTPADDING",   (0, 0), (-1, -1), 8),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 8),
        ("TOPPADDING",    (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    elems.append(t)
    elems.append(PageBreak())
    return elems


def ch8_analytics(styles):
    elems = []
    elems.append(Paragraph("08 · AI Analytics Engine", styles["h2"]))
    elems.append(color_bar())
    elems.append(Spacer(1, 5))

    elems.append(info_box(
        "🔒  Access Level: Regional Admin and Admin only.",
        styles, bg=BG_CARD, border=WARN_YEL,
    ))
    elems.append(Spacer(1, 5))

    # 8.1
    elems.append(Paragraph("8.1  Overview", styles["h3"]))
    elems.append(Paragraph(
        "The AI Analytics Engine goes beyond simple chat. Ask any business question and receive "
        "a comprehensive <b>executive-level report</b> with KPIs, findings, charts, and actionable "
        "recommendations — all powered by your live database.",
        styles["body"],
    ))
    elems.append(Spacer(1, 4))
    elems.append(Paragraph(
        "To use the Analytics Engine, navigate to <b>04 · AI Analytics</b> in the sidebar. "
        "Type your question in the large search bar and click <b>Analyse</b>.",
        styles["body"],
    ))
    elems.append(Spacer(1, 5))

    # 8.2 Snapshots
    elems.append(Paragraph("8.2  Data Focus Snapshots", styles["h3"]))
    elems.append(Paragraph(
        "Before asking a question, select a <b>Data Focus</b> chip to control which data slice "
        "the AI receives. This saves tokens and improves answer precision.",
        styles["body"],
    ))
    snap_rows = [
        ("Overview",           "Default. Balanced summary across sales, inventory, deliveries, and sentiment."),
        ("Sales Ledger",       "Individual sale transactions with dates and amounts."),
        ("Full Inventory",     "Complete chemical catalog with all stock levels and pricing."),
        ("Deliveries & GPS",   "All deliveries with GPS coordinates, tracking codes, and notes."),
        ("Feedback",           "Customer reviews, sentiment scores, and voice transcriptions."),
        ("Users",              "User accounts, roles, and registration dates."),
        ("Notifications Log",  "In-app alerts and system notification history."),
    ]
    elems.append(role_table(snap_rows, styles))
    elems.append(Spacer(1, 6))

    # 8.3 Suggestions
    elems.append(Paragraph("8.3  Suggested Analyses", styles["h3"]))
    elems.append(Paragraph(
        "The engine provides pre-built analysis chips for common business queries:", styles["body"],
    ))
    sugg = [
        ("Total Sold",           "Total kg of chemicals sold across all time."),
        ("vs Competitors",       "Benchmarks ChemTech performance vs Pakistani chemical industry averages."),
        ("Underperformers",      "Identifies underperforming chemicals with actionable recommendations."),
        ("Growth Forecast",      "Revenue trend analysis and next-quarter forecast."),
        ("Province Breakdown",   "Full breakdown of all 4 provinces: revenue, volume, sentiment, and delivery performance."),
        ("Top Performers",       "Best-selling chemical and most profitable province identification."),
        ("Satisfaction Report",  "Customer satisfaction and sentiment analysis across all deliveries."),
    ]
    elems.append(feature_table(sugg, styles))
    elems.append(Spacer(1, 6))

    # 8.4 Dashboard
    elems.append(Paragraph("8.4  Immersive Dashboard", styles["h3"]))
    elems.append(Paragraph(
        "When using Groq mode, the AI can generate an <b>Immersive Full-Width Dashboard</b> view "
        "with multiple Chart.js visualisations (bar charts, line charts, doughnut charts, radar charts) "
        "rendered alongside the executive report. Click the <b>◈ Dashboard</b> button in the Analytics "
        "header to toggle between the conversation thread and the full dashboard.",
        styles["body"],
    ))
    elems.append(PageBreak())
    return elems


def ch9_regional_dashboard(styles):
    elems = []
    elems.append(Paragraph("09 · Regional Dashboard", styles["h2"]))
    elems.append(color_bar())
    elems.append(Spacer(1, 5))

    elems.append(info_box(
        "🔒  Access Level: Regional Admin and Admin only.",
        styles, bg=BG_CARD, border=WARN_YEL,
    ))
    elems.append(Spacer(1, 5))

    # 9.1 Region selector
    elems.append(Paragraph("9.1  Region Selector", styles["h3"]))
    elems.append(Paragraph(
        "Clicking <b>05 · Regional Dashboard</b> opens a <b>Region Selector</b> overlay. "
        "Choose one of the five views:",
        styles["body"],
    ))
    region_rows = [
        ("Overall",      "Aggregates data from all four provinces into a national overview."),
        ("Punjab",       "Dashboard scoped to Punjab region data only."),
        ("KPK",          "Dashboard scoped to Khyber Pakhtunkhwa region data only."),
        ("Sindh",        "Dashboard scoped to Sindh region data only."),
        ("Balochistan",  "Dashboard scoped to Balochistan region data only."),
    ]
    elems.append(role_table(region_rows, styles))
    elems.append(Spacer(1, 4))
    elems.append(Paragraph(
        "After selecting a region, the dashboard loads with summary cards and three data sections. "
        "You can also switch provinces using the tab bar at the top of the dashboard.",
        styles["body"],
    ))
    elems.append(Spacer(1, 5))

    # Summary cards
    elems.append(Paragraph("Summary Cards", styles["h4"]))
    elems.append(Paragraph(
        "Four KPI cards appear at the top of the dashboard:", styles["body"],
    ))
    for card in ["Total Revenue (PKR)", "Total Orders", "Active Chemicals", "Avg. Sentiment Score"]:
        elems.append(Paragraph(f"• {card}", styles["bullet"]))
    elems.append(Spacer(1, 5))

    # 9.2 Inventory
    elems.append(Paragraph("9.2  Chemical Inventory Section", styles["h3"]))
    elems.append(Paragraph(
        "A horizontal bar chart visualises stock levels for all chemicals in the selected province. "
        "Click <b>View Details →</b> to expand to a full sortable table showing Name, Formula, "
        "Category, Stock (kg), Concentration, and Price per kg. Click <b>← Summary</b> to return "
        "to the chart view.",
        styles["body"],
    ))
    elems.append(Spacer(1, 5))

    # 9.3 Deliveries
    elems.append(Paragraph("9.3  Delivery Management", styles["h3"]))
    elems.append(Paragraph(
        "A doughnut chart shows delivery status distribution (Pending, Processing, Dispatched, "
        "In Transit, Delivered). An interactive <b>Leaflet.js map</b> displays GPS pins for all "
        "deliveries with location data. Click <b>View Details →</b> to see a full delivery table "
        "with status update controls.",
        styles["body"],
    ))
    elems.append(Spacer(1, 4))
    elems.append(info_box(
        "📍  Click any delivery row in the detail table to open the location picker and update "
        "the delivery's GPS pin.",
        styles, border=ACCENT_BLU,
    ))
    elems.append(Spacer(1, 5))

    # 9.4 Feedback
    elems.append(Paragraph("9.4  Feedback & Sentiment", styles["h3"]))
    elems.append(Paragraph(
        "A bar chart shows the distribution of feedback sentiment scores. Click <b>View Details →</b> "
        "to see individual feedback records with the original text, AI sentiment label, and score. "
        "This data helps Regional Admins identify service quality trends.",
        styles["body"],
    ))
    elems.append(Spacer(1, 5))

    # 9.5 Add Chemical
    elems.append(Paragraph("9.5  Adding Chemicals", styles["h3"]))
    elems.append(Paragraph(
        "Regional Admins can add new chemicals to the catalog. In the Chemical Inventory section, "
        "click the <b>+ Add Chemical</b> button to open the Add Chemical modal. Fill in:",
        styles["body"],
    ))
    add_chem_fields = [
        ("Chemical Name *",    "Required. The common name of the compound."),
        ("Formula",            "Molecular formula (e.g., H₂SO₄, NaOH)."),
        ("Province *",         "Required. Select the province where this chemical will be stocked."),
        ("Category",           "General, Acids, Bases, Solvents, Oxidizers, or Minerals."),
        ("Amount (kg)",        "Initial stock quantity in kilograms."),
        ("Concentration (%)",  "Purity/concentration percentage. Default: 100%."),
        ("Price per kg (PKR)", "Retail price per kilogram in Pakistani Rupees."),
        ("Description",        "Optional descriptive text for the chemical card."),
    ]
    elems.append(feature_table(add_chem_fields, styles))
    elems.append(PageBreak())
    return elems


def ch10_admin(styles):
    elems = []
    elems.append(Paragraph("10 · Admin Panel", styles["h2"]))
    elems.append(color_bar())
    elems.append(Spacer(1, 5))

    elems.append(info_box(
        "🔒  Access Level: Admin only. The Admin Panel link (06 · Admin Panel) is only visible to "
        "users with the Admin role.",
        styles, bg=BG_CARD, border=ERR_RED,
    ))
    elems.append(Spacer(1, 5))

    elems.append(Paragraph(
        "The Admin Panel is a modal dialog accessed from the sidebar. It contains two tabs: "
        "<b>Users</b> and <b>Admins</b>.",
        styles["body"],
    ))
    elems.append(Spacer(1, 5))

    # 10.1 Users tab
    elems.append(Paragraph("10.1  User Management (Users Tab)", styles["h3"]))
    elems.append(Paragraph(
        "The <b>Users</b> tab has three sections:", styles["body"],
    ))

    elems.append(Paragraph("Pending Approvals", styles["h4"]))
    elems.append(Paragraph(
        "Lists all user accounts that registered via the Manual Login form and are awaiting approval. "
        "Each entry shows the username and two action buttons:",
        styles["body"],
    ))
    elems.append(Paragraph("• <b>Approve</b> — Grants the user access to the platform.", styles["bullet"]))
    elems.append(Paragraph("• <b>Deny</b> — Rejects and deletes the pending registration.", styles["bullet"]))
    elems.append(Spacer(1, 5))

    elems.append(Paragraph("All Users", styles["h4"]))
    elems.append(Paragraph(
        "Lists all active user accounts. Each entry shows the username, current role, and action buttons "
        "to <b>change the role</b> or <b>delete</b> the account. Use the role dropdown to promote a "
        "User to Regional Admin, or an Admin to standard User.",
        styles["body"],
    ))
    elems.append(Spacer(1, 5))

    # 10.2 Pending approvals (already covered)
    # 10.3 Admins tab
    elems.append(Paragraph("10.3  Admin Management (Admins Tab)", styles["h3"]))
    elems.append(Paragraph(
        "The <b>Admins</b> tab manages administrator accounts:", styles["body"],
    ))
    elems.append(Paragraph("• <b>Pending Admin Requests</b> — Requests for admin elevation (if any) appear here.", styles["bullet"]))
    elems.append(Paragraph("• <b>Current Admins</b> — Lists all Admin-role accounts with their usernames.", styles["bullet"]))
    elems.append(Spacer(1, 5))

    # 10.4 Add user
    elems.append(Paragraph("10.4  Adding a User Directly", styles["h3"]))
    elems.append(Paragraph(
        "In the <b>Users</b> tab, use the <b>Add User</b> form to create an account without requiring "
        "self-registration or approval. Fill in:",
        styles["body"],
    ))
    add_user = [
        ("Username",    "A unique username for the new account."),
        ("Password",    "A secure password (stored as a bcrypt hash)."),
        ("Role",        "Select from: User, Regional Admin, or Admin."),
    ]
    elems.append(feature_table(add_user, styles))
    elems.append(Spacer(1, 4))
    elems.append(Paragraph(
        "Click <b>Add</b> to create the account immediately. The new user can log in at once "
        "using the Manual Login method.",
        styles["body"],
    ))
    elems.append(PageBreak())
    return elems


def ch11_notifications(styles):
    elems = []
    elems.append(Paragraph("11 · Notifications System", styles["h2"]))
    elems.append(color_bar())
    elems.append(Spacer(1, 5))

    elems.append(Paragraph(
        "ChemTech includes a real-time in-app notification system that keeps you informed of "
        "important events without requiring you to manually refresh or check pages.",
        styles["body"],
    ))
    elems.append(Spacer(1, 5))

    notif_rows = [
        ("Order Placed",        "A notification is sent when a new chemical order is successfully placed."),
        ("Delivery Status",     "Alerts are sent when the status of your delivery changes."),
        ("Account Approved",    "New users receive a notification when their registration is approved by an Admin."),
        ("Account Denied",      "Notifies users if their registration was rejected."),
        ("New User Pending",    "Admins receive a notification when a new user registers and awaits approval."),
        ("System Alerts",       "General system messages and announcements from Admins."),
    ]
    elems.append(role_table(notif_rows, styles))
    elems.append(Spacer(1, 5))

    elems.append(Paragraph("Managing Notifications", styles["h3"]))
    elems.append(Paragraph(
        "Click the <b>🔔 bell icon</b> to open the Notification Panel. Unread notifications are "
        "indicated by a red badge counter. To manage notifications:",
        styles["body"],
    ))
    elems.append(Paragraph("• Click <b>Clear All</b> to dismiss all notifications at once.", styles["bullet"]))
    elems.append(Paragraph("• Click the ✕ button on an individual notification to dismiss it.", styles["bullet"]))
    elems.append(Paragraph("• Click anywhere outside the panel to close it without dismissing.", styles["bullet"]))
    elems.append(PageBreak())
    return elems


def ch12_api_key(styles):
    elems = []
    elems.append(Paragraph("12 · API Key Management", styles["h2"]))
    elems.append(color_bar())
    elems.append(Spacer(1, 5))

    elems.append(Paragraph(
        "ChemTech uses the <b>Groq API</b> to power both the AI chatbot and the Analytics Engine "
        "when operating in Cloud mode. By default, the application uses the server-configured API key. "
        "You can optionally provide your own Groq API key for dedicated usage.",
        styles["body"],
    ))
    elems.append(Spacer(1, 5))

    elems.append(Paragraph("How to Use Your Own Key", styles["h3"]))
    steps = [
        "Open the <b>AI Engine</b> floating panel on the home screen (top-right corner).",
        "Toggle the <b>Your Groq API Key</b> switch to the ON position.",
        "The key input field will appear. Enter your Groq API key (format: <font face='Courier' color='#00e6c3'>gsk_...</font>).",
        "Click <b>Save</b>. The key is stored locally in your session.",
        "All subsequent AI requests will use your personal key.",
        "To remove your key, click the <b>✕</b> button next to the key field.",
    ]
    for i, s in enumerate(steps, 1):
        elems.append(Paragraph(f"<b>{i}.</b>  {s}", styles["bullet"]))
    elems.append(Spacer(1, 5))

    elems.append(info_box(
        "🔑  Your API key is never transmitted to ChemTech servers. It is stored client-side and "
        "sent directly to the Groq API with each AI request. Keep your key confidential and do not "
        "share it with others.",
        styles, border=WARN_YEL,
    ))
    elems.append(Spacer(1, 5))

    elems.append(Paragraph("Getting a Groq API Key", styles["h3"]))
    elems.append(Paragraph(
        "Visit <b>console.groq.com</b> to create a free Groq account and generate an API key. "
        "Free-tier keys have generous rate limits suitable for most ChemTech usage patterns.",
        styles["body"],
    ))
    elems.append(PageBreak())
    return elems


def ch13_troubleshooting(styles):
    elems = []
    elems.append(Paragraph("13 · Troubleshooting & FAQ", styles["h2"]))
    elems.append(color_bar())
    elems.append(Spacer(1, 5))

    faq = [
        ("The application won't launch / white screen",
         "Ensure the backend (Flask) started correctly. Check the Electron developer tools console for errors. "
         "Try closing and relaunching. If using a portable build, ensure you have write permission to the "
         "application directory."),

        ("AI chatbot returns no response",
         "Check your internet connection (required for Groq mode). Verify your Groq API key is valid if using "
         "a personal key. Switch to Ollama local mode if internet is unavailable. Check that Ollama is running "
         "if in Local mode."),

        ("Chemical Catalog shows 'Loading...' indefinitely",
         "The backend may not have started. Restart the application. If the issue persists, check that port 5000 "
         "is not blocked by a firewall or used by another application."),

        ("Cannot log in with Google",
         "Ensure you have an active internet connection. Google OAuth requires access to accounts.google.com. "
         "Check that your Google account has not been restricted. Try the Manual Login method as an alternative."),

        ("Order placed but not appearing in Delivery Tracker",
         "Refresh the Delivery Tracker panel by navigating away and back. If the issue persists, contact your "
         "Regional Admin to verify the order was recorded in the database."),

        ("Voice feedback is not transcribing",
         "Ensure microphone permission has been granted to the application. Check that your microphone is "
         "working in other applications. Voice features require a working browser audio API."),

        ("Notifications are not appearing",
         "Notifications are fetched periodically. Wait a few seconds after the triggering event. If notifications "
         "remain absent, try refreshing by navigating to a different panel and back."),

        ("Ollama local mode is very slow",
         "Ollama performance depends heavily on hardware. CPU-only inference for 7B+ models can take 30–120 "
         "seconds per response. Use Groq cloud mode for faster responses, or use a smaller model like llama3.2:1b."),

        ("How do I reset my password?",
         "Contact your system Admin. They can delete your account and create a new one via the Admin Panel. "
         "Google-authenticated accounts are managed through your Google Account settings."),

        ("My account is stuck in Pending status",
         "Contact your Admin and ask them to approve your account in the Admin Panel → Users → Pending Approvals."),
    ]

    for q, a in faq:
        elems.append(KeepTogether([
            Paragraph(f"<b>Q: {q}</b>", styles["h4"]),
            Paragraph(f"A: {a}", styles["body"]),
            Spacer(1, 4),
        ]))

    elems.append(PageBreak())
    return elems


def ch14_glossary(styles):
    elems = []
    elems.append(Paragraph("14 · Glossary", styles["h2"]))
    elems.append(color_bar())
    elems.append(Spacer(1, 5))

    terms = [
        ("API Key",          "A unique authentication token used to access an external API service (e.g., Groq)."),
        ("Electron",         "A framework that allows web technologies (HTML/CSS/JS) to run as native desktop apps."),
        ("Flask",            "A lightweight Python web framework used to build the ChemTech backend API."),
        ("Groq",             "A cloud AI inference service providing fast LLM (Large Language Model) API access."),
        ("GPS / Coordinates","Geographic latitude and longitude values used to pin delivery locations on a map."),
        ("KPI",              "Key Performance Indicator — a measurable value showing how effectively goals are met."),
        ("LLM",              "Large Language Model — an AI model trained on large text datasets (e.g., Llama 3.3)."),
        ("Leaflet.js",       "An open-source JavaScript library used for interactive maps in ChemTech."),
        ("Ollama",           "A tool for running LLMs locally on your own hardware without internet."),
        ("PKR",              "Pakistani Rupee — the currency unit used for all pricing in ChemTech."),
        ("Province",         "One of the four Pakistani regions supported: Punjab, KPK, Sindh, Balochistan."),
        ("Role",             "A user permission level: User, Regional Admin, or Admin."),
        ("Sentiment",        "AI-analysed emotional tone of customer feedback: Positive, Neutral, or Negative."),
        ("SQLite / Turso",   "The database technologies used to store ChemTech data (compatible SQL databases)."),
        ("TTS",              "Text-to-Speech — technology that converts AI text responses to spoken audio."),
        ("Web Speech API",   "Browser API enabling voice recognition and speech synthesis in web applications."),
    ]

    elems.append(feature_table(terms, styles))
    elems.append(Spacer(1, 10))

    elems.append(color_bar())
    elems.append(Spacer(1, 8))
    elems.append(Paragraph(
        "End of ChemTech User Manual v1.0",
        ParagraphStyle("end", fontName="Helvetica", fontSize=9,
                       textColor=TEXT_MUTED, alignment=TA_CENTER),
    ))
    elems.append(Paragraph(
        f"Generated on {datetime.now().strftime('%d %B %Y at %H:%M')}  ChemTech Molecular Innovation",
        ParagraphStyle("end2", fontName="Courier", fontSize=8,
                       textColor=TEAL_DARK, alignment=TA_CENTER),
    ))

    return elems


# ─── Main build ───────────────────────────────────────────────────────────────
def build_pdf():
    print("[ChemTech Manual] Starting PDF generation…")

    doc = SimpleDocTemplate(
        OUTPUT_PATH,
        pagesize=A4,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=26 * mm,
        bottomMargin=18 * mm,
        title="ChemTech User Manual",
        author="ChemTech",
        subject="User Manual v1.0",
    )

    styles = make_styles()

    # ── Assemble all elements ─────────────────────────────────────────────────
    story = []

    # Cover (no header/footer — we use a different canvas callback)
    story += build_cover(styles)

    # From page 2 onwards: header/footer
    # Table of contents
    story += build_toc_page(styles)

    # Chapters
    story += ch1_introduction(styles)
    story += ch2_requirements(styles)
    story += ch3_getting_started(styles)
    story += ch4_home_navigation(styles)
    story += ch5_chemicals(styles)
    story += ch6_deliveries(styles)
    story += ch7_ai_chatbot(styles)
    story += ch8_analytics(styles)
    story += ch9_regional_dashboard(styles)
    story += ch10_admin(styles)
    story += ch11_notifications(styles)
    story += ch12_api_key(styles)
    story += ch13_troubleshooting(styles)
    story += ch14_glossary(styles)

    # Build
    doc.build(story, onFirstPage=make_cover_footer, onLaterPages=make_header_footer)
    print(f"[ChemTech Manual] PDF saved successfully to: {OUTPUT_PATH}")


if __name__ == "__main__":
    build_pdf()
