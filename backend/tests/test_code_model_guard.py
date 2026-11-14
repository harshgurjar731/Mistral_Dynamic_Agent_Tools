"""Tool and activity code is never written by a Codestral model.

The code pipeline's routes take their model from the Settings page. A Codestral
model is refused there, and one that arrives some other way (an environment
variable, an override saved before the rule existed) is replaced by the
route's default when the route is resolved.
"""

import pytest

from app import llm_routes
from app.app_settings.core import coerce, excluded_model
from app.app_settings.registry import all_defs


def _defs():
    return {d.key: d for d in all_defs()}


def test_code_route_settings_refuse_codestral():
    defs = _defs()
    for role in llm_routes.CODE_ROLES:
        for field in ("MODEL", "FALLBACK"):
            defn = defs[f"ROUTE_{role.upper()}_{field}"]
            with pytest.raises(ValueError, match="cannot be used here"):
                coerce(defn, "codestral-latest")
            assert coerce(defn, "mistral-large-4") == "mistral-large-4"


def test_other_routes_keep_free_choice():
    defs = _defs()
    other = set(llm_routes._ROUTES) - set(llm_routes.CODE_ROLES)
    assert other, "expected at least one non-code route"
    for role in other:
        assert coerce(defs[f"ROUTE_{role.upper()}_MODEL"], "codestral-latest") == "codestral-latest"


def test_resolver_replaces_codestral_from_environment(monkeypatch):
    monkeypatch.setenv("ROUTE_SPEC_AUTHOR_MODEL", "codestral-2508")
    monkeypatch.setenv("ROUTE_SPEC_AUTHOR_FALLBACK", "Codestral-latest")
    route = llm_routes.route_for("spec_author")
    base = llm_routes._ROUTES["spec_author"]
    assert route.model == base.model
    assert route.fallback_model == base.fallback_model


def test_resolver_keeps_a_general_model_override(monkeypatch):
    monkeypatch.setenv("ROUTE_SPEC_AUTHOR_MODEL", "mistral-medium-2604")
    assert llm_routes.route_for("spec_author").model == "mistral-medium-2604"


def test_excluded_model_matching():
    assert excluded_model("Codestral-Latest", ("codestral",))
    assert not excluded_model("mistral-large-4", ("codestral",))
    assert not excluded_model("", ("codestral",))
