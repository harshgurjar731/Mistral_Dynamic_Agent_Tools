"""
Cleanup — delete what the project has accumulated, by area or all of it, and
return it to a fresh install's starting point. See app/cleanup.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from app.cleanup import targets as cleanup

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/settings/cleanup", tags=["Settings"])

#: What the caller must send to show the request is deliberate.
CONFIRM_PHRASE = "DELETE"


class CleanupRequest(BaseModel):
    #: The areas to clean. Omitted or empty with ``everything``: all of them.
    targets: list[str] = []
    everything: bool = False
    confirm: str = ""


@router.get("")
async def cleanup_preview():
    """Every area cleanup can delete, with what it holds now."""
    return {**(await cleanup.preview()), "confirm_phrase": CONFIRM_PHRASE}


@router.post("")
async def run_cleanup(body: CleanupRequest, x_vault_token: Optional[str] = Header(default=None)):
    """Delete the chosen areas, then restore the fresh-install defaults."""
    if body.confirm.strip() != CONFIRM_PHRASE:
        raise HTTPException(status_code=400,
                            detail=f'Type "{CONFIRM_PHRASE}" to confirm the cleanup.')

    targets = [t.id for t in cleanup.TARGETS] if body.everything else body.targets
    if not targets:
        raise HTTPException(status_code=400, detail="Choose at least one thing to delete.")

    # Wiping the vault is a vault write: it needs the vault's admin token.
    if "vault" in targets:
        from app.vault.guard import require_admin

        require_admin(x_vault_token)

    running = cleanup.busy()
    if running:
        raise HTTPException(status_code=409, detail={
            "message": f"{len(running)} run(s) are still in progress. Wait for them to finish "
                       "or stop them, then clean up.",
            "running": running,
        })

    logger.warning("Cleanup started: %s", ", ".join(targets))
    try:
        return await cleanup.run(targets)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
