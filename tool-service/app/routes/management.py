"""
Management Routes — Tool listing, approval, rejection, and MCP publishing.
"""

import json
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import ToolRecord
from app.schemas import ToolResponse, ToolListResponse, ApproveRejectResponse, ToolUpdateRequest, ToolImportRequest
from app.services.synthesis_service import (
    activate_version,
    approve_tool,
    delete_tool,
    import_tool,
    reject_tool,
    update_tool,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Management"])


class PublishMcpRequest(BaseModel):
    server_name: str


def _loads(text):
    if not text:
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


def _record_to_response(record: ToolRecord, *, full: bool = True) -> ToolResponse:
    """Convert a ToolRecord (one version) to a ToolResponse."""
    return ToolResponse(
        id=record.id,
        name=record.name,
        hash=record.hash,
        version=record.version,
        version_no=record.version_no or 1,
        is_active=bool(record.is_active),
        schema=json.loads(record.schema_json),
        output_schema=_loads(record.output_schema_json),
        status=record.status,
        source_code=record.source_code,
        sandbox_output=record.sandbox_output,
        created_at=record.created_at,
        mcp_published=record.mcp_published if record.mcp_published else False,
        mcp_server_name=record.mcp_server_name,
        purpose=record.purpose or "tool",
        kind=record.kind or "pure",
        side_effects=record.side_effects or "none",
        review_required=bool(record.review_required),
        spec=_loads(record.spec_json) if full else None,
        report=_loads(record.report_json) if full else None,
    )


@router.get("/tools", response_model=ToolListResponse)
def list_tools(include_versions: bool = False, db: Session = Depends(get_db)):
    """List tools: each tool's active version plus any version awaiting a decision.

    Superseded versions are omitted unless ``include_versions`` is set — with
    versioning, listing every row would show one tool many times over.
    """
    records = db.query(ToolRecord).order_by(ToolRecord.name, ToolRecord.version_no).all()
    if not include_versions:
        active_names = {r.name for r in records if r.is_active}
        records = [
            r for r in records
            if r.is_active
            or r.status == "pending_approval"
            or (r.name not in active_names and r.status != "approved")
        ]
    tools = [_record_to_response(r) for r in records]
    return ToolListResponse(tools=tools, count=len(tools))


@router.get("/tools/{name}/versions", response_model=ToolListResponse)
def list_versions(name: str, db: Session = Depends(get_db)):
    """Every version of one tool, newest first."""
    from app.synthesis import registry

    records = registry.versions_of(db, name)
    if not records:
        raise HTTPException(status_code=404, detail="Tool not found")
    tools = [_record_to_response(r) for r in records]
    return ToolListResponse(tools=tools, count=len(tools))


@router.post("/tools/{tool_id}/activate", response_model=ApproveRejectResponse)
def activate(tool_id: int, db: Session = Depends(get_db)):
    """Make an approved version the active one (rollback / roll-forward)."""
    result = activate_version(db, tool_id)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return ApproveRejectResponse(**result)


@router.get("/tools/by-hash/{hash}")
def get_tool_by_hash(hash: str, db: Session = Depends(get_db)):
    """Lookup tool by content hash."""
    record = db.query(ToolRecord).filter_by(hash=hash).first()
    if not record:
        raise HTTPException(status_code=404, detail="Tool not found")
    return _record_to_response(record)


@router.get("/tools/pending", response_model=ToolListResponse)
def list_pending_tools(db: Session = Depends(get_db)):
    """List tools awaiting approval."""
    records = db.query(ToolRecord).filter_by(status="pending_approval").all()
    tools = [_record_to_response(r) for r in records]
    return ToolListResponse(tools=tools, count=len(tools))


@router.post("/tools/{tool_id}/approve", response_model=ApproveRejectResponse)
def approve(tool_id: int, db: Session = Depends(get_db)):
    """Approve a pending tool — writes to disk and registers for execution."""
    result = approve_tool(db, tool_id)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return ApproveRejectResponse(**result)


@router.post("/tools/{tool_id}/reject", response_model=ApproveRejectResponse)
def reject(tool_id: int, db: Session = Depends(get_db)):
    """Reject a pending tool."""
    result = reject_tool(db, tool_id)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return ApproveRejectResponse(**result)


@router.delete("/tools/{tool_id}")
def delete(tool_id: int, db: Session = Depends(get_db)):
    """Delete a tool from DB, disk, and cache."""
    result = delete_tool(db, tool_id)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.put("/tools/{tool_id}")
def update(tool_id: int, request: ToolUpdateRequest, db: Session = Depends(get_db)):
    """Update a tool's code, description and (optionally) its purpose."""
    result = update_tool(db, tool_id, request.source_code, request.description, request.purpose)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.post("/tools/import", response_model=ApproveRejectResponse)
def import_tool_endpoint(request: ToolImportRequest, db: Session = Depends(get_db)):
    """Install a tool from known-good source, bypassing the synthesis pipeline.

    Used by workflow deployment packages to reproduce a tool that was already
    vetted and approved on the source instance — no LLM codegen, lint or
    sandbox run. Idempotent by content hash: importing the same tool twice is
    a no-op the second time.
    """
    result = import_tool(db, request.name, request.schema, request.source_code, request.hash,
                         request.version, request.purpose, version_no=request.version_no)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return ApproveRejectResponse(**{k: result[k] for k in ("status", "message", "tool_name")})


@router.post("/tools/{tool_id}/publish-mcp")
async def publish_to_mcp(tool_id: int, request: PublishMcpRequest,
                          db: Session = Depends(get_db)):
    """
    Publish an approved tool to a specific MCP server.
    Steps:
      1. Validate tool exists and is approved
      2. POST code to remote MCP server's deploy API
      3. Register Mistral Connector (idempotent)
      4. Mark mcp_published in DB
      5. Re-discover tools on that server
    """
    from app.services.mcp_manager import mcp_manager
    from app.services.mcp_publisher import deploy_to_mcp_server, ensure_connector_registered

    record = db.query(ToolRecord).filter_by(id=tool_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Tool not found")
    if record.status != "approved":
        raise HTTPException(status_code=400, detail="Only approved tools can be published to MCP")

    # Check if already published to this server
    if record.mcp_published and record.mcp_server_name == request.server_name:
        return {"status": "already_published", "tool_name": record.name,
                "server_name": request.server_name}

    # Get the server URL from mcp_manager
    server = mcp_manager.servers.get(request.server_name)
    if not server:
        raise HTTPException(status_code=400,
                            detail=f"MCP server '{request.server_name}' not found. Register it first.")

    schema = json.loads(record.schema_json)

    # Step 1: Deploy code to remote MCP server
    try:
        await deploy_to_mcp_server(server.url, record.name, record.source_code, schema)
    except Exception as e:
        logger.error("Failed to deploy tool '%s' to MCP server '%s': %s",
                     record.name, request.server_name, e)
        raise HTTPException(status_code=502,
                            detail=f"Failed to deploy to MCP server: {str(e)}")

    # Step 2: Register as Mistral Connector (best-effort)
    connector_id = None
    try:
        connector_id = await ensure_connector_registered(server.url, request.server_name)
    except Exception as e:
        logger.warning("Connector registration skipped: %s", e)

    # Step 3: Update DB
    record.mcp_published = True
    record.mcp_server_name = request.server_name
    db.commit()

    # Step 4: Re-discover tools on that server
    tools = await mcp_manager.get_server_tools(request.server_name)

    return {
        "status": "published",
        "tool_name": record.name,
        "server_name": request.server_name,
        "connector_id": connector_id,
        "mcp_tools_count": len(tools),
    }



@router.get("/tools/{tool_id:int}", response_model=ToolResponse)
def get_tool(tool_id: int, db: Session = Depends(get_db)):
    """One version by id — including superseded ones, for version history links."""
    record = db.get(ToolRecord, tool_id)
    if not record:
        raise HTTPException(status_code=404, detail="Tool not found")
    return _record_to_response(record)
