"""
Calling an agent so that one slow model cannot fail a run.

Measured on the deployment's own prompt (the drafting agent of the electricity
dispute workflow, 4 000 characters in, 77 out):

    mistral-large-latest   148.0 s        mistral-medium-2604   1.5 s
    mistral-large-4        139.8 s        mistral-small-2603    2.5 s

The agent ran on the large model, the HTTP client gives up after 120 s, and the
call was made once: every run of the workflow failed at that step.

An agent call now:

* has its own time limit (``AGENT_CALL_TIMEOUT_SECONDS``), not the client's;
* is retried on a rate limit (backoff) and once on any other transient failure;
* is **hedged**: when the agent's model has not answered after
  ``AGENT_HEDGE_SECONDS``, the same agent — its instructions, its function
  tools, its guardrails, its sampling settings — is also run on
  ``AGENT_FALLBACK_MODEL``, and the first answer is used. A model that loses is
  skipped for a while (``app.core.model_speed``), so the next step does not
  wait at all.

The fallback is the agent's own definition on another model, sent through the
chat-completion endpoint with the agent's guardrails attached. It is not used
for an agent with built-in connectors (web search, document library, code
interpreter…): only Mistral's agent runtime executes those, so such an agent is
retried on its own model instead.

Which model answered is written to ``trace`` and logged — never silent.
"""

from __future__ import annotations

import asyncio
import logging
import random
import threading
import time
from typing import Any, Optional

from app.services.workflow_engine.failures import is_transient

logger = logging.getLogger(__name__)

_PROFILE_TTL = 60.0
_profiles: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()

#: Rate-limit retries per model, and the first wait between them (seconds).
RATE_LIMIT_ATTEMPTS = 5
RATE_LIMIT_BASE = 2.0


def _is_rate_limit(exc: BaseException) -> bool:
    text = str(exc).lower()
    return "429" in text or "rate limit" in text or "too many requests" in text


def _settings():
    from app.config import settings

    return settings


def fallback_model(model: str) -> Optional[str]:
    """The model an agent on ``model`` falls back to; None when there is none (or it is off)."""
    s = _settings()
    wanted = str(getattr(s, "AGENT_FALLBACK_MODEL", "") or "").strip()
    if wanted.lower() in ("", "none", "off"):
        return None
    if wanted != model:
        return wanted
    # The agent already runs on the fallback: the next tier down is the second model.
    small = str(getattr(s, "AGENT_MODEL_SMALL", "") or "").strip()
    return small if small and small != model else None


def _fetch_profile(agent_id: str) -> dict:
    """The agent's definition as Mistral holds it (raw JSON)."""
    from app.services import agent_service

    resp = agent_service._http_client.get(f"/v1/agents/{agent_id}")
    resp.raise_for_status()
    raw = resp.json()
    tools = [t for t in raw.get("tools") or [] if isinstance(t, dict)]
    return {
        "model": raw.get("model") or "",
        "instructions": raw.get("instructions") or "",
        "tools": tools,
        "guardrails": raw.get("guardrails") or [],
        "completion_args": raw.get("completion_args") or {},
        # Only function tools run outside Mistral's agent runtime.
        "portable": all(t.get("type") == "function" for t in tools) and not raw.get("handoffs"),
    }


def profile(agent_id: str) -> Optional[dict]:
    """The agent's definition, cached briefly; None when it cannot be read."""
    now = time.monotonic()
    with _lock:
        hit = _profiles.get(agent_id)
        if hit and now - hit[0] < _PROFILE_TTL:
            return hit[1]
    try:
        value = _fetch_profile(agent_id)
    except Exception as e:  # noqa: BLE001 — no profile means no fallback, not a failed step
        logger.warning("Agent %s: its definition could not be read (%s) — no fallback model", agent_id, e)
        return None
    with _lock:
        _profiles[agent_id] = (now, value)
    return value


def forget(agent_id: Optional[str] = None) -> None:
    with _lock:
        _profiles.clear() if agent_id is None else _profiles.pop(agent_id, None)


_SAMPLING = ("temperature", "top_p", "max_tokens", "random_seed", "frequency_penalty",
             "presence_penalty", "stop", "response_format", "tool_choice")


def fallback_kwargs(prof: dict, model: str, messages: list, timeout_ms: int) -> dict:
    """``chat.complete`` arguments that run the agent's own definition on ``model``."""
    from app.services import agent_service

    kwargs: dict[str, Any] = {
        "model": model,
        "messages": ([{"role": "system", "content": prof["instructions"]}] if prof.get("instructions") else [])
                    + list(messages),
        "timeout_ms": timeout_ms,
    }
    if prof.get("tools"):
        kwargs["tools"] = prof["tools"]
    if prof.get("guardrails"):
        kwargs["guardrails"] = agent_service.build_guardrails(prof["guardrails"])
    for key in _SAMPLING:
        value = (prof.get("completion_args") or {}).get(key)
        if value is not None:
            kwargs[key] = value
    return kwargs


async def _with_rate_limit_backoff(call, step_id: str, label: str):
    delay = RATE_LIMIT_BASE
    for attempt in range(RATE_LIMIT_ATTEMPTS):
        try:
            return await call()
        except Exception as e:
            if not _is_rate_limit(e) or attempt == RATE_LIMIT_ATTEMPTS - 1:
                raise
            wait = delay + random.uniform(0, delay / 2)
            logger.warning("Step '%s' rate limited on %s (attempt %d/%d) — retrying in %.1fs",
                           step_id, label, attempt + 1, RATE_LIMIT_ATTEMPTS, wait)
            await asyncio.sleep(wait)
            delay *= 2


def _quiet(task: "asyncio.Future") -> None:
    """A call whose answer is no longer needed: let its thread finish, swallow its outcome."""
    task.add_done_callback(lambda t: t.cancelled() or t.exception())


async def complete(client: Any, agent_id: str, messages: list, step_id: str, *,
                   extra: Optional[dict] = None, trace: Optional[dict] = None):
    """One agent completion that survives a slow or unavailable model.

    ``extra``: further arguments for ``agents.complete`` (e.g. a conversation id).
    ``trace``: filled with ``model`` (the one that answered), ``fallback`` (bool)
    and ``why`` when the agent's own model did not answer.
    """
    from app.core import model_speed

    s = _settings()
    timeout_ms = int(max(20, float(getattr(s, "AGENT_CALL_TIMEOUT_SECONDS", 180) or 180)) * 1000)
    hedge = float(getattr(s, "AGENT_HEDGE_SECONDS", 0) or 0)
    trace = trace if trace is not None else {}
    extra = {k: v for k, v in (extra or {}).items() if k != "agent_id"}

    async def own() -> Any:
        return await _with_rate_limit_backoff(
            lambda: asyncio.to_thread(client.agents.complete, agent_id=agent_id, messages=messages,
                                      timeout_ms=timeout_ms, **extra),
            step_id, "the agent's model")

    # The agent's definition (cached for a minute): its model, to know whether
    # that model is currently slow, and everything a fallback run needs.
    state: dict = {"prof": None, "alt": None, "model": None}
    wants_fallback = str(getattr(s, "AGENT_FALLBACK_MODEL", "") or "").strip().lower() not in ("", "none", "off")
    if wants_fallback:
        prof = await asyncio.to_thread(profile, agent_id)
        if prof:
            state["model"] = prof.get("model") or None
            if prof.get("portable") and not extra.get("conversation_id"):
                state["prof"], state["alt"] = prof, fallback_model(prof.get("model") or "")

    async def prepare() -> bool:
        return bool(state["alt"])

    async def other() -> Any:
        kwargs = fallback_kwargs(state["prof"], state["alt"], messages, timeout_ms)
        started = time.monotonic()
        result = await _with_rate_limit_backoff(
            lambda: asyncio.to_thread(client.chat.complete, **kwargs), step_id, state["alt"])
        model_speed.record(state["alt"], time.monotonic() - started)
        return result

    def answered_by_fallback(why: str):
        trace.update(model=state["alt"], fallback=True, why=why)
        logger.warning("Step '%s' — agent %s answered by %s: %s", step_id, agent_id, state["alt"], why)

    started = time.monotonic()
    known = state["model"]
    if known and model_speed.skipped(known) and await prepare():
        # Its model has been too slow lately: the fallback answers, the agent's
        # own model is the backup.
        try:
            result = await other()
            answered_by_fallback(f"{known} has been answering too slowly")
            return result
        except Exception as e:
            if not is_transient(e):
                raise
            logger.warning("Step '%s' — fallback model failed (%s); using the agent's own model", step_id, e)
            return await own()

    primary = asyncio.ensure_future(own())
    if hedge > 0:
        await asyncio.wait({primary}, timeout=hedge)
    else:
        await asyncio.wait({primary})

    if primary.done():
        error = primary.exception()
        if error is None:
            if known:
                model_speed.record(known, time.monotonic() - started)
            trace.setdefault("fallback", False)
            return primary.result()
        if not is_transient(error):
            raise error
        # The service did not answer. Another model when there is one; else once more.
        if await prepare():
            model_speed.strike(state["prof"].get("model") or agent_id, time.monotonic() - started,
                               "an agent call failed in transit")
            result = await other()
            answered_by_fallback(f"its own model failed ({str(error)[:120]})")
            return result
        logger.warning("Step '%s' — agent call failed in transit (%s); trying once more", step_id, error)
        return await own()

    # Still no answer after the hedge delay.
    if not await prepare():
        # Nothing to race it with: wait it out, and once more if the service gave up.
        try:
            return await primary
        except Exception as e:
            if not is_transient(e):
                raise
            logger.warning("Step '%s' — agent call failed in transit (%s); trying once more", step_id, e)
            return await own()
    model = state["prof"].get("model") or ""
    logger.warning("Step '%s' — agent %s (%s) has not answered after %.0fs; also asking %s",
                   step_id, agent_id, model, hedge, state["alt"])
    second = asyncio.ensure_future(other())
    pending = {primary, second}
    failure: Optional[BaseException] = None
    while pending:
        done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            if task.exception() is None:
                for rest in pending:
                    _quiet(rest)
                if task is second:
                    model_speed.strike(model, time.monotonic() - started,
                                       "the fallback answered an agent call first", decisive=True)
                    answered_by_fallback(f"{model} had not answered after {time.monotonic() - started:.0f}s")
                else:
                    model_speed.record(model, time.monotonic() - started)
                    trace.setdefault("fallback", False)
                return task.result()
            # A refusal (guardrail, bad request) is the answer — do not wait for the other.
            if not is_transient(task.exception()):
                for rest in pending:
                    _quiet(rest)
                raise task.exception()
            failure = task.exception() if task is primary or failure is None else failure
    raise failure  # both failed in transit

