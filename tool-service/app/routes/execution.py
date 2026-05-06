"""
Execution Route — POST /execute/{tool_name}
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas import ExecuteRequest, ExecuteResponse
from app.services.execution_service import execute_tool

router = APIRouter(tags=["Execution"])


@router.post("/execute/{tool_name}", response_model=ExecuteResponse)
def execute(tool_name: str, request: ExecuteRequest, db: Session = Depends(get_db)):
    """Execute a stored tool function with arguments."""
    result = execute_tool(db=db, tool_name=tool_name, arguments=request.arguments)

    if "error" in result:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=result["error"])

    return ExecuteResponse(
        result=result["result"],
        tool_name=result["tool_name"],
    )
