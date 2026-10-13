"""Workflow run inputs: the strict schema, the run-input check and document inputs — no Mistral."""

import asyncio
from unittest import mock

import pytest

from app.services.workflow_engine.models import WorkflowDefinition
from app.services.workflow_engine.validation import validate_workflow
from app.workflow_inputs import documents, run_input, schema


def _definition(**overrides):
    values = dict(
        name="claim_check",
        entry_step="read",
        steps=[
            {"id": "read", "type": "agent", "next_steps": ["score"],
             "config": {"agent_id": "ag_1",
                        "query_template": "Check {{claim_form}} for {{claimant}}"}},
            {"id": "score", "type": "agent", "next_steps": [],
             "config": {"agent_id": "ag_2",
                        "query_template": "Score {{step_read_output}} using {{claim_form}}"}},
        ],
        input_schema=[
            {"name": "claim_form", "type": "file", "accept": ["pdf", "image"]},
            {"name": "claimant", "type": "string"},
            {"name": "amount", "type": "string", "format": "currency", "required": False},
        ],
    )
    values.update(overrides)
    return WorkflowDefinition(**values)


REF = schema.make_ref("lib", "doc1", "claim.pdf", "application/pdf", 10)


@pytest.fixture
def known_documents(monkeypatch):
    monkeypatch.setattr(run_input, "_documents_ok", lambda *a: [])


def test_document_input_is_read_by_the_agents_that_reference_it():
    assert schema.consumer_agent_ids(_definition(), "claim_form") == ["ag_1", "ag_2"]


def test_accept_is_decided_by_extension():
    field = _definition().input_schema[0]
    assert schema.accepts_file(field, "scan.JPG", None)
    assert not schema.accepts_file(field, "claim.docx", "application/pdf")


def test_valid_run_input_passes(known_documents):
    assert run_input.check(_definition(), {"claim_form": REF, "claimant": "A", "amount": 250}) == []


def test_pasted_text_stands_in_for_the_document(known_documents):
    assert run_input.check(_definition(), {"claim_form": "Claim text", "claimant": "A"}) == []


def test_run_input_is_strict(known_documents):
    problems = run_input.check(
        _definition(), {"claim_form": {"x": 1}, "claimant": 5, "amount": "lots", "_image": {}})
    text = " | ".join(problems)
    assert "Not inputs of this workflow: _image" in text
    assert "'claim_form' must be an uploaded document" in text
    assert "'claimant' must be text" in text
    assert "'amount' must be a number" in text


def test_missing_and_too_many_documents(known_documents):
    assert run_input.check(_definition(), {"claimant": "A"}) == ["Missing required input: claim_form"]
    assert "accepts at most 1 document" in " ".join(
        run_input.check(_definition(), {"claim_form": [REF, REF], "claimant": "A"}))


def test_undeclared_entry_inputs_are_still_accepted_as_text(known_documents):
    d = _definition(steps=[{"id": "read", "type": "agent", "next_steps": [],
                            "config": {"agent_id": "a", "query_template": "{{claim_form}} {{policy}}"}}])
    assert schema.implicit_inputs(d) == ["policy"]
    assert run_input.check(d, {"claim_form": REF, "claimant": "A", "policy": "P1"}) == []
    codes = {i.code for i in validate_workflow(d).issues}
    assert "input.undeclared" in codes


def test_validation_flags_unknown_file_kinds():
    d = _definition(input_schema=[{"name": "claim_form", "type": "file", "accept": ["exe"]},
                                  {"name": "claimant", "type": "string"}])
    issue = next(i for i in validate_workflow(d).issues if i.code == "input.bad_accept")
    assert issue.severity == "error"


def test_planner_schema_is_normalised():
    fields = schema.normalise_input_schema(
        [{"name": "doc", "type": "upload", "format": "long_text"}, {"name": "x", "type": "weird"}],
        [{"id": "e", "config": {"q": "{{doc}} {{y}} {{step_a_output}}"}}], "e")
    assert fields[0] == {"name": "doc", "type": "file", "accept": schema.DEFAULT_ACCEPT,
                         "multiple": False, "max_files": 1, "max_size_mb": 20}
    assert fields[1]["type"] == "string"
    assert [f["name"] for f in fields] == ["doc", "x", "y"]


def test_materialise_replaces_references_with_document_text(monkeypatch):
    client = mock.MagicMock()
    client.beta.libraries.documents.text_content.return_value = mock.Mock(text="Claim 42.")
    monkeypatch.setattr(documents, "_client", lambda: client)
    documents._TEXT_CACHE.clear()

    variables = {"claim_form": REF, "n": 1}
    out = asyncio.run(documents.materialise(variables))

    assert out["claim_form"] == "[Document: claim.pdf]\nClaim 42."
    assert variables["claim_form"] is REF  # the run's own variables keep the reference
    assert asyncio.run(documents.materialise({"n": 1})) == {"n": 1}
