"""
Decision — One focused LLM call, shared by every orchestration layer.

Both orchestrators now ask many small questions instead of one large one, so
the mechanics of asking — thread offload, timeout budget, fence-tolerant JSON
parsing, and a fallback that keeps the pipeline moving — belong in one place
rather than being re-implemented per layer.

The offload-and-timeout handling here comes from the old workflow planner,
which was the only caller that already got both right.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from typing import Any, Optional

from app.core.context import PipelineContext
from app.core.layer import Layer, NextFn

logger = logging.getLogger(__name__)

# Decision calls are small and narrowly scoped — a layer asking only "which
# tools does this agent need" produces a short answer. The generous budget is
# for the tail, not the median: the DAG and instruction layers can still emit
# a few thousand tokens.
DEFAULT_TIMEOUT_MS = 120_000

# The DAG and instruction-authoring layers write substantially more than a
# facet layer does, and are given room accordingly.
LONG_TIMEOUT_MS = 180_000


class DecisionTimeout(Exception):
    """A decision call exceeded its budget. Carries a message worth showing."""


class DecisionRateLimited(Exception):
    """A decision call was rate limited and never got through."""


# One gate for every decision call in the process.
#
# Splitting the orchestrators into single-decision layers multiplied the number
# of completions, and the agent pipeline's facet group issues five of them
# simultaneously. Against a modest quota that is a 429 storm rather than a
# speed-up: four of five facets fail, their fallbacks fire, and the agent is
# assembled from defaults that were never actually decided.
#
# Created lazily because a Semaphore must belong to the running loop.
_gate: Optional[asyncio.Semaphore] = None
_gate_limit: int = 0


def _concurrency_gate() -> asyncio.Semaphore:
    global _gate, _gate_limit
    from app.config import settings

    limit = max(1, int(settings.DECISION_CONCURRENCY))
    if _gate is None or _gate_limit != limit:
        _gate = asyncio.Semaphore(limit)
        _gate_limit = limit
    return _gate


def _rate_limit_retry_after(exc: Exception) -> Optional[float]:
    """Seconds to wait if ``exc`` is a rate limit, else None.

    The SDK raises a generic ``SDKError`` whose text carries the status and
    body, so the status is matched from the message rather than an attribute
    that is not part of its public surface.
    """
    status = getattr(exc, "status_code", None) or getattr(exc, "raw_status_code", None)
    text = str(exc)
    if status != 429 and "status 429" not in text.lower() and "rate limit" not in text.lower():
        return None

    # Honour a server-supplied delay when there is one.
    headers = getattr(getattr(exc, "raw_response", None), "headers", None)
    if headers:
        for key in ("retry-after", "Retry-After", "x-ratelimit-reset"):
            value = headers.get(key) if hasattr(headers, "get") else None
            if value:
                try:
                    return max(0.0, float(value))
                except (TypeError, ValueError):
                    pass
    return 0.0  # caller falls back to its own backoff schedule


def parse_json(raw: str, fallback: Any = None) -> Any:
    """Parse a JSON response, tolerating markdown fences.

    Models wrap JSON in ``` fences often enough that treating it as a parse
    error would make the pipeline flaky for a purely cosmetic reason.
    """
    text = (raw or "").strip()
    if text.startswith("```"):
        lines = [l for l in text.split("\n") if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()
    try:
        return json.loads(text)
    except Exception as e:
        logger.error("Decision JSON parse failed: %s — raw: %.300s", e, text)
        return fallback


async def decide(
    client: Any,
    *,
    model: str,
    system: str,
    user: str,
    phase: str,
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
    temperature: float = 0.1,
) -> dict:
    """Run one decision completion off the event loop, with a real timeout.

    The Mistral client is synchronous. Called inline from a coroutine it blocks
    the whole API for the duration of the request — during a long planning call
    the backend served nothing at all, which made a slow plan look like a dead
    server. Every decision goes through ``asyncio.to_thread`` for that reason.

    Calls are gated by a process-wide semaphore and retried on a rate limit. A
    429 here is not an error to report but a queue to join: the caller's only
    alternative is its fallback, which produces an agent assembled from defaults
    nobody decided.
    """
    from app.config import settings

    started = time.monotonic()
    attempts = max(1, int(settings.DECISION_MAX_RETRIES))
    base = max(0.1, float(settings.DECISION_RETRY_BASE_SECONDS))
    last_rate_limit: Optional[Exception] = None

    for attempt in range(attempts):
        # Reset per attempt: a stale server-supplied delay must not be reused
        # for a later, unrelated rate limit.
        retry_after: float = 0.0
        async with _concurrency_gate():
            if attempt == 0:
                logger.info("Decision '%s': requesting (%d chars in)", phase, len(user))
            else:
                logger.info("Decision '%s': retry %d/%d", phase, attempt, attempts - 1)

            try:
                result = await asyncio.to_thread(
                    client.chat.complete,
                    model=model,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    temperature=temperature,
                    response_format={"type": "json_object"},
                    timeout_ms=timeout_ms,
                )
            except Exception as e:
                elapsed = time.monotonic() - started
                text = str(e).lower()
                if "timed out" in text or "timeout" in text:
                    raise DecisionTimeout(
                        f"The '{phase}' step timed out after {elapsed:.0f}s. The request may be "
                        f"too broad — try narrowing it."
                    ) from e

                retry_after = _rate_limit_retry_after(e)
                if retry_after is None:
                    raise
                last_rate_limit = e
                # Fall through to sleep *outside* the gate, so a backing-off
                # call does not hold a slot another decision could use.
            else:
                logger.info(
                    "Decision '%s': completed in %.1fs", phase, time.monotonic() - started
                )
                return result.choices[0].message.content

        if attempt < attempts - 1:
            # Exponential backoff with jitter. The jitter matters more than the
            # growth here: the facet layers are released together, so without it
            # they would retry in lockstep and rate-limit each other again.
            delay = retry_after or (base * (2 ** attempt))
            delay += random.uniform(0, base / 2)
            logger.warning(
                "Decision '%s': rate limited, retrying in %.1fs", phase, delay,
            )
            await asyncio.sleep(delay)

    raise DecisionRateLimited(
        f"The '{phase}' step was rate limited after {attempts} attempts."
    ) from last_rate_limit


class DecisionLayer(Layer):
    """Base for a layer whose whole job is one focused decision.

    Subclasses implement :meth:`build_prompt` and :meth:`apply`, and get the
    call, the parse, the error containment and the ``decision`` SSE event for
    free. A failed decision is never fatal on its own — :meth:`fallback` is
    applied and the pipeline continues, because losing one facet should
    degrade the agent rather than fail the request.
    """

    name = "decision"
    phase = "decision"
    timeout_ms = DEFAULT_TIMEOUT_MS
    temperature = 0.1

    #: Emitted before the call, so the UI can name the decision in flight.
    status_message: str = ""

    def model_for(self, ctx: PipelineContext) -> str:
        from app.config import settings

        return settings.MISTRAL_ORCHESTRATOR_MODEL

    def build_prompt(self, ctx: PipelineContext) -> tuple[str, str]:
        """Return ``(system_prompt, user_prompt)`` for this decision."""
        raise NotImplementedError

    def apply(self, ctx: PipelineContext, data: dict) -> None:
        """Write the parsed decision onto the context."""
        raise NotImplementedError

    def fallback(self, ctx: PipelineContext) -> None:
        """Write a safe default when the decision could not be made."""
        return None

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        if self.status_message:
            ctx.emit("status", self.status_message)

        try:
            system, user = self.build_prompt(ctx)
            raw = await decide(
                ctx.client,
                model=self.model_for(ctx),
                system=system,
                user=user,
                phase=self.phase,
                timeout_ms=self.timeout_ms,
                temperature=self.temperature,
            )
            data = parse_json(raw, None)
            if not isinstance(data, dict):
                raise ValueError(f"{self.phase} returned non-object JSON")
            self.apply(ctx, data)
            # Shown under this layer's row in the timeline. Every decision
            # prompt is required to justify itself, and this is where that
            # justification surfaces to the user.
            ctx.set_layer_summary(self.name, str(data.get("reasoning") or ""))
        except DecisionTimeout as e:
            logger.error("Decision '%s' timed out: %s", self.phase, e)
            ctx.emit("status", str(e))
            ctx.set_layer_summary(self.name, "Timed out — a default was used instead.")
            self.fallback(ctx)
        except DecisionRateLimited as e:
            logger.error("Decision '%s' rate limited: %s", self.phase, e)
            ctx.set_layer_summary(
                self.name,
                "Rate limited by the model API — a default was used instead.",
            )
            self.fallback(ctx)
        except Exception as e:
            logger.error("Decision '%s' failed: %s", self.phase, e, exc_info=True)
            ctx.set_layer_summary(self.name, "Could not be decided — a default was used instead.")
            self.fallback(ctx)

        return await next(ctx)


class AgentDecisionLayer(DecisionLayer):
    """A decision layer that only applies when an agent is being designed.

    Follow-ups (``conversation_id``) and user-picked agents (``agent_id``)
    already have a configured agent — there is nothing left to decide, and
    running these layers would burn a completion to answer a question whose
    answer is fixed.
    """

    def should_run(self, ctx: PipelineContext) -> bool:
        return self.enabled and not ctx.agent_id and not ctx.conversation_id
