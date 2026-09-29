"""
Repair and fresh-restart prompts.

A repair prompt names the check that failed and quotes it in full: the failing
case's input, what was expected, what came back. "It failed" invites a rewrite
that trades one defect for another; the evidence invites a fix.
"""

from __future__ import annotations

from app.synthesis.spec import Candidate, SynthesisSpec, Verdict

_GUIDANCE = {
    "static": "Fix the static-analysis problem. Keep the rest of the module unchanged.",
    "import": "The module fails when it is imported. Fix the top-level problem "
              "(an unavailable import, a name error, a statement outside a function).",
    "timeout": "The function did not return in time. Remove unbounded loops, retries and sleeps.",
    "contract": "Every return path must produce a valid envelope, and valid input must "
                "succeed. Read each failing case's input and problem and fix the cause.",
    "output_schema": "`data` must validate against the output schema exactly: required "
                     "field names, types and nesting. Fix the shape of what you return.",
    "example_mismatch": "Your result differs from the worked example. Recompute the "
                        "example by hand from its input, find where your logic diverges "
                        "(formula, rounding, ordering, units), and fix it.",
    "negative": "Invalid input must be rejected with a validation_error envelope. "
                "Check every required parameter before using it.",
    "determinism": "The same input must give the same output. Remove randomness, UUIDs, "
                   "current-time values and any dependence on iteration order of sets.",
}


def repair_request(spec: SynthesisSpec, verdict: Verdict) -> str:
    guidance = _GUIDANCE.get(verdict.stage, "Fix the failure described below.")
    return (
        f"Your module failed verification at the '{verdict.stage}' check.\n\n"
        f"{verdict.diagnostic}\n\n"
        f"{guidance}\n"
        f"Return the COMPLETE corrected module — `def run(**kwargs) -> dict` — "
        f"with no fences and no explanation."
    )


def fresh_summary(candidate: Candidate) -> str:
    """What earlier attempts got wrong, for a restart from a clean context."""
    lines = []
    for a in candidate.attempts[-4:]:
        head = (a.diagnostic or "").strip().splitlines()
        lines.append(f"- attempt {a.number} ({a.mode}): failed at '{a.stage}'"
                     + (f" — {head[0][:300]}" if head else ""))
        if len(head) > 1:
            lines.append("  " + " | ".join(h.strip() for h in head[1:6])[:900])
    return (
        "\n\nEarlier attempts at this task kept failing the same way:\n"
        + "\n".join(lines)
        + "\n\nDo not patch a previous version. Re-read the specification and "
          "write the module again from first principles, avoiding these failures."
    )
