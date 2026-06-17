"""
Library Routes — CRUD /api/libraries
Endpoints for managing Mistral document libraries and their documents.
"""

from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.services import library_service

router = APIRouter(tags=["Libraries"])


class CreateLibraryRequest(BaseModel):
    name: str
    description: Optional[str] = ""


class UpdateLibraryRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class WebpageRequest(BaseModel):
    url: str


# ── Library Endpoints ──────────────────────────────────────────────────────


@router.get("/libraries")
async def list_libraries():
    """List all Mistral document libraries."""
    try:
        return await library_service.list_libraries()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list libraries: {str(e)}")


@router.post("/libraries")
async def create_library(request: CreateLibraryRequest):
    """Create a new document library."""
    try:
        return await library_service.create_library(
            name=request.name,
            description=request.description or "",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create library: {str(e)}")


@router.put("/libraries/{library_id}")
async def update_library(library_id: str, request: UpdateLibraryRequest):
    """Update a library's name and/or description."""
    try:
        return await library_service.update_library(
            library_id=library_id,
            name=request.name,
            description=request.description,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update library: {str(e)}")


@router.delete("/libraries/{library_id}")
async def delete_library(library_id: str):
    """Delete a document library."""
    try:
        return await library_service.delete_library(library_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete library: {str(e)}")


# ── Document Endpoints ─────────────────────────────────────────────────────


@router.get("/libraries/{library_id}/documents")
async def list_documents(library_id: str):
    """List all documents in a library."""
    try:
        return await library_service.list_documents(library_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list documents: {str(e)}")


@router.post("/libraries/{library_id}/documents")
async def upload_document(library_id: str, file: UploadFile = File(...)):
    """Upload a document to a library (multipart form upload)."""
    try:
        content = await file.read()
        return await library_service.upload_document(
            library_id=library_id,
            filename=file.filename or "untitled",
            file_content=content,
            content_type=file.content_type or "application/octet-stream",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload document: {str(e)}")


@router.post("/libraries/{library_id}/documents/webpage")
async def upload_webpage(library_id: str, request: WebpageRequest):
    """Fetch a webpage and upload its content as a document."""
    try:
        return await library_service.upload_webpage(
            library_id=library_id,
            page_url=request.url,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload webpage: {str(e)}")


@router.delete("/libraries/{library_id}/documents/{document_id}")
async def delete_document(library_id: str, document_id: str):
    """Remove a document from a library."""
    try:
        return await library_service.delete_document(library_id, document_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete document: {str(e)}")
