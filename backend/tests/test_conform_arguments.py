"""Step arguments reshaped to a strict activity's input schema, at every depth."""

import jsonschema
import pytest

from app.services.workflow_engine.conform import conform, conform_arguments

# The upstream output that failed 'output_safety_moderation' with
# "structured_meeting_summary/action_items: {...} is not of type 'array'".
GROUPED = {
    "Aisha Mohammed": {"high": ["Deliver the missing high-fidelity mockups"], "medium": [], "low": []},
    "David Park": {"high": [], "medium": ["Finalize the PRD by November 10, 2026."], "low": []},
    "Unassigned": {"high": [], "medium": ["Review the budget proposal."], "low": []},
}


def _params(item_schema: dict) -> dict:
    return {
        "type": "object",
        "properties": {
            "structured_meeting_summary": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string"},
                    "action_items": {"type": "array", "items": item_schema},
                },
                "required": ["action_items"],
            }
        },
        "required": ["structured_meeting_summary"],
    }


def _run(item_schema: dict):
    params = _params(item_schema)
    args = {"structured_meeting_summary": {"summary": "Portal sync", "action_items": GROUPED}}
    out, notes = conform_arguments(args, params)
    jsonschema.validate(out, params)
    return out["structured_meeting_summary"]["action_items"], notes


def test_grouped_object_becomes_records_with_owner_and_priority():
    items, notes = _run({
        "type": "object",
        "properties": {
            "task": {"type": "string"},
            "owner": {"type": "string"},
            "priority": {"type": "string", "enum": ["High", "Medium", "Low"]},
        },
        "required": ["task", "owner", "priority"],
    })
    assert len(items) == 3
    assert items[0] == {"task": "Deliver the missing high-fidelity mockups",
                        "owner": "Aisha Mohammed", "priority": "High"}
    assert items[2]["owner"] == "Unassigned"
    assert notes and "flattened" in notes[0]


def test_priority_without_enum_and_assignee_field():
    items, _ = _run({
        "type": "object",
        "properties": {"assignee": {"type": "string"}, "priority": {"type": "string"},
                       "description": {"type": "string"}},
    })
    assert items[1] == {"description": "Finalize the PRD by November 10, 2026.",
                        "assignee": "David Park", "priority": "medium"}


def test_string_items_keep_the_group_as_a_label():
    items, _ = _run({"type": "string"})
    assert items[0] == "[Aisha Mohammed / high] Deliver the missing high-fidelity mockups"


def test_valid_values_are_untouched():
    params = _params({"type": "string"})
    args = {"structured_meeting_summary": {"action_items": ["a", "b"], "extra": {"x": 1}}}
    out, notes = conform_arguments(args, params)
    assert out == args and notes == []


RECORDS = {
    "type": "object",
    "properties": {
        "validated_student_records": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"student_id": {"type": "string"},
                               "subject_marks": {"type": "object"}},
                "required": ["student_id", "subject_marks"],
            },
        }
    },
    "required": ["validated_student_records"],
}
_OK = {"student_id": "S1", "subject_marks": {"math": 80}}


def _records(*rows):
    return conform_arguments({"validated_student_records": list(rows)}, RECORDS)


def test_required_field_under_another_spelling_is_recovered():
    out, notes = _records(_OK, {"student_id": "S5", "subjectMarks": {"math": 55}})
    jsonschema.validate(out, RECORDS)
    assert out["validated_student_records"][1] == {"student_id": "S5", "subject_marks": {"math": 55}}
    assert "taken from 'subjectMarks'" in notes[0]


def test_required_field_nested_one_level_down_is_recovered():
    out, _ = _records(_OK, {"student_id": "S5", "details": {"subject_marks": {"math": 55}}})
    jsonschema.validate(out, RECORDS)


@pytest.mark.parametrize("reject", [
    {"is_valid": False}, {"status": "invalid"}, {"errors": ["subject_marks missing"]},
])
def test_record_marked_invalid_upstream_is_left_out(reject):
    out, notes = _records(_OK, {"student_id": "S5", **reject})
    assert out["validated_student_records"] == [_OK]
    assert "marked invalid" in notes[-1]


def test_incomplete_record_not_marked_invalid_is_kept_and_explained():
    from app.services.workflow_engine.conform import argument_problem

    out, _ = _records(_OK, {"student_id": "S5"})
    assert len(out["validated_student_records"]) == 2  # never silently dropped
    problem = argument_problem(out, RECORDS)
    assert "validated_student_records/1" in problem and '"S5"' in problem


@pytest.mark.parametrize("value,schema,expected", [
    ({"items": [1, 2]}, {"type": "array", "items": {"type": "integer"}}, [1, 2]),
    ("High", {"type": "string", "enum": ["high", "low"]}, "high"),
    ("$250,000", {"type": "number"}, 250000.0),
    ("12", {"type": "integer"}, 12),
    ("yes", {"type": "boolean"}, True),
    ({"text": "hi"}, {"type": "string"}, "hi"),
    ('[{"a": 1}]', {"type": "array", "items": {"type": "object"}}, [{"a": 1}]),
    ({"a": 1}, {"type": "array", "items": {"type": "object"}}, [{"a": 1}]),
    ([{"a": 1}], {"type": "object"}, {"a": 1}),
    (None, {"type": "array"}, None),
    ("not a number", {"type": "number"}, "not a number"),
])
def test_scalar_and_wrapper_shapes(value, schema, expected):
    assert conform(value, schema) == expected
