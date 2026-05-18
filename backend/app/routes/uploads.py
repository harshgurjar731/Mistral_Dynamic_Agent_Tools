"""
Upload Routes — Handle file uploads (images) for workflow inputs.
"""

import os
import uuid
import base64
import logging
from datetime import datetime

from fastapi import APIRouter, UploadFile, File, HTTPException

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Uploads"])

# Where uploaded files are stored
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB


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
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"File too large. Max size: {MAX_FILE_SIZE // (1024*1024)}MB")

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
