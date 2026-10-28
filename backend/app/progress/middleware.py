"""
Binds a request to its op — every request that carries an ``X-Op-Id`` header.

Pure ASGI, like ``ActionTracingMiddleware``: streamed responses pass through
untouched, and the op stays current for the whole of the response.
"""

from __future__ import annotations

import time
from typing import Any

from app.progress.tracker import bind, registry, unbind

_HEADER = b"x-op-id"
#: Streams that report their own progress — tagging them would only echo it.
_SKIP_PREFIXES = ("/api/ops/", "/health", "/uploads")


class OpProgressMiddleware:
    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope.get("type") != "http" or scope.get("path", "").startswith(_SKIP_PREFIXES):
            await self.app(scope, receive, send)
            return

        op_id = next(
            (v.decode("latin-1") for k, v in scope.get("headers", []) if k.lower() == _HEADER),
            None,
        )
        method = scope.get("method", "")
        op = registry.begin(op_id, f"{method} {scope.get('path', '')}") if op_id else None
        if op is None:
            await self.app(scope, receive, send)
            return

        status_holder: dict[str, int] = {}

        async def send_wrapper(message: dict) -> None:
            if message.get("type") == "http.response.start":
                status_holder["status"] = int(message.get("status", 0))
            await send(message)

        started = time.monotonic()
        token = bind(op)
        error: str | None = None
        try:
            await self.app(scope, receive, send_wrapper)
        except BaseException as e:
            error = str(e) or e.__class__.__name__
            raise
        finally:
            unbind(token)
            status = status_holder.get("status", 500)
            op.end({
                "status": "failed" if error or status >= 400 else "completed",
                "http_status": status,
                "ms": round((time.monotonic() - started) * 1000),
                **({"error": error[:300]} if error else {}),
            })
