"""
Project File Report Generator
Scans all project files and generates a PDF with:
1. File name
2. Short description
3. APIs/endpoints available
4. Total lines of code
"""

import os
import re
import ast
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch, cm
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph,
    Spacer, HRFlowable, PageBreak, KeepTogether
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import Image
import datetime

# ──────────────────────────────────────────────
# CONFIG
# ──────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent

SKIP_DIRS = {
    ".git", ".venv", "venv", "__pycache__", "node_modules",
    "dist", "build", ".next", ".mypy_cache", ".ruff_cache",
    ".mistral_workflows", "mcp_servers", "dynamic_tools"
}

SKIP_FILES = {
    ".gitignore", ".gitattributes", "package-lock.json",
    "sql_app.db", "tsc_errors.txt", ".env", ".env.example",
    "openapi.yaml", "tools.json", ".dockerignore",
}

INCLUDE_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx",
    ".json", ".yaml", ".yml", ".md", ".txt",
    ".html", ".css", ".env.example",
}

# ──────────────────────────────────────────────
# COLOUR PALETTE
# ──────────────────────────────────────────────
PRIMARY   = colors.HexColor("#1E1B4B")   # deep indigo
ACCENT    = colors.HexColor("#6366F1")   # violet
LIGHT_BG  = colors.HexColor("#F0F0FF")   # lavender tint
ALT_ROW   = colors.HexColor("#F8F7FF")   # very light lavender
HEADER_FG = colors.white
BORDER    = colors.HexColor("#C7D2FE")   # indigo-200
TEXT_DARK = colors.HexColor("#1E1B4B")
TEXT_MID  = colors.HexColor("#4338CA")
MUTED     = colors.HexColor("#6B7280")


# ──────────────────────────────────────────────
# HELPERS — file analysis
# ──────────────────────────────────────────────

def count_lines(filepath: Path) -> int:
    try:
        return sum(1 for _ in open(filepath, encoding="utf-8", errors="ignore"))
    except Exception:
        return 0


def describe_file(filepath: Path) -> str:
    """Return a short, human-readable description based on name/content."""
    name = filepath.name
    rel  = str(filepath.relative_to(PROJECT_ROOT)).replace("\\", "/")
    ext  = filepath.suffix.lower()

    # ── known filenames ──────────────────────────────────────────────────
    known = {
        "main.py":                    "Application entry point; registers routers and starts the FastAPI server.",
        "config.py":                  "Loads and exposes environment-level configuration (API keys, DB URL, etc.).",
        "database.py":                "SQLAlchemy engine / session factory and Base declarative model.",
        "dependencies.py":            "FastAPI dependency-injection helpers (DB session, auth tokens, etc.).",
        "exceptions.py":              "Custom HTTP exception classes and global exception handlers.",
        "prompts.py":                 "LLM system-prompt templates used by the orchestrator and code-gen pipeline.",
        "models.py":                  "SQLAlchemy ORM model definitions for database tables.",
        "schemas.py":                 "Pydantic request/response schema definitions.",
        "seed_native_tools.py":       "Seeds the database with pre-built native tool definitions on startup.",
        "requirements.txt":           "Python package dependencies for the service.",
        "sandbox_requirements.txt":   "Additional Python packages installed inside the sandboxed tool executor.",
        "Dockerfile":                 "Docker image build instructions for containerising the service.",
        "docker-compose.yml":         "Multi-container Docker Compose configuration (app + DB services).",
        "vite.config.ts":             "Vite bundler configuration for the React/TypeScript frontend.",
        "tsconfig.json":              "Root TypeScript compiler configuration.",
        "tsconfig.app.json":          "TypeScript configuration for the application source.",
        "tsconfig.node.json":         "TypeScript configuration for Node build scripts.",
        "package.json":               "NPM package manifest: dependencies, scripts, and project metadata.",
        "eslint.config.js":           "ESLint linting rules for the TypeScript/React codebase.",
        "index.html":                 "Root HTML shell loaded by Vite; mounts the React SPA.",
        "index.css":                  "Global CSS reset and base styles for the frontend.",
        "App.tsx":                    "Root React component; defines client-side routing and global layout.",
        "main.tsx":                   "React DOM entry point; renders <App /> into the HTML shell.",
        "client.ts":                  "Configured Axios HTTP client with base URL and auth interceptors.",
        "sse.ts":                     "Server-Sent Events helper for real-time streaming responses from the backend.",
        "README.md":                  "Project-level README with setup, architecture overview, and usage instructions.",
        "DESIGN.md":                  "Frontend design-system specification (colours, typography, component patterns).",
        "api_documentation.md":       "Human-readable API reference summarising all backend routes.",
        "hybrid_architecture_implementation.md": "Deep-dive implementation notes on the hybrid Mistral + local workflow architecture.",
        # backend routes
        "agents.py":                  "FastAPI router exposing CRUD endpoints for Mistral agent resources.",
        "chat.py":                    "FastAPI router for streaming general-purpose chat completions.",
        "conversations.py":           "FastAPI router for listing and deleting conversation histories.",
        "orchestrator.py":            "FastAPI router for the multi-agent orchestrator chat interface.",
        "tools.py":                   "FastAPI router for tool CRUD, synthesis triggering, and execution.",
        "workflows.py":               "FastAPI router for workflow planning, execution, archiving, and history.",
        # backend services
        "_worker_inner.py":           "Inner subprocess logic for the Mistral Temporal workflow worker.",
        "agent_service.py":           "Business logic for creating, listing, and deleting Mistral agents via SDK.",
        "chat_service.py":            "Handles streaming chat completions using the Mistral SDK.",
        "conversation_service.py":    "CRUD operations on conversation records stored in the database.",
        "conversational_workflow_service.py": "Orchestrates multi-turn conversational workflow execution sessions.",
        "mistral_worker.py":          "Manages the background Temporal worker process lifecycle.",
        "mistral_workflows_compiler.py": "Compiles JSON workflow plans into executable Mistral Workflow Python modules.",
        "orchestrator_service.py":    "Multi-agent orchestration logic: selects, invokes, and chains agent calls.",
        "tool_registry.py":           "Maintains an in-memory registry of available tools and their metadata.",
        "tool_resolver.py":           "Resolves tool call requests to the appropriate executor (native, dynamic, MCP).",
        "workflow_planner.py":        "LLM-driven planner that converts user goals into structured workflow plans.",
        # workflow engine
        "engine.py":                  "Core workflow execution engine: step scheduling, retries, and state tracking.",
        "step_runners.py":            "Concrete runners for each workflow step type (agent, tool, conditional, etc.).",
        # tool-service routes
        "execution.py":               "Tool-service route for executing a specific tool by ID.",
        "management.py":              "Tool-service routes for registering, listing, updating, and deleting tools.",
        "mcp.py":                     "Tool-service route for proxying MCP server tool calls.",
        "synthesis.py":               "Tool-service route for triggering AI-driven tool code synthesis.",
        # tool-service services
        "execution_service.py":       "Safely executes dynamic tool code inside a restricted sandbox environment.",
        "llm_fallback.py":            "Provides LLM-generated synthetic fallback results when tool execution fails.",
        "mcp_manager.py":             "Manages connections to Model Context Protocol servers and proxies tool calls.",
        "sandbox.py":                 "Configures and enforces the Python sandbox for untrusted tool execution.",
        "synthesis_service.py":       "Generates Python tool source code from a natural-language description via LLM.",
        # frontend api
        "agents.ts":                  "Frontend API calls for agent CRUD operations.",
        "chat.ts":                    "Frontend API calls for general chat streaming.",
        "conversations.ts":           "Frontend API calls for conversation management.",
        "health.ts":                  "Frontend API call to check backend liveness.",
        "mcp.ts":                     "Frontend API calls for MCP server tool queries.",
        "orchestrator.ts":            "Frontend API calls for the orchestrator chat interface.",
        "workflowPlanner.ts":         "Frontend API calls for workflow planning requests.",
        "workflows.ts":               "Frontend API calls for workflow lifecycle management.",
        # frontend features
        "AgentDetail.tsx":            "Page displaying a single agent's configuration and conversation interface.",
        "AgentStudio.tsx":            "Agent Studio page: lists, creates, and manages Mistral agents.",
        "GeneralChat.tsx":            "General-purpose chat page with streaming message support.",
        "OrchestratorChat.tsx":       "Orchestrator chat page that shows multi-agent reasoning steps.",
        "ToolLifecycle.tsx":          "Tool Lifecycle page: tool creation, synthesis, editing, and deletion.",
        "ArchivedWorkflows.tsx":      "Displays the list of archived (completed) workflow executions.",
        "WorkflowDashboard.tsx":      "Workflow Dashboard: summary cards and navigation hub for workflows.",
        "WorkflowExecutionModal.tsx": "Modal dialog for launching and configuring a workflow execution.",
        "WorkflowExecutionPage.tsx":  "Full-page real-time workflow execution view with live step tracking.",
        "WorkflowHistoryPanel.tsx":   "Side panel showing the execution history for a given workflow.",
        "WorkflowPlanner.tsx":        "Interactive UI for designing and submitting new workflow plans.",
        "WorkflowVisualizer.tsx":     "SVG-based visual graph of workflow steps and their dependencies.",
        # backend utility scripts
        "_diag.py":                   "Diagnostic script for inspecting backend state and DB contents.",
        "check_stuck.py":             "Utility to detect and report workflow tasks stuck in a pending state.",
        "check_tasks.py":             "Utility to list and inspect current background tasks.",
        "direct_recompile.py":        "Script to force-recompile a workflow module without restarting the server.",
        "re_register.py":             "Script to re-register workflow definitions with the Mistral cloud.",
        "rewrite.py":                 "Utility to rewrite/migrate tool or workflow records in the database.",
        "test_endpoint.py":           "Ad-hoc HTTP test script for manually probing backend endpoints.",
        "test_stream.py":             "Ad-hoc test script for validating SSE streaming from the backend.",
        # mistral_workflows
        "workflow_personalized_fitness_plan_workflow.py": "Compiled Mistral workflow that generates a personalised fitness plan using agent steps.",
    }

    if name in known:
        return known[name]

    # ── generic fallbacks by extension ──────────────────────────────────
    if ext == ".py":
        return "Python module providing supporting logic for the service."
    if ext in (".ts", ".tsx"):
        return "TypeScript/React module providing UI or API-client functionality."
    if ext == ".md":
        return "Markdown documentation file."
    if ext in (".yaml", ".yml"):
        return "YAML configuration or schema file."
    if ext == ".json":
        return "JSON data or configuration file."
    if ext in (".js", ".jsx"):
        return "JavaScript module."
    if ext == ".css":
        return "CSS stylesheet."
    if ext == ".html":
        return "HTML template file."
    if ext == ".txt":
        return "Plain-text file (requirements list or notes)."
    return "Project support file."


def extract_apis(filepath: Path) -> list[tuple[str, str]]:
    """Return list of (method+path, handler_name) tuples for route files,
    or (call_name, description) for API-client files."""
    text = ""
    try:
        text = filepath.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []

    apis = []
    ext  = filepath.suffix.lower()

    # ── FastAPI / Flask Python routes ────────────────────────────────────
    if ext == ".py":
        # @router.get("/path") or @app.post("/path")
        route_re = re.compile(
            r'@(?:router|app)\.(get|post|put|patch|delete|websocket)\s*\(\s*["\']([^"\']+)["\']',
            re.IGNORECASE
        )
        func_re = re.compile(r'(?:async\s+)?def\s+(\w+)\s*\(')
        lines = text.splitlines()
        i = 0
        while i < len(lines):
            m = route_re.search(lines[i])
            if m:
                method = m.group(1).upper()
                path   = m.group(2)
                # look ahead for the function name
                handler = ""
                for j in range(i + 1, min(i + 5, len(lines))):
                    fm = func_re.search(lines[j])
                    if fm:
                        handler = fm.group(1)
                        break
                apis.append((f"{method} {path}", handler or "—"))
            i += 1

    # ── TypeScript API client files ──────────────────────────────────────
    elif ext in (".ts", ".tsx") and filepath.parent.name == "api":
        func_re = re.compile(r'(?:export\s+(?:async\s+)?function|export\s+const)\s+(\w+)', re.MULTILINE)
        method_re = re.compile(r'\.(get|post|put|patch|delete)\s*[(<]', re.IGNORECASE)
        url_re    = re.compile(r'["`\'](/[^"`\']+)["`\']')

        for m in func_re.finditer(text):
            fn_name = m.group(1)
            # try to find the HTTP method and URL in the surrounding lines
            start = m.start()
            snippet = text[start:start + 600]
            method_m = method_re.search(snippet)
            url_m    = url_re.search(snippet)
            method   = method_m.group(1).upper() if method_m else "?"
            url      = url_m.group(1) if url_m else "—"
            apis.append((f"{method} {url}", fn_name))

    return apis


# ──────────────────────────────────────────────
# FILE COLLECTOR
# ──────────────────────────────────────────────

def collect_files() -> list[dict]:
    records = []
    for root, dirs, files in os.walk(PROJECT_ROOT):
        # prune unwanted dirs
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for fname in sorted(files):
            fpath = Path(root) / fname
            if fname in SKIP_FILES:
                continue
            if fpath.suffix.lower() not in INCLUDE_EXTENSIONS and fpath.suffix != "":
                continue
            # skip the script itself and its output
            if fpath.name in {"generate_report.py", "Project_File_Report.pdf"}:
                continue
            rel  = str(fpath.relative_to(PROJECT_ROOT)).replace("\\", "/")
            apis = extract_apis(fpath)
            records.append({
                "name":       fname,
                "path":       rel,
                "description": describe_file(fpath),
                "apis":       apis,
                "loc":        count_lines(fpath),
            })
    return records


# ──────────────────────────────────────────────
# PDF BUILDER
# ──────────────────────────────────────────────

def build_pdf(records: list[dict], output_path: Path):
    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=landscape(A4),
        leftMargin=1.2 * cm,
        rightMargin=1.2 * cm,
        topMargin=1.5 * cm,
        bottomMargin=1.5 * cm,
    )

    styles = getSampleStyleSheet()
    W = landscape(A4)[0] - 2.4 * cm   # usable width

    # ── custom paragraph styles ──────────────────────────────────────────
    title_style = ParagraphStyle(
        "Title", fontSize=22, textColor=PRIMARY, spaceAfter=4,
        fontName="Helvetica-Bold", alignment=TA_CENTER
    )
    sub_style = ParagraphStyle(
        "Sub", fontSize=10, textColor=MUTED, spaceAfter=2,
        fontName="Helvetica", alignment=TA_CENTER
    )
    section_style = ParagraphStyle(
        "Section", fontSize=13, textColor=PRIMARY, spaceBefore=14, spaceAfter=6,
        fontName="Helvetica-Bold", borderPad=4,
    )
    cell_name = ParagraphStyle(
        "CellName", fontSize=8.5, fontName="Helvetica-Bold",
        textColor=TEXT_DARK, leading=12,
    )
    cell_path = ParagraphStyle(
        "CellPath", fontSize=7, fontName="Helvetica",
        textColor=MUTED, leading=10,
    )
    cell_body = ParagraphStyle(
        "CellBody", fontSize=8, fontName="Helvetica",
        textColor=TEXT_DARK, leading=11, alignment=TA_JUSTIFY,
    )
    cell_api = ParagraphStyle(
        "CellApi", fontSize=7.5, fontName="Courier",
        textColor=TEXT_MID, leading=11,
    )
    cell_api_name = ParagraphStyle(
        "CellApiName", fontSize=7.5, fontName="Helvetica-Oblique",
        textColor=MUTED, leading=11,
    )
    cell_loc = ParagraphStyle(
        "CellLoc", fontSize=9, fontName="Helvetica-Bold",
        textColor=ACCENT, alignment=TA_CENTER,
    )

    # ── column widths ────────────────────────────────────────────────────
    col_name  = W * 0.16
    col_desc  = W * 0.28
    col_api   = W * 0.44
    col_loc   = W * 0.12

    def make_header_row():
        hdr = ParagraphStyle("Hdr", fontSize=9, fontName="Helvetica-Bold",
                              textColor=HEADER_FG, alignment=TA_CENTER)
        return [
            Paragraph("File", hdr),
            Paragraph("Description", hdr),
            Paragraph("APIs / Endpoints", hdr),
            Paragraph("LOC", hdr),
        ]

    # ── group files by top-level directory ──────────────────────────────
    groups: dict[str, list[dict]] = {}
    for r in records:
        top = r["path"].split("/")[0] if "/" in r["path"] else "root"
        groups.setdefault(top, []).append(r)

    story = []

    # ── cover / header ───────────────────────────────────────────────────
    story.append(Spacer(1, 0.4 * inch))
    story.append(Paragraph("Mistral Dynamic Agent Tools", title_style))
    story.append(Paragraph("Project File Report", title_style))
    story.append(Spacer(1, 0.1 * inch))
    generated = datetime.datetime.now().strftime("%d %B %Y, %H:%M")
    story.append(Paragraph(f"Generated: {generated}  |  Total files: {len(records)}", sub_style))
    story.append(Spacer(1, 0.15 * inch))
    story.append(HRFlowable(width="100%", thickness=2, color=ACCENT))
    story.append(Spacer(1, 0.1 * inch))

    section_order = ["root", "backend", "tool-service", "frontend", "mistral_workflows"]
    ordered_groups = []
    for s in section_order:
        if s in groups:
            ordered_groups.append((s, groups.pop(s)))
    for k, v in groups.items():
        ordered_groups.append((k, v))

    for section_name, section_files in ordered_groups:
        label_map = {
            "root":              "📁 Root / Project-Level Files",
            "backend":           "🐍 Backend Service  (FastAPI)",
            "tool-service":      "🔧 Tool Service  (FastAPI)",
            "frontend":          "⚛️  Frontend  (React + TypeScript)",
            "mistral_workflows": "🤖 Mistral Workflows",
        }
        label = label_map.get(section_name, f"📂 {section_name}")
        story.append(Paragraph(label, section_style))

        # table header
        header = make_header_row()
        table_data = [header]

        for rec in section_files:
            # ── Name column ──────────────────────────────────────────────
            name_cell = [
                Paragraph(rec["name"], cell_name),
                Paragraph(rec["path"], cell_path),
            ]

            # ── Description column ───────────────────────────────────────
            desc_cell = Paragraph(rec["description"], cell_body)

            # ── APIs column ──────────────────────────────────────────────
            if rec["apis"]:
                api_parts = []
                for endpoint, handler in rec["apis"]:
                    api_parts.append(Paragraph(f"▸ {endpoint}", cell_api))
                    if handler and handler != "—":
                        api_parts.append(Paragraph(f"   ↳ {handler}", cell_api_name))
                api_cell = api_parts
            else:
                api_cell = [Paragraph("—", cell_body)]

            # ── LOC column ───────────────────────────────────────────────
            loc_cell = Paragraph(str(rec["loc"]), cell_loc)

            table_data.append([name_cell, desc_cell, api_cell, loc_cell])

        t = Table(
            table_data,
            colWidths=[col_name, col_desc, col_api, col_loc],
            repeatRows=1,
        )

        row_count = len(table_data)
        row_styles = [
            # header
            ("BACKGROUND",  (0, 0), (-1, 0), PRIMARY),
            ("TEXTCOLOR",   (0, 0), (-1, 0), HEADER_FG),
            ("FONTNAME",    (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",    (0, 0), (-1, 0), 9),
            ("ALIGN",       (0, 0), (-1, 0), "CENTER"),
            ("VALIGN",      (0, 0), (-1, 0), "MIDDLE"),
            ("TOPPADDING",  (0, 0), (-1, 0), 8),
            ("BOTTOMPADDING",(0,0), (-1, 0), 8),
            # body
            ("FONTSIZE",    (0, 1), (-1, -1), 8),
            ("VALIGN",      (0, 1), (-1, -1), "TOP"),
            ("TOPPADDING",  (0, 1), (-1, -1), 6),
            ("BOTTOMPADDING",(0,1), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING",(0, 0), (-1, -1), 6),
            # borders
            ("GRID",        (0, 0), (-1, -1), 0.4, BORDER),
            ("LINEBELOW",   (0, 0), (-1, 0),  1.0, ACCENT),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, ALT_ROW]),
            # LOC column alignment
            ("ALIGN",       (3, 1), (3, -1), "CENTER"),
            ("VALIGN",      (3, 1), (3, -1), "MIDDLE"),
        ]

        t.setStyle(TableStyle(row_styles))
        story.append(t)
        story.append(Spacer(1, 0.25 * inch))

    # ── summary table ────────────────────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=1.5, color=ACCENT))
    story.append(Spacer(1, 0.1 * inch))
    story.append(Paragraph("📊 Summary", section_style))

    total_loc = sum(r["loc"] for r in records)
    total_api = sum(len(r["apis"]) for r in records)

    sum_hdr = ParagraphStyle("SHdr", fontSize=9, fontName="Helvetica-Bold",
                             textColor=HEADER_FG, alignment=TA_CENTER)
    sum_cell = ParagraphStyle("SCell", fontSize=11, fontName="Helvetica-Bold",
                              textColor=ACCENT, alignment=TA_CENTER)
    sum_label = ParagraphStyle("SLabel", fontSize=8, fontName="Helvetica",
                               textColor=MUTED, alignment=TA_CENTER)

    sum_data = [
        [Paragraph("Total Files", sum_hdr),
         Paragraph("Total Lines of Code", sum_hdr),
         Paragraph("Total API Endpoints", sum_hdr)],
        [Paragraph(str(len(records)), sum_cell),
         Paragraph(f"{total_loc:,}", sum_cell),
         Paragraph(str(total_api), sum_cell)],
        [Paragraph("files analysed", sum_label),
         Paragraph("across all source files", sum_label),
         Paragraph("routes & client calls found", sum_label)],
    ]
    sw = W * 0.6
    sum_t = Table(sum_data, colWidths=[sw / 3] * 3)
    sum_t.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, 0), PRIMARY),
        ("BACKGROUND",   (0, 1), (-1, 2), LIGHT_BG),
        ("GRID",         (0, 0), (-1, -1), 0.4, BORDER),
        ("LINEBELOW",    (0, 0), (-1, 0), 1.0, ACCENT),
        ("TOPPADDING",   (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 8),
        ("ALIGN",        (0, 0), (-1, -1), "CENTER"),
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(sum_t)
    story.append(Spacer(1, 0.3 * inch))

    def on_page(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(MUTED)
        canvas.drawString(1.2 * cm, 0.8 * cm,
                          "Mistral Dynamic Agent Tools — Project File Report")
        canvas.drawRightString(
            landscape(A4)[0] - 1.2 * cm, 0.8 * cm,
            f"Page {doc.page}"
        )
        canvas.restoreState()

    doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
    print(f"PDF written -> {output_path}")


# ──────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────
if __name__ == "__main__":
    print("Scanning project files...")
    records = collect_files()
    print(f"   Found {len(records)} files")

    output = PROJECT_ROOT / "Project_File_Report.pdf"
    print(f"Building PDF -> {output}")
    build_pdf(records, output)
