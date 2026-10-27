"""Build prerequisites: worked out and settled before anything is built — certain
vault matches used unasked, the rest asked about, values never passed in answers,
and what was settled reaching the specifications."""

import asyncio
import json

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.build_prereqs import analysis, ask, guidance, resolve
from app.build_prereqs.layer import STOPPED_KEY, BuildPrerequisitesLayer
from app.build_prereqs.models import METADATA_KEY, PrereqItem
from app.core.context import PipelineContext
from app.core.specs import CapabilitySpec, WorkflowSpec
from app.vault import crypto, store


@pytest.fixture
def vault(monkeypatch, tmp_path):
    import app.vault.models  # noqa: F401
    from app.config import settings
    from app.database import Base

    engine = create_engine(f"sqlite:///{tmp_path / 'vault.db'}",
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    monkeypatch.setattr(store, "SessionLocal", sessionmaker(bind=engine))
    monkeypatch.setenv("VAULT_MASTER_KEYS", Fernet.generate_key().decode())
    for key, value in {"VAULT_ENABLED": True, "PREREQ_CHECK_ENABLED": True,
                       "PREREQ_AUTO_USE_VAULT": True, "PREREQ_ASK_WHEN_SATISFIED": False,
                       "PREREQ_ASK_FOR_INFORMATION": True, "PREREQ_UNATTENDED_POLICY": "proceed",
                       "PREREQ_CODE_CHECK": True, "VAULT_ENV_FALLBACK": False}.items():
        monkeypatch.setattr(settings, key, value)
    crypto.reset()
    yield
    crypto.reset()


class FakeRun:
    """The run's event sink, answering questions from a script."""

    id = "run-1"

    def __init__(self, *answers):
        self.answers = list(answers)
        self.events, self.questions = [], []

    def put_nowait(self, sse):
        self.events.append((sse.event, sse.data))

    async def ask(self, kind, question, *, options, default):
        self.questions.append({"kind": kind, **question})
        answer = self.answers.pop(0)
        return answer(question) if callable(answer) else answer


def _items(*raw, info=True, steps=None):
    return analysis.parse_items(list(raw), ask_information=info, known_steps=steps)


def test_parse_items_cleans_the_models_answer(vault):
    items = _items(
        {"category": "credential", "name": "openweather api-key", "label": "OpenWeather key",
         "service": "OpenWeather", "secret_kind": "api_key", "used_by": ["fetch", "ghost"]},
        {"category": "credential", "name": "OPENWEATHER_API_KEY", "label": "duplicate"},
        {"category": "endpoint", "name": "ACME_CRM_BASE_URL", "label": "CRM URL", "secret_kind": "bogus"},
        {"category": "information", "key": "tax rate", "label": "GST rate", "default": "18%"},
        {"category": "mystery", "label": "dropped"},
        steps={"fetch"},
    )
    assert [i.key for i in items] == ["OPENWEATHER_API_KEY", "ACME_CRM_BASE_URL", "info_tax_rate"]
    assert items[0].used_by == ["fetch"] and items[0].sensitive
    assert items[1].secret_kind == "url" and not items[1].sensitive
    assert items[2].default == "18%" and not items[2].in_vault
    assert _items({"category": "information", "label": "x"}, info=False) == []


def test_system_prompt_formats(vault):
    assert '"information"' in analysis.system_prompt(ask_information=True)
    assert '"information"' not in analysis.system_prompt(ask_information=False)


def test_certain_vault_match_is_used_without_asking(vault):
    store.create_secret(name="OPENWEATHER_API_KEY", value="weather-123456789", service="OpenWeather")
    store.create_secret(name="OWM_KEY", value="owm-key-123456789", service="Weatherly")
    items = _items({"category": "credential", "name": "OPENWEATHER_API_KEY", "label": "k"},
                   {"category": "credential", "name": "WEATHERLY_TOKEN", "label": "Weatherly key",
                    "service": "Weatherly", "secret_kind": "api_key"},
                   {"category": "credential", "name": "STRIPE_KEY", "label": "Stripe key"})

    async def go():
        await resolve.attach_candidates(items)
        await resolve.auto_resolve(items, use_vault=True, env_fallback=False)
    asyncio.run(go())
    exact, by_service, missing = items
    assert exact.status == "vault" and exact.auto
    # The only entry for that service and kind: used, and the code reads its name.
    assert by_service.status == "vault" and by_service.name == "OWM_KEY"
    assert missing.status == "pending"


def test_answers_never_carry_a_value_for_code(vault):
    entry = store.create_secret(name="SMTP_PASSWORD", value="smtp-pass-12345", kind="password")
    items = _items({"category": "credential", "name": "SMTP_PASSWORD", "label": "SMTP password"},
                   {"category": "credential", "name": "SLACK_TOKEN", "label": "Slack token"},
                   {"category": "endpoint", "name": "CRM_URL", "label": "CRM URL"},
                   {"category": "information", "key": "threshold", "label": "Approval limit"},
                   {"category": "credential", "name": "FAX_KEY", "label": "Fax key"})
    problems = asyncio.run(ask.apply_answers(items, [
        {"key": "SMTP_PASSWORD", "action": "vault", "secret_id": entry["id"]},
        {"key": "SLACK_TOKEN", "action": "text", "text": "xoxb-should-not-pass"},
        {"key": "CRM_URL", "action": "skip", "instruction": "Read the CRM export file instead"},
        {"key": "info_threshold", "action": "text", "text": "50,000 INR"},
        {"key": "FAX_KEY", "action": "defer"},
    ]))
    smtp, slack, crm, limit, fax = items
    assert smtp.status == "vault" and smtp.secret_id == entry["id"]
    assert slack.status == "pending" and slack.value is None
    assert len(problems) == 1 and "vault" in problems[0]
    assert crm.status == "skipped" and "export" in crm.instruction
    assert limit.status == "answered" and limit.value == "50,000 INR"
    assert fax.status == "deferred" and fax.secret_name == "FAX_KEY"


def test_guidance_tells_the_spec_author_exact_names(vault):
    ctx = PipelineContext()
    ctx.metadata[METADATA_KEY] = {"items": [
        PrereqItem(key="K", name="OWM_KEY", label="Weather key", service="OpenWeather",
                   status="vault", secret_name="OWM_KEY", used_by=["fetch"]).as_dict(),
        PrereqItem(key="CRM_URL", category="endpoint", name="CRM_URL", label="CRM URL",
                   service="AcmeCRM", status="skipped", instruction="Use the uploaded CSV").as_dict(),
        PrereqItem(key="info_rate", category="information", label="GST rate", status="answered",
                   value="18%").as_dict(),
    ]}
    lines = guidance.code_guidance(ctx, "fetch")
    assert any("kwargs['_secrets']['OWM_KEY']" in l for l in lines)
    assert any(l.startswith("Do NOT use AcmeCRM") and "uploaded CSV" in l for l in lines)
    assert any("GST rate: 18%" in l for l in lines)
    # Scoped: another step is not told about the weather key.
    assert not any("OWM_KEY" in l for l in guidance.code_guidance(ctx, "other_step"))
    assert "Build prerequisites" in guidance.block(ctx)
    assert guidance.block(PipelineContext()) == ""


# ── The layer ──────────────────────────────────────────────────────────────


def _workflow_ctx(run=None):
    ctx = PipelineContext(query="Send weather alerts", client=object())
    ctx.workflow_spec = WorkflowSpec(goal="Send weather alerts", workflow_name="weather_alerts",
                                     capabilities=[CapabilitySpec(id="fetch", name="Fetch",
                                                                  kind="activity")])
    ctx.event_queue = run
    return ctx


def _model_says(monkeypatch, items):
    async def fake_decide(client, **kw):
        assert kw["route"] == "prerequisite_analysis"
        return json.dumps({"items": items, "reasoning": "it calls OpenWeather"})
    monkeypatch.setattr(analysis, "decide", fake_decide)


async def _run(layer, ctx):
    async def nxt(c):
        c.metadata["reached_next"] = True
        return c
    return await layer.process(ctx, nxt)


_WEATHER = [{"category": "credential", "name": "OPENWEATHER_API_KEY", "label": "OpenWeather key",
             "service": "OpenWeather", "used_by": ["fetch"]}]


def test_layer_asks_and_the_answer_stores_nothing_but_a_reference(vault, monkeypatch):
    _model_says(monkeypatch, _WEATHER)

    def answer(question):
        # The page stores the typed key in the vault first, then answers with its id.
        assert question["items"][0]["value"] is None and question["stage"] == "workflow"
        entry = store.create_secret(name="OPENWEATHER_API_KEY", value="typed-in-dialog-123",
                                    origin="build", origin_ref=question["run_id"])
        return {"choice": "continue",
                "answers": [{"key": "OPENWEATHER_API_KEY", "action": "vault", "secret_id": entry["id"]}]}

    run = FakeRun(answer)
    ctx = asyncio.run(_run(BuildPrerequisitesLayer("workflow"), _workflow_ctx(run)))
    assert ctx.metadata["reached_next"] and ctx.error is None
    item = ctx.metadata[METADATA_KEY]["items"][0]
    assert item["status"] == "vault" and item["secret_name"] == "OPENWEATHER_API_KEY"
    assert "typed-in-dialog" not in json.dumps([e for e in run.events], default=str)
    assert store.get_secret("OPENWEATHER_API_KEY")["origin"] == "build"


def test_layer_does_not_ask_when_the_vault_covers_everything(vault, monkeypatch):
    store.create_secret(name="OPENWEATHER_API_KEY", value="already-there-123", service="OpenWeather")
    _model_says(monkeypatch, _WEATHER)
    run = FakeRun()
    ctx = asyncio.run(_run(BuildPrerequisitesLayer("workflow"), _workflow_ctx(run)))
    assert run.questions == [] and ctx.metadata[METADATA_KEY]["items"][0]["auto"]


def test_cancel_stops_before_anything_is_built(vault, monkeypatch):
    _model_says(monkeypatch, _WEATHER)
    ctx = asyncio.run(_run(BuildPrerequisitesLayer("workflow"),
                           _workflow_ctx(FakeRun({"choice": "cancel"}))))
    assert ctx.metadata[STOPPED_KEY] == "cancel" and ctx.error
    # Workflow layers after this one see the error and pass straight through.
    from app.layers.workflow.base import workflow_ready
    assert not workflow_ready(ctx)


def test_unattended_policy(vault, monkeypatch):
    from app.config import settings

    _model_says(monkeypatch, _WEATHER)
    ctx = asyncio.run(_run(BuildPrerequisitesLayer("workflow"), _workflow_ctx(None)))
    assert ctx.metadata[METADATA_KEY]["items"][0]["status"] == "deferred"
    monkeypatch.setattr(settings, "PREREQ_UNATTENDED_POLICY", "stop")
    ctx = asyncio.run(_run(BuildPrerequisitesLayer("workflow"), _workflow_ctx(None)))
    assert ctx.metadata[STOPPED_KEY] == "stop" and "OpenWeather key" in ctx.error


def test_a_failed_analysis_never_blocks_the_build(vault, monkeypatch):
    async def broken(client, **kw):
        raise RuntimeError("model down")
    monkeypatch.setattr(analysis, "decide", broken)
    ctx = asyncio.run(_run(BuildPrerequisitesLayer("workflow"), _workflow_ctx(FakeRun())))
    assert ctx.metadata["reached_next"] and ctx.error is None


def test_agent_stop_short_circuits(vault, monkeypatch):
    _model_says(monkeypatch, _WEATHER)
    ctx = PipelineContext(query="weather?", client=object())
    ctx.event_queue = FakeRun({"choice": "cancel"})
    ctx = asyncio.run(_run(BuildPrerequisitesLayer("agent"), ctx))
    assert "reached_next" not in ctx.metadata and ctx.metadata[STOPPED_KEY] == "cancel"


# ── R4b: the credential check inside the code pipeline ─────────────────────


def _req_ctx(secrets, code_check=None):
    from app.core.specs import CodeNeed, CodeRequirement
    from app.layers.codegen.layers import RequirementContext
    from app.layers.codegen.profiles import profile_for

    need = CodeNeed(purpose="activity", origin="workflow", intent="fetch weather")
    ctx = RequirementContext(need=need, profile=profile_for("activity"), client=object(),
                             code_check=code_check)
    ctx.requirement = CodeRequirement(name="fetch_weather", kind="http", secrets=list(secrets),
                                      api_details="GET /weather with appid=OWM_API_KEY")
    return ctx


def test_r4b_renames_to_the_vault_entry_the_user_picks(vault):
    from app.build_prereqs.code_check import CodeCheck
    from app.layers.codegen.layers import CredentialCheckLayer

    entry = store.create_secret(name="OPENWEATHER_API_KEY", value="the-real-key-1234",
                                service="Other")
    run = FakeRun({"choice": "continue", "answers": [
        {"key": "OWM_API_KEY", "action": "vault", "secret_id": entry["id"]}]})
    check = CodeCheck(_workflow_ctx(run))
    ctx = _req_ctx(["OWM_API_KEY"], check)
    asyncio.run(CredentialCheckLayer().run(ctx))
    assert ctx.requirement.secrets == ["OPENWEATHER_API_KEY"]
    assert "OPENWEATHER_API_KEY" in ctx.requirement.api_details and not ctx.issues
    assert run.questions[0]["stage"] == "code"
    # A second need using the same name is not asked about again.
    again = _req_ctx(["OWM_API_KEY"], check)
    asyncio.run(CredentialCheckLayer().run(again))
    assert len(run.questions) == 1 and again.requirement.secrets == ["OPENWEATHER_API_KEY"]


def test_r4b_skip_sends_the_spec_back_without_the_service(vault):
    from app.build_prereqs.code_check import CodeCheck
    from app.layers.codegen.layers import CredentialCheckLayer

    run = FakeRun({"choice": "continue", "answers": [
        {"key": "OWM_API_KEY", "action": "skip", "instruction": "use open-meteo.com, no key"}]})
    ctx = _req_ctx(["OWM_API_KEY"], CodeCheck(_workflow_ctx(run)))
    asyncio.run(CredentialCheckLayer().run(ctx))
    assert ctx.issues and "proceed without OWM_API_KEY" in ctx.issues[0]
    assert any("open-meteo" in g for g in ctx.need.guidance) and ctx.resolution is None


def test_r4b_already_settled_names_pass_silently(vault):
    from app.build_prereqs.code_check import CodeCheck
    from app.layers.codegen.layers import CredentialCheckLayer

    build = _workflow_ctx(FakeRun())
    build.metadata[METADATA_KEY] = {"items": [PrereqItem(
        key="OWM_API_KEY", name="OWM_API_KEY", label="k", status="deferred",
        secret_name="OWM_API_KEY").as_dict()]}
    ctx = _req_ctx(["OWM_API_KEY"], CodeCheck(build))
    asyncio.run(CredentialCheckLayer().run(ctx))
    assert not ctx.issues and ctx.resolution is None


def test_r4b_unattended_stop_blocks_the_build(vault, monkeypatch):
    from app.config import settings
    from app.layers.codegen.layers import CredentialCheckLayer

    monkeypatch.setattr(settings, "PREREQ_UNATTENDED_POLICY", "stop")
    ctx = _req_ctx(["OWM_API_KEY"])
    asyncio.run(CredentialCheckLayer().run(ctx))
    assert ctx.resolution.status == "blocked" and ctx.resolution.reason == "prerequisites"


def test_pipelines_check_prerequisites_before_building(vault):
    from app.layers import chat_pipeline, workflow_pipeline

    wf = workflow_pipeline.layer_names
    assert wf.index("workflow_prerequisites") == wf.index("execution_mode") + 1
    assert wf.index("workflow_prerequisites") < wf.index("activity_gap")
    chat = chat_pipeline.layer_names
    assert chat.index("agent_prerequisites") < chat.index("capability_gap")
