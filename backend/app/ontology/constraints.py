"""
Ontology constraints — thin compatibility entry point.

The four checks that used to live here as fixed Python functions (capability
coverage, data egress, guardrail coverage, library/domain match) are now rows
in ``ontology_rules``, evaluated declaratively by ``ontology/rules.py``. This
module only still exists because ``routes/workflows.py`` imports
``ontology.constraints.check`` — kept as the stable name so that call site
does not need to change, and so a future rename of the engine module does not
ripple into the route layer.

See ``ontology/rules.py`` for what actually runs, and ``ontology/seed/rules.yaml``
for the seed rows that reproduce the original four checks' exact behavior.
"""

from app.ontology.rules import check_rules as check

__all__ = ["check"]
