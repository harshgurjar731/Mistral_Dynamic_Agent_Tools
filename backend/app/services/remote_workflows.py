"""Read the workflows registered on Mistral.

``GET /v1/workflows`` returns its results in pages: 50 a page by default,
oldest first, with ``next_cursor`` pointing at the next page. Reading only the
first answer misses every workflow past the fiftieth, and because the order is
oldest first, a newly registered workflow is exactly the one that goes missing.
That is what made publishing wait for a registration that had already happened.

Everything here is synchronous (plain ``httpx``). Async callers run it with
``asyncio.to_thread``.
"""

from __future__ import annotations

import logging
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

MISTRAL_API = "https://api.mistral.ai"

#: Matches the SDK's default page size, which the server is known to accept.
PAGE_SIZE = 50
#: Stops a listing whose cursor never ends: 200 pages is 10,000 workflows.
MAX_PAGES = 200


def _headers(api_key: str | None) -> dict:
    if api_key is None:
        from app.dependencies import current_mistral_api_key

        api_key = current_mistral_api_key()
    return {"Authorization": f"Bearer {api_key}"}


def list_remote_workflows(api_key: str | None = None, timeout: float | httpx.Timeout = 8.0) -> list[dict]:
    """Every workflow on Mistral, across all pages.

    Raises ``httpx.HTTPError`` when a page cannot be fetched, so a caller can
    tell "Mistral has none" apart from "Mistral could not be asked".
    ``api_key`` defaults to the current workspace's key.
    """
    headers = _headers(api_key)
    workflows: list[dict] = []
    cursor: str | None = None
    seen_cursors: set[str] = set()

    with httpx.Client(base_url=MISTRAL_API, headers=headers, timeout=timeout) as http:
        for _ in range(MAX_PAGES):
            params: dict = {"limit": PAGE_SIZE}
            if cursor:
                params["cursor"] = cursor
            resp = http.get("/v1/workflows", params=params)
            resp.raise_for_status()
            body = resp.json() or {}

            batch = [w for w in body.get("workflows") or [] if isinstance(w, dict)]
            workflows.extend(batch)

            cursor = str(body.get("next_cursor") or "").strip() or None
            if not cursor or not batch or cursor in seen_cursors:
                break
            seen_cursors.add(cursor)
        else:
            logger.warning(
                "Stopped listing Mistral workflows after %d pages (%d workflows)",
                MAX_PAGES, len(workflows),
            )

    return workflows


def find_remote_workflow(
    workflow_name: str, api_key: str | None = None, timeout: float | httpx.Timeout = 8.0
) -> dict | None:
    """The Mistral record of one workflow, or None when it is not registered.

    Asks for the workflow by name first, the same way execution addresses it,
    which costs a single request. A workflow whose record does not carry the
    same name is found by walking the full listing instead. Never raises:
    a lookup that cannot be answered returns None, as before.
    """
    headers = _headers(api_key)
    try:
        resp = httpx.get(
            f"{MISTRAL_API}/v1/workflows/{quote(workflow_name, safe='')}",
            headers=headers, timeout=timeout,
        )
        if resp.status_code == 200:
            body = resp.json() or {}
            record = body.get("workflow") if isinstance(body.get("workflow"), dict) else body
            if isinstance(record, dict) and record.get("name") == workflow_name and record.get("id"):
                return record
        elif resp.status_code not in (404, 422):
            logger.info(
                "GET /v1/workflows/%s returned %d; falling back to the listing",
                workflow_name, resp.status_code,
            )
    except (httpx.HTTPError, ValueError) as e:
        logger.info("Lookup of workflow '%s' by name failed (%s); using the listing", workflow_name, e)

    try:
        for wf in list_remote_workflows(api_key=api_key, timeout=timeout):
            if wf.get("name") == workflow_name:
                return wf
    except (httpx.HTTPError, ValueError) as e:
        logger.warning("Could not list Mistral workflows: %s", e)
    return None
