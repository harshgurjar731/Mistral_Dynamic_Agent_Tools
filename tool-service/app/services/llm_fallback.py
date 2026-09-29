"""
LLM Fallback — a labelled stand-in answer when an *agent tool* fails.

Opt-in (``TOOL_RUNTIME_FALLBACK``) and never used for activities. The caller
wraps the answer in a ``"status": "degraded"`` envelope so an agent can tell
it apart from a verified result; it used to be returned as though the tool had
succeeded, and in workflows that meant invented figures flowing downstream.
"""

from __future__ import annotations

import json
import logging

from app import llm

logger = logging.getLogger(__name__)

FALLBACK_SYSTEM_PROMPT = """\
A tool failed at runtime. Using general knowledge only, produce the best answer
the tool would have given. Return ONLY a JSON object. State plainly in a
"caveat" field what you could not know (live data, private records). Never
present a guess about live or private data as fact.
"""


def llm_fallback(tool_name: str, tool_description: str, arguments: dict, original_error: str) -> dict:
    user = (
        f"Tool: {tool_name}\nDescription: {tool_description}\n"
        f"Arguments: {json.dumps(arguments, default=str)[:3000]}\n"
        f"Error: {str(original_error)[:500]}\n"
    )
    try:
        data, _model = llm.complete_json("runtime_fallback", [
            {"role": "system", "content": FALLBACK_SYSTEM_PROMPT},
            {"role": "user", "content": user},
        ])
        return data if isinstance(data, dict) else {"result": data}
    except Exception as e:  # noqa: BLE001
        logger.error("LLM fallback failed for '%s': %s", tool_name, e)
        return {"error": f"fallback unavailable: {e}"}
