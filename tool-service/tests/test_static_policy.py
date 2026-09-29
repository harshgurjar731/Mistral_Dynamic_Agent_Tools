"""V1 static analysis, and the policy's single-source guarantee."""

from app.synthesis import policy
from app.synthesis.verifiers import verify_static
from tests.samples import GOOD_GST, UNUSED_IMPORT_GST


def _with_header(header: str) -> str:
    return header + "\n\n" + GOOD_GST


def test_good_code_passes():
    assert verify_static(GOOD_GST).ok


def test_unused_import_is_fixed_not_failed():
    verdict = verify_static(UNUSED_IMPORT_GST)
    assert verdict.ok, verdict.diagnostic
    assert "import math" not in verdict.repaired_code


def test_unused_forbidden_import_is_simply_removed():
    verdict = verify_static(_with_header("import os"))
    assert verdict.ok and "import os" not in verdict.repaired_code


def test_forbidden_module_rejected():
    verdict = verify_static(_with_header("import os\n\nCWD = os.getcwd"))
    assert not verdict.ok and verdict.fault == "code"
    assert "os" in verdict.diagnostic


def test_unlisted_module_rejected():
    verdict = verify_static(_with_header("import dateutil\n\nPARSER = dateutil.parser"))
    assert not verdict.ok and "not on the allowed list" in verdict.diagnostic


def test_forbidden_builtin_rejected():
    code = GOOD_GST.replace('"""Apply GST; data holds gst_amount and grand_total."""',
                            '"""x"""\n    open("f")')
    verdict = verify_static(code)
    assert not verdict.ok and "open" in verdict.diagnostic


def test_computed_getattr_rejected():
    code = GOOD_GST.replace('"""Apply GST; data holds gst_amount and grand_total."""',
                            '"""x"""\n    name = "a"\n    getattr(kwargs, name)')
    assert not verify_static(code).ok


def test_exception_class_name_allowed():
    code = GOOD_GST.replace('"detail": str(e)}', '"detail": e.__class__.__name__}')
    assert verify_static(code).ok


def test_run_must_take_kwargs():
    verdict = verify_static("def run(subtotal):\n    return {}\n")
    assert not verdict.ok and "**kwargs" in verdict.diagnostic


def test_main_block_rejected():
    verdict = verify_static(GOOD_GST + "\nif __name__ == '__main__':\n    run()\n")
    assert not verdict.ok


def test_undefined_name_caught_by_lint():
    code = GOOD_GST.replace("round(subtotal * rate, 2)", "round(subtotl * rate, 2)")
    verdict = verify_static(code)
    assert not verdict.ok and "subtotl" in verdict.diagnostic


def test_extra_forbidden_for_activities():
    verdict = verify_static(_with_header("import random\n\nPICK = random.choice"),
                            frozenset({"random"}))
    assert not verdict.ok and "deterministic" in verdict.diagnostic


def test_prompt_is_rendered_from_policy():
    section = policy.render_imports_section()
    for module in policy.FORBIDDEN_MODULES:
        assert module in section
    for builtin in policy.FORBIDDEN_BUILTINS:
        assert f"{builtin}()" in section
    for module in policy.ALLOWED_STDLIB:
        assert module in section
