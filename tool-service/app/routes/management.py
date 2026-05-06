"""
Management Routes — Tool listing, approval, rejection.
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import ToolRecord
from app.schemas import ToolResponse, ToolListResponse, ApproveRejectResponse, ToolUpdateRequest
from app.services.synthesis_service import approve_tool, reject_tool, delete_tool, update_tool

router = APIRouter(tags=["Management"])


def _record_to_response(record: ToolRecord) -> ToolResponse:
    """Convert a ToolRecord to a ToolResponse."""
    return ToolResponse(
        id=record.id,
        name=record.name,
        hash=record.hash,
        version=record.version,
        schema=json.loads(record.schema_json),
        status=record.status,
        source_code=record.source_code,
        sandbox_output=record.sandbox_output,
        created_at=record.created_at,
    )


@router.get("/tools", response_model=ToolListResponse)
def list_tools(db: Session = Depends(get_db)):
    """List all tools with schemas."""
    records = db.query(ToolRecord).all()
    tools = [_record_to_response(r) for r in records]
    return ToolListResponse(tools=tools, count=len(tools))


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
    """Update a tool's code and description."""
    result = update_tool(db, tool_id, request.source_code, request.description)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result
