"""
The restricted Python a condition or transform step runs in — one definition.

The planner was told one contract and the runner enforced another. Transform
code was described as "a short expression" but executed with ``exec`` and read
from a variable named ``output``; ``round`` was not available although every
financial transform reaches for it. Condition prompts promised ``len``, ``str``,
``int`` and ``float`` while the evaluator ran with no builtins at all. Each
mismatch passed validation and failed the first run.

So the runner, plan validation and the prompts all read the names below, and
validation compiles the code against exactly the scope it will run in:

* a transform is either one expression (its value is the output) or statements
  that assign ``output``; ``variables`` holds every workflow variable;
* a condition is one boolean expression after ``{{var}}`` substitution;
* both get the builtins in :data:`SAFE_BUILTINS` and the ``json`` module —
  no imports, no attribute access to dunder names, nothing else.
"""

from __future__ import annotations

import ast
import builtins as _builtins
import json
from typing import Any, Optional

#: Builtins available to condition expressions and transform code.
SAFE_BUILTIN_NAMES: tuple[str, ...] = (
    "str", "int", "float", "bool", "list", "dict", "tuple", "set",
    "len", "round", "min", "max", "abs", "sum", "sorted", "reversed",
    "enumerate", "zip", "range", "any", "all", "isinstance", "map", "filter",
)
SAFE_BUILTINS: dict[str, Any] = {name: getattr(_builtins, name) for name in SAFE_BUILTIN_NAMES}

#: Names a condition expression may use besides the builtins.
CONDITION_CONSTANTS: dict[str, Any] = {
    "true": True, "false": False, "null": None, "True": True, "False": False, "None": None,
}

#: Names transform code is handed besides the builtins.
TRANSFORM_NAMES = ("variables", "output", "json")

#: One line for prompts: what transform code may use.
TRANSFORM_CONTRACT = (
    "Python run in a sandbox. `variables` is a dict of every workflow variable "
    "(step outputs as `variables['step_<id>_output']`, workflow inputs by name). "
    "Records and lists are already Python dicts and lists — index them directly "
    "(`variables['step_x_output']['field']`); `json.loads` on one is harmless. Either "
    "write ONE expression whose value is the step's output, or write statements that "
    "assign the result to `output` (a dict). Available: " + ", ".join(SAFE_BUILTIN_NAMES)
    + ", and `json`. No imports, no other modules, no other functions."
)

#: One line for prompts: what a condition expression may use.
CONDITION_CONTRACT = (
    "One Python boolean expression over {{variable}} references (they are "
    "substituted as literals before evaluation): comparisons, `in`, `and`/`or`/"
    "`not`, and " + ", ".join(SAFE_BUILTIN_NAMES) + ". No imports, no assignments."
)


class SandboxError(ValueError):
    """The code cannot run in the sandbox — found before or while running it."""


class _Json:
    """``json`` for transform code: ``loads`` of a value that is already a record returns it.

    The engine keeps a step's record output as a JSON string, so transform code
    was told it "may need json.loads" — and half of it indexed the string
    instead ("string indices must be integers"). Transforms now receive records
    parsed (:func:`structured`); code that still calls ``json.loads`` on one —
    every transform written under the old contract — keeps working.
    """

    JSONDecodeError = json.JSONDecodeError

    @staticmethod
    def loads(value, *args, **kwargs):
        if isinstance(value, (dict, list)):
            return value
        return json.loads(value, *args, **kwargs)

    dumps = staticmethod(json.dumps)


def structured(variables: dict) -> dict:
    """``variables`` with every JSON-encoded record or list parsed (one level of values)."""
    out = {}
    for key, value in (variables or {}).items():
        if isinstance(value, str):
            text = value.strip()
            if text[:1] in ("{", "[") and text[-1:] in ("}", "]"):
                try:
                    value = json.loads(text)
                except ValueError:
                    pass
        out[key] = value
    return out


def _transform_scope(variables: dict, output: Any) -> dict:
    """One namespace for the code — its globals *and* its locals.

    With separate dicts, a name the code assigns lives in the locals, and a
    comprehension, generator or nested function (each its own scope) looks only
    in the globals: ``mean = sum(xs) / n`` followed by
    ``[(x - mean) ** 2 for x in xs]`` failed every run with "name 'mean' is not
    defined", although plan validation — rightly — found nothing wrong with it.
    """
    return {"__builtins__": dict(SAFE_BUILTINS), "json": _Json,
            "variables": structured(variables), "output": output}


def is_expression(code: str) -> bool:
    try:
        ast.parse(code.strip(), mode="eval")
    except SyntaxError:
        return False
    return True


def run_transform(code: str, variables: dict, output: Optional[dict] = None) -> Any:
    """Run transform code. An expression's value, else whatever it assigned to ``output``."""
    code = (code or "").strip()
    scope = _transform_scope(variables, output if output is not None else {})
    if is_expression(code):
        return eval(compile(code, "<transform>", "eval"), scope)  # noqa: S307
    exec(compile(code, "<transform>", "exec"), scope)  # noqa: S102
    return scope.get("output")


def eval_condition(expression: str) -> Any:
    """Evaluate an already-substituted condition expression."""
    scope = {"__builtins__": dict(SAFE_BUILTINS), **CONDITION_CONSTANTS}
    return eval(compile(expression, "<condition>", "eval"), scope)  # noqa: S307


# ── Static checks (plan validation) ──────────────────────────────────────


def _forbidden(tree: ast.AST) -> Optional[str]:
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            return "imports are not allowed"
        if isinstance(node, ast.Attribute) and node.attr.startswith("__"):
            return f"'{node.attr}' cannot be used"
        if isinstance(node, ast.Name) and node.id.startswith("__"):
            return f"'{node.id}' cannot be used"
        if isinstance(node, (ast.Global, ast.Nonlocal, ast.Lambda, ast.ClassDef,
                             ast.AsyncFunctionDef, ast.Await)):
            return f"{type(node).__name__.lower()} is not allowed"
    return None


def _bound_names(tree: ast.AST) -> set[str]:
    """Every name the code itself binds (assignments, loop and comprehension targets, defs)."""
    bound: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
            bound.add(node.id)
        elif isinstance(node, ast.FunctionDef):
            bound.add(node.name)
            bound.update(a.arg for a in node.args.args + node.args.kwonlyargs)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            bound.add(node.name)
        elif isinstance(node, ast.arg):
            bound.add(node.arg)
    return bound


def _unknown_names(tree: ast.AST, allowed: set[str]) -> list[str]:
    bound = _bound_names(tree) | allowed
    unknown = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id not in bound:
            if node.id not in unknown:
                unknown.append(node.id)
    return unknown


def check_transform(code: str) -> Optional[str]:
    """Why this transform code cannot run in the sandbox, or None."""
    code = (code or "").strip()
    if not code:
        return "transform code is empty"
    expression = is_expression(code)
    try:
        tree = ast.parse(code, mode="eval" if expression else "exec")
    except SyntaxError as e:
        return f"syntax error on line {e.lineno}: {e.msg}"
    problem = _forbidden(tree)
    if problem:
        return problem
    unknown = _unknown_names(tree, set(SAFE_BUILTIN_NAMES) | set(TRANSFORM_NAMES))
    if unknown:
        return (f"uses {', '.join(repr(n) for n in unknown)}, which the sandbox does not have "
                f"(available: {', '.join(SAFE_BUILTIN_NAMES)}, json, variables)")
    if not expression and "output" not in _bound_names(tree):
        return "statements must assign the result to `output` (or write one expression)"
    return None


def check_condition(expression: str) -> Optional[str]:
    """Why this condition cannot be evaluated, or None.

    ``{{var}}`` references are replaced by a placeholder literal first, as the
    runner substitutes them before evaluating.
    """
    import re

    text = re.sub(r"\{{2,}[^{}]+\}{2,}", "0", (expression or "").strip())
    if not text:
        return "the expression is empty"
    try:
        tree = ast.parse(text, mode="eval")
    except SyntaxError as e:
        return f"not a single Python expression: {e.msg}"
    problem = _forbidden(tree)
    if problem:
        return problem
    unknown = _unknown_names(tree, set(SAFE_BUILTIN_NAMES) | set(CONDITION_CONSTANTS))
    if unknown:
        return (f"uses {', '.join(repr(n) for n in unknown)} — reference workflow values as "
                "{{name}} so they are substituted before evaluation")
    return None
