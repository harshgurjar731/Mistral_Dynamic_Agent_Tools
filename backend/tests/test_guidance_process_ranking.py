"""Guidance picked with process knowledge: ranking, per-stage views, view places, facts."""

import asyncio
from types import SimpleNamespace

from app.knowledge import retrieval
from app.process import context as pk_context
from tests.test_knowledge_context import _ctx, _guidance, db  # noqa: F401 — fixture


def _item(i, title, body, category="governance", strength="should", **kw):
    return {"id": i, "title": title, "body": body, "category": category, "strength": strength,
            "conditions": [], "tags": [], **kw}


PROCESS = pk_context.build([{
    "id": 1, "title": "Vendor onboarding", "content": {
        "process": {"name": "Vendor onboarding"},
        "objective": "Onboard new suppliers safely",
        "stages": [
            {"id": "collect", "name": "Collect supplier documents", "outputs": ["supplier_record"]},
            {"id": "pay", "name": "Approve first payment", "inputs": ["bank_account"],
             "controls": ["dual_approval"]},
        ],
        "controls": [
            {"id": "kyc", "description": "Run KYC sanctions screening", "applies_to": ["collect"]},
            {"id": "dual_approval", "description": "Segregation of duties for payment approval"},
        ],
        "data_entities": [{"name": "bank_account", "classification": "financial"}],
        "execution_profile": {"task_horizon": "many_steps", "interaction_mode": "batch"},
    }}], mode="uploaded")


# ── Process text ────────────────────────────────────────────────────────────


def test_query_text_carries_the_process_in_plain_words():
    text = pk_context.query_text(PROCESS)
    assert "KYC sanctions screening" in text and "Segregation of duties" in text
    assert "stage:" not in text


def test_each_stage_text_has_only_its_own_controls_and_data():
    stages = pk_context.stage_texts(PROCESS)
    assert "KYC" in stages["stage:collect"] and "Segregation" not in stages["stage:collect"]
    assert "Segregation" in stages["stage:pay"] and "financial" in stages["stage:pay"]


def test_requirement_facts_from_the_process():
    content = {"execution_profile": {"task_horizon": "many_steps", "interaction_mode": "user_dialogue"}}
    assert pk_context.derived_requirements(content) == {"complexity": "complex",
                                                        "task_type": "conversation"}
    assert pk_context.derived_requirements({}) == {}


# ── Ranking ─────────────────────────────────────────────────────────────────


ITEMS = [
    _item(1, "Generic onboarding checklist", "Keep onboarding steps short."),
    _item(2, "Screen every supplier", "Run KYC and sanctions screening before activation."),
    _item(3, "Automate vendor onboarding end to end", "Vendor onboarding automation tips."),
]


def _titles(ranked):
    return [r["title"] for r in ranked]


def test_the_process_surfaces_guidance_the_goal_never_mentions():
    goal = "automate vendor onboarding"
    without = retrieval.select(goal, items=[dict(i) for i in ITEMS])
    with_process = retrieval.select(goal, items=[dict(i) for i in ITEMS],
                                    process_text=pk_context.query_text(PROCESS))
    assert _titles(without)[-1] == "Screen every supplier", "the goal alone ranks it last"
    assert _titles(with_process)[:2] == ["Automate vendor onboarding end to end",
                                         "Screen every supplier"], "goal still leads"


def test_without_process_the_ranking_is_unchanged():
    a = retrieval.select("automate vendor onboarding", items=[dict(i) for i in ITEMS])
    b = retrieval.select("automate vendor onboarding", items=[dict(i) for i in ITEMS],
                         process_text="")
    assert [(r["id"], r["score"]) for r in a] == [(r["id"], r["score"]) for r in b]


def test_process_vector_adds_meaning_but_below_the_goal():
    items = [dict(ITEMS[1], embedding=[0.0, 1.0]), dict(ITEMS[2], embedding=[1.0, 0.0])]
    ranked = retrieval.select("x", items=items, query_vector=[1.0, 0.0], process_vector=[0.0, 1.0])
    assert ranked[0]["id"] == 3  # matches the goal: 6.0 beats the process's 3.5
    assert ranked[1]["score"] > 1.5  # the process match still counted


def test_every_view_keeps_some_places():
    crowd = [_item(i, f"Pattern {i}", "decompose", category="workflow_pattern", strength="must")
             for i in range(1, 11)]
    naming = [_item(100, "Name agents by role", "naming", category="naming", strength="may")]
    old = retrieval.select("x", items=[dict(i) for i in crowd + naming], limit=5)
    new = retrieval.select("x", items=[dict(i) for i in crowd + naming], limit=5, view_min=3)
    assert 100 not in [r["id"] for r in old]
    assert 100 in [r["id"] for r in new] and len(new) <= 5 + 5 // 2


# ── Per-stage views ─────────────────────────────────────────────────────────


def _pack():
    items = [_item(1, "Approve payments with two people", "Segregation of duties for payment "
                   "approval.", strength="should", score=5.0),
             _item(2, "Screen suppliers", "Run KYC sanctions screening.", strength="should",
                   score=5.0)]
    stages = {ref: {"text": text} for ref, text in pk_context.stage_texts(PROCESS).items()}
    return retrieval.build_pack(items, mode="auto", stages=stages)


def _first_ref(text):
    return text.split("\n")[1].split("]")[0] + "]"


def test_a_stage_gets_the_guidance_for_its_own_work():
    pack = _pack()
    assert _first_ref(retrieval.render(pack, "agent_rules", focus="stage:pay")) == "- [guidance:1]"
    assert _first_ref(retrieval.render(pack, "agent_rules", focus="collect")) == "- [guidance:2]"


def test_no_focus_or_unknown_stage_keeps_the_run_order():
    pack = _pack()
    assert _first_ref(retrieval.render(pack, "agent_rules")) == "- [guidance:1]"
    assert retrieval.render(pack, "agent_rules", focus="stage:ghost") == \
        retrieval.render(pack, "agent_rules")


def test_stage_vectors_rerank_by_meaning():
    pack = _pack()
    pack["items"][0]["_vector"], pack["items"][1]["_vector"] = [1.0, 0.0], [0.0, 1.0]
    pack["stages"] = {"stage:x": {"text": "", "vector": [0.0, 1.0]}}
    assert _first_ref(retrieval.render(pack, "agent_rules", focus="stage:x")) == "- [guidance:2]"


# ── The resolver ────────────────────────────────────────────────────────────


class _EmbedClient:
    def __init__(self):
        self.calls = []
        self.embeddings = SimpleNamespace(create=self._create)

    def _create(self, model, inputs):
        self.calls.append(list(inputs))
        return SimpleNamespace(data=[SimpleNamespace(embedding=[0.5, 0.5]) for _ in inputs])


def test_resolver_ranks_with_the_process_and_keeps_stage_texts(db, monkeypatch):  # noqa: F811
    from app.knowledge import embed, store
    from app.layers.knowledge_context_layer import resolve_guidance

    a = _guidance(title="Screen every supplier", body="Run KYC sanctions screening.",
                  category="governance")
    store.set_embedding(a["id"], [0.5, 0.5])
    embed._CACHE.clear()
    client = _EmbedClient()
    ctx = _ctx(client=client)
    pack = asyncio.run(resolve_guidance(ctx, goal="automate vendor onboarding", concept_ids=[],
                                        process=PROCESS))
    assert set(pack["stages"]) == {"stage:collect", "stage:pay"}
    assert pack["stages"]["stage:pay"]["vector"] == [0.5, 0.5]
    assert len(client.calls) == 2, "the goal, then the process and its stages in one call"
    assert len(client.calls[1]) == 3
    assert pack["items"][0]["_vector"] == [0.5, 0.5]


def test_resolver_without_process_makes_no_extra_call(db):  # noqa: F811
    from app.knowledge import embed, store
    from app.layers.knowledge_context_layer import resolve_guidance

    a = _guidance()
    store.set_embedding(a["id"], [0.5, 0.5])
    embed._CACHE.clear()
    client = _EmbedClient()
    pack = asyncio.run(resolve_guidance(_ctx(client=client), goal="invoice", concept_ids=[]))
    assert pack["stages"] == {} and len(client.calls) == 1
    assert "_vector" not in pack["items"][0]


def test_workflow_conditions_on_complexity_are_checked_with_process_facts():
    facts = retrieval.facts_from({"execution_profile": {"task_horizon": "many_steps"}},
                                 pk_context.derived_requirements(
                                     {"execution_profile": {"task_horizon": "many_steps"}}))
    cond = [{"attr": "requirements.complexity", "op": "eq", "value": "complex"}]
    assert retrieval.evaluate(cond, facts) == "true"
    assert retrieval.evaluate(cond, retrieval.facts_from({})) == "unknown"


def test_switches_turn_process_and_stage_ranking_off(db, monkeypatch):  # noqa: F811
    from app.config import settings
    from app.knowledge import embed, store
    from app.layers.knowledge_context_layer import derived_requirements, resolve_guidance

    a = _guidance()
    store.set_embedding(a["id"], [0.5, 0.5])
    embed._CACHE.clear()
    monkeypatch.setattr(settings, "GUIDANCE_PROCESS_RANKING", False)
    monkeypatch.setattr(settings, "GUIDANCE_STAGE_RANKING", False)
    monkeypatch.setattr(settings, "GUIDANCE_PROCESS_REQUIREMENTS", False)
    client = _EmbedClient()
    pack = asyncio.run(resolve_guidance(_ctx(client=client), goal="invoice", concept_ids=[],
                                        process=PROCESS))
    assert pack["stages"] == {} and len(client.calls) == 1
    assert derived_requirements({"execution_profile": {"task_horizon": "many_steps"}}) is None


def test_view_places_follow_the_setting(monkeypatch):
    from app.config import settings
    from app.layers.knowledge_context_layer import view_min

    monkeypatch.setattr(settings, "GUIDANCE_VIEW_MIN", 0)
    assert view_min() == 0
    monkeypatch.setattr(settings, "GUIDANCE_VIEW_MIN", 10)
    monkeypatch.setattr(settings, "GUIDANCE_VIEW_SIZE", 4)
    assert view_min() == 4
