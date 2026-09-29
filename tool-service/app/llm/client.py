"""
The one place this service talks to Mistral.

Handles everything that is about the transport rather than the task: timeouts,
rate limits, jittered backoff, the fallback model, and the shape reasoning
models answer in.

Reasoning responses
-------------------
With ``reasoning_effort`` set, ``message.content`` is not a string but a list
of chunks — a ``ThinkChunk`` followed by one or more ``TextChunk``. Only the
text chunks are the answer; treating the list as a string (as the previous
client did with ``.strip()``) raises, and joining the thinking in would put the
model's working notes into the generated module.
"""

from __future__ import annotations

import json
import logging
import random
import re
import time
from typing import Any, Optional

from app import metrics
from app.config import settings
from app.llm.routes import ModelRoute, route_for

logger = logging.getLogger(__name__)


class LLMUnavailable(Exception):
    """No model on the route answered within its attempt budget."""


def _is_retryable(exc: Exception) -> bool:
    """Timeouts, rate limits and gateway errors are worth another go; a 400 is not."""
    text = str(exc).lower()
    return any(
        marker in text
        for marker in ("timed out", "timeout", "429", "rate limit", "502", "503", "504",
                       "connection", "temporarily")
    )


def _rejects_effort(exc: Exception) -> bool:
    text = str(exc).lower()
    return "reasoning_effort" in text and ("not supported" in text or "invalid" in text)


def extract_text(content: Any) -> str:
    """The answer text from a message's content, whatever its shape."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for chunk in content:
            # TextChunk has .text; ThinkChunk has .thinking and must be skipped.
            chunk_type = getattr(chunk, "type", None) or (
                chunk.get("type") if isinstance(chunk, dict) else None
            )
            if chunk_type == "thinking":
                continue
            text = getattr(chunk, "text", None)
            if text is None and isinstance(chunk, dict):
                text = chunk.get("text")
            if isinstance(text, str):
                parts.append(text)
        return "".join(parts)
    return str(content)


_FENCE = re.compile(r"^```[a-zA-Z0-9_+-]*\s*\n(.*?)\n?```\s*$", re.DOTALL)
_EMBEDDED_FENCE = re.compile(r"```[a-zA-Z0-9_+-]*[ \t]*\n(.*?)```", re.DOTALL)


def strip_fences(text: str) -> str:
    """The code in a model answer, without markdown fences or surrounding prose.

    Models sometimes explain before the code despite instructions (seen in a
    real repair: "The solution involves using the decimal module…" followed by
    a fenced module). The largest fenced block is taken as the answer then;
    passing the prose on made the attempt a SyntaxError on line 1.
    """
    text = (text or "").strip()
    match = _FENCE.match(text)
    if match:
        return match.group(1).strip()
    blocks = _EMBEDDED_FENCE.findall(text)
    if blocks:
        return max(blocks, key=len).strip()
    if text.startswith("```"):
        lines = [ln for ln in text.split("\n") if not ln.strip().startswith("```")]
        return "\n".join(lines).strip()
    return text


def _client(timeout_ms: int):
    # Imported lazily so the pure-logic modules (and their tests) do not need
    # the SDK importable just to load.
    from mistralai.client import Mistral

    return Mistral(api_key=settings.MISTRAL_API_KEY, timeout_ms=timeout_ms)


def _call(route: ModelRoute, model: str, messages: list[dict], *,
          json_mode: bool, use_effort: bool) -> tuple[str, Any]:
    kwargs: dict = {"model": model, "messages": messages}
    if use_effort and route.reasoning_effort:
        kwargs["reasoning_effort"] = route.reasoning_effort
    if route.temperature is not None:
        kwargs["temperature"] = route.temperature
    if route.max_tokens:
        kwargs["max_tokens"] = route.max_tokens
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    response = _client(route.timeout_ms).chat.complete(**kwargs)
    return extract_text(response.choices[0].message.content), getattr(response, "usage", None)


def _attempt_model(route: ModelRoute, model: str, messages: list[dict],
                   json_mode: bool) -> tuple[str, Any]:
    """Call one model with transport retries. Raises the last error."""
    attempts = max(1, int(settings.TOOL_MODEL_MAX_ATTEMPTS))
    # The fallback is a different model; the primary's effort may not apply.
    use_effort = model == route.model
    last: Optional[Exception] = None
    for attempt in range(attempts):
        try:
            return _call(route, model, messages, json_mode=json_mode, use_effort=use_effort)
        except Exception as e:  # noqa: BLE001 — classified below
            if use_effort and _rejects_effort(e):
                logger.warning("%s rejected reasoning_effort=%s — retrying without it",
                               model, route.reasoning_effort)
                use_effort = False
                last = e
                continue
            if not _is_retryable(e):
                raise
            last = e
            if attempt < attempts - 1:
                # Jittered: several jobs run at once, and synchronised retries
                # rate-limit each other.
                delay = (2 ** attempt) + random.uniform(0, 1)
                logger.warning("%s/%s unavailable (%s) — retrying in %.1fs",
                               route.role, model, type(e).__name__, delay)
                time.sleep(delay)
    assert last is not None
    raise last


def complete(role: str, messages: list[dict], *, json_mode: bool = False) -> tuple[str, str]:
    """Ask the model on ``role``'s route. Returns ``(text, model_used)``.

    Tries the route's model, then its fallback. Raises :class:`LLMUnavailable`
    when neither answers — never a raw transport error, so a caller can turn it
    into a result instead of a 500.
    """
    route = route_for(role)
    models = [route.model] + ([route.fallback_model] if route.fallback_model else [])
    errors: list[str] = []
    for model in models:
        started = time.monotonic()
        try:
            text, usage = _attempt_model(route, model, messages, json_mode)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{model}: {type(e).__name__}: {e}")
            metrics.incr(f"llm.{role}.{model}.error")
            logger.warning("%s: %s failed: %s", role, model, e)
            continue
        elapsed = time.monotonic() - started
        metrics.incr(f"llm.{role}.{model}.ok")
        metrics.observe(f"llm.{role}.seconds", elapsed)
        tokens = getattr(usage, "total_tokens", None)
        if isinstance(tokens, (int, float)):
            metrics.observe(f"llm.{role}.tokens", float(tokens))
        logger.info("%s: %s answered %d chars in %.1fs", role, model, len(text), elapsed)
        return text, model
    raise LLMUnavailable(f"No model answered for '{role}': " + " | ".join(errors))


def complete_json(role: str, messages: list[dict]) -> tuple[Any, str]:
    """:func:`complete` in JSON mode, parsed. Raises ``ValueError`` on bad JSON."""
    text, model = complete(role, messages, json_mode=True)
    text = strip_fences(text)
    try:
        return json.loads(text), model
    except ValueError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start:end + 1]), model
        raise
