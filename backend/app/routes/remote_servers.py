"""
Remote Server Routes — CRUD for remote servers + reachability check + send tool code.
"""

import httpx
import logging
from fastapi import APIRouter, Request, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.remote_server_model import RemoteServer

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Remote Servers"])


# ── List all remote servers ────────────────────────────────────────────────

@router.get("/remote-servers")
async def list_remote_servers(db: Session = Depends(get_db)):
    """Return all saved remote servers."""
    if not db:
        return []
    servers = db.query(RemoteServer).order_by(RemoteServer.created_at.desc()).all()
    return [
        {
            "id": s.id,
            "name": s.name,
            "url": s.url,
            "description": s.description or "",
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in servers
    ]


# ── Add a remote server ───────────────────────────────────────────────────

@router.post("/remote-servers")
async def add_remote_server(request: Request, db: Session = Depends(get_db)):
    """Save a new remote server configuration."""
    if not db:
        return {"error": "Database not available"}
    body = await request.json()
    name = body.get("name", "").strip()
    url = body.get("url", "").strip()
    description = body.get("description", "").strip()
    if not name or not url:
        return {"error": "Name and URL are required"}

    server = RemoteServer(name=name, url=url, description=description)
    db.add(server)
    db.commit()
    db.refresh(server)
    return {
        "id": server.id,
        "name": server.name,
        "url": server.url,
        "description": server.description or "",
        "created_at": server.created_at.isoformat() if server.created_at else None,
    }


# ── Delete a remote server ────────────────────────────────────────────────

@router.delete("/remote-servers/{server_id}")
async def delete_remote_server(server_id: int, db: Session = Depends(get_db)):
    """Delete a saved remote server."""
    if not db:
        return {"error": "Database not available"}
    server = db.query(RemoteServer).filter(RemoteServer.id == server_id).first()
    if not server:
        return {"error": "Server not found"}
    db.delete(server)
    db.commit()
    return {"status": "deleted", "id": server_id}
# ── Get a remote server ───────────────────────────────────────────────────

@router.get("/remote-servers/{server_id}")
async def get_remote_server(server_id: int, db: Session = Depends(get_db)):
    """Retrieve a single saved remote server."""
    if not db:
        return {"error": "Database not available"}
    server = db.query(RemoteServer).filter(RemoteServer.id == server_id).first()
    if not server:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Server not found")
    return {
        "id": server.id,
        "name": server.name,
        "url": server.url,
        "description": server.description or "",
        "created_at": server.created_at.isoformat() if server.created_at else None,
    }

# ── Update a remote server ────────────────────────────────────────────────

@router.put("/remote-servers/{server_id}")
async def update_remote_server(server_id: int, request: Request, db: Session = Depends(get_db)):
    """Update an existing remote server."""
    if not db:
        return {"error": "Database not available"}
    server = db.query(RemoteServer).filter(RemoteServer.id == server_id).first()
    if not server:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Server not found")
        
    body = await request.json()
    if "name" in body:
        server.name = body["name"].strip()
    if "url" in body:
        server.url = body["url"].strip()
    if "description" in body:
        server.description = body["description"].strip()
        
    db.commit()
    db.refresh(server)
    return {
        "id": server.id,
        "name": server.name,
        "url": server.url,
        "description": server.description or "",
        "created_at": server.created_at.isoformat() if server.created_at else None,
    }


# ── Check reachability ────────────────────────────────────────────────────

def _derive_base_url(url: str) -> str:
    """Derive the server base URL from a /submit-code style endpoint URL.
    e.g. 'https://example.com/submit-code' → 'https://example.com'
    """
    from urllib.parse import urlparse
    parsed = urlparse(url.strip().rstrip("/"))
    return f"{parsed.scheme}://{parsed.netloc}"


@router.post("/remote-servers/check")
async def check_reachability(request: Request):
    """Check if a remote server is reachable.
    
    Derives the base URL from the stored endpoint and pings /health first,
    then falls back to GET on the base URL.
    """
    body = await request.json()
    url = body.get("url", "").strip()
    if not url:
        return {"reachable": False, "error": "No URL provided"}

    base_url = _derive_base_url(url)
    
    # Try /health endpoint first (the remote MCP server exposes this)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{base_url}/health", follow_redirects=True)
            if resp.status_code == 200:
                return {"reachable": True, "url": url, "health": resp.json() if resp.headers.get("content-type", "").startswith("application/json") else None}
    except Exception:
        pass

    # Fallback: try GET on base URL
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(base_url, follow_redirects=True)
            reachable = resp.status_code < 500
    except Exception:
        reachable = False

    return {"reachable": reachable, "url": url}


# ── Send tool code to remote server ───────────────────────────────────────

@router.post("/remote-servers/{server_id}/send-tool")
async def send_tool_to_remote(server_id: int, request: Request, db: Session = Depends(get_db)):
    """Fetch tool data from the tool-service and POST the source code to the remote server."""
    if not db:
        return {"error": "Database not available"}

    server = db.query(RemoteServer).filter(RemoteServer.id == server_id).first()
    if not server:
        return {"error": "Remote server not found"}

    body = await request.json()
    tool_id = body.get("tool_id")
    if not tool_id:
        return {"error": "tool_id is required"}

    # Fetch tool data from Docker Tool Service
    from app.services.tool_resolver import tool_resolver
    try:
        tools = await tool_resolver.list_tools()
        tool = None
        for t in tools:
            if str(t.get("id")) == str(tool_id):
                tool = t
                break
        if not tool:
            return {"error": f"Tool {tool_id} not found in tool service"}
    except Exception as e:
        return {"error": f"Failed to fetch tool: {str(e)}"}

    # Build payload matching the remote MCP server's /submit-code contract:
    # POST JSON { name: str, description: str, code: str }
    # The code must contain a def run(...) function.
    source_code = tool.get("source_code", "")
    if not source_code:
        return {"error": "Tool has no source code to send"}

    tool_name = tool.get("name", "unknown")
    # Extract description from schema or direct field
    tool_description = (
        tool.get("description")
        or (tool.get("schema", {}).get("function", {}) or {}).get("description")
        or f"Dynamic tool: {tool_name}"
    )

    payload = {
        "name": tool_name,
        "description": str(tool_description),
        "code": source_code,
    }

    # Send to remote server
    remote_url = server.url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                remote_url,
                json=payload,
            )
            if resp.status_code < 400:
                resp_data = {}
                try:
                    resp_data = resp.json()
                except Exception:
                    pass
                return {
                    "status": "sent",
                    "server_name": server.name,
                    "tool_name": tool_name,
                    "remote_status_code": resp.status_code,
                    "remote_response": resp_data,
                }
            else:
                error_text = resp.text[:500]
                try:
                    error_data = resp.json()
                    error_text = str(error_data.get("detail", error_data))
                except Exception:
                    pass
                return {
                    "status": "error",
                    "message": f"Remote server returned {resp.status_code}: {error_text}",
                }
    except httpx.ConnectError:
        return {"status": "error", "message": f"Cannot reach remote server at {remote_url}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}
