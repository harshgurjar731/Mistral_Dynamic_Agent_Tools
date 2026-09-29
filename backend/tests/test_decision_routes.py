"""decide() with model routes: reasoning responses, effort rejection, fallback model."""

import asyncio
from types import SimpleNamespace

from app.core import decision
from app.llm_routes import all_routes, extract_text, route_for


def _response(content):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


class FakeClient:
    def __init__(self, behaviour):
        self.calls = []
        self.chat = SimpleNamespace(complete=self._complete)
        self.behaviour = behaviour

    def _complete(self, **kwargs):
        self.calls.append(kwargs)
        return self.behaviour(kwargs)


def _decide(client, **kw):
    return asyncio.run(decision.decide(client, system="s", user="u", phase="p", **kw))


def test_reasoning_chunks_are_stripped():
    thinking = SimpleNamespace(type="thinking", thinking=[])
    text = SimpleNamespace(type="text", text='{"ok": true}')
    client = FakeClient(lambda kw: _response([thinking, text]))
    assert _decide(client, route="spec_author") == '{"ok": true}'
    assert client.calls[0]["reasoning_effort"] == "high"
    assert client.calls[0]["model"] == route_for("spec_author").model


def test_rejected_effort_is_retried_without_it():
    def behaviour(kw):
        if "reasoning_effort" in kw:
            raise RuntimeError("reasoning_effort medium is not supported for this model")
        return _response("{}")

    client = FakeClient(behaviour)
    assert _decide(client, route="spec_author") == "{}"
    assert "reasoning_effort" not in client.calls[-1]


def test_fallback_model_on_hard_error():
    route = route_for("spec_author")

    def behaviour(kw):
        if kw["model"] == route.model:
            raise RuntimeError("Status 500 internal error")
        return _response("{}")

    client = FakeClient(behaviour)
    assert _decide(client, route="spec_author") == "{}"
    assert client.calls[-1]["model"] == route.fallback_model


def test_plain_model_still_supported():
    client = FakeClient(lambda kw: _response("{}"))
    assert _decide(client, model="mistral-large-latest") == "{}"
    assert "reasoning_effort" not in client.calls[0]


def test_routes_only_use_supported_effort_values():
    for route in all_routes().values():
        assert route.reasoning_effort in (None, "high", "none")


def test_extract_text_variants():
    assert extract_text("x") == "x"
    assert extract_text(None) == ""
    assert extract_text([{"type": "text", "text": "a"}, {"type": "thinking", "text": "zzz"}]) == "a"
