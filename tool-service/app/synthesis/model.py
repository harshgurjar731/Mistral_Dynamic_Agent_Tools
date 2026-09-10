"""
Model client for code synthesis.

Separated from the pipeline because every failure mode here is about the
transport, not about the code being written: timeouts, rate limits, and the
choice of model. Previously a read timeout on the fourth retry propagated out
of the request handler and returned a 500 for the whole /synthesize call, after
three earlier attempts had already been spent.

Model choice
------------
Codestral is a code *completion* model — it is built for filling in code given
surrounding context. Writing a complete, correct function from a JSON schema,
with the error handling and the return contract this service demands, is a
reasoning task, and the generalist flagship is measurably better at holding a
long specification in mind while doing it. So generation and repair both
default to the flagship, with the model configurable per role.
"""

from __future__ import annotations

import logging
import random
import time
from typing import Optional

from mistralai.client import Mistral

from app.config import settings

logger = logging.getLogger(__name__)


class ModelUnavailable(Exception):
    """The model could not be reached within the attempt budget."""


def _is_retryable(exc: Exception) -> bool:
    """Timeouts and rate limits are worth another go; a 400 is not."""
    text = str(exc).lower()
    return any(
        marker in text
        for marker in ("timed out", "timeout", "429", "rate limit", "502", "503", "504")
    )


def _strip_fences(content: str) -> str:
    """Remove markdown fences the model wraps code in."""
    content = (content or "").strip()
    if content.startswith("```"):
        lines = [l for l in content.split("\n") if not l.strip().startswith("```")]
        content = "\n".join(lines)
    return content.strip()


def generate_code(messages: list[dict], *, role: str = "generation") -> tuple[str, str]:
    """Ask the model for Python source. Returns ``(code, model_used)``.

    Raises :class:`ModelUnavailable` rather than letting a transport error
    escape: the caller turns that into a ``failed`` synthesis result, which is
    a useful answer, where an unhandled timeout was a 500.
    """
    model = (
        settings.TOOL_REPAIR_MODEL if role == "repair" else settings.TOOL_CODEGEN_MODEL
    )
    attempts = max(1, int(settings.TOOL_MODEL_MAX_ATTEMPTS))
    timeout_ms = max(10_000, int(settings.TOOL_MODEL_TIMEOUT_MS))

    last: Optional[Exception] = None
    for attempt in range(attempts):
        started = time.monotonic()
        try:
            client = Mistral(api_key=settings.MISTRAL_API_KEY, timeout_ms=timeout_ms)
            response = client.chat.complete(
                model=model,
                messages=messages,
                temperature=settings.TOOL_CODEGEN_TEMPERATURE,
            )
            code = _strip_fences(response.choices[0].message.content)
            logger.info(
                "%s: %s produced %d chars in %.1fs",
                role, model, len(code), time.monotonic() - started,
            )
            return code, model
        except Exception as e:
            if not _is_retryable(e):
                raise
            last = e
            if attempt < attempts - 1:
                # Jittered backoff. Several tools synthesise concurrently, so
                # without jitter their retries line up and rate-limit each other.
                delay = (2 ** attempt) + random.uniform(0, 1)
                logger.warning(
                    "%s: %s unavailable (%s) — retrying in %.1fs",
                    role, model, type(e).__name__, delay,
                )
                time.sleep(delay)

    raise ModelUnavailable(
        f"{model} did not respond after {attempts} attempts: {last}"
    ) from last
