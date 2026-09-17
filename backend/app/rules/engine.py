"""
Rules engine — the checks themselves.

Pure functions over plain data: nothing here talks to Mistral or writes to the
database. Each check returns *outcomes* (``{rule_id, rule_name, checkpoint,
outcome, message, detail}``); the caller attaches the subject and records them,
because only the caller knows which agent, conversation or execution it is.

Every check fails open. A bug in a rule must degrade to "the rule did not run"
(logged), never to an agent that cannot answer or a workflow that cannot save.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Optional

from app.rules import catalog

logger = logging.getLogger(__name__)


def _outcome(rule: dict, checkpoint: str, outcome: str, message: str, detail=None) -> dict:
    return {
        "rule_id": rule["id"],
        "rule_name": rule["name"],
        "checkpoint": checkpoint,
        "outcome": outcome,
        "message": message,
        "detail": detail,
    }


def _of_type(rules: list[dict], *types: str) -> list[dict]:
    return [r for r in rules or [] if r.get("type") in types]


def _safe(fn):
    """Run one rule's check; on an internal error, log and report nothing."""
    def wrapper(rule, *args, **kwargs):
        try:
            return fn(rule, *args, **kwargs)
        except Exception as e:
            logger.warning("Rule '%s' (%s) failed and was skipped: %s", rule.get("id"), rule.get("type"), e)
            return None
    return wrapper


# ── Text helpers ────────────────────────────────────────────────────────────

_PII_PATTERNS = {
    "email": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    "card": re.compile(r"\b(?:\d[ -]?){13,19}\b"),
    "phone": re.compile(r"(?<![\w])(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?![\w])"),
    "national_id": re.compile(r"\b(?:\d{3}-\d{2}-\d{4}|\d{4}\s\d{4}\s\d{4}|[A-Z]{5}\d{4}[A-Z])\b"),
    "ip": re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b"),
}

#: Card numbers are checked before phone numbers, so a 16-digit card is not
#: half-matched as a phone number first.
_PII_ORDER = ("email", "card", "national_id", "ip", "phone")


def _luhn(digits: str) -> bool:
    total, alt = 0, False
    for ch in reversed(digits):
        n = int(ch)
        if alt:
            n *= 2
            if n > 9:
                n -= 9
        total += n
        alt = not alt
    return total % 10 == 0


def redact(text: str, types: list[str]) -> tuple[str, dict[str, int]]:
    """Replace personal data of ``types`` with a marker. Returns counts per type."""
    counts: dict[str, int] = {}
    for kind in _PII_ORDER:
        if kind not in types:
            continue
        pattern = _PII_PATTERNS[kind]

        def _sub(m, kind=kind):
            value = m.group(0)
            if kind == "card":
                digits = re.sub(r"\D", "", value)
                if not (13 <= len(digits) <= 19 and _luhn(digits)):
                    return value
            if kind == "phone" and len(re.sub(r"\D", "", value)) < 8:
                return value
            counts[kind] = counts.get(kind, 0) + 1
            return f"[REDACTED {kind.replace('_', ' ').upper()}]"

        text = pattern.sub(_sub, text)
    return text, counts


def _find_phrases(text: str, phrases: list[str]) -> list[str]:
    low = (text or "").lower()
    return [p for p in phrases or [] if p and p.lower() in low]


def summary_lines(rules: list[dict]) -> str:
    """The rules as short bullet lines, for prompts."""
    return "\n".join(f"- {r['name']}: {r.get('summary') or r.get('description', '')}" for r in rules or [])


# ═══════════════════════════════════════════════════════════════════════════
# AGENT RULES
# ═══════════════════════════════════════════════════════════════════════════

# ── Creation ────────────────────────────────────────────────────────────────


def _merge_moderation(guardrails: list[dict] | None, categories: list[str], threshold: float) -> list[dict]:
    """Add moderation thresholds to a guardrail request list, stricter wins."""
    entries = [dict(g) for g in (guardrails or []) if isinstance(g, dict)]
    entry = entries[0] if entries else {"block_on_error": True}
    if not entries:
        entries = [entry]

    use_v1 = bool(entry.get("moderation_llm_v1")) and not entry.get("moderation_llm_v2")
    key = "moderation_llm_v1" if use_v1 else "moderation_llm_v2"
    moderation = dict(entry.get(key) or {})
    moderation["action"] = "block"
    thresholds = dict(moderation.get("custom_category_thresholds") or {})

    for category in categories:
        name = category
        if use_v1:
            if category in ("dangerous", "criminal"):
                name = "dangerous_and_criminal_content"
            elif category == "jailbreaking":
                continue
        current = thresholds.get(name)
        thresholds[name] = threshold if current is None else min(float(current), threshold)

    moderation["custom_category_thresholds"] = thresholds
    entry[key] = moderation
    entry.setdefault("block_on_error", True)
    entries[0] = entry
    return entries


def check_agent_config(config: dict, rules: list[dict], *, mode: str = "manual") -> tuple[dict, list[dict]]:
    """Apply creation-time agent rules to a configuration.

    ``config`` keys: ``model``, ``instructions``, ``tools`` (tool keys),
    ``connectors`` (connector ids), ``guardrails`` (list of guardrail request
    dicts). Returns the corrected config and the outcomes.

    ``mode="pipeline"`` is used for agents the orchestrator designs: a block
    that has a safe correction is applied as a fix instead, because an
    AI-designed agent should conform to the rules rather than fail a run the
    user never configured. ``mode="manual"`` reports blocks, and the caller
    refuses the create.
    """
    config = dict(config)
    config["tools"] = list(config.get("tools") or [])
    config["connectors"] = list(config.get("connectors") or [])
    outcomes: list[dict] = []
    fixing = mode == "pipeline"

    @_safe
    def run(rule):
        t, p, enf = rule["type"], rule["params"], rule["enforcement"]

        if t == "content_moderation":
            threshold = catalog.STRICTNESS.get(p.get("strictness"), 0.7)
            config["guardrails"] = _merge_moderation(
                config.get("guardrails"), p.get("categories") or [], threshold
            )
            return _outcome(rule, "creation", "applied",
                            f"Moderation on for {len(p.get('categories') or [])} categories "
                            f"({p.get('strictness', 'balanced')}).")

        if t == "blocked_tools":
            hits = [k for k in config["tools"] if k in set(p.get("tools") or [])]
            if not hits:
                return _outcome(rule, "creation", "passed", "No blocked tools attached.")
            if enf == "fix" or fixing:
                config["tools"] = [k for k in config["tools"] if k not in hits]
                return _outcome(rule, "creation", "fixed", f"Removed: {', '.join(hits)}.", {"removed": hits})
            return _outcome(rule, "creation", "blocked", f"Blocked tools attached: {', '.join(hits)}.")

        if t == "approved_connectors":
            allowed = set(p.get("connectors") or [])
            hits = [c for c in config["connectors"] if c not in allowed]
            if not hits:
                return _outcome(rule, "creation", "passed", "Only approved connectors attached.")
            if enf == "fix" or fixing:
                config["connectors"] = [c for c in config["connectors"] if c in allowed]
                return _outcome(rule, "creation", "fixed", f"Detached {len(hits)} unapproved connector(s).",
                                {"removed": hits})
            return _outcome(rule, "creation", "blocked",
                            f"{len(hits)} connector(s) are not on the approved list.", {"connectors": hits})

        if t == "approved_models":
            models = p.get("models") or []
            model = config.get("model") or ""
            if not models or model in models:
                return _outcome(rule, "creation", "passed", f"{model} is approved.")
            if fixing:
                config["model"] = models[0]
                return _outcome(rule, "creation", "fixed", f"Switched {model} to {models[0]}.")
            return _outcome(rule, "creation", "blocked",
                            f"{model} is not an approved model. Use one of: {', '.join(models)}.")

        if t == "instruction_quality":
            minimum = int(p.get("min_chars") or 0)
            length = len((config.get("instructions") or "").strip())
            if length >= minimum:
                return _outcome(rule, "creation", "passed", f"Instructions are {length} characters.")
            outcome = "blocked" if (enf == "block" and not fixing) else "warned"
            return _outcome(rule, "creation", outcome,
                            f"Instructions are {length} characters; at least {minimum} are required.")

        # A rule enforced later (on messages, tool calls, answers): record that
        # it is now in force, so the agent's rule list shows every rule it has.
        rule_type = catalog.get_type(t)
        when = ", ".join(catalog.CHECKPOINTS[c].lower() for c in (rule_type.checkpoints if rule_type else []))
        return _outcome(rule, "creation", "applied", f"In force — checked {when}.")

    for rule in rules or []:
        if rule.get("scope") != "agent":
            continue
        result = run(rule)
        if result:
            outcomes.append(result)
    return config, outcomes


def blocking(outcomes: list[dict]) -> list[dict]:
    return [o for o in outcomes if o["outcome"] == "blocked"]


# ── Runtime ─────────────────────────────────────────────────────────────────


def check_message(text: str, rules: list[dict]) -> tuple[list[dict], Optional[str]]:
    """Screen a user message. Returns outcomes and a refusal message, if any."""
    outcomes, refusal = [], None
    for rule in _of_type(rules, "blocked_phrases"):
        try:
            if rule["params"].get("check_on", "message") not in ("message", "both"):
                continue
            hits = _find_phrases(text, rule["params"].get("phrases") or [])
            if not hits:
                outcomes.append(_outcome(rule, "message", "passed", "No blocked phrases."))
            elif rule["enforcement"] == "block":
                outcomes.append(_outcome(rule, "message", "blocked", f"Contains: {', '.join(hits)}.",
                                         {"phrases": hits}))
                refusal = refusal or f"Blocked by rule '{rule['name']}': the message contains a blocked phrase."
            else:
                outcomes.append(_outcome(rule, "message", "warned", f"Contains: {', '.join(hits)}.",
                                         {"phrases": hits}))
        except Exception as e:
            logger.warning("Rule '%s' failed on message: %s", rule.get("id"), e)
    return outcomes, refusal


_SQL_WRITE = re.compile(
    r"\b(insert|update|delete|drop|alter|create|replace|truncate|attach|detach|vacuum|pragma|reindex|grant|revoke)\b",
    re.IGNORECASE,
)


def _sql_is_read_only(query: str) -> bool:
    statements = [s.strip() for s in (query or "").split(";") if s.strip()]
    if not statements:
        return True
    for s in statements:
        head = s.split(None, 1)[0].lower() if s.split() else ""
        if head not in ("select", "with", "explain"):
            return False
        if _SQL_WRITE.search(s):
            return False
    return True


def check_tool_call(tool_name: str, arguments: dict, rules: list[dict]) -> tuple[list[dict], Optional[str]]:
    """Gate one tool call. Returns outcomes and a refusal reason, if any."""
    outcomes, refusal = [], None
    for rule in _of_type(rules, "database_read_only", "blocked_tools"):
        try:
            if rule["type"] == "database_read_only":
                if tool_name != "execute_sql_query":
                    continue
                query = str((arguments or {}).get("query") or "")
                if _sql_is_read_only(query):
                    outcomes.append(_outcome(rule, "tool_call", "passed", "Read-only query allowed."))
                else:
                    outcomes.append(_outcome(rule, "tool_call", "blocked", "A write query was refused.",
                                             {"query": query[:300]}))
                    refusal = refusal or (
                        f"Blocked by rule '{rule['name']}': only SELECT queries are allowed. "
                        "Answer without changing any data."
                    )
            else:
                if tool_name in set(rule["params"].get("tools") or []):
                    outcomes.append(_outcome(rule, "tool_call", "blocked", f"Call to '{tool_name}' refused."))
                    refusal = refusal or f"Blocked by rule '{rule['name']}': the tool '{tool_name}' may not be used."
        except Exception as e:
            logger.warning("Rule '%s' failed on tool call: %s", rule.get("id"), e)
    return outcomes, refusal


def answer_rules(rules: list[dict]) -> list[dict]:
    """Rules that inspect the answer — their presence disables token streaming."""
    out = []
    for r in rules or []:
        if r["type"] in ("pii_redaction", "json_answers", "answer_length"):
            out.append(r)
        elif r["type"] == "blocked_phrases" and r["params"].get("check_on") in ("answer", "both"):
            out.append(r)
    return out


def _parse_json_object(text: str) -> Optional[dict]:
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t, flags=re.DOTALL).strip()
    try:
        data = json.loads(t)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def check_answer(text: str, rules: list[dict]) -> tuple[str, list[dict], Optional[str]]:
    """Check (and possibly correct) an answer. Returns text, outcomes, refusal."""
    outcomes, refusal = [], None
    text = text or ""
    ordered = sorted(
        answer_rules(rules),
        key=lambda r: ["blocked_phrases", "pii_redaction", "json_answers", "answer_length"].index(r["type"]),
    )
    for rule in ordered:
        try:
            t, p, enf = rule["type"], rule["params"], rule["enforcement"]
            if t == "blocked_phrases":
                hits = _find_phrases(text, p.get("phrases") or [])
                if not hits:
                    outcomes.append(_outcome(rule, "answer", "passed", "No blocked phrases."))
                elif enf == "block":
                    outcomes.append(_outcome(rule, "answer", "blocked", f"Answer contained: {', '.join(hits)}."))
                    refusal = refusal or f"The answer was withheld by rule '{rule['name']}'."
                else:
                    outcomes.append(_outcome(rule, "answer", "warned", f"Answer contained: {', '.join(hits)}."))
            elif t == "pii_redaction":
                redacted, counts = redact(text, p.get("types") or [])
                total = sum(counts.values())
                if not total:
                    outcomes.append(_outcome(rule, "answer", "passed", "No personal data found."))
                else:
                    found = ", ".join(f"{n} {k.replace('_', ' ')}" for k, n in counts.items())
                    if enf == "fix":
                        text = redacted
                        outcomes.append(_outcome(rule, "answer", "fixed", f"Redacted {found}.", counts))
                    else:
                        outcomes.append(_outcome(rule, "answer", "warned", f"Found {found}.", counts))
            elif t == "json_answers":
                data = _parse_json_object(text)
                missing = [k for k in p.get("required_keys") or [] if data is None or k not in data]
                if data is not None and not missing:
                    outcomes.append(_outcome(rule, "answer", "passed", "Answer is valid JSON."))
                else:
                    why = "not a JSON object" if data is None else f"missing keys: {', '.join(missing)}"
                    if enf == "block":
                        outcomes.append(_outcome(rule, "answer", "blocked", f"Answer was {why}."))
                        refusal = refusal or f"The answer was withheld by rule '{rule['name']}': it was {why}."
                    else:
                        outcomes.append(_outcome(rule, "answer", "warned", f"Answer was {why}."))
            elif t == "answer_length":
                limit = int(p.get("max_chars") or 4000)
                if len(text) <= limit:
                    outcomes.append(_outcome(rule, "answer", "passed", f"{len(text)} characters."))
                elif enf == "fix":
                    outcomes.append(_outcome(rule, "answer", "fixed",
                                             f"Cut from {len(text)} to {limit} characters."))
                    text = text[:limit].rstrip() + "…"
                else:
                    outcomes.append(_outcome(rule, "answer", "warned",
                                             f"{len(text)} characters, over the {limit} limit."))
        except Exception as e:
            logger.warning("Rule '%s' failed on answer: %s", rule.get("id"), e)
    return text, outcomes, refusal


def tool_round_limit(rules: list[dict], default: int) -> int:
    limits = [int(r["params"].get("max_rounds") or default) for r in _of_type(rules, "tool_call_limit")]
    return min([default, *limits]) if limits else default


def tool_limit_outcomes(rules: list[dict], rounds_used: int, hit_limit: bool) -> list[dict]:
    out = []
    for rule in _of_type(rules, "tool_call_limit"):
        limit = rule["params"].get("max_rounds")
        if hit_limit:
            out.append(_outcome(rule, "run", "blocked",
                                f"Stopped after {limit} tool round(s); answered with what it had."))
        else:
            out.append(_outcome(rule, "run", "passed", f"{rounds_used} of {limit} tool round(s) used."))
    return out


# ═══════════════════════════════════════════════════════════════════════════
# WORKFLOW RULES
# ═══════════════════════════════════════════════════════════════════════════


def _issue(rule: dict, message: str, step_id: str | None = None, field: str | None = None,
           severity: str | None = None):
    from app.services.workflow_engine.models import ValidationIssue

    return ValidationIssue(
        severity=severity or ("error" if rule["enforcement"] == "block" else "warning"),
        code=f"rule.{rule['type']}",
        message=f"{rule['name']}: {message}",
        step_id=step_id,
        field=field,
    )


def _labels(concept_ids) -> str:
    from app.ontology import store

    out = []
    for cid in concept_ids:
        concept = store.get_concept(cid)
        out.append(concept["label"] if concept else cid)
    return ", ".join(sorted(out))


def _capability_coverage(rule, definition, agents_by_id, connectors_by_id) -> list:
    """Recreated from the ontology check: each agent can reach what it needs."""
    from app.ontology import store
    from app.ontology.vocab import Predicate, SubjectType
    from app.services.workflow_engine.models import StepType

    out = []
    for step in definition.steps:
        if step.type != StepType.AGENT:
            continue
        agent_id = (step.config or {}).get("agent_id")
        if not agent_id or agent_id not in agents_by_id:
            continue
        required = set(store.annotations_for(SubjectType.AGENT.value, agent_id)
                       .get(Predicate.REQUIRES_CAPABILITY.value, []))
        if not required:
            continue
        agent = agents_by_id[agent_id]
        provided: set[str] = set()
        for ref in agent.get("connectors") or []:
            cid = ref.get("connector_id") if isinstance(ref, dict) else ref
            if cid:
                provided |= set(store.annotations_for(SubjectType.CONNECTOR.value, cid)
                                .get(Predicate.PROVIDES_CAPABILITY.value, []))
        for tool in agent.get("tools") or []:
            name = tool if isinstance(tool, str) else (
                (tool.get("function") or {}).get("name") or tool.get("type") or "")
            if name:
                provided |= set(store.annotations_for(SubjectType.TOOL.value, name)
                                .get(Predicate.PROVIDES_CAPABILITY.value, []))
        missing = {c for c in required if not (store.descendants(c) & provided)}
        missing = {c for c in missing if not c.startswith("capability.reasoning")}
        if not missing:
            continue
        sources = store.annotation_sources(SubjectType.AGENT.value, agent_id,
                                           Predicate.REQUIRES_CAPABILITY.value)
        confirmed = any(sources.get(c) != "inferred" for c in missing)
        severity = "error" if (confirmed and rule["enforcement"] == "block") else "warning"
        hint = ("Attach a tool or connector, or remove the requirement from the agent."
                if confirmed else "This requirement was inferred automatically and may be wrong.")
        out.append(_issue(
            rule, f"'{agent.get('name', agent_id)}' needs {_labels(missing)}, but nothing attached "
                  f"to it provides that. {hint}", step.id, "agent_id", severity))
    return out


def _data_classes_in_path(definition) -> dict[str, set[str]]:
    """Data classes each step inherits from the steps before it."""
    from app.ontology import store
    from app.ontology.vocab import Predicate, SubjectType
    from app.services.workflow_engine.models import StepType

    steps_by_id = {s.id: s for s in definition.steps}

    def classes_of(step) -> set[str]:
        found = set((step.config or {}).get("data_classes") or [])
        if step.type == StepType.AGENT and (step.config or {}).get("agent_id"):
            found |= set(store.annotations_for(SubjectType.AGENT.value, step.config["agent_id"])
                         .get(Predicate.HANDLES_DATA_CLASS.value, []))
        return found

    inherited: dict[str, set[str]] = {s.id: set() for s in definition.steps}

    def walk(step_id, carried, seen):
        step = steps_by_id.get(step_id)
        if step is None or step_id in seen:
            return
        carried = carried | classes_of(step)
        inherited[step_id] |= carried
        targets = list(step.next_steps or [])
        if step.type == StepType.CONDITION:
            for key in ("true_step", "false_step"):
                target = (step.config or {}).get(key)
                if isinstance(target, str) and target:
                    targets.append(target)
        for target in targets:
            walk(target, carried, seen | {step_id})

    if definition.entry_step:
        walk(definition.entry_step, set(), frozenset())
    return inherited


def _sensitive_data_internal(rule, definition, agents_by_id, connectors_by_id) -> list:
    from app.ontology import store
    from app.ontology.vocab import Predicate, SubjectType
    from app.services.workflow_engine.models import StepType

    restricted_classes = set(rule["params"].get("data_classes") or [])
    if not restricted_classes:
        return []
    inherited = _data_classes_in_path(definition)
    out = []
    for step in definition.steps:
        if step.type != StepType.CONNECTOR:
            continue
        connector_id = (step.config or {}).get("connector_id")
        if not connector_id:
            continue
        if not store.annotations_for(SubjectType.CONNECTOR.value, connector_id).get(
            Predicate.EGRESSES_TO.value
        ):
            continue
        restricted = {c for c in inherited.get(step.id, set())
                      if c.rsplit(".", 1)[-1] in restricted_classes}
        if not restricted:
            continue
        name = connectors_by_id.get(connector_id, {}).get("name", connector_id)
        out.append(_issue(
            rule, f"{_labels(restricted)} reaches '{name}', which sends data to a third party. "
                  f"Remove the upstream step that introduces it, or mark the connector as internal.",
            step.id, "connector_id"))
    return out


def _screen_input_first(rule, definition, agents_by_id, connectors_by_id) -> list:
    from app.ontology import store
    from app.services.workflow_engine.models import StepType

    entry = next((s for s in definition.steps if s.id == definition.entry_step), None)
    if entry is None or entry.type != StepType.AGENT:
        return []
    agent_id = (entry.config or {}).get("agent_id")
    if not agent_id:
        return []
    tier = store.tier_for_agent(agent_id)
    if tier is None:
        return []
    required = rule["params"].get("required_tier", "foundation")
    if tier == required:
        return []
    name = agents_by_id.get(agent_id, {}).get("name", agent_id)
    return [_issue(
        rule, f"The workflow opens on '{name}', a {tier.replace('_', ' ')} agent. Open with a "
              f"{required.replace('_', ' ')} screening agent before any business logic runs.",
        entry.id, "agent_id")]


def _documents_match_domain(rule, definition, agents_by_id, connectors_by_id) -> list:
    from app.ontology import store
    from app.ontology.vocab import Predicate, SubjectType
    from app.rag import library_domain
    from app.services.workflow_engine.models import StepType

    out = []
    for step in definition.steps:
        if step.type != StepType.AGENT:
            continue
        agent_id = (step.config or {}).get("agent_id")
        agent = agents_by_id.get(agent_id or "")
        if not agent:
            continue
        try:
            from app.rag.scope import library_ids_from_tools
            library_ids = library_ids_from_tools(agent.get("tools") or [])
        except Exception:
            library_ids = []
        domains = set(store.annotations_for(SubjectType.AGENT.value, agent_id)
                      .get(Predicate.SERVES_DOMAIN.value, []))
        if not domains or not library_ids:
            continue
        reachable: set[str] = set()
        for cid in domains:
            reachable |= store.descendants(cid)
            reachable |= store.ancestors(cid, include_self=True)
        for library_id in library_ids:
            lib_domains = set(library_domain.domains_for(library_id))
            if lib_domains and not (lib_domains & reachable):
                out.append(_issue(
                    rule, f"'{agent.get('name') or agent_id}' serves {_labels(domains)} but reads a "
                          f"library scoped to {_labels(lib_domains)}.", step.id))
    return out


def _step_limit(rule, definition, agents_by_id, connectors_by_id) -> list:
    limit = int(rule["params"].get("max_steps") or 50)
    count = len(definition.steps)
    if count <= limit:
        return []
    return [_issue(rule, f"The workflow has {count} steps; the limit is {limit}.")]


def _blocked_connectors(rule, definition, agents_by_id, connectors_by_id) -> list:
    from app.services.workflow_engine.models import StepType

    blocked = set(rule["params"].get("connectors") or [])
    if not blocked:
        return []
    out = []
    for step in definition.steps:
        cfg = step.config or {}
        if step.type == StepType.CONNECTOR and cfg.get("connector_id") in blocked:
            name = connectors_by_id.get(cfg["connector_id"], {}).get("name", cfg["connector_id"])
            out.append(_issue(rule, f"Step calls '{name}', which is blocked.", step.id, "connector_id"))
        elif step.type == StepType.AGENT and cfg.get("agent_id") in agents_by_id:
            agent = agents_by_id[cfg["agent_id"]]
            for ref in agent.get("connectors") or []:
                cid = ref.get("connector_id") if isinstance(ref, dict) else ref
                if cid in blocked:
                    name = connectors_by_id.get(cid, {}).get("name", cid)
                    out.append(_issue(rule, f"'{agent.get('name')}' holds '{name}', which is blocked.",
                                      step.id, "agent_id"))
    return out


_WORKFLOW_CHECKS = {
    "capability_coverage": _capability_coverage,
    "sensitive_data_internal": _sensitive_data_internal,
    "screen_input_first": _screen_input_first,
    "documents_match_domain": _documents_match_domain,
    "step_limit": _step_limit,
    "blocked_connectors": _blocked_connectors,
}


def check_workflow(definition, agents_by_id: dict | None, connectors_by_id: dict | None,
                   rules: list[dict]) -> list:
    """Structure-time workflow rules. Returns ValidationIssues."""
    agents_by_id = agents_by_id or {}
    connectors_by_id = connectors_by_id or {}
    issues = []
    for rule in rules or []:
        check = _WORKFLOW_CHECKS.get(rule.get("type"))
        if not check:
            continue
        try:
            issues.extend(check(rule, definition, agents_by_id, connectors_by_id))
        except Exception as e:
            logger.warning("Workflow rule '%s' failed and was skipped: %s", rule.get("id"), e)
    return issues


def workflow_validation_outcomes(rules: list[dict], issues: list) -> list[dict]:
    """One outcome per structure-time rule, from the issues it produced."""
    by_code: dict[str, list] = {}
    for issue in issues:
        by_code.setdefault(issue.code, []).append(issue)
    out = []
    for rule in rules or []:
        if rule["type"] not in _WORKFLOW_CHECKS:
            continue
        found = by_code.get(f"rule.{rule['type']}", [])
        if not found:
            out.append(_outcome(rule, "validate", "passed", "No issues."))
        else:
            outcome = "blocked" if any(i.severity == "error" for i in found) else "warned"
            out.append(_outcome(rule, "validate", outcome, found[0].message.split(": ", 1)[-1],
                                {"issues": len(found)}))
    return out


def check_workflow_input(input_vars: dict, rules: list[dict]) -> tuple[list[dict], Optional[str]]:
    text = " ".join(str(v) for v in (input_vars or {}).values() if isinstance(v, (str, int, float)))
    outcomes, refusal = [], None
    for rule in _of_type(rules, "input_screening"):
        hits = _find_phrases(text, rule["params"].get("phrases") or [])
        if not hits:
            outcomes.append(_outcome(rule, "run_start", "passed", "Inputs are clean."))
        elif rule["enforcement"] == "block":
            outcomes.append(_outcome(rule, "run_start", "blocked", f"Inputs contain: {', '.join(hits)}."))
            refusal = refusal or f"Blocked by rule '{rule['name']}': the run inputs contain a blocked phrase."
        else:
            outcomes.append(_outcome(rule, "run_start", "warned", f"Inputs contain: {', '.join(hits)}."))
    return outcomes, refusal


def step_limit(rules: list[dict], default: int = 50) -> int:
    limits = [int(r["params"].get("max_steps") or default) for r in _of_type(rules, "step_limit")]
    return min([default, *limits]) if limits else default


def agent_step_tool_limit(rules: list[dict], default: int = 10) -> int:
    limits = [int(r["params"].get("max_rounds") or default) for r in _of_type(rules, "agent_step_tool_limit")]
    return min([default, *limits]) if limits else default


def check_connector_step(step, connector_id: str, rules: list[dict]) -> tuple[list[dict], Optional[str]]:
    """Runtime gate for one connector step."""
    outcomes, refusal = [], None
    for rule in _of_type(rules, "blocked_connectors", "sensitive_data_internal"):
        try:
            if rule["type"] == "blocked_connectors":
                if connector_id in set(rule["params"].get("connectors") or []):
                    outcomes.append(_outcome(rule, "step", "blocked", f"Connector '{connector_id}' is blocked."))
                    refusal = refusal or f"Blocked by rule '{rule['name']}': this connector may not be called."
                else:
                    outcomes.append(_outcome(rule, "step", "passed", "Connector allowed."))
                continue

            from app.ontology import store
            from app.ontology.vocab import Predicate, SubjectType

            if not store.annotations_for(SubjectType.CONNECTOR.value, connector_id).get(
                Predicate.EGRESSES_TO.value
            ):
                outcomes.append(_outcome(rule, "step", "passed", "Connector is internal."))
                continue
            declared = (step.config or {}).get("data_classes") or []
            classes = set(rule["params"].get("data_classes") or [])
            restricted = [c for c in declared if str(c).rsplit(".", 1)[-1] in classes]
            if not restricted:
                outcomes.append(_outcome(rule, "step", "passed", "No sensitive data declared."))
            elif rule["enforcement"] == "block":
                outcomes.append(_outcome(rule, "step", "blocked",
                                         f"{', '.join(restricted)} would leave via a third-party connector."))
                refusal = refusal or f"Blocked by rule '{rule['name']}': sensitive data would leave the platform."
            else:
                outcomes.append(_outcome(rule, "step", "warned",
                                         f"{', '.join(restricted)} leaves via a third-party connector."))
        except Exception as e:
            logger.warning("Rule '%s' failed on connector step: %s", rule.get("id"), e)
    return outcomes, refusal


def redact_step_result(text: str, rules: list[dict]) -> tuple[str, list[dict]]:
    outcomes = []
    for rule in _of_type(rules, "result_redaction"):
        redacted, counts = redact(text, rule["params"].get("types") or [])
        total = sum(counts.values())
        if not total:
            outcomes.append(_outcome(rule, "step_result", "passed", "No personal data found."))
            continue
        found = ", ".join(f"{n} {k.replace('_', ' ')}" for k, n in counts.items())
        if rule["enforcement"] == "fix":
            text = redacted
            outcomes.append(_outcome(rule, "step_result", "fixed", f"Redacted {found}.", counts))
        else:
            outcomes.append(_outcome(rule, "step_result", "warned", f"Found {found}.", counts))
    return text, outcomes
