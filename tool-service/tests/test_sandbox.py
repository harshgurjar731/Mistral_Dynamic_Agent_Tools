"""The sandbox runner reports which phase failed — the fix for misattributed faults."""

from app.config import settings
from app.synthesis.sandbox import SandboxOptions, run_in_sandbox
from app.synthesis.testplan import TestCase, TestPlan
from app.synthesis.verifiers import judge_run
from tests.samples import BROKEN_IMPORT, GOOD_GST, gst_spec


def _cases(*kwargs_list):
    return [{"id": f"c{i}", "kwargs": k, "repeat": False} for i, k in enumerate(kwargs_list)]


def test_runs_cases_and_returns_structured_results():
    run = run_in_sandbox(GOOD_GST, _cases({"subtotal": 100}), SandboxOptions())
    assert run.harness_error is None and run.import_error is None
    assert run.results[0]["result"]["data"]["grand_total"] == 118.0


def test_module_level_error_is_the_codes_fault_not_the_harness():
    run = run_in_sandbox(BROKEN_IMPORT, _cases({}), SandboxOptions())
    assert run.harness_error is None
    assert "NameError" in run.import_error
    plan = TestPlan(cases=[TestCase("c0", "schema_full", {}, "envelope")])
    verdict = judge_run(gst_spec(), plan, run, allow_transport_errors=False)
    assert verdict.stage == "import" and verdict.fault == "code"


def test_exception_in_run_is_reported_per_case():
    code = "def run(**kwargs):\n    raise ValueError('boom')\n"
    run = run_in_sandbox(code, _cases({}), SandboxOptions())
    assert run.results[0]["raised"] and "ValueError: boom" in run.results[0]["exception"]


def test_print_in_tool_does_not_corrupt_protocol():
    code = ("def run(**kwargs):\n    print('noise {\"x\": 1}')\n"
            "    return {'status': 'success', 'data': 1, 'source': 'computed'}\n")
    run = run_in_sandbox(code, _cases({}), SandboxOptions())
    assert run.results[0]["result"]["data"] == 1


def test_non_serialisable_result_detected():
    code = ("def run(**kwargs):\n    return {'status': 'success', 'data': {1, 2}, 'source': 'x'}\n")
    run = run_in_sandbox(code, _cases({}), SandboxOptions())
    assert run.results[0]["serialisable"] is False


def test_timeout_names_the_hanging_case(monkeypatch):
    monkeypatch.setattr(settings, "SANDBOX_TIMEOUT_SECONDS", 3)
    code = ("def run(**kwargs):\n    if kwargs.get('hang'):\n        while True:\n            pass\n"
            "    return {'status': 'success', 'data': 1, 'source': 'x'}\n")
    run = run_in_sandbox(code, _cases({}, {"hang": True}), SandboxOptions(timeout_seconds=3))
    assert run.timed_out and run.hung_case == "c1"


def test_network_blocked_for_pure_code():
    code = ("import urllib.request\n\ndef run(**kwargs):\n"
            "    try:\n        urllib.request.urlopen('http://example.com', timeout=2)\n"
            "        return {'status': 'success', 'data': 'reached', 'source': 'x'}\n"
            "    except Exception as e:\n"
            "        return {'status': 'error', 'error_type': 'network_error', 'message': str(e)}\n")
    run = run_in_sandbox(code, _cases({}), SandboxOptions(block_network=True))
    assert run.results[0]["result"]["status"] == "error"


def test_requests_stub_refuses_without_fixtures_and_answers_with_them():
    code = ("import requests\n\ndef run(**kwargs):\n"
            "    try:\n        r = requests.get('https://api.example.org/x', timeout=5)\n"
            "    except requests.exceptions.ConnectionError as e:\n"
            "        return {'status': 'error', 'error_type': 'network_error', 'message': str(e)}\n"
            "    return {'status': 'success', 'data': r.json(), 'source': 'api'}\n")
    refused = run_in_sandbox(code, _cases({}), SandboxOptions(block_network=False, http_stub=True))
    assert refused.results[0]["result"]["error_type"] == "network_error"

    answered = run_in_sandbox(code, _cases({}), SandboxOptions(
        block_network=False, http_stub=True, fixtures=[{"status": 200, "json": {"temp": 21}}]))
    assert answered.results[0]["result"]["data"] == {"temp": 21}


def test_secrets_are_passed_as_kwarg():
    code = ("def run(**kwargs):\n"
            "    return {'status': 'success', 'data': kwargs.get('_secrets', {}).get('K'), 'source': 'x'}\n")
    run = run_in_sandbox(code, _cases({}), SandboxOptions(secrets={"K": "v"}))
    assert run.results[0]["result"]["data"] == "v"
