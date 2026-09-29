"""Specs and candidate code shared by the tests."""

from app.synthesis.spec import SynthesisSpec

GST_SPEC = dict(
    name="apply_gst",
    description="Apply GST at the given rate (default 18%) to a subtotal and return the "
                "GST amount and the grand total, each rounded to 2 decimals.",
    purpose="activity",
    input_schema={
        "type": "object",
        "properties": {
            "subtotal": {"type": "number", "minimum": 0, "description": "Pre-tax amount"},
            "rate": {"type": "number", "minimum": 0, "description": "Tax rate, default 0.18"},
        },
        "required": ["subtotal"],
    },
    output_schema={
        "type": "object",
        "properties": {"gst_amount": {"type": "number"}, "grand_total": {"type": "number"}},
        "required": ["gst_amount", "grand_total"],
    },
    examples=[
        {"input": {"subtotal": 100}, "output": {"gst_amount": 18.0, "grand_total": 118.0}},
        {"input": {"subtotal": 250.5}, "output": {"gst_amount": 45.09, "grand_total": 295.59},
         "note": "250.5 × 0.18 = 45.09"},
    ],
)


def gst_spec(**overrides) -> SynthesisSpec:
    return SynthesisSpec.from_request(**{**GST_SPEC, **overrides})


GOOD_GST = '''
def run(**kwargs) -> dict:
    """Apply GST; data holds gst_amount and grand_total."""
    subtotal = kwargs.get("subtotal")
    rate = kwargs.get("rate", 0.18)
    if isinstance(subtotal, bool) or not isinstance(subtotal, (int, float)):
        return {"status": "error", "error_type": "validation_error",
                "message": "subtotal must be a number", "detail": repr(subtotal)}
    if isinstance(rate, bool) or not isinstance(rate, (int, float)):
        return {"status": "error", "error_type": "validation_error",
                "message": "rate must be a number", "detail": repr(rate)}
    try:
        gst = round(subtotal * rate, 2)
        return {"status": "success",
                "data": {"gst_amount": gst, "grand_total": round(subtotal + gst, 2)},
                "source": "computed"}
    except Exception as e:
        return {"status": "error", "error_type": "unexpected_error",
                "message": "calculation failed", "detail": str(e)}
'''

# Wrong rate: disagrees with both examples.
WRONG_RATE_GST = GOOD_GST.replace('kwargs.get("rate", 0.18)', 'kwargs.get("rate", 0.15)')

# Rejects everything — the "vacuous pass" the old harness accepted.
ALWAYS_REJECTS = '''
def run(**kwargs) -> dict:
    """Reject."""
    return {"status": "error", "error_type": "validation_error",
            "message": "invalid input", "detail": ""}
'''

# Loads nothing: a module-level NameError, which the old harness blamed on itself.
BROKEN_IMPORT = '''
import json

VALUE = undefined_name


def run(**kwargs) -> dict:
    """Nothing."""
    return {"status": "success", "data": json.dumps({}), "source": "computed"}
'''

# Returns a field name the output schema does not have.
WRONG_SHAPE_GST = GOOD_GST.replace('"grand_total": round', '"total": round')

UNUSED_IMPORT_GST = "import json\nimport math\n" + GOOD_GST

TOOL_SPEC = dict(
    name="word_count",
    description="Count the words in a piece of text and return the count.",
    purpose="tool",
    parameters={"text": {"type": "string", "description": "The text to count words in"}},
    required=["text"],
    output_schema={"type": "object", "properties": {"words": {"type": "integer"}},
                   "required": ["words"]},
)

GOOD_WORD_COUNT = '''
def run(**kwargs) -> dict:
    """Count words; data holds words."""
    text = kwargs.get("text")
    if not isinstance(text, str):
        return {"status": "error", "error_type": "validation_error",
                "message": "text must be a string", "detail": repr(text)}
    try:
        return {"status": "success", "data": {"words": len(text.split())}, "source": "computed"}
    except Exception as e:
        return {"status": "error", "error_type": "unexpected_error",
                "message": "failed", "detail": str(e)}
'''
