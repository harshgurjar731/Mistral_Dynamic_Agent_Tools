"""Typed agent outputs: an answer is held to its schema and converted when it does not match."""

import asyncio
import json
from types import SimpleNamespace

from app.services.workflow_engine.structured_output import conform, problems, schema_instruction

SCHEMA = {"type": "object", "properties": {"risk_assessment": {
    "type": "object",
    "properties": {"risk_score": {"type": "integer"}, "risk_rating": {"type": "string"}},
    "required": ["risk_score", "risk_rating"]}}, "required": ["risk_assessment"]}


class _Client:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []
        self.chat = SimpleNamespace(complete=self._complete)

    def _complete(self, **kw):
        self.calls.append(kw)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=reply))])


def test_a_matching_answer_is_kept_without_a_call():
    client = _Client([])
    value = {"risk_assessment": {"risk_score": 18, "risk_rating": "low"}}
    out, notes = asyncio.run(conform(client, "risk", "text", value, SCHEMA))
    assert out == value and notes == [] and client.calls == []


def test_a_mismatched_answer_is_converted_with_the_schema():
    fixed = {"risk_assessment": {"risk_score": 18, "risk_rating": "low"}}
    client = _Client([json.dumps(fixed)])
    out, notes = asyncio.run(conform(client, "risk", "Risk score 18, rating low.", {"score": 18}, SCHEMA))
    assert out == fixed and notes == ["converted to the output schema"]
    fmt = client.calls[0]["response_format"]
    assert fmt["type"] == "json_schema" and fmt["json_schema"]["schema"] == SCHEMA


def test_a_refused_strict_schema_falls_back_to_json_mode():
    fixed = {"risk_assessment": {"risk_score": 40, "risk_rating": "medium"}}
    client = _Client([RuntimeError("schema not supported in strict mode"), json.dumps(fixed)])
    out, _ = asyncio.run(conform(client, "risk", "Score 40, medium.", None, SCHEMA))
    assert out == fixed
    assert client.calls[1]["response_format"] == {"type": "json_object"}


def test_problems_and_instruction():
    assert problems({"risk_assessment": {"risk_score": "high"}}, SCHEMA)
    assert problems({"risk_assessment": {"risk_score": 3, "risk_rating": "low"}}, SCHEMA) == []
    assert '"risk_score"' in schema_instruction(SCHEMA)
