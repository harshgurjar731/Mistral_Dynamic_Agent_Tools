"""
Typed agent outputs — an agent step returns exactly the record its schema says.

With a data contract, an agent step carries ``config.output_schema``: the one
record it produces (``DataContractLayer``). Previously an agent's answer was
free text from which a JSON object was fished out, and downstream steps read
fields that were often renamed, wrapped or missing.

At run time:

1. the prompt states the schema and asks for one JSON object matching it
   (:func:`schema_instruction`);
2. the answer's JSON is validated against the schema (:func:`problems`);
3. when it does not match, the answer is converted — not rewritten — by one
   call with Mistral's schema-constrained output (``response_format`` of type
   ``json_schema``) on the best model, told to keep every value from the
   answer and use null where the answer has none (:func:`conform`). A schema
   the strict mode refuses is retried in JSON mode.

The tool loop itself is not constrained: agents still call tools freely.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

_CONVERT_SYSTEM = """\
You convert an agent's answer into one JSON object that matches a schema.
Use only the values the answer contains — never invent figures, names or
reasons. Copy text values verbatim where the schema asks for text. Put each
value under the field the schema names; convert units only when the answer
states them explicitly. A required field the answer has no value for is null.
Return only the JSON object."""


def schema_instruction(schema: dict) -> str:
    return (
        "\n\nOUTPUT FORMAT (required): later steps read your result field by field. End your "
        "answer with ONE JSON object in a ```json block that matches this JSON Schema exactly "
        "— the same field names, nesting and types, every required field present:\n"
        + json.dumps(schema, indent=2)[:8000]
    )


def top_fields(schema: Optional[dict]) -> list[str]:
    props = (schema or {}).get("properties") if isinstance(schema, dict) else None
    return list(props) if isinstance(props, dict) else []


def problems(value: Any, schema: dict, limit: int = 8) -> list[str]:
    """Where ``value`` breaks ``schema``; [] when it matches (or jsonschema is unavailable)."""
    try:
        import jsonschema

        validator = jsonschema.Draft202012Validator(schema)
        errors = sorted(validator.iter_errors(value), key=lambda e: list(e.absolute_path))
    except Exception:  # noqa: BLE001 — no validator, or an unusable schema: nothing to hold it to
        return []
    out = []
    for e in errors[:limit]:
        where = "/".join(str(p) for p in e.absolute_path) or "answer"
        out.append(f"{where}: {e.message}")
    return out


def _best_model() -> str:
    from app.config import settings

    return settings.MISTRAL_ORCHESTRATOR_MODEL


def _complete(client, schema: dict, answer: str, strict: bool):
    response_format = (
        {"type": "json_schema", "json_schema": {"name": "step_output", "schema": schema, "strict": True}}
        if strict else {"type": "json_object"}
    )
    user = (f"SCHEMA:\n{json.dumps(schema, indent=2)[:8000]}\n\nANSWER:\n{answer[:20000]}"
            + ("" if strict else "\n\nReturn the JSON object matching the SCHEMA."))
    return client.chat.complete(
        model=_best_model(),
        messages=[{"role": "system", "content": _CONVERT_SYSTEM}, {"role": "user", "content": user}],
        response_format=response_format,
        temperature=0,
    )


async def conform(client, step_id: str, answer: str, parsed: Optional[dict], schema: dict) -> tuple[Any, list[str]]:
    """``(output, notes)``: the answer as a value matching ``schema`` when it can be made to.

    ``parsed`` is the JSON the answer already carried (None when it had none).
    Returns it unchanged when it matches; otherwise the converted object, or the
    best available value with notes saying what still does not match.
    """
    if parsed is not None and not problems(parsed, schema):
        return parsed, []
    before = problems(parsed, schema) if parsed is not None else ["the answer carries no JSON object"]
    if client is None:
        return (parsed if parsed is not None else answer), before

    from app.llm_routes import extract_text
    from app.services.workflow_engine.output_contracts import extract_json_object

    for strict in (True, False):
        try:
            response = await asyncio.to_thread(_complete, client, schema, answer, strict)
            text = extract_text(response.choices[0].message.content)
        except Exception as e:  # noqa: BLE001 — a schema the strict mode refuses, a transient error
            logger.info("Step '%s': %s conversion failed (%s)", step_id,
                        "schema-constrained" if strict else "JSON-mode", e)
            continue
        try:
            converted = json.loads(text)
        except ValueError:
            converted = extract_json_object(text, top_fields(schema))
        if isinstance(converted, dict):
            left = problems(converted, schema)
            logger.info("Step '%s': answer converted to the output schema (%s)", step_id,
                        "matches" if not left else f"{len(left)} problem(s) left")
            return converted, ([f"converted to the output schema; still: {'; '.join(left)}"] if left
                               else ["converted to the output schema"])
    return (parsed if parsed is not None else answer), before
