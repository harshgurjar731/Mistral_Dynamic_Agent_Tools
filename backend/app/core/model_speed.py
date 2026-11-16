"""
How fast each model answers — so a slow one cannot stall a build.

Measured on the deployment: a plan spent 140 minutes, most of it waiting.
Nearly every decision ran on a large reasoning model that did not answer inside
its 3–5 minute budget; the answer then came from the fallback model in 10–20
seconds. The same decision, timed directly: 140–190 s on ``mistral-large-4``,
6–16 s on ``mistral-medium-2604``, with the same correct result.

Two mechanisms keep any configuration fast, both driven by what is observed:

* **Hedge** — when the primary has not answered after ``DECISION_HEDGE_SECONDS``
  and the fallback is expected to be faster, the fallback is started alongside
  and the first good answer is used.
* **Breaker** — a model that loses a hedge (the fallback answered while it was
  still silent) is skipped for ``OPEN_SECONDS``: calls go straight to the
  fallback, and the slow model is tried again afterwards. Each time it loses
  again on that retry the pause doubles, up to ``MAX_OPEN_SECONDS`` — a model
  that is slow all day costs one hedge delay per pause, not one per decision.
  A plain timeout takes ``STRIKES`` in a row.

The same record serves agent steps at run time
(``app.services.workflow_engine.agent_call``).

Per process, per model name; no persistence — a restart starts from the priors.
"""

from __future__ import annotations

import logging
import threading
import time

logger = logging.getLogger(__name__)

#: Losses in a row before a model is skipped.
STRIKES = 2
#: How long a skipped model stays skipped the first time; doubles on each repeat.
OPEN_SECONDS = 900.0
MAX_OPEN_SECONDS = 4 * 3600.0
#: Latency assumed for a model nothing has been observed on yet (seconds).
_PRIOR_SLOW, _PRIOR_FAST = 90.0, 12.0

_lock = threading.Lock()
_stats: dict[str, dict] = {}


def _entry(model: str) -> dict:
    return _stats.setdefault(model, {"ewma": None, "strikes": 0, "open_until": 0.0, "opens": 0})


def _prior(model: str) -> float:
    low = (model or "").lower()
    return _PRIOR_SLOW if "large" in low else _PRIOR_FAST


def expected(model: str) -> float:
    """Seconds a call to ``model`` is expected to take."""
    with _lock:
        ewma = _entry(model)["ewma"]
    return float(ewma) if ewma is not None else _prior(model)


def record(model: str, seconds: float) -> None:
    """A call to ``model`` answered in ``seconds``."""
    with _lock:
        e = _entry(model)
        e["ewma"] = seconds if e["ewma"] is None else 0.6 * e["ewma"] + 0.4 * seconds
        e["strikes"] = 0
        # An answer that arrives while the model is being skipped is the slow
        # call that lost its race finishing late — not a recovery.
        if e["open_until"] <= time.monotonic():
            e["opens"] = 0


def strike(model: str, seconds: float, why: str, *, decisive: bool = False) -> bool:
    """``model`` was too slow (lost a hedge, or timed out). True when it is now skipped.

    ``decisive``: another model answered the same request while this one was
    still silent — one such loss is enough.
    """
    with _lock:
        e = _entry(model)
        e["ewma"] = seconds if e["ewma"] is None else max(e["ewma"], 0.6 * e["ewma"] + 0.4 * seconds)
        e["strikes"] += 1
        if not decisive and e["strikes"] < STRIKES:
            return False
        e["strikes"] = 0
        pause = min(MAX_OPEN_SECONDS, OPEN_SECONDS * (2 ** e["opens"]))
        e["opens"] += 1
        e["open_until"] = time.monotonic() + pause
    logger.warning("Model %s is answering slowly (%s) — using the fallback model for the next %d min",
                   model, why, int(pause // 60))
    return True


def skipped(model: str) -> bool:
    """True while ``model`` is being skipped for answering too slowly."""
    with _lock:
        return _entry(model)["open_until"] > time.monotonic()


def snapshot() -> dict:
    """What has been observed, for the health page and the logs."""
    now = time.monotonic()
    with _lock:
        return {m: {"seconds": round(e["ewma"], 1) if e["ewma"] is not None else None,
                    "skipped_for": max(0, round(e["open_until"] - now))}
                for m, e in _stats.items()}


def reset() -> None:
    with _lock:
        _stats.clear()
        _probes.clear()


# ── Is this model answering right now? ─────────────────────────────────────
#
# Asked before an agent is created on a model. The deployment's drafting agent
# was created on a model that took 148 s to write 77 characters; every run of
# its workflow then failed at that step. A short test of the model would have shown it.

#: A model that cannot finish the probe task in this long is not used for a new agent.
PROBE_SECONDS = 12.0
#: How long a probe's result is trusted.
PROBE_TTL = 900.0
# The probe is the shape of a workflow agent's work — a system prompt with rules,
# a record, a short structured answer — because that is what has to be fast.
# Measured 2026-11-16: mistral-medium-latest 1.0 s, mistral-small-latest 1.3 s;
# mistral-large-latest no answer in 60 s (it reasons at length before every
# answer and the effort cannot be turned off). "Repeat this sentence" did not
# tell them apart.
_PROBE_SYSTEM = ("You are a step in an automated workflow. From the record you are given, write the "
                 "customer a reply of exactly three sentences: greet them by name, state the outcome "
                 "and the amount, and say what happens next. Use only the values in the record. "
                 'Return JSON: {"reply": "..."}.')
_PROBE_USER = ('{"customer_name": "Alex Morgan", "order_id": "ORD-1042", "outcome": "refund", '
               '"amount_gbp": 18.5, "refund_days": 5, "reason": "item arrived damaged"}')
_probes: dict[str, tuple[float, bool]] = {}


def _probe_sync(client, model: str) -> bool | None:
    """True/False: answered inside the budget or not. None: could not be judged (not a timing failure)."""
    from app.services.workflow_engine.failures import is_transient

    started = time.monotonic()
    try:
        client.chat.complete(model=model, timeout_ms=int(PROBE_SECONDS * 1000),
                             messages=[{"role": "system", "content": _PROBE_SYSTEM},
                                       {"role": "user", "content": _PROBE_USER}])
    except Exception as e:  # noqa: BLE001
        if is_transient(e) and "429" not in str(e) and "rate" not in str(e).lower():
            return False  # no answer in time, or the service failing for this model
        logger.info("Model %s could not be probed (%s) — left as chosen", model, str(e)[:160])
        return None
    seconds = time.monotonic() - started
    record(model, seconds)
    return seconds <= PROBE_SECONDS


async def responsive(client, model: str) -> bool | None:
    """Whether ``model`` is answering promptly right now (probed at most every ``PROBE_TTL``)."""
    import asyncio

    if not model:
        return None
    if skipped(model):
        return False
    now = time.monotonic()
    with _lock:
        hit = _probes.get(model)
    if hit and now - hit[0] < PROBE_TTL:
        return hit[1]
    verdict = await asyncio.to_thread(_probe_sync, client, model)
    if verdict is not None:
        with _lock:
            _probes[model] = (now, verdict)
        if verdict is False:
            strike(model, PROBE_SECONDS, "it did not answer a short test in time", decisive=True)
    return verdict


async def responsive_model(client, model: str, candidates: list[str]) -> tuple[str, str]:
    """``model`` when it is answering; else the first of ``candidates`` that is. Returns (model, note)."""
    if await responsive(client, model) is not False:
        return model, ""
    for other in dict.fromkeys(c for c in candidates if c and c != model):
        if await responsive(client, other) is True:
            return other, (f"{model} is answering too slowly right now (a three-sentence test reply "
                           f"took more than {int(PROBE_SECONDS)}s) — using {other} instead. Change the "
                           "agent's model under Agents if you want it back.")
    return model, f"{model} is answering slowly right now and no faster model is configured."
