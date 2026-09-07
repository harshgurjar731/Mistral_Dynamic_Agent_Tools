"""
Workflow Deployment Routes — package a workflow for deployment elsewhere.

Separate from routes/workflows.py (already large) because this is an
additive, self-contained concern: given a saved workflow, produce a manifest
of what it depends on and a downloadable bundle that reproduces it on a
different Mistral workspace. See app/services/workflow_packager.py for the
actual manifest/zip construction.
"""

import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
import io

from app.dependencies import get_mistral_client
from app.services.workflow_engine.engine import get_workflow
from app.services.workflow_engine.models import DeploymentManifest
from app.services import workflow_packager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Workflow Deployment"])


@router.get("/workflows/{workflow_name}/deployment/manifest", response_model=DeploymentManifest)
async def get_deployment_manifest(workflow_name: str):
    """What a deployment package for this workflow would contain."""
    workflow = get_workflow(workflow_name)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_name}' not found")

    client = get_mistral_client()
    return await workflow_packager.build_deployment_manifest(workflow, client)


@router.get("/workflows/{workflow_name}/deployment/package")
async def get_deployment_package(workflow_name: str):
    """Download a self-contained deployment .zip for this workflow."""
    workflow = get_workflow(workflow_name)
    if not workflow:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_name}' not found")

    client = get_mistral_client()
    manifest = await workflow_packager.build_deployment_manifest(workflow, client)
    zip_bytes = workflow_packager.build_package_zip(workflow, manifest)

    filename = f"workflow_{workflow_name}_deploy.zip"
    return StreamingResponse(
        io.BytesIO(zip_bytes),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
