"""
The synthesis pipeline: generate, verify, repair.

Shaped as a verification loop rather than a linear chain of stages, because
that is the shape of the problem. A linear pipeline cannot express "the sandbox
failed, so go back and regenerate, then re-run static analysis and the sandbox
again" without the retry logic reaching across three stages — which is what the
previous single function did, and why its two retry loops had subtly different
behaviour.

Here there is one loop. Verifiers are ordered cheapest-first, the first failure
stops the pass, and its diagnostic is what the repair model is shown.
"""

from __future__ import annotations

import logging
from typing import Callable, Optional

from app.prompts import CODEGEN_SYSTEM_PROMPT, CODEGEN_USER_PROMPT_TEMPLATE
from app.synthesis import model as model_client
from app.synthesis.spec import Candidate, CodeSpec, Verdict
from app.synthesis.testdata import build_test_inputs
from app.synthesis.verifiers import verify_sandbox, verify_static

logger = logging.getLogger(__name__)


class SynthesisFailed(Exception):
    """The pipeline could not produce a verified tool."""

    def __init__(self, message: str, candidate: Optional[Candidate] = None):
        super().__init__(message)
        self.candidate = candidate


def build_prompt(spec: CodeSpec) -> str:
    """Render the spec into the codegen user prompt."""
    lines = []
    for name, definition in spec.properties.items():
        if isinstance(definition, dict):
            ptype = definition.get("type", "string")
            desc = definition.get("description", "")
        else:
            ptype, desc = "string", str(definition)
        marker = "(required)" if name in spec.required else "(optional)"
        lines.append(f"  - {name}: {ptype} {marker} — {desc}")

    return CODEGEN_USER_PROMPT_TEMPLATE.format(
        description=spec.description,
        params_str="\n".join(lines) if lines else "  (no parameters)",
        api_details=spec.api_details,
        expected_output_shape=spec.expected_output_shape,
    )


def _repair_request(verdict: Verdict, spec: CodeSpec) -> str:
    """What the model is told when a verifier rejects its code.

    Names the check that failed and quotes it in full. A repair prompt that
    says only "it failed" invites the model to rewrite arbitrarily, which
    routinely trades one defect for another.
    """
    if verdict.stage == "sandbox":
        return (
            f"Your code failed when executed against generated test inputs.\n\n"
            f"{verdict.diagnostic}\n\n"
            f"Fix the cause. The function must handle every declared parameter, "
            f"including optional ones that may be absent, and must return a "
            f"JSON-serialisable dict. Return only the corrected Python module, "
            f"with the entry point still named `run`."
        )
    return (
        f"Your code failed static analysis.\n\n"
        f"{verdict.diagnostic}\n\n"
        f"Fix it and return only the corrected Python module. The entry point "
        f"must be a top-level synchronous function named `run`."
    )


def synthesise(
    spec: CodeSpec,
    *,
    max_attempts: int = 3,
    on_progress: Optional[Callable[[str, str], None]] = None,
) -> Candidate:
    """Generate code for ``spec`` and return it only once every check passes.

    Raises :class:`SynthesisFailed` with the accumulated history when it cannot.
    """
    def _note(stage: str, message: str) -> None:
        logger.info("%s [%s] %s", spec.name, stage, message)
        if on_progress:
            on_progress(stage, message)

    test_inputs = build_test_inputs(spec.properties, spec.required)
    _note("plan", f"{len(test_inputs)} test case(s) from the schema")

    messages = [
        {"role": "system", "content": CODEGEN_SYSTEM_PROMPT},
        {"role": "user", "content": build_prompt(spec)},
    ]

    candidate = Candidate()
    code, used = model_client.generate_code(messages, role="generation")
    candidate.code, candidate.model_used = code, used
    _note("generate", f"{used} produced {len(code)} chars")

    for attempt in range(1, max_attempts + 1):
        verdict = _verify(spec, candidate, test_inputs)

        if verdict.ok:
            candidate.record(attempt, "verified", True)
            _note("verified", f"passed on attempt {attempt}")
            return candidate

        candidate.record(attempt, verdict.stage, False, verdict.diagnostic)

        # A harness or toolchain failure is ours. Repairing the model's code
        # cannot fix it, and pretending otherwise burns the attempt budget on
        # correct code — the failure mode this loop was rewritten to end.
        if verdict.our_fault:
            _note(verdict.stage, "harness failure, not a code defect")
            raise SynthesisFailed(
                f"The {verdict.stage} harness failed, so the generated code was "
                f"never fairly tested: {verdict.diagnostic}",
                candidate,
            )

        if attempt == max_attempts:
            break

        _note(verdict.stage, f"failed (attempt {attempt}/{max_attempts}), repairing")
        messages.append({"role": "assistant", "content": candidate.code})
        messages.append({"role": "user", "content": _repair_request(verdict, spec)})

        code, used = model_client.generate_code(messages, role="repair")
        candidate.code, candidate.model_used = code, used

    last = candidate.attempts[-1] if candidate.attempts else None
    raise SynthesisFailed(
        f"{(last.stage if last else 'verification')} failed after {max_attempts} "
        f"attempts: {(last.diagnostic if last else 'no diagnostic')}",
        candidate,
    )


def _verify(spec: CodeSpec, candidate: Candidate, test_inputs: list[dict]) -> Verdict:
    """Run the verifiers cheapest-first, stopping at the first failure."""
    static = verify_static(spec, candidate.code)
    # Formatting and any other in-place correction is kept whether or not the
    # verdict passed, so the repair model sees tidy code.
    if static.repaired_code:
        candidate.code = static.repaired_code
    if not static.ok:
        return static

    return verify_sandbox(spec, candidate.code, test_inputs)
