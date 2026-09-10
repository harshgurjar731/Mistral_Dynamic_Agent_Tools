"""
Execution Route — POST /execute/{tool_name}
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import ExecuteRequest, ExecuteResponse
from app.services.execution_service import execute_tool

router = APIRouter(tags=["Execution"])

#: Every failure used to be a 400, which made the access log — the only place
#: some of these are ever seen — say nothing about the cause. A tool that was
#: never built, a tool awaiting approval, and a call with the wrong arguments
#: are three different problems with three different fixes, and the caller
#: needs to tell them apart to decide whether retrying is worth anything.
_STATUS_BY_REASON = {
    "not_found": 404,
    "not_registered": 409,
    "bad_arguments": 422,
}


@router.post("/execute/{tool_name}", response_model=ExecuteResponse)
def execute(tool_name: str, request: ExecuteRequest, db: Session = Depends(get_db)):
    """Execute a stored tool function with arguments."""
    result = execute_tool(db=db, tool_name=tool_name, arguments=request.arguments)

    if "error" in result:
        raise HTTPException(
            status_code=_STATUS_BY_REASON.get(result.get("reason", ""), 400),
            detail=result["error"],
        )

    return ExecuteResponse(
        result=result["result"],
        tool_name=result["tool_name"],
    )
