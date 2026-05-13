"""
LLM Fallback Service — Uses Mistral to generate synthetic results when tool
execution fails (API errors, bad URLs, timeouts, parse errors).

This is the last line of defence: if a tool's primary logic crashes, the LLM
reconstructs a best-effort answer from the tool's description, the user's
arguments, and the error message.
"""

import json
import logging

from mistralai.client import Mistral
from app.config import settings

logger = logging.getLogger(__name__)

# Model used for fallback generation (general knowledge, not code)
FALLBACK_MODEL = "mistral-large-latest"

FALLBACK_SYSTEM_PROMPT = """\
You are a resilient data-generation assistant.  A tool function failed at
runtime, and you must produce the BEST POSSIBLE substitute result using your
own knowledge.

## Rules
1. Return ONLY a valid JSON object — no markdown fences, no prose.
2. The JSON must match what the tool was supposed to return.
3. If the tool was fetching live data (weather, stock prices, etc.), generate
   a realistic, clearly-labelled synthetic response and include a
   `"_fallback": true` flag so the caller knows this is LLM-generated.
4. If the tool was creating or writing something, generate that content fully
   and include it in the response.
5. Never return an empty object.  Always provide useful information.
6. Keep responses concise but complete.
"""

FALLBACK_USER_TEMPLATE = """\
A tool named **{tool_name}** failed during execution.

**Tool description:** {tool_description}

**Arguments the user provided:**
```json
{arguments_json}
```

**Error that occurred:**
```
{error}
```

Generate the result this tool SHOULD have returned.  Return ONLY valid JSON.\
"""


def llm_fallback(
    tool_name: str,
    tool_description: str,
    arguments: dict,
    original_error: str,
) -> dict:
    """
    Call Mistral LLM to generate a synthetic result after a tool execution
    failure.  Returns a dict that mimics what the tool should have produced.
    """
    try:
        client = Mistral(api_key=settings.MISTRAL_API_KEY)

        user_prompt = FALLBACK_USER_TEMPLATE.format(
            tool_name=tool_name,
            tool_description=tool_description,
            arguments_json=json.dumps(arguments, indent=2, default=str),
            error=str(original_error)[:500],
        )

        response = client.chat.complete(
            model=FALLBACK_MODEL,
            messages=[
                {"role": "system", "content": FALLBACK_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            response_format={"type": "json_object"},
        )

        raw = response.choices[0].message.content.strip()

        # Strip markdown fences if the model added them despite instructions
        if raw.startswith("```"):
            lines = raw.split("\n")
            lines = [ln for ln in lines if not ln.strip().startswith("```")]
            raw = "\n".join(lines)

        result = json.loads(raw)

        # Ensure the fallback flag is present
        if isinstance(result, dict):
            result["_fallback"] = True
            result["_original_error"] = str(original_error)[:200]
        else:
            result = {
                "result": result,
                "_fallback": True,
                "_original_error": str(original_error)[:200],
            }

        logger.info(
            "LLM fallback succeeded for tool '%s' — generated %d-char result",
            tool_name, len(raw),
        )
        return result

    except Exception as fallback_err:
        logger.error(
            "LLM fallback ALSO failed for tool '%s': %s",
            tool_name, fallback_err,
        )
        return {
            "error": f"Tool execution failed: {original_error}",
            "_fallback": True,
            "_fallback_error": str(fallback_err)[:200],
        }
