"""
Verifiers — the checks a candidate must pass before it becomes a tool.

Each verifier answers one question about the code and returns a
:class:`Verdict`. Keeping them separate from the repair loop is what lets a
failure say *which* check it failed and hand the repair model that check's own
diagnostic, rather than a generic "it did not work".

A verifier may also mark a failure ``our_fault``: the harness or the toolchain
broke, not the generated code. Those must never be sent to the repair model —
it would be asked to fix code that is correct, which is what happened to every
tool with a boolean parameter until the harness below was fixed.
"""

from __future__ import annotations

import ast
import json
import logging
import os
import subprocess
import sys
import tempfile

from app.synthesis.spec import CodeSpec, Verdict

logger = logging.getLogger(__name__)

#: Modules a generated tool may never import. Enforced by AST inspection, so
#: an aliased or nested import is caught too.
FORBIDDEN_IMPORTS = {
    "os", "subprocess", "socket", "shutil", "sys", "ctypes",
    "multiprocessing", "threading", "signal", "importlib",
}

FORBIDDEN_BUILTINS = {"eval", "exec", "compile", "__import__"}

SANDBOX_TIMEOUT_SECONDS = 15


# ── Static analysis ────────────────────────────────────────────────────────


def _ruff(args: list[str], code: str, timeout: int = 10) -> tuple[int, str, str]:
    try:
        result = subprocess.run(
            ["ruff", *args],
            input=code.encode(),
            capture_output=True,
            timeout=timeout,
        )
        return (
            result.returncode,
            result.stdout.decode(errors="replace"),
            result.stderr.decode(errors="replace"),
        )
    except FileNotFoundError:
        return -1, "", "ruff not installed"
    except subprocess.TimeoutExpired:
        return -1, "", "ruff timed out"


def verify_static(spec: CodeSpec, code: str) -> Verdict:
    """Format, parse, and check the code against the import and builtin rules."""
    # Formatting first: a purely cosmetic lint failure should never cost a
    # repair attempt.
    rc, formatted, _ = _ruff(["format", "-"], code, timeout=5)
    if rc == 0 and formatted.strip():
        code = formatted

    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return Verdict(False, "static", f"SyntaxError: {e}", repaired_code=code)

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root in FORBIDDEN_IMPORTS:
                    return Verdict(
                        False, "static",
                        f"Forbidden import '{root}'. This tool runs sandboxed and "
                        f"may not use it. Use only the permitted standard library "
                        f"and `requests`/`httpx` for HTTP.",
                        repaired_code=code,
                    )
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root in FORBIDDEN_IMPORTS:
                return Verdict(
                    False, "static",
                    f"Forbidden import from '{root}'.",
                    repaired_code=code,
                )
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in FORBIDDEN_BUILTINS:
                return Verdict(
                    False, "static",
                    f"Forbidden builtin '{node.func.id}'.",
                    repaired_code=code,
                )

    entry = next(
        (n for n in tree.body
         if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == "run"),
        None,
    )
    if entry is None:
        return Verdict(
            False, "static",
            "No `run` function at module level. The entry point must be a "
            "top-level function named exactly `run`.",
            repaired_code=code,
        )
    if isinstance(entry, ast.AsyncFunctionDef):
        return Verdict(
            False, "static",
            "`run` is async. It must be a regular synchronous function.",
            repaired_code=code,
        )

    rc, out, err = _ruff(["check", "--select", "E9,F", "--no-cache", "-"], code)
    if rc > 0 and out.strip():
        return Verdict(False, "static", f"Lint errors:\n{out.strip()}", repaired_code=code)

    return Verdict(True, "static", repaired_code=code)


# ── Sandbox execution ──────────────────────────────────────────────────────


def _harness(code: str, test_inputs: list[dict]) -> str:
    """Wrap the candidate in a runner.

    The inputs are embedded as a JSON *string* and parsed at run time, rather
    than interpolated as a Python literal.

    This is the fix for a bug that made every tool with a boolean, null, or
    non-ASCII parameter unverifiable: `json.dumps` emits `true`/`false`/`null`,
    which are not Python names, so the harness itself raised
    `NameError: name 'true' is not defined` before the tool was ever called.
    The traceback pointed at the harness line, the repair model was handed it
    as though the generated code were at fault, and three attempts were burned
    rewriting code that had never run.
    """
    payload = json.dumps(json.dumps(test_inputs))
    return (
        f"{code}\n\n"
        "if __name__ == '__main__':\n"
        "    import json as _json, sys as _sys, traceback as _tb\n"
        f"    _cases = _json.loads({payload})\n"
        "    for _i, _case in enumerate(_cases):\n"
        "        try:\n"
        "            _result = run(**_case)\n"
        "        except Exception:\n"
        "            _sys.stderr.write(\n"
        "                'Tool raised on input #%d: %r\\n' % (_i + 1, _case)\n"
        "            )\n"
        "            _tb.print_exc()\n"
        "            _sys.exit(1)\n"
        "        if _result is None:\n"
        "            _sys.stderr.write('Tool returned None on input #%d\\n' % (_i + 1))\n"
        "            _sys.exit(1)\n"
        "        try:\n"
        "            _json.dumps(_result)\n"
        "        except (TypeError, ValueError) as _e:\n"
        "            _sys.stderr.write(\n"
        "                'Tool returned a non-JSON-serialisable value on input #%d: %s\\n'\n"
        "                % (_i + 1, _e)\n"
        "            )\n"
        "            _sys.exit(1)\n"
        "        print(_json.dumps(_result))\n"
    )


def verify_sandbox(spec: CodeSpec, code: str, test_inputs: list[dict]) -> Verdict:
    """Run the candidate against generated inputs in a separate process."""
    source = _harness(code, test_inputs)

    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(
            suffix=".py", mode="w", delete=False, encoding="utf-8"
        ) as f:
            f.write(source)
            tmp_path = f.name
    except OSError as e:
        return Verdict(False, "sandbox", f"Could not stage the sandbox file: {e}",
                       our_fault=True)

    try:
        result = subprocess.run(
            [sys.executable, tmp_path],
            capture_output=True,
            timeout=SANDBOX_TIMEOUT_SECONDS,
            env={"PATH": os.environ.get("PATH", "/usr/bin:/usr/local/bin")},
            cwd=tempfile.gettempdir(),
        )
    except subprocess.TimeoutExpired:
        return Verdict(
            False, "sandbox",
            f"Execution exceeded {SANDBOX_TIMEOUT_SECONDS}s. The tool must return "
            f"promptly — remove any unbounded loop, retry, or sleep.",
        )
    except Exception as e:
        return Verdict(False, "sandbox", f"Sandbox could not run: {e}", our_fault=True)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    if result.returncode != 0:
        stderr = result.stderr.decode(errors="replace").strip()
        stdout = result.stdout.decode(errors="replace").strip()
        # The whole diagnostic, never a prefix of it: the repair model needs
        # the exception, which lives at the end of a traceback.
        detail = stderr or stdout or f"exited {result.returncode} with no output"
        our_fault = "_json.loads" in stderr or "in <module>" in stderr and "run(" not in stderr
        return Verdict(False, "sandbox", detail, our_fault=our_fault)

    return Verdict(True, "sandbox")
