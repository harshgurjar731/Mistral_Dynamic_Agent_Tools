"""
Upload Routes — Handle file uploads (images) for workflow inputs.
"""

import asyncio
import os
import uuid
import base64
import logging
from datetime import datetime

from fastapi import APIRouter, UploadFile, File, HTTPException
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Uploads"])

# Where uploaded files are stored
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


@router.post("/uploads/image")
async def upload_image(file: UploadFile = File(...)):
    """
    Upload an image file for use in workflows.
    Returns the image as base64 (for Mistral vision API) and a local URL.
    """
    # Validate MIME type
    content_type = file.content_type or ""
    if content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type: {content_type}. Allowed: {', '.join(ALLOWED_MIME_TYPES)}",
        )

    # Read file content
    content = await file.read()
    if len(content) > settings.UPLOAD_MAX_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File too large. Max size: {settings.UPLOAD_MAX_MB}MB")

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file uploaded")

    # Generate unique filename
    ext = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }.get(content_type, ".jpg")
    
    unique_name = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}{ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_name)

    # Save to disk
    with open(file_path, "wb") as f:
        f.write(content)

    # Encode to base64
    b64_data = base64.b64encode(content).decode("utf-8")

    logger.info("Image uploaded: %s (%d bytes, %s)", unique_name, len(content), content_type)

    return {
        "filename": unique_name,
        "content_type": content_type,
        "size_bytes": len(content),
        "image_base64": b64_data,
        "image_url": f"/uploads/{unique_name}",
        "image_mime": content_type,
    }


@router.post("/uploads/file")
async def upload_file(file: UploadFile = File(...)):
    """Upload an image, audio, document (PDF, Word, PowerPoint, Excel) or text file to attach to a message.

    Returns a reference (``upload_id``) the message carries; the file is turned
    into what the chosen model accepts when the message is sent
    (``app.services.attachments``).
    """
    from app.services import attachments

    content = await file.read()
    try:
        saved = attachments.save(file.filename or "file", content, file.content_type,
                                 max_mb=settings.UPLOAD_MAX_MB)
    except attachments.AttachmentError as e:
        raise HTTPException(status_code=400, detail=str(e))
    logger.info("Attachment uploaded: %s (%s, %d bytes)", saved["upload_id"], saved["kind"], saved["size"])
    if saved["kind"] == attachments.IMAGE:
        # Older clients read these.
        saved.update(image_url=saved["url"], image_mime=saved["mime"])
    return saved


@router.get("/uploads/support")
async def input_support(model: str | None = None, agent_id: str | None = None, api: str = "chat"):
    """What a model takes: per kind, sent as-is ("native") or converted to text ("text").

    With ``agent_id`` the agent's own model is used (agent chat runs on the
    Conversations API, which converts audio).
    """
    from app.services import attachments

    if agent_id:
        from app.services.workflow_engine import agent_call

        profile = await asyncio.to_thread(agent_call.profile, agent_id)
        model = (profile or {}).get("model") or model
        api = "conversations"
    return {"model": model, "api": api, "kinds": attachments.describe_support(model, api)}
