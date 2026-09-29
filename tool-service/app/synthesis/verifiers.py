"""
Verifiers — the checks a candidate must pass before it becomes a tool.

The ladder, cheapest first, stopping at the first failing rung:

    V1 static     ruff format → ruff --fix → policy AST rules → `run` shape
    V2 import     the module loads in the sandbox
    V3 cases      every test case meets its expectation (see testplan.py)
    V4 output     successful ``data`` validates against ``output_schema``
    V5 negative   missing required input → an error envelope, not a raise
    V6 profile    activity determinism; HTTP code under the requests stub

V2–V6 come out of one sandbox run: the runner executes every case and the
results are judged here, in order of how fundamental the failure is.

Every failing verdict carries a *fault class*: ``code`` goes to repair,
``harness`` aborts (the tooling broke, the code may be fine), ``spec`` goes back
to the caller. See spec.Verdict.
"""

from __future__ import annotations

import ast
import json
import logging
import math
import shutil
import subprocess
import sys
from typing import TYPE_CHECKING, Any, Optional

from app.synthesis import policy
from app.synthesis.sandbox import SandboxOptions, SandboxRun, run_in_sandbox
from app.synthesis.spec import CaseReport, SynthesisSpec, Verdict
from app.synthesis.testplan import (
    EXPECT_ENVELOPE,
    EXPECT_ERROR,
    EXPECT_SUCCESS,
    TestCase,
    TestPlan,
)

if TYPE_CHECKING:  # pragma: no cover
    from app.synthesis.profiles.base import CodeProfile

logger = logging.getLogger(__name__)

#: Error types an HTTP tool may legitimately return under the network stub.
TRANSPORT_ERROR_TYPES = {"network_error", "http_error", "parse_error", "empty_response",
                         "timeout", "auth_error", "configuration_error"}


# ── V1: static analysis ───────────────────────────────────────────────────


def _ruff_cmd() -> list[str]:
    exe = shutil.which("ruff")
    return [exe] if exe else [sys.executable, "-m", "ruff"]


def _ruff(args: list[str], code: str, timeout: int = 15) -> tuple[int, str, str]:
    try:
        result = subprocess.run([*_ruff_cmd(), *args], input=code.encode("utf-8"),
                                capture_output=True, timeout=timeout)
        return (result.returncode, result.stdout.decode("utf-8", errors="replace"),
                result.stderr.decode("utf-8", errors="replace"))
    except FileNotFoundError:
        return -1, "", "ruff not installed"
    except subprocess.TimeoutExpired:
        return -1, "", "ruff timed out"


def _policy_violation(tree: ast.AST, extra_forbidden: frozenset[str]) -> Optional[str]:
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                problem = _module_problem(alias.name, extra_forbidden)
                if problem:
                    return problem
        elif isinstance(node, ast.ImportFrom):
            if node.level:
                return "Relative imports are not allowed; the module stands alone."
            problem = _module_problem(node.module or "", extra_forbidden)
            if problem:
                return problem
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            name = node.func.id
            if name in policy.FORBIDDEN_BUILTINS:
                return f"Forbidden builtin `{name}()`."
            if name == "getattr" and len(node.args) >= 2 and not isinstance(node.args[1], ast.Constant):
                return "`getattr` with a computed attribute name is not allowed."
        elif isinstance(node, ast.Attribute) and node.attr in policy.FORBIDDEN_ATTRIBUTES:
            return f"Access to `{node.attr}` is not allowed."
        elif isinstance(node, ast.Name) and node.id in ("__builtins__",):
            return "Access to `__builtins__` is not allowed."
    return None


def _module_problem(name: str, extra_forbidden: frozenset[str]) -> Optional[str]:
    root = policy.module_root(name)
    if root in policy.FORBIDDEN_MODULES:
        return (f"Forbidden import `{root}`. This code runs sandboxed; see the "
                f"allowed-imports list.")
    if root in extra_forbidden:
        return (f"`{root}` is not allowed here: an activity must be deterministic and "
                f"self-contained, and `{root}` makes its output vary between runs or "
                f"depend on the network.")
    if not policy.is_allowed_module(name):
        return f"Import `{root}` is not on the allowed list, and is not installed in the sandbox."
    return None


def _module_level_problem(tree: ast.Module) -> Optional[str]:
    """Only imports, constants, functions and classes at module level."""
    for index, node in enumerate(tree.body):
        if isinstance(node, (ast.Import, ast.ImportFrom, ast.FunctionDef,
                             ast.AsyncFunctionDef, ast.ClassDef, ast.Pass)):
            continue
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and index == 0:
            continue  # module docstring
        if isinstance(node, ast.If):
            return "Remove the `if __name__ == ...` block (or any module-level `if`)."
        return (f"Module-level statement on line {node.lineno} is not allowed. Only "
                f"imports, constants and definitions may appear outside functions.")
    return None


def verify_static(code: str, extra_forbidden: frozenset[str] = frozenset()) -> Verdict:
    """V1. Format, auto-fix trivial lint, then enforce the policy."""
    # Formatting and fixable lint never cost a repair attempt.
    rc, formatted, _ = _ruff(["format", "-"], code, timeout=10)
    if rc == 0 and formatted.strip():
        code = formatted

    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return Verdict(False, "static", f"SyntaxError: {e.msg} (line {e.lineno})\n{e.text or ''}",
                       fault="code", repaired_code=code)

    # Unused imports are the most common lint "failure" in generated code and
    # are fixed mechanically — previously each one burned a whole repair pass.
    rc, fixed, _ = _ruff(["check", "--fix", "--select", "F401", "--no-cache", "--quiet",
                          "--exit-zero", "--stdin-filename", "candidate.py", "-"], code)
    if rc == 0 and fixed.strip():
        try:
            tree = ast.parse(fixed)
            code = fixed
        except SyntaxError:
            pass

    problem = _module_level_problem(tree) or _policy_violation(tree, extra_forbidden)
    if problem:
        return Verdict(False, "static", problem, fault="code", repaired_code=code)

    entry = next((n for n in tree.body
                  if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == "run"), None)
    if entry is None:
        return Verdict(False, "static", "No top-level function named `run`.",
                       fault="code", repaired_code=code)
    if isinstance(entry, ast.AsyncFunctionDef):
        return Verdict(False, "static", "`run` is async; it must be a regular function.",
                       fault="code", repaired_code=code)
    if entry.args.kwarg is None:
        return Verdict(False, "static",
                       "`run` must accept `**kwargs` — callers may pass optional or extra "
                       "arguments, and a fixed signature raises TypeError on them.",
                       fault="code", repaired_code=code)

    # Undefined names, syntax-level and comparison errors — real defects only.
    rc, out, err = _ruff(["check", "--select", "E9,F63,F7,F82", "--no-cache",
                          "--output-format", "concise", "--stdin-filename", "candidate.py", "-"], code)
    if rc > 0 and out.strip():
        return Verdict(False, "static", f"Lint errors:\n{out.strip()}", fault="code",
                       repaired_code=code)
    if rc < 0:
        logger.warning("ruff unavailable (%s) — lint step skipped", err)

    return Verdict(True, "static", repaired_code=code)


# ── Output comparison ─────────────────────────────────────────────────────


def _decimals(value: float) -> Optional[int]:
    text = repr(value)
    if "e" in text or "E" in text:
        return None
    return len(text.split(".")[1]) if "." in text else 0


def values_match(expected: Any, actual: Any, path: str = "data") -> Optional[str]:
    """None when ``actual`` satisfies ``expected``, else where and how it differs.

    Numbers compare with a small tolerance, and an unrounded result matches an
    example rounded to the same number of decimals. Dicts compare on the keys
    the example states — extra keys are the output schema's business, not the
    example's.
    """
    if isinstance(expected, bool) or isinstance(actual, bool):
        return None if expected is actual else f"{path}: expected {expected!r}, got {actual!r}"
    if isinstance(expected, (int, float)) and isinstance(actual, (int, float)):
        if math.isclose(expected, actual, rel_tol=1e-6, abs_tol=1e-6):
            return None
        places = _decimals(float(expected))
        if places is not None and places <= 6 and round(float(actual), places) == round(float(expected), places):
            return None
        return f"{path}: expected {expected!r}, got {actual!r}"
    if isinstance(expected, str) and isinstance(actual, str):
        return None if expected.strip() == actual.strip() else f"{path}: expected {expected!r}, got {actual!r}"
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return f"{path}: expected an object, got {type(actual).__name__}"
        for key, value in expected.items():
            if key not in actual:
                return f"{path}: missing key '{key}' (present: {sorted(actual)[:15]})"
            problem = values_match(value, actual[key], f"{path}.{key}")
            if problem:
                return problem
        return None
    if isinstance(expected, list):
        if not isinstance(actual, list):
            return f"{path}: expected a list, got {type(actual).__name__}"
        if len(expected) != len(actual):
            return f"{path}: expected {len(expected)} items, got {len(actual)}"
        for i, (e, a) in enumerate(zip(expected, actual)):
            problem = values_match(e, a, f"{path}[{i}]")
            if problem:
                return problem
        return None
    if expected is None:
        return None if actual is None else f"{path}: expected null, got {actual!r}"
    return None if expected == actual else f"{path}: expected {expected!r}, got {actual!r}"


def validate_against(schema: dict, value: Any) -> Optional[str]:
    try:
        import jsonschema
    except ImportError:  # pragma: no cover
        return None
    try:
        jsonschema.validate(value, schema)
        return None
    except jsonschema.ValidationError as e:
        where = "/".join(str(p) for p in e.absolute_path)
        return f"data{('/' + where) if where else ''}: {e.message}"
    except jsonschema.SchemaError as e:
        return f"output_schema is itself invalid: {e.message}"


# ── V2–V6: judging a sandbox run ──────────────────────────────────────────

#: Most fundamental first: the stage a verdict reports is the first of these
#: that any case failed at.
_STAGE_ORDER = ("contract", "output_schema", "example_mismatch", "negative", "determinism")


def _envelope_problem(result: Any) -> Optional[str]:
    if not isinstance(result, dict):
        return f"returned {type(result).__name__}, not a dict envelope"
    status = result.get("status")
    if status not in ("success", "error"):
        return f"envelope 'status' is {status!r}; it must be \"success\" or \"error\""
    if status == "success" and "data" not in result:
        return "a success envelope has no 'data' key"
    if status == "error" and not (result.get("message") or result.get("error_type")):
        return "an error envelope has neither 'error_type' nor 'message'"
    return None


def evaluate_case(spec: SynthesisSpec, case: TestCase, entry: Optional[dict],
                  *, allow_transport_errors: bool) -> tuple[CaseReport, str]:
    """Judge one case. Returns the report and the stage it failed at ('' if ok)."""
    base = dict(case_id=case.case_id, origin=case.origin, expectation=case.expect,
                input=case.kwargs, expected=case.expected)
    if entry is None:
        return CaseReport(ok=False, detail="the runner returned no result for this case", **base), "contract"

    if entry.get("raised"):
        detail = f"raised {entry.get('exception')}\n{entry.get('traceback', '')}"
        return CaseReport(ok=False, detail=detail, **base), "contract"
    if not entry.get("serialisable", True):
        return CaseReport(ok=False, actual=entry.get("result"),
                          detail=f"result is not JSON-serialisable: {entry.get('serialise_error')}",
                          **base), "contract"

    result = entry.get("result")
    problem = _envelope_problem(result)
    if problem:
        return CaseReport(ok=False, actual=result, detail=problem, **base), "contract"

    status = result["status"]
    if case.expect == EXPECT_ERROR:
        if status != "error":
            return CaseReport(ok=False, actual=result,
                              detail=f"{case.note or 'invalid input'} — must return an error "
                                     f"envelope with error_type 'validation_error', but it succeeded",
                              **base), "negative"
        return CaseReport(ok=True, actual=result, **base), ""

    if case.expect == EXPECT_SUCCESS:
        if status == "error":
            if (allow_transport_errors and case.origin != "fixture"
                    and result.get("error_type") in TRANSPORT_ERROR_TYPES):
                # The stub refused the call, or answered with a fixture meant
                # for a different input; the error path is what was tested.
                pass
            else:
                return CaseReport(ok=False, actual=result,
                                  detail=f"valid input was rejected: {result.get('error_type')}: "
                                         f"{result.get('message')} {result.get('detail', '')}".strip(),
                                  **base), "contract"
        elif spec.output_schema:
            schema_problem = validate_against(spec.output_schema, result.get("data"))
            if schema_problem:
                return CaseReport(ok=False, actual=result,
                                  detail=f"output does not match output_schema — {schema_problem}",
                                  **base), "output_schema"

        if status == "success" and case.expected is not None:
            mismatch = values_match(case.expected, result.get("data"))
            if mismatch:
                return CaseReport(ok=False, actual=result.get("data"),
                                  detail=f"output differs from the worked example — {mismatch}",
                                  **base), "example_mismatch"

    # EXPECT_ENVELOPE: a success on synthetic input must still honour the schema.
    if case.expect == EXPECT_ENVELOPE and status == "success" and spec.output_schema:
        schema_problem = validate_against(spec.output_schema, result.get("data"))
        if schema_problem:
            return CaseReport(ok=False, actual=result,
                              detail=f"output does not match output_schema — {schema_problem}",
                              **base), "output_schema"

    if case.check_repeat and entry.get("repeat_equal") is False:
        return CaseReport(ok=False, actual=result,
                          detail=entry.get("repeat_detail") or "not deterministic", **base), "determinism"

    return CaseReport(ok=True, actual=result, **base), ""


def _diagnostic(stage: str, failing: list[CaseReport]) -> str:
    lines = [f"{len(failing)} test case(s) failed at the '{stage}' check."]
    for report in failing[:5]:
        lines.append("")
        lines.append(f"• case '{report.case_id}' ({report.origin}, expected: {report.expectation})")
        lines.append(f"  input: {json.dumps(report.input, default=str)[:1500]}")
        if report.expected is not None:
            lines.append(f"  expected data: {json.dumps(report.expected, default=str)[:1500]}")
        if report.actual is not None and "raised" not in report.detail[:10]:
            lines.append(f"  actual: {json.dumps(report.actual, default=str)[:1500]}")
        lines.append(f"  problem: {report.detail[-4000:]}")
    return "\n".join(lines)


def judge_run(spec: SynthesisSpec, plan: TestPlan, run: SandboxRun,
              *, allow_transport_errors: bool) -> Verdict:
    if run.harness_error:
        return Verdict(False, "sandbox", run.harness_error, fault="harness")
    if run.timed_out:
        where = f" while running case '{run.hung_case}'" if run.hung_case else ""
        case = next((c for c in plan.cases if c.case_id == run.hung_case), None)
        inp = f"\ninput: {json.dumps(case.kwargs, default=str)[:1500]}" if case else ""
        return Verdict(False, "timeout",
                       f"Execution exceeded the time limit{where}. Remove unbounded loops, "
                       f"retries and sleeps; the function must return promptly.{inp}",
                       fault="code")
    if run.import_error:
        return Verdict(False, "import",
                       f"The module failed to load: {run.import_error}\n{run.import_traceback}".strip(),
                       fault="code")

    by_id = run.by_id
    reports: list[CaseReport] = []
    stages: dict[str, list[CaseReport]] = {}
    for case in plan.cases:
        report, stage = evaluate_case(spec, case, by_id.get(case.case_id),
                                      allow_transport_errors=allow_transport_errors)
        reports.append(report)
        if stage:
            stages.setdefault(stage, []).append(report)

    if not stages:
        return Verdict(True, "verified", cases=reports)

    stage = next(s for s in _STAGE_ORDER if s in stages)
    failing = stages[stage]
    mismatches = stages.get("example_mismatch", []) if stage == "example_mismatch" else []
    return Verdict(False, stage, _diagnostic(stage, failing), fault="code",
                   cases=reports, mismatches=mismatches)


def verify_candidate(spec: SynthesisSpec, profile: "CodeProfile", plan: TestPlan,
                     code: str) -> Verdict:
    """The whole ladder. The returned verdict's ``repaired_code`` is the code
    that was actually tested (formatted and lint-fixed)."""
    static = verify_static(code, profile.extra_forbidden_modules(spec))
    tested = static.repaired_code or code
    if not static.ok:
        return static

    options = profile.sandbox_options(spec)
    cases = [{"id": c.case_id, "kwargs": c.kwargs, "repeat": c.check_repeat} for c in plan.cases]
    run = run_in_sandbox(tested, cases, options)
    verdict = judge_run(spec, plan, run, allow_transport_errors=profile.allow_transport_errors(spec))
    verdict.repaired_code = tested
    return verdict


__all__ = [
    "verify_static", "verify_candidate", "judge_run", "evaluate_case", "values_match",
    "validate_against", "SandboxOptions", "TRANSPORT_ERROR_TYPES",
]
