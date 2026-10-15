"""A rebuild after a run-time failure carries feedback to the generator."""

from app.synthesis.prompts import common
from app.synthesis.spec import SynthesisSpec

BASE = {"name": "apply_gst", "description": "Apply 18% GST", "purpose": "activity",
        "input_schema": {"type": "object", "properties": {"subtotal": {"type": "number"}},
                         "required": ["subtotal"]}}


def test_specs_without_feedback_keep_their_identity():
    plain = SynthesisSpec.from_request(**BASE)
    assert plain.feedback == {}
    assert plain.content_hash() == SynthesisSpec.from_request(**BASE, feedback={}).content_hash()


def test_feedback_makes_a_new_identity_and_reaches_the_prompt():
    plain = SynthesisSpec.from_request(**BASE)
    fixed = SynthesisSpec.from_request(**BASE, feedback={
        "runtime_error": "TypeError: unsupported operand type(s) for *: 'str' and 'float'",
        "comment": "subtotal can arrive as a string",
        "failing_input": {"subtotal": "100"},
        "previous_code": "def run(**kw):\n    return kw['subtotal'] * 1.18",
        "ignored": "x",
    })
    assert fixed.content_hash() != plain.content_hash()
    assert set(fixed.feedback) == {"runtime_error", "comment", "failing_input", "previous_code"}
    block = common.spec_block(fixed)
    assert "The previous version failed" in block
    assert "subtotal can arrive as a string" in block and '"subtotal": "100"' in block


def test_feedback_is_bounded_and_needs_an_error_or_comment():
    assert SynthesisSpec.from_request(**BASE, feedback={"previous_code": "x"}).feedback == {}
    long = SynthesisSpec.from_request(**BASE, feedback={"runtime_error": "e" * 10000})
    assert len(long.feedback["runtime_error"]) == 4000
