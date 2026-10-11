"""
Workflow revision routes — change a saved workflow by instruction, review, apply, undo.

    GET  /workflows/{name}/revisions                     the conversation: every proposal, oldest first
    POST /workflows/{name}/revisions                     propose a change (instruction, or operations)
    GET  /workflows/{name}/revisions/{id}                one proposal
    POST /workflows/{name}/revisions/{id}/apply          save it (409 when the workflow moved on)
    POST /workflows/{name}/revisions/{id}/discard        reject it
    GET  /workflows/{name}/revision-suggestions          one-click prompts from validation issues
    GET  /workflows/{name}/versions                      saved states, newest first
    GET  /workflows/{name}/versions/{no}                 one state, with its definition
    POST /workflows/{name}/versions/{no}/restore         go back to it (recorded as a new version)
    POST /workflows/{name}/undo                          go back to the previous state

Proposing never changes the workflow; applying and restoring do, and each
records a version first. Publishing stays where it was —
``POST /workflows/{name}/publish`` — so a revised workflow goes live only when
the user says so.
"""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.dependencies import get_mistral_client
from app.services import workflow_revision_service as revisions
from app.services.workflow_revision_service import RevisionError

router = APIRouter(tags=["Workflow revisions"])


class ProposeRevisionRequest(BaseModel):
    instruction: str = Field(default="", max_length=4000)
    #: Steps the instruction is about — chosen on the canvas.
    focus_step_ids: list[str] = Field(default_factory=list, max_length=50)
    #: An edit chosen directly in the UI; skips interpreting an instruction.
    operations: Optional[list[dict]] = Field(default=None, max_length=25)
    origin: Literal["editor", "planner"] = "editor"


class ApplyRevisionRequest(BaseModel):
    #: Keep working on a workflow that the change leaves with errors.
    allow_errors: bool = False


def _http(e: RevisionError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail=str(e))


@router.get("/workflows/{workflow_name}/revisions")
async def list_revisions(workflow_name: str):
    return {"revisions": await revisions.list_revisions(workflow_name)}


@router.post("/workflows/{workflow_name}/revisions", status_code=201)
async def propose_revision(workflow_name: str, body: ProposeRevisionRequest,
                           client=Depends(get_mistral_client)):
    try:
        return await revisions.propose(
            client, workflow_name,
            instruction=body.instruction,
            focus_step_ids=body.focus_step_ids,
            operations=body.operations,
            origin=body.origin,
        )
    except RevisionError as e:
        raise _http(e)


@router.get("/workflows/{workflow_name}/revisions/{revision_id}")
async def get_revision(workflow_name: str, revision_id: str):
    try:
        return await revisions.get_revision(workflow_name, revision_id)
    except RevisionError as e:
        raise _http(e)


@router.post("/workflows/{workflow_name}/revisions/{revision_id}/apply")
async def apply_revision(workflow_name: str, revision_id: str,
                         body: Optional[ApplyRevisionRequest] = None):
    try:
        return await revisions.apply(workflow_name, revision_id,
                                     allow_errors=bool(body and body.allow_errors))
    except RevisionError as e:
        raise _http(e)


@router.post("/workflows/{workflow_name}/revisions/{revision_id}/discard")
async def discard_revision(workflow_name: str, revision_id: str):
    try:
        return await revisions.discard(workflow_name, revision_id)
    except RevisionError as e:
        raise _http(e)


@router.get("/workflows/{workflow_name}/revision-suggestions")
async def revision_suggestions(workflow_name: str, client=Depends(get_mistral_client)):
    try:
        return await revisions.suggestions(workflow_name, client=client)
    except RevisionError as e:
        raise _http(e)


@router.get("/workflows/{workflow_name}/versions")
async def list_versions(workflow_name: str):
    try:
        return await revisions.list_versions(workflow_name)
    except RevisionError as e:
        raise _http(e)


@router.get("/workflows/{workflow_name}/versions/{version_no}")
async def get_version(workflow_name: str, version_no: int):
    try:
        return await revisions.get_version(workflow_name, version_no)
    except RevisionError as e:
        raise _http(e)


@router.post("/workflows/{workflow_name}/versions/{version_no}/restore")
async def restore_version(workflow_name: str, version_no: int):
    try:
        return await revisions.restore_version(workflow_name, version_no)
    except RevisionError as e:
        raise _http(e)


@router.post("/workflows/{workflow_name}/undo")
async def undo_last_change(workflow_name: str):
    try:
        return await revisions.undo(workflow_name)
    except RevisionError as e:
        raise _http(e)
