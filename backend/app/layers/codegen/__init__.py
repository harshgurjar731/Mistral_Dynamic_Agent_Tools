"""
Code-requirement orchestration — deciding *what* code to build.

The tool service decides *how* to build it and proves it works; this package
decides whether anything needs building, and writes the specification the
code is generated from and tested against.

    profiles.py    tool vs activity: authoring prompt, contract rules
    layers.py      R1–R8
    preflight.py   deterministic schema/example/name checks (R6)
    pipeline.py    resolve_code_need / resolve_code_needs
"""

from app.layers.codegen.pipeline import resolve_code_need, resolve_code_needs

__all__ = ["resolve_code_need", "resolve_code_needs"]
