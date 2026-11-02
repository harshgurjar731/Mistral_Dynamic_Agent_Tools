"""
Human review routes — the review inbox.

    GET    /reviews                    list (?status=pending|approved|… &execution_id=)
    GET    /reviews/{id}               one, with what the reviewer is shown
    POST   /reviews/{id}/decision      approve | edit | reject — releases the waiting workflow
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.workflow_engine import reviews

router = APIRouter(tags=["Reviews"])


class DecisionBody(BaseModel):
    decision: str
    comment: str = ""
    edits: dict = Field(default_factory=dict)
    decided_by: str = ""


@router.get("/reviews")
async def list_reviews(status: Optional[str] = "pending", execution_id: Optional[str] = None):
    items = reviews.list_reviews(status=status or None, execution_id=execution_id)
    return {"reviews": items, "count": len(items)}


@router.get("/reviews/{review_id}")
async def get_review(review_id: int):
    review = reviews.get(review_id)
    if not review:
        raise HTTPException(status_code=404, detail="Review not found.")
    return review


@router.post("/reviews/{review_id}/decision")
async def decide(review_id: int, body: DecisionBody):
    try:
        return await reviews.decide(review_id, body.decision, comment=body.comment,
                                    edits=body.edits, decided_by=body.decided_by)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
