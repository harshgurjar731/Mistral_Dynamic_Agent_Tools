"""
Code policy — what generated code may import and call.

The single source for these lists. The codegen prompt renders its "allowed" and
"forbidden" sections from here, and the static verifier enforces from here.
They used to be two hand-kept copies that disagreed: the prompt forbade
``pathlib``, ``tempfile``, ``asyncio``, ``pickle`` and ``open()``, while the
verifier checked ten modules and four builtins — so the model was told one set
of rules and graded against another.
"""

from __future__ import annotations

#: Standard-library modules generated code may import.
ALLOWED_STDLIB: tuple[str, ...] = (
    "json", "re", "math", "cmath", "datetime", "calendar", "zoneinfo", "hashlib",
    "hmac", "base64", "binascii", "urllib", "html", "csv", "io", "collections",
    "itertools", "functools", "decimal", "fractions", "statistics", "uuid",
    "string", "textwrap", "difflib", "typing", "dataclasses", "enum", "copy",
    "operator", "time", "random", "unicodedata", "numbers", "bisect", "heapq",
    "xml", "ipaddress", "email",
)

#: Third-party packages installed in the sandbox (sandbox_requirements.txt).
#: Keys are import names, values are what the prompt calls them.
ALLOWED_THIRD_PARTY: dict[str, str] = {
    "requests": "requests",
    "pandas": "pandas",
    "numpy": "numpy",
    "bs4": "beautifulsoup4 (import bs4)",
    "lxml": "lxml",
}

#: Never importable, even though some are stdlib. Checked before the allow-list
#: so the diagnostic can say "forbidden" rather than "not permitted".
FORBIDDEN_MODULES: frozenset[str] = frozenset({
    "os", "subprocess", "socket", "shutil", "sys", "ctypes", "multiprocessing",
    "threading", "signal", "importlib", "pathlib", "tempfile", "glob", "asyncio",
    "pickle", "marshal", "shelve", "dbm", "pty", "tty", "termios", "fcntl",
    "resource", "builtins", "inspect", "gc", "code", "codeop", "runpy", "sqlite3",
    "sqlalchemy", "http", "ftplib", "smtplib", "telnetlib", "socketserver",
    "concurrent", "atexit", "platform", "webbrowser", "zipimport",
})

FORBIDDEN_BUILTINS: frozenset[str] = frozenset({
    "eval", "exec", "compile", "open", "__import__", "vars", "locals", "globals",
    "setattr", "delattr", "input", "breakpoint", "exit", "quit", "memoryview",
})

#: Dunder attributes whose access is the usual route out of a sandbox.
FORBIDDEN_ATTRIBUTES: frozenset[str] = frozenset({
    "__subclasses__", "__globals__", "__builtins__", "__code__", "__bases__",
    "__mro__", "__getattribute__", "__loader__", "__spec__",
})
# ``__class__`` is deliberately absent: ``type(e).__name__`` and
# ``e.__class__.__name__`` are the idiomatic way to name an exception in an
# error envelope, and rejecting them cost repair attempts on correct code.

#: Modules that break an activity's determinism unless it is an HTTP activity.
NONDETERMINISTIC_FOR_ACTIVITIES: frozenset[str] = frozenset({"random", "uuid", "requests"})


def module_root(name: str) -> str:
    return (name or "").split(".")[0]


def is_allowed_module(name: str) -> bool:
    root = module_root(name)
    if root in FORBIDDEN_MODULES:
        return False
    return root in ALLOWED_STDLIB or root in ALLOWED_THIRD_PARTY


def render_imports_section() -> str:
    """The prompt's "allowed / forbidden imports" section, from the lists above."""
    stdlib = ", ".join(sorted(ALLOWED_STDLIB))
    third = ", ".join(ALLOWED_THIRD_PARTY[k] for k in sorted(ALLOWED_THIRD_PARTY))
    forbidden = ", ".join(sorted(FORBIDDEN_MODULES))
    builtins = ", ".join(f"{b}()" for b in sorted(FORBIDDEN_BUILTINS))
    attrs = ", ".join(sorted(FORBIDDEN_ATTRIBUTES))
    return (
        "ALLOWED IMPORTS — anything not listed here is rejected:\n"
        f"  Standard library: {stdlib}\n"
        f"  Third-party: {third}\n\n"
        "FORBIDDEN — rejected by static analysis before your code ever runs:\n"
        f"  Modules: {forbidden}\n"
        f"  Builtins: {builtins}\n"
        f"  Attributes: {attrs}\n"
        "  Any file I/O, environment access, process or thread creation."
    )
