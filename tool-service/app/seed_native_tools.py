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
        "description": "Get current weather information for a specific location using real API data.",
        "schema_json": json.dumps({
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "Get current weather information for a specific location using real API data.",
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

def run(location: str, unit: str = "celsius") -> str:
    """Get weather using wttr.in free API."""
    try:
        format_str = "%C+%t+%h+%w"
        url = f"https://wttr.in/{location}?format={format_str}"
        if unit == "fahrenheit":
            url += "&u"
        resp = requests.get(url, timeout=10)
        if resp.status_code == 200:
            return f"Weather in {location}: {resp.text.strip()}"
        return f"Weather API returned status {resp.status_code}"
    except Exception as e:
        return f"Weather lookup failed: {str(e)}"
'''
    },
    {
        "name": "calculate",
        "description": "Evaluate a mathematical expression and return the result. Supports basic arithmetic, trigonometry, logarithms, etc.",
        "schema_json": json.dumps({
            "type": "function",
            "function": {
                "name": "calculate",
                "description": "Evaluate a mathematical expression and return the result. Supports basic arithmetic, trigonometry, logarithms, etc.",
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

def run(expression: str) -> str:
    """Safe math expression evaluator."""
    allowed = {
        "__builtins__": None,
        "abs": abs, "round": round, "min": min, "max": max, "pow": pow,
        "sum": sum, "int": int, "float": float,
        "sin": math.sin, "cos": math.cos, "tan": math.tan,
        "sqrt": math.sqrt, "log": math.log, "log10": math.log10,
        "pi": math.pi, "e": math.e, "ceil": math.ceil, "floor": math.floor,
    }
    try:
        result = eval(expression, allowed)
        return str(result)
    except Exception as e:
        return f"Calculation error: {str(e)}"
'''
    },
    {
        "name": "search_knowledge",
        "description": "Search an internal knowledge base for relevant documents, articles, or data on a given topic.",
        "schema_json": json.dumps({
            "type": "function",
            "function": {
                "name": "search_knowledge",
                "description": "Search an internal knowledge base for relevant documents, articles, or data on a given topic.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query to find relevant knowledge"},
                        "max_results": {"type": "integer", "description": "Maximum number of results to return", "default": 5},
                    },
                    "required": ["query"],
                },
            }
        }),
        "source_code": '''import requests
import json

def run(query: str, max_results: int = 5) -> str:
    """Search knowledge base (real search via Wikipedia)."""
    try:
        resp = requests.get(
            f"https://en.wikipedia.org/w/api.php",
            params={"action": "query", "list": "search", "srsearch": query, "srlimit": max_results, "format": "json"},
            timeout=10,
        )
        if resp.status_code == 200:
            data = resp.json()
            results = data.get("query", {}).get("search", [])
            if results:
                return json.dumps([{"title": r["title"], "snippet": r["snippet"]} for r in results], default=str)
        return f"No results found for '{query}'"
    except Exception as e:
        return f"Knowledge search failed: {str(e)}"
'''
    },
    {
        "name": "create_document",
        "description": "Create a structured document (report, summary, analysis) from provided content and save it.",
        "schema_json": json.dumps({
            "type": "function",
            "function": {
                "name": "create_document",
                "description": "Create a structured document (report, summary, analysis) from provided content and save it.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Document title"},
                        "content": {"type": "string", "description": "Document content in markdown format"},
                        "doc_type": {"type": "string", "enum": ["report", "summary", "analysis", "memo"], "description": "Type of document to create"},
                    },
                    "required": ["title", "content"],
                },
            }
        }),
        "source_code": '''import os

def run(title: str, content: str, doc_type: str = "report") -> str:
    """Create and save a document to disk."""
    filename = f"{title.replace(' ', '_').lower()}_{doc_type}.md"
    os.makedirs("documents", exist_ok=True)
    filepath = os.path.join("documents", filename)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(f"# {title}\\n\\n{content}")
    return f"Document '{title}' saved as {filepath}"
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
        "source_code": '''import logging

logger = logging.getLogger(__name__)

def run(to: str, subject: str, body: str) -> str:
    """Send email (mock — logs the email details)."""
    logger.info(f"EMAIL SENT → to={to}, subject={subject}, body={body[:100]}...")
    return f"Email sent successfully to {to} with subject '{subject}'"
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
                sandbox_output="Pre-approved native tool."
            )
            db.add(record)
            seeded += 1
            
    if seeded > 0:
        db.commit()
        logger.info(f"Seeded {seeded} native tools into dynamic_tools database.")
