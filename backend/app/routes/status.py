"""Is the platform live? — the signed-in user's view (app.health)."""

from fastapi import APIRouter

from app import health
from app.auth.context import current_principal

router = APIRouter(tags=["Status"])


@router.get("/status")
async def system_status():
    """Plain-language status for the caller's workspace. No internals."""
    p = current_principal()
    return await health.user_status(p.workspace_id if p else None)
