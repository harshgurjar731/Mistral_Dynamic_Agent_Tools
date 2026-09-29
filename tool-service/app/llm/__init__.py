"""
LLM access for the tool service.

Every model call in this service goes through :func:`complete`, addressed by a
*role* ("codegen", "repair", "arbiter", ...) rather than by a model name. The
role resolves to a :class:`ModelRoute` — model, reasoning effort, timeout and
fallback — so choosing a different model for a job is a configuration change,
not an edit to the layer that makes the call.
"""

from app.llm.client import LLMUnavailable, complete, complete_json
from app.llm.routes import ModelRoute, route_for

__all__ = ["complete", "complete_json", "LLMUnavailable", "ModelRoute", "route_for"]
