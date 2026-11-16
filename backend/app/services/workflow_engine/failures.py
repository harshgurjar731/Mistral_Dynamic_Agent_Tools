"""
What kind of failure was that? — the question every retry and every repair must ask first.

Read from a deployed plan's records: all 17 failed dry runs of one workflow
ended at the same agent step with ``The read operation timed out`` after exactly
120 s. Nothing in the workflow was wrong — the agent's model took two minutes
to answer. The repair loop was handed "the scenarios failed" and rewrote three
working activities, renamed fields and added a transform until the workflow no
longer validated.

So a failure has a kind, and each kind has exactly one remedy:

``transient``   the service did not answer (timeout, connection, 429, 5xx,
                capacity). Remedy: wait, retry, or use another model. Never a
                change to the workflow.
``guardrail``   an agent's own moderation guardrail refused the step's input.
                Remedy: the agent's guardrail (see verify_layers).
``design``      everything else — wiring, a condition, a template, activity
                code, an answer of the wrong shape. Remedy: Refine with AI.
"""

from __future__ import annotations

import re

TRANSIENT, GUARDRAIL, DESIGN = "transient", "guardrail", "design"

# The service, the network or the quota — not the request.
_TRANSIENT = re.compile(
    r"timed out|timeout|read operation|"
    r"connection (?:error|reset|refused|aborted|closed)|connect(?:ion)? failed|connecterror|"
    r"remote end closed|server disconnected|remoteprotocolerror|"
    r"temporarily unavailable|service unavailable|bad gateway|gateway time|"
    r"\b(?:429|500|502|503|504|520|522|524|529)\b|"
    r"rate.?limit|too many requests|overloaded|capacity|"
    r"did not answer|no answer from the model",
    re.I)

# An activity's own code running out of time in the sandbox is the code's fault.
_OWN_CODE = re.compile(r"execution timed out|sandbox|exceeded the time limit|infinite loop", re.I)


def is_transient(error: object, step_type: str = "") -> bool:
    """True when ``error`` says the service did not answer, not that the request was wrong."""
    text = str(error or "")
    if not text or "blocked by guardrail" in text.lower():
        return False
    if str(step_type).lower() in ("tool", "transform", "condition") and _OWN_CODE.search(text):
        return False
    return bool(_TRANSIENT.search(text))


def kind(error: object, step_type: str = "") -> str:
    text = str(error or "").lower()
    if "blocked by guardrail" in text:
        return GUARDRAIL
    return TRANSIENT if is_transient(error, step_type) else DESIGN


def describe(error: object) -> str:
    """One plain line for a transient failure, for the person reading a test result."""
    text = str(error or "").lower()
    if "429" in text or "rate" in text or "too many requests" in text:
        return "the model service was rate limited"
    if "timed out" in text or "timeout" in text or "read operation" in text:
        return "the model did not answer in time"
    return "the model service did not respond"
