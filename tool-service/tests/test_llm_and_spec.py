"""Model client behaviour and spec normalisation."""

from types import SimpleNamespace

import pytest

import app.llm.client as client
from app.llm.routes import route_for
from app.synthesis.profiles import get_profile
from app.synthesis.spec import SynthesisSpec, normalise_input_schema
from tests.samples import gst_spec


def test_reasoning_chunks_yield_only_the_answer():
    content = [SimpleNamespace(type="thinking", thinking=[SimpleNamespace(text="let me think")]),
               SimpleNamespace(type="text", text="def run(**kwargs):\n    return {}")]
    assert client.extract_text(content) == "def run(**kwargs):\n    return {}"
    assert client.extract_text("plain") == "plain"
    assert client.extract_text([{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]) == "ab"


def test_strip_fences():
    assert client.strip_fences("```python\nx = 1\n```") == "x = 1"
    assert client.strip_fences("x = 1") == "x = 1"
    prose = "The solution uses decimal.\n\n```python\nimport decimal\n\nx = 1\n```\nDone."
    assert client.strip_fences(prose) == "import decimal\n\nx = 1"


def test_falls_back_to_second_model(monkeypatch):
    seen = []

    def fake_call(route, model, messages, *, json_mode, use_effort):
        seen.append((model, use_effort))
        if model == route.model:
            raise RuntimeError("Status 503 service unavailable")
        return "ok", None

    monkeypatch.setattr(client, "_call", fake_call)
    monkeypatch.setattr(client.time, "sleep", lambda s: None)
    text, model = client.complete("codegen", [])
    route = route_for("codegen")
    assert text == "ok" and model == route.fallback_model
    assert seen[-1] == (route.fallback_model, False), "fallback model must not get the primary's effort"


def test_rejected_effort_is_dropped_and_retried(monkeypatch):
    calls = []

    def fake_call(route, model, messages, *, json_mode, use_effort):
        calls.append(use_effort)
        if use_effort:
            raise RuntimeError("reasoning_effort medium is not supported for this model")
        return "ok", None

    monkeypatch.setattr(client, "_call", fake_call)
    assert client.complete("codegen", [])[0] == "ok"
    assert calls == [True, False]


def test_non_retryable_error_is_unavailable_not_raw(monkeypatch):
    monkeypatch.setattr(client, "_call", lambda *a, **k: (_ for _ in ()).throw(ValueError("Status 400 bad")))
    with pytest.raises(client.LLMUnavailable):
        client.complete("codegen", [])


def test_route_env_override(monkeypatch):
    monkeypatch.setenv("ROUTE_CODEGEN_MODEL", "mistral-large-2512")
    monkeypatch.setenv("ROUTE_CODEGEN_EFFORT", "omit")
    route = route_for("codegen")
    assert route.model == "mistral-large-2512" and route.reasoning_effort is None


def test_routes_use_supported_effort_values():
    from app.llm.routes import all_routes

    for route in all_routes().values():
        assert route.reasoning_effort in (None, "high", "none"), route


@pytest.mark.parametrize("params", [
    {"type": "object", "properties": {"x": {"type": "float"}}, "required": ["x"]},
    {"properties": {"type": "object", "properties": {"x": {"type": "float"}}, "required": ["x"]}},
    {"x": {"type": "float"}},
])
def test_parameter_shapes_normalise(params):
    schema = normalise_input_schema(params, ["x"])
    assert schema == {"type": "object", "properties": {"x": {"type": "number"}}, "required": ["x"]}


def test_kind_inferred_from_api_details():
    assert SynthesisSpec.from_request(name="a_b", description="d").kind == "pure"
    assert SynthesisSpec.from_request(name="a_b", description="d",
                                      api_details="GET https://api.x.com/v1 endpoint").kind == "http"


def test_hash_covers_output_contract():
    assert gst_spec().content_hash() != gst_spec(output_schema={"type": "object"}).content_hash()


def test_activity_rules_strict_vs_lenient():
    spec = gst_spec(examples=[], output_schema=None)
    issues, _ = get_profile("activity").validate_spec(spec, strict=True)
    assert len(issues) == 2
    issues, warnings = get_profile("activity").validate_spec(spec, strict=False)
    assert not issues and len(warnings) >= 2


def test_bad_name_is_a_spec_issue():
    issues, _ = get_profile("tool").validate_spec(gst_spec(name="Apply GST!", purpose="tool"), strict=True)
    assert any("snake_case" in i for i in issues)


def test_golden_eval_specs_are_valid():
    import json
    import os

    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "evals", "golden.json")
    with open(path, encoding="utf-8") as f:
        specs = json.load(f)
    assert len(specs) >= 16
    for raw in specs:
        spec = SynthesisSpec.from_request(**raw)
        issues, _ = get_profile(spec.purpose).validate_spec(spec, strict=True)
        assert not issues, (spec.name, issues)
