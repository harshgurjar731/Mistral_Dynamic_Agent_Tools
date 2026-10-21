"""
The Tool Service's settings, read and written through its own ``/settings``
endpoints — it owns and persists them (tool-service/app/runtime_config.py).
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

import httpx

from app.config import settings

_TIMEOUT = httpx.Timeout(10.0, connect=3.0)


def _url(path: str) -> str:
    return f"{settings.TOOL_SERVICE_URL.rstrip('/')}{path}"


def _raise_for(resp: httpx.Response) -> None:
    if resp.status_code >= 400:
        try:
            detail = resp.json().get("detail")
        except ValueError:
            detail = None
        raise ValueError(detail or f"Tool Service returned {resp.status_code}")


async def get_settings() -> dict:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as http:
        resp = await http.get(_url("/settings"))
    _raise_for(resp)
    return resp.json()


async def update(values: dict[str, Any]) -> dict:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as http:
        resp = await http.put(_url("/settings"), json={"values": values})
    _raise_for(resp)
    return resp.json()


async def reset(keys: Optional[Iterable[str]] = None, section: Optional[str] = None) -> dict:
    body: dict[str, Any] = {}
    if keys is not None:
        body["keys"] = list(keys)
    if section is not None:
        body["section"] = section
    async with httpx.AsyncClient(timeout=_TIMEOUT) as http:
        resp = await http.post(_url("/settings/reset"), json=body)
    _raise_for(resp)
    return resp.json()
