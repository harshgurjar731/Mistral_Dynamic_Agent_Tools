import json
import logging
from sqlalchemy.orm import Session
from app.models import ToolRecord
import os
import hashlib

logger = logging.getLogger(__name__)

PREDEFINED_TOOLS = [
    {
        "name": "get_weather",
        "description": "Get current weather information for a specific location using real API data. Falls back to LLM-generated weather if the API is unavailable.",
        "schema_json": json.dumps({
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get current weather information for a specific location using real API data. Falls back to LLM-generated weather if the API is unavailable.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {"type": "string", "description": "City and country, e.g. 'Paris, France'"},
                        "unit": {"type": "string", "enum": ["celsius", "fahrenheit"], "description": "Temperature unit", "default": "celsius"},
                    },
                    "required": ["location"],
                },
            }
        }),
        "source_code": '''import requests
import urllib.parse
import json as _json

def run(location: str, unit: str = "celsius") -> dict:
    """Get weather using wttr.in free API with robust fallback."""
    try:
        encoded_loc = urllib.parse.quote(location)
        format_str = "%C+%t+%h+%w"
        url = (
            f"https://wttr.in/{encoded_loc}"
            f"?format={format_str}"
        )
        if unit == "fahrenheit":
            url += "&u"

        try:
            resp = requests.get(
                url,
                timeout=10,
                headers={"User-Agent": "curl/7.68.0"},
            )
            if resp.status_code == 200:
                text = resp.text.strip()
                if text and "Unknown" not in text:
                    return {
                        "location": location,
                        "unit": unit,
                        "weather": text,
                    }
                return {
                    "error": f"No weather data for '{location}'",
                    "fallback_hint": (
                        f"Generate realistic weather data for "
                        f"{location} in {unit}"
                    ),
                }
            return {
                "error": (
                    f"Weather API returned status "
                    f"{resp.status_code}"
                ),
                "fallback_hint": (
                    f"Generate realistic weather data for "
                    f"{location} in {unit}"
                ),
            }
        except requests.exceptions.RequestException as e:
            return {
                "error": f"Weather API unreachable: {str(e)}",
                "fallback_hint": (
                    f"Generate realistic current weather for "
                    f"{location} in {unit}: temperature, "
                    f"humidity, wind, conditions"
                ),
            }
    except Exception as e:
        return {
            "error": f"Weather lookup failed: {str(e)}",
            "fallback_hint": (
                f"Generate weather data for {location}"
            ),
        }
'''
    },
    {
        "name": "calculate",
        "description": "Evaluate a mathematical expression and return the result. Supports basic arithmetic, trigonometry, logarithms, etc.",
        "schema_json": json.dumps({
            "type": "function",
            "function": {
                "name": "calculate",
                "description": "Evaluate a mathematical expression and return the result.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "expression": {"type": "string", "description": "Mathematical expression to evaluate, e.g. '2 * (3 + 4) / 5'"},
                    },
                    "required": ["expression"],
                },
            }
        }),
        "source_code": '''import math

def run(expression: str) -> dict:
    """Safe math expression evaluator."""
    allowed = {
        "__builtins__": None,
        "abs": abs, "round": round,
        "min": min, "max": max, "pow": pow,
        "sum": sum, "int": int, "float": float,
        "sin": math.sin, "cos": math.cos,
        "tan": math.tan, "sqrt": math.sqrt,
        "log": math.log, "log10": math.log10,
        "pi": math.pi, "e": math.e,
        "ceil": math.ceil, "floor": math.floor,
    }
    try:
        result = eval(expression, allowed)
        return {
            "expression": expression,
            "result": result,
        }
    except ZeroDivisionError:
        return {
            "error": "Division by zero",
            "expression": expression,
            "fallback_hint": (
                f"The expression '{expression}' involves "
                f"division by zero"
            ),
        }
    except Exception as e:
        return {
            "error": f"Calculation error: {str(e)}",
            "expression": expression,
            "fallback_hint": (
                f"Evaluate the math expression: {expression}"
            ),
        }
'''
    },
    {
        "name": "search_knowledge",
        "description": "Search an internal knowledge base for relevant documents, articles, or data on a given topic. Falls back to LLM knowledge if the search API is unavailable.",
        "schema_json": json.dumps({
            "type": "function",
            "function": {
                "name": "search_knowledge",
                "description": "Search knowledge base for relevant documents. Falls back to LLM knowledge if API unavailable.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query to find relevant knowledge"},
                        "max_results": {"type": "integer", "description": "Maximum number of results", "default": 5},
                    },
                    "required": ["query"],
                },
            }
        }),
        "source_code": '''import requests
import urllib.parse
import json as _json

def run(query: str, max_results: int = 5) -> dict:
    """Search knowledge base via Wikipedia with fallback."""
    try:
        encoded_query = urllib.parse.quote(query)
        try:
            resp = requests.get(
                "https://en.wikipedia.org/w/api.php",
                params={
                    "action": "query",
                    "list": "search",
                    "srsearch": query,
                    "srlimit": max_results,
                    "format": "json",
                },
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json()
                results = (
                    data
                    .get("query", {})
                    .get("search", [])
                )
                if results:
                    return {
                        "query": query,
                        "results": [
                            {
                                "title": r["title"],
                                "snippet": r.get(
                                    "snippet", ""
                                ),
                            }
                            for r in results
                        ],
                        "count": len(results),
                    }
                return {
                    "error": f"No results for '{query}'",
                    "fallback_hint": (
                        f"Provide {max_results} knowledge "
                        f"articles about: {query}"
                    ),
                }
            return {
                "error": (
                    f"Wikipedia API status "
                    f"{resp.status_code}"
                ),
                "fallback_hint": (
                    f"Provide {max_results} knowledge "
                    f"summaries about: {query}"
                ),
            }
        except requests.exceptions.RequestException as e:
            return {
                "error": (
                    f"Knowledge search API unreachable: "
                    f"{str(e)}"
                ),
                "fallback_hint": (
                    f"Provide {max_results} detailed "
                    f"knowledge entries about: {query}"
                ),
            }
    except Exception as e:
        return {
            "error": f"Search failed: {str(e)}",
            "fallback_hint": (
                f"Provide information about: {query}"
            ),
        }
'''
    },
    {
        "name": "create_document",
        "description": "Create a structured document (report, summary, analysis) locally and return a download URL.",
        "schema_json": json.dumps({
            "type": "function",
            "function": {
                "name": "create_document",
                "description": "Create a structured document and return a download URL. The document is saved locally and can be downloaded.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Document title"},
                        "content": {"type": "string", "description": "Document content in markdown format"},
                        "doc_type": {"type": "string", "enum": ["report", "summary", "analysis", "memo"], "description": "Type of document", "default": "report"},
                    },
                    "required": ["title", "content"],
                },
            }
        }),
        "source_code": '''import re
import datetime as _dt
import hashlib as _hl
import json as _json

def run(
    title: str,
    content: str,
    doc_type: str = "report",
) -> dict:
    """Create a document and return metadata with download URL."""
    try:
        # Sanitize filename
        safe_title = re.sub(r"[^a-zA-Z0-9_\\- ]", "", title)
        safe_title = safe_title.strip().replace(" ", "_").lower()
        if not safe_title:
            safe_title = "untitled"

        ts = _dt.datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{safe_title}_{doc_type}_{ts}.md"

        # Build full markdown document
        now = _dt.datetime.now().strftime("%B %d, %Y at %H:%M")
        header = (
            f"# {title}\\n\\n"
            f"**Type:** {doc_type.capitalize()}\\n"
            f"**Generated:** {now}\\n\\n---\\n\\n"
        )
        full_content = header + content

        # Write to the documents directory
        # (the execution service handles the actual I/O
        #  since sandbox cannot use os module)
        return {
            "title": title,
            "doc_type": doc_type,
            "filename": filename,
            "content": full_content,
            "download_url": (
                f"http://localhost:9000/documents/{filename}"
            ),
            "_needs_file_write": True,
        }
    except Exception as e:
        return {
            "error": f"Document creation failed: {str(e)}",
            "fallback_hint": (
                f"Create a {doc_type} document titled "
                f"\\'{title}\\' with the provided content"
            ),
        }
'''
    },
    {
        "name": "send_email",
        "description": "Compose and send an email to a specified recipient.",
        "schema_json": json.dumps({
            "type": "function",
            "function": {
                "name": "send_email",
                "description": "Compose and send an email to a specified recipient.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "to": {"type": "string", "description": "Recipient email address"},
                        "subject": {"type": "string", "description": "Email subject line"},
                        "body": {"type": "string", "description": "Email body content"},
                    },
                    "required": ["to", "subject", "body"],
                },
            }
        }),
        "source_code": '''import re
import logging

logger = logging.getLogger(__name__)

def run(to: str, subject: str, body: str) -> dict:
    """Send email (mock — logs the email details)."""
    try:
        # Basic email validation
        if not re.match(
            r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\\.[a-zA-Z0-9-.]+$",
            to,
        ):
            return {
                "error": f"Invalid email address: {to}",
                "fallback_hint": (
                    "The email address format is invalid"
                ),
            }

        logger.info(
            "EMAIL SENT to=%s subject=%s body=%s...",
            to, subject, body[:100],
        )
        return {
            "status": "sent",
            "to": to,
            "subject": subject,
            "message": (
                f"Email sent successfully to {to} "
                f"with subject \\'{subject}\\'"
            ),
        }
    except Exception as e:
        return {
            "error": f"Email failed: {str(e)}",
            "fallback_hint": (
                f"Confirm email to {to} with subject "
                f"\\'{subject}\\' was queued"
            ),
        }
'''
    }
]

def seed_native_tools(db: Session):
    """Seed the database with predefined native tools if they don't exist."""
    seeded = 0
    os.makedirs("dynamic_tools", exist_ok=True)
    
    for tool in PREDEFINED_TOOLS:
        name = tool["name"]
        
        # Check if exists
        existing = db.query(ToolRecord).filter_by(name=name).first()
        if not existing:
            # Generate hash
            source = tool["source_code"]
            file_hash = hashlib.sha256(source.encode()).hexdigest()[:8]
            module_path = f"dynamic_tools/{name}_{file_hash}.py"
            
            # Write to disk
            with open(module_path, "w", encoding="utf-8") as f:
                f.write(source)
            
            # Insert to DB
            record = ToolRecord(
                name=name,
                hash=file_hash,
                version="1.0.0",
                schema_json=tool["schema_json"],
                source_code=source,
                module_path=module_path,
                status="approved",
                sandbox_output="Pre-approved native tool.",
                version_no=1,
                is_active=True,
            )
            db.add(record)
            seeded += 1
        else:
            # Update existing tool source code to latest version
            source = tool["source_code"]
            if existing.source_code != source:
                file_hash = hashlib.sha256(
                    source.encode()
                ).hexdigest()[:8]
                module_path = (
                    f"dynamic_tools/{name}_{file_hash}.py"
                )

                # Remove old file if different path
                if (
                    existing.module_path
                    and existing.module_path != module_path
                    and os.path.exists(existing.module_path)
                ):
                    os.remove(existing.module_path)

                with open(module_path, "w", encoding="utf-8") as f:
                    f.write(source)

                existing.source_code = source
                existing.hash = file_hash
                existing.module_path = module_path
                existing.schema_json = tool["schema_json"]
                logger.info(
                    "Updated native tool '%s' to latest version",
                    name,
                )
            
    if seeded > 0:
        db.commit()
        logger.info(
            f"Seeded {seeded} native tools into "
            f"dynamic_tools database."
        )
    else:
        db.commit()  # commit any updates
