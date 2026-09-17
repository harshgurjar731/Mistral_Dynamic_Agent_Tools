# Competency questions — the rule layer's acceptance test

> **Moved.** Governance rules are no longer part of the ontology. They are
> their own feature in `app/rules/` (Rules page in the frontend), with separate
> agent and workflow rules. The workflow checks below — capability coverage,
> data egress, entry screening, library/domain match — live on as workflow rule
> types in `app/rules/engine.py`. The `cardinality` and `derives_annotation`
> kinds, and the draft/approve and exception lifecycle, were dropped in that
> move; the questions about them are kept for the record.

The rule layer (formerly `ontology/rules.py`) is only as good as its answers to these.
Each maps to one test case in `tests/test_ontology_rules.py`. A question the
rule layer cannot answer is a gap, not a hypothetical — add a rule kind or a
rule row before checking the box.

## Capability & reachability

1. Does every agent in a workflow have every capability its `requires_capability`
   annotations demand, reachable through its attached tools and connectors?
2. When a required capability is missing, does the severity correctly follow
   provenance — `error` for a user-confirmed requirement, `warning` for one the
   backfill only inferred?
3. Is a capability satisfied by something more specific than what was asked for
   (`integration` satisfied by a connector providing `integration.read`)?

## Data egress

4. Does restricted data (`pii`, `financial`) ever reach a connector annotated
   `egresses_to` a third party, including when it arrives via an upstream step
   rather than the connector's own step?
5. Has a specific instance of that been explicitly excepted — by whom, with
   what reason, and is that exception still within its `expires_at`?

## Guardrails

6. Does a workflow whose entry step takes untrusted input open on a
   `foundation`-tier agent?

## Library / domain coverage

7. Does an agent's document library belong to the domain(s) it serves (in
   either hierarchy direction)?
8. Is a domain agent silently missing a library entirely, in a workflow where
   sibling steps do have one?

## Cardinality (formal axioms)

9. Does every agent referenced in a workflow have exactly one `has_tier`
   annotation — not zero, not more than one?
10. Can a `cardinality` rule be added for a new predicate (e.g. "every
    connector must have at least one `provides_capability`") without a code
    change — just a new `OntologyRule` row?

## Derived / conditional facts ("role transformation")

11. If an agent both `handles_data_class=pii` and `serves_domain=lending`,
    does the engine derive an implied `requires_capability` (e.g. a compliance
    capability) automatically, with `source="derived"`?
12. Does a derived annotation get picked up by the *other* checks in the same
    validation pass (e.g. a derived `requires_capability` correctly triggers a
    `capability_gap` finding if nothing satisfies it)?
13. Is it visible when a fact was derived rather than stated — does the
    resulting issue say which rule produced it?

## Rule governance

14. Can a rule be edited, disabled, or have its parameters changed (e.g. which
    data classes are restricted) as data, without a deploy?
15. Does a `draft` rule have zero effect on validation until it is explicitly
    approved?
