"""The ladder must reject code the old harness accepted, and accept correct code."""

import pytest

from app.synthesis.profiles import get_profile
from app.synthesis.spec import SynthesisSpec
from app.synthesis.verifiers import values_match, verify_candidate
from tests.samples import (
    ALWAYS_REJECTS,
    GOOD_GST,
    GOOD_WORD_COUNT,
    TOOL_SPEC,
    WRONG_RATE_GST,
    WRONG_SHAPE_GST,
    gst_spec,
)


def _verify(spec, code, llm_inputs=()):
    profile = get_profile(spec.purpose)
    plan = profile.build_test_plan(spec, list(llm_inputs))
    return verify_candidate(spec, profile, plan, code), plan


def test_correct_activity_verifies():
    verdict, plan = _verify(gst_spec(), GOOD_GST)
    assert verdict.ok, verdict.diagnostic
    assert not plan.weak
    assert {c.origin for c in plan.cases} >= {"example", "schema_full", "boundary", "missing_required"}


def test_vacuous_code_is_rejected():
    verdict, _ = _verify(gst_spec(), ALWAYS_REJECTS)
    assert not verdict.ok and verdict.stage == "contract"
    assert "valid input was rejected" in verdict.diagnostic


def test_wrong_values_are_an_example_mismatch():
    verdict, _ = _verify(gst_spec(), WRONG_RATE_GST)
    assert not verdict.ok and verdict.stage == "example_mismatch"
    assert verdict.mismatches and verdict.mismatches[0].expected == {"gst_amount": 18.0, "grand_total": 118.0}


def test_wrong_output_shape_fails_output_schema():
    verdict, _ = _verify(gst_spec(), WRONG_SHAPE_GST)
    assert not verdict.ok and verdict.stage == "output_schema"
    assert "grand_total" in verdict.diagnostic


def test_nondeterminism_is_caught():
    code = GOOD_GST.replace(
        '"source": "computed"}',
        '"source": "computed", "nonce": time.perf_counter_ns()}',
    )
    verdict, _ = _verify(gst_spec(), "import time\n" + code)
    assert not verdict.ok and verdict.stage == "determinism"


def test_missing_required_must_be_an_error_envelope():
    code = GOOD_GST.replace(
        'if isinstance(subtotal, bool) or not isinstance(subtotal, (int, float)):',
        'if subtotal is None:\n        subtotal = 0\n    if isinstance(subtotal, bool):',
    )
    verdict, _ = _verify(gst_spec(), code)
    assert not verdict.ok and verdict.stage == "negative"


def test_tool_with_llm_inputs_verifies():
    spec = SynthesisSpec.from_request(**TOOL_SPEC)
    verdict, plan = _verify(spec, GOOD_WORD_COUNT, [{"text": "the quick brown fox"}])
    assert verdict.ok, verdict.diagnostic
    assert not plan.weak


def test_tool_without_valid_inputs_is_a_weak_plan():
    spec = SynthesisSpec.from_request(**TOOL_SPEC)
    _, plan = _verify(spec, GOOD_WORD_COUNT)
    assert plan.weak


def test_http_tool_may_report_transport_errors_under_stub():
    spec = SynthesisSpec.from_request(
        name="get_rate", description="Fetch an exchange rate from the Frankfurter API.",
        purpose="tool", kind="http",
        api_details="GET https://api.frankfurter.app/latest?from=GBP&to=EUR",
        parameters={"base": {"type": "string", "description": "currency"}}, required=["base"])
    code = ("import requests\n\nREQUEST_TIMEOUT = 10\n\n\ndef run(**kwargs) -> dict:\n"
            "    \"\"\"Fetch.\"\"\"\n    base = kwargs.get('base')\n"
            "    if not isinstance(base, str) or not base:\n"
            "        return {'status': 'error', 'error_type': 'validation_error', 'message': 'base'}\n"
            "    try:\n        resp = requests.get('https://api.frankfurter.app/latest',"
            " params={'from': base}, timeout=REQUEST_TIMEOUT)\n"
            "    except requests.exceptions.ConnectionError as e:\n"
            "        return {'status': 'error', 'error_type': 'network_error', 'message': str(e)}\n"
            "    return {'status': 'success', 'data': resp.json(), 'source': 'frankfurter'}\n")
    verdict, _ = _verify(spec, code, [{"base": "GBP"}])
    assert verdict.ok, verdict.diagnostic


@pytest.mark.parametrize("expected,actual,ok", [
    (18.0, 18, True),
    (45.09, 45.089999999, True),
    (45.09, 45.0901, True),      # unrounded result, rounded example
    (45.09, 45.1, False),
    ({"a": 1}, {"a": 1, "extra": 2}, True),
    ({"a": 1}, {"b": 1}, False),
    ([1, 2], [1, 2, 3], False),
    ("x ", "x", True),
    (True, 1, False),
])
def test_values_match(expected, actual, ok):
    assert (values_match(expected, actual) is None) is ok


FX_CODE = '''
import requests

REQUEST_TIMEOUT = 10


def run(**kwargs) -> dict:
    """Fetch a rate."""
    base, quote = kwargs.get("base"), kwargs.get("quote")
    if not isinstance(base, str) or not isinstance(quote, str):
        return {"status": "error", "error_type": "validation_error", "message": "base/quote"}
    try:
        resp = requests.get("https://api.frankfurter.app/latest",
                            params={"from": base, "to": quote}, timeout=REQUEST_TIMEOUT)
    except requests.exceptions.ConnectionError as e:
        return {"status": "error", "error_type": "network_error", "message": str(e)}
    rate = (resp.json().get("rates") or {}).get(quote)
    if rate is None:
        return {"status": "error", "error_type": "parse_error", "message": "no rate"}
    return {"status": "success", "data": {"rate": rate}, "source": "frankfurter"}
'''


def _fx_spec():
    return SynthesisSpec.from_request(
        name="get_exchange_rate", description="Latest exchange rate from the Frankfurter API.",
        purpose="tool", kind="http", api_details="GET https://api.frankfurter.app/latest",
        parameters={"base": {"type": "string", "description": "from"},
                    "quote": {"type": "string", "description": "to"}},
        required=["base", "quote"],
        http_fixtures=[{"status": 200, "json": {"rates": {"EUR": 1.17}},
                        "for_input": {"base": "GBP", "quote": "EUR"}}])


def test_fixture_case_must_really_succeed_other_inputs_may_mismatch():
    verdict, plan = _verify(_fx_spec(), FX_CODE, [{"base": "USD", "quote": "JPY"}])
    assert verdict.ok, verdict.diagnostic
    assert any(c.origin == "fixture" for c in plan.cases)


def test_broken_parsing_fails_the_fixture_case():
    broken = FX_CODE.replace('.get(quote)', '.get("XXX")')
    verdict, _ = _verify(_fx_spec(), broken, [{"base": "USD", "quote": "JPY"}])
    assert not verdict.ok
    assert "fixture_1" in verdict.diagnostic
