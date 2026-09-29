"""
Execution Route — POST /execute/{tool_name}

``tool_name`` may pin a version as ``name@3``; the body's ``version`` does the
same. Without either, the active version runs.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import ExecuteRequest, ExecuteResponse
from app.services.execution_service import execute_tool

router = APIRouter(tags=["Execution"])

#: A tool that was never built, a tool awaiting approval, and a call with the
#: wrong arguments are three different problems with three different fixes;
#: the caller needs to tell them apart to decide whether retrying helps.
_STATUS_BY_REASON = {
    "not_found": 404,
    "not_registered": 409,
    "bad_arguments": 422,
}


@router.post("/execute/{tool_name}", response_model=ExecuteResponse)
def execute(tool_name: str, request: ExecuteRequest, db: Session = Depends(get_db)):
    """Execute a stored tool function with arguments.

    A failure inside the tool is not an HTTP error: it comes back as a
    ``{"status": "error", ...}`` envelope in ``result`` with status 200, so the
    caller always sees the tool's own account of what went wrong.
    """
    result = execute_tool(db=db, tool_name=tool_name, arguments=request.arguments,
                          version=request.version)

    if "error" in result and "result" not in result:
        raise HTTPException(
            status_code=_STATUS_BY_REASON.get(result.get("reason", ""), 400),
            detail=result["error"],
        )

    return ExecuteResponse(result=result["result"], tool_name=result["tool_name"],
                           version=result.get("version"))
