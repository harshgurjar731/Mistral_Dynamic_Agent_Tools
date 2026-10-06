"""
HTTP actions — one trace per user action against the API.

A pure ASGI middleware (not ``BaseHTTPMiddleware``), so streamed responses —
the orchestrator's SSE, run streams — pass through untouched and the span
covers the whole stream.

Reads (GET/HEAD/OPTIONS) are not traced: the UI polls execution status and run
progress every second or two, and tracing that would bury every real action in
noise. Every request that *does* something — create, run, deploy, delete,
chat — is a trace, and whatever it starts (model calls, rules, tools, a
pipeline) is nested under it or linked back to it.
"""

from __future__ import annotations

import json
import time
from typing import Any

from app.observability import tracing

_UNTRACED_METHODS = {"GET", "HEAD", "OPTIONS"}
_UNTRACED_PREFIXES = ("/health", "/uploads", "/api/observability")
_BODY_LIMIT = 64_000


class ActionTracingMiddleware:
    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if (
            scope.get("type") != "http"
            or not tracing.enabled()
            or scope.get("method", "GET") in _UNTRACED_METHODS
            or scope.get("path", "").startswith(_UNTRACED_PREFIXES)
        ):
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "")
        path = scope.get("path", "")
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        content_type = headers.get("content-type", "")
        capture_body = "json" in content_type

        body_chunks: list[bytes] = []
        body_size = 0
        status_holder: dict[str, int] = {}
        started = time.monotonic()

        async def receive_wrapper() -> dict:
            nonlocal body_size
            message = await receive()
            if message.get("type") == "http.request":
                chunk = message.get("body", b"") or b""
                body_size += len(chunk)
                if capture_body and sum(len(c) for c in body_chunks) < _BODY_LIMIT:
                    body_chunks.append(chunk)
            return message

        async def send_wrapper(message: dict) -> None:
            if message.get("type") == "http.response.start":
                status_holder["status"] = int(message.get("status", 0))
            await send(message)

        attrs = {
            "http.request.method": method,
            "url.path": path,
            "url.query": scope.get("query_string", b"").decode("latin-1") or None,
            "user_agent.original": headers.get("user-agent"),
            "app.action": f"{method} {path}",
        }

        with tracing.span(f"{method} {path}", kind="http", attrs=attrs, root=True) as s:
            try:
                await self.app(scope, receive_wrapper, send_wrapper)
            finally:
                route = scope.get("route")
                template = getattr(route, "path_format", None) or getattr(route, "path", None)
                if template:
                    s.update_name(f"{method} {template}")
                    s.set_attribute("http.route", template)
                    endpoint = getattr(route, "name", None)
                    if endpoint:
                        s.set_attribute("app.endpoint", endpoint)
                path_params = scope.get("path_params")
                if path_params:
                    tracing.set_attrs(s, {f"app.param.{k}": str(v) for k, v in path_params.items()})

                status = status_holder.get("status", 500)
                s.set_attribute("http.response.status_code", status)
                s.set_attribute("http.request.body.size", body_size)
                s.set_attribute("app.duration_ms", round((time.monotonic() - started) * 1000, 1))
                if body_chunks:
                    raw = b"".join(body_chunks)[:_BODY_LIMIT]
                    try:
                        payload: Any = json.loads(raw)
                    except Exception:
                        payload = raw.decode("utf-8", "replace")
                    tracing.set_attrs(s, {"app.request.body": payload})
                if status >= 500:
                    tracing.mark_error(s, f"HTTP {status}", error_type=str(status))
                elif status >= 400:
                    s.set_attribute("app.outcome", "rejected")
