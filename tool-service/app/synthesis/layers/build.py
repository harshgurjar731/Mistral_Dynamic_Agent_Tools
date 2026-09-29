"""
G4 Generate, G5 Verify, G6 Diagnose & repair, G7 Oracle arbitration.

One loop, because that is the shape of the problem: generate, verify, and on
failure decide by *fault class* what happens next.

    code       → repair with the failing cases quoted in full
                 (the same failure twice → restart from a clean context)
    harness    → stop; the tooling broke and the code may well be correct
    spec       → stop; the caller must fix the specification
    transport  → the model client already retried and fell back; stop

For activities, a failure that is only a disagreement with a worked example
first goes to the arbiter (G7): an independently written reference
implementation — never shown the candidate — is run on the examples. If it
sides with the code, the example was wrong: it is corrected (and reported), or
sent back to its author, instead of the code being bent to fit it.
"""

from __future__ import annotations

import time
from typing import Any, Optional

from app import llm, metrics
from app.config import settings
from app.llm.client import strip_fences
from app.synthesis.layers.base import Layer, NextFn, SynthesisContext
from app.synthesis.prompts import oracle as oracle_prompt
from app.synthesis.prompts import repair as repair_prompt
from app.synthesis.spec import CaseReport, Verdict
from app.synthesis.sandbox import SandboxOptions, run_in_sandbox
from app.synthesis.verifiers import values_match, verify_candidate, verify_static

_ROLE_BY_MODE = {"generate": "codegen", "repair": "repair", "fresh": "codegen_fresh"}


class BuildLoopLayer(Layer):
    name = "build"
    label = "Generate, verify and repair"

    def process(self, ctx: SynthesisContext, next: NextFn) -> SynthesisContext:
        spec, profile, plan = ctx.spec, ctx.profile, ctx.plan
        system = {"role": "system", "content": profile.system_prompt(spec, plan)}
        task = profile.user_prompt(spec)
        messages: list[dict] = [system, {"role": "user", "content": task}]
        mode = "generate"
        last_signature = None
        budget = max(1, int(settings.TOOL_SYNTHESIS_MAX_ATTEMPTS))

        for attempt in range(1, budget + 1):
            if ctx.seconds_left() <= 0:
                ctx.emit("budget", "wall-clock budget exhausted")
                break

            role = _ROLE_BY_MODE[mode]
            ctx.emit(mode, f"attempt {attempt}/{budget}: asking the model ({role})")
            try:
                text, model = llm.complete(role, messages)
            except llm.LLMUnavailable as e:
                metrics.incr("synthesis.fault.transport")
                return ctx.finish("failed", f"Code model unavailable: {e}", fault="transport",
                                  report=_report(ctx))
            code = strip_fences(text)
            if not code.strip():
                verdict = Verdict(False, "static", "The model returned no code.", fault="code")
            else:
                started = time.monotonic()
                verdict = verify_candidate(spec, profile, plan, code)
                metrics.observe("synthesis.verify.seconds", time.monotonic() - started)

            ctx.candidate.code = verdict.repaired_code or code
            ctx.candidate.model_used = model
            ctx.candidate.record(attempt, verdict, mode)
            self._track_best(ctx, verdict)
            ctx.emit("verify", _summary(verdict),
                     {"attempt": attempt, "stage": verdict.stage, "ok": verdict.ok,
                      "fault": verdict.fault, "passed": verdict.cases_passed,
                      "total": len(verdict.cases)})

            if verdict.ok:
                metrics.observe("synthesis.attempts", attempt)
                if attempt == 1:
                    metrics.incr(f"synthesis.{spec.purpose}.first_pass")
                ctx.verdict = verdict
                return next(ctx)

            metrics.incr(f"synthesis.fault.{verdict.fault or 'code'}.{verdict.stage}")

            if verdict.fault == "harness":
                return ctx.finish(
                    "failed",
                    f"The {verdict.stage} harness failed, so the code was never fairly "
                    f"tested: {verdict.diagnostic[-1500:]}",
                    fault="harness", report=_report(ctx))

            if (verdict.stage == "example_mismatch" and profile.arbitrates()
                    and settings.ORACLE_ARBITRATION and verdict.mismatches
                    and spec.kind == "pure"):
                ruling = self._arbitrate(ctx, verdict.mismatches)
                if ruling.spec_issues:
                    metrics.incr("synthesis.arbitration.spec_fault")
                    return ctx.finish(
                        "spec_invalid",
                        "A worked example appears to be wrong: " + "; ".join(ruling.spec_issues),
                        issues=ruling.spec_issues, fault="spec", report=_report(ctx))
                if ruling.corrected:
                    # The examples changed, not the code: judge the same code
                    # again against the corrected examples, without a model call.
                    verdict = verify_candidate(spec, profile, plan, ctx.candidate.code)
                    ctx.candidate.record(attempt, verdict, "recheck")
                    self._track_best(ctx, verdict)
                    ctx.emit("verify", _summary(verdict) + " (after example correction)",
                             {"attempt": attempt, "stage": verdict.stage, "ok": verdict.ok,
                              "passed": verdict.cases_passed, "total": len(verdict.cases)})
                    if verdict.ok:
                        ctx.verdict = verdict
                        return next(ctx)
                if ruling.evidence:
                    verdict.diagnostic += "\n\n" + "\n".join(ruling.evidence)

            if attempt == budget:
                break

            signature = verdict.signature()
            if signature == last_signature:
                # Same failure after a repair: the conversation is anchored on
                # a broken approach. Start clean, carrying only what failed.
                mode = "fresh"
                messages = [system, {"role": "user",
                                     "content": task + repair_prompt.fresh_summary(ctx.candidate)}]
            else:
                mode = "repair"
                messages = messages + [
                    {"role": "assistant", "content": ctx.candidate.code},
                    {"role": "user", "content": repair_prompt.repair_request(spec, verdict)},
                ]
            last_signature = signature

        best = ctx.best_verdict
        last = ctx.candidate.attempts[-1] if ctx.candidate.attempts else None
        metrics.incr(f"synthesis.{spec.purpose}.failed")
        detail = (best.diagnostic if best else (last.diagnostic if last else "no attempt ran"))
        return ctx.finish(
            "failed",
            f"Verification failed after {len(ctx.candidate.attempts)} attempt(s) "
            f"(last stage: {last.stage if last else 'none'}). {detail[-1500:]}",
            fault="code", report=_report(ctx), best_code=ctx.best_code)

    # ── helpers ─────────────────────────────────────────────────────────

    @staticmethod
    def _track_best(ctx: SynthesisContext, verdict: Verdict) -> None:
        best = ctx.best_verdict
        if best is None or verdict.cases_passed > best.cases_passed or verdict.ok:
            ctx.best_verdict = verdict
            ctx.best_code = ctx.candidate.code

    def _arbitrate(self, ctx: SynthesisContext, mismatches: list[CaseReport]) -> "_Ruling":
        """G7 — which is wrong, the code or the example?

        An independent reference implementation, written from the spec without
        seeing the candidate, is executed on the examples. Its answers decide:

            reference = code ≠ example   → the example is wrong: corrected
                                           (ORACLE_AUTOCORRECT) or sent back
            reference = example ≠ code   → the code is wrong: repair, with evidence
            reference agrees with neither → the spec is ambiguous: sent back
        """
        ruling = _Ruling()
        outputs = self._reference_outputs(ctx)
        if outputs is None:
            return ruling  # no referee: treat as a code fault, as before arbitration existed

        by_case = {f"example_{i}": ex for i, ex in enumerate(ctx.spec.examples, 1)}
        for report in mismatches:
            example = by_case.get(report.case_id)
            if example is None or report.case_id not in outputs:
                continue
            expected = report.expected
            reference = _project(outputs[report.case_id], expected)
            with_example = values_match(expected, reference) is None
            with_code = values_match(reference, _project(report.actual, expected)) is None

            if with_code and not with_example:
                outcome = "example_wrong"
                if settings.ORACLE_AUTOCORRECT:
                    example.output = _merge(example.output, reference)
                    for case in ctx.plan.cases:
                        if case.case_id == report.case_id:
                            case.expected = example.output
                    ruling.corrected = True
                    note = (f"{report.case_id} corrected: expected {_short(expected)} → "
                            f"{_short(reference)} (an independent reference implementation "
                            f"and the generated code agree)")
                    ctx.warnings.append(note)
                    ctx.corrections.append({"case_id": report.case_id, "was": expected,
                                            "now": reference})
                    ctx.emit("arbitrate", note)
                else:
                    ruling.spec_issues.append(
                        f"{report.case_id}: expected {_short(expected)}, but an independent "
                        f"reference implementation computes {_short(reference)} — the same as "
                        f"the generated code. Use {_short(reference)}.")
            elif with_example:
                outcome = "code_wrong"
                ruling.evidence.append(
                    f"An independent reference implementation confirms {report.case_id}'s "
                    f"expected output {_short(expected)}. The example is right; the code is wrong.")
            else:
                outcome = "ambiguous"
                ruling.spec_issues.append(
                    f"{report.case_id}: the specification admits different answers — the example "
                    f"says {_short(expected)}, the generated code {_short(_project(report.actual, expected))}, "
                    f"an independent implementation {_short(reference)}. State the method precisely.")
            ctx.arbitration.append({"case_id": report.case_id, "outcome": outcome,
                                    "reference": reference, "expected": expected,
                                    "actual": report.actual})
            metrics.incr(f"synthesis.arbitration.{outcome}")
        return ruling

    @staticmethod
    def _reference_outputs(ctx: SynthesisContext) -> Optional[dict]:
        """Run (once per job) an independently written reference on every example."""
        if ctx.reference_outputs is not None:
            return ctx.reference_outputs or None
        ctx.reference_outputs = {}
        ctx.emit("arbitrate", "code and a worked example disagree — writing an independent "
                              "reference implementation to decide which is wrong")
        try:
            text, model = llm.complete("arbiter", [
                {"role": "system", "content": oracle_prompt.SYSTEM},
                {"role": "user", "content": oracle_prompt.user(ctx.spec)},
            ])
        except Exception as e:  # noqa: BLE001
            ctx.arbitration.append({"outcome": "unavailable", "error": str(e)[:300]})
            return None
        static = verify_static(strip_fences(text))
        if not static.ok:
            ctx.arbitration.append({"outcome": "reference_invalid", "error": static.diagnostic[:300]})
            return None
        cases = [{"id": f"example_{i}", "kwargs": ex.input, "repeat": False}
                 for i, ex in enumerate(ctx.spec.examples, 1)]
        run = run_in_sandbox(static.repaired_code, cases, SandboxOptions(block_network=True))
        for entry in run.results:
            if entry.get("raised") or not entry.get("serialisable", True):
                continue
            result = entry.get("result")
            if isinstance(result, dict) and result.get("status") == "success" and "data" in result:
                result = result["data"]
            ctx.reference_outputs[entry["id"]] = result
        return ctx.reference_outputs or None


class _Ruling:
    def __init__(self):
        self.spec_issues: list[str] = []
        self.evidence: list[str] = []
        self.corrected = False


def _merge(original: Any, correction: Any) -> Any:
    """``original`` with the values ``correction`` states replaced."""
    if isinstance(original, dict) and isinstance(correction, dict):
        return {**original, **{k: _merge(original.get(k), v) for k, v in correction.items()}}
    return correction


def _project(value: Any, shape: Any) -> Any:
    """``value`` restricted to the keys ``shape`` has, recursively."""
    if isinstance(shape, dict) and isinstance(value, dict):
        return {k: _project(value.get(k), v) for k, v in shape.items() if k in value}
    if isinstance(shape, list) and isinstance(value, list) and shape:
        return [_project(v, shape[min(i, len(shape) - 1)]) for i, v in enumerate(value)]
    return value


def _short(value: Any) -> str:
    import json
    text = json.dumps(value, default=str)
    return text if len(text) <= 300 else text[:297] + "..."


def _summary(verdict: Verdict) -> str:
    if verdict.ok:
        return f"verified — {verdict.cases_passed}/{len(verdict.cases)} cases passed"
    counts = f" ({verdict.cases_passed}/{len(verdict.cases)} cases passed)" if verdict.cases else ""
    first = (verdict.diagnostic or "").strip().splitlines()
    return f"failed at {verdict.stage}{counts}: {first[0][:200] if first else ''}"


def _report(ctx: SynthesisContext) -> dict:
    """What the job learned — stored on the version and returned to the caller."""
    from dataclasses import asdict

    verdict = ctx.verdict or ctx.best_verdict
    return {
        "history": ctx.candidate.history(),
        "model": ctx.candidate.model_used,
        "attempts": [asdict(a) for a in ctx.candidate.attempts],
        "cases": [
            {**asdict(c), "detail": c.detail[-1500:]} for c in (verdict.cases if verdict else [])
        ],
        "weak_plan": bool(ctx.plan and ctx.plan.weak),
        "arbitration": ctx.arbitration,
        "corrected_examples": ctx.corrections,
        # The hash of the spec as requested, before any example correction, so
        # the same request is recognised and reused later.
        "request_hash": ctx.spec_hash,
        "warnings": list(ctx.warnings),
        "elapsed_seconds": round(time.monotonic() - ctx.started, 1),
    }


report_of = _report
