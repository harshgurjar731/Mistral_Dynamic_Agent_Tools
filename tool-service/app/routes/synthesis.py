"""
Synthesis Route — POST /synthesize
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.schemas import SynthesizeRequest, SynthesizeResponse
from app.services.synthesis_service import synthesize_tool

router = APIRouter(tags=["Synthesis"])


@router.post("/synthesize", response_model=SynthesizeResponse)
def synthesize(request: SynthesizeRequest, db: Session = Depends(get_db)):
    """
    Run the full synthesis pipeline: codegen → lint → sandbox → store.
    """
    result = synthesize_tool(
        db=db,
        name=request.name,
        description=request.description,
        parameters={"properties": request.parameters, "required": request.required},
        required=request.required,
        api_details=request.api_details,
        expected_output_shape=request.expected_output_shape,
        purpose=request.purpose,
    )
    return SynthesizeResponse(
        status=result["status"],
        tool_name=result["tool_name"],
        message=result["message"],
        tool_id=result.get("tool_id"),
    )
