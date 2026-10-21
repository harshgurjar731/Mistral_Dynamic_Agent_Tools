"""
The Tool Service's settings as the backend's Settings page shows them.

Values are persisted to ``db/runtime_settings.json`` (the ``tool-db`` volume),
so a change survives a container rebuild, and every worker process picks up a
change within a couple of seconds. ``used_in`` says where each value is read
and ``impact`` what it changes for a user — keep both current.
"""

from __future__ import annotations

import os
from typing import Any, Optional

from app.runtime_config import Section, SettingDef, SettingsStore

SECTIONS = [
    Section("ts_model_routes", "Tool Service model routes",
            "Which model writes, repairs and checks every synthesised tool and activity, with "
            "its reasoning effort, timeout and fallback.", "route", "tool_service"),
    Section("ts_synthesis", "Tool synthesis",
            "Attempts, time budgets and verification used when a tool or activity is built.",
            "wrench", "tool_service"),
    Section("ts_runtime", "Tool runtime & sandbox",
            "How generated code is executed and what it may access.", "box", "tool_service"),
]

_EFFORT_LABELS = (
    ("high", "High — reasoning on"),
    ("none", "None — reasoning off"),
    ("omit", "Omit — do not send the parameter"),
)
_BUILD = ("Tool & activity synthesis",)

DEFS: list[SettingDef] = [
    # ── Synthesis ──────────────────────────────────────────────────────
    SettingDef("TOOL_MODEL_MAX_ATTEMPTS", "ts_synthesis", "Model call attempts",
               "Retries of one model call on a transport error before the route's fallback "
               "model is tried.", type="int", minimum=1, maximum=10, unit="attempts",
               impact=_BUILD, used_in=("app/llm/client.py — complete",)),
    SettingDef("TOOL_SYNTHESIS_MAX_ATTEMPTS", "ts_synthesis", "Generate / repair passes",
               "How many times a candidate is generated or repaired before the job is reported "
               "as failed. More passes succeed more often but take longer.",
               type="int", minimum=1, maximum=20, unit="passes",
               impact=_BUILD + ("Workflow planning (missing tools)",),
               used_in=("app/synthesis/layers/build.py",)),
    SettingDef("SYNTHESIS_WALL_CLOCK_SECONDS", "ts_synthesis", "Job time budget",
               "Hard wall-clock limit for one synthesis job across all its attempts, so a slow "
               "reasoning model cannot hold a worker indefinitely.",
               type="int", minimum=60, maximum=7200, unit="seconds",
               impact=_BUILD, used_in=("app/synthesis/pipeline.py",)),
    SettingDef("SYNTHESIS_WORKERS", "ts_synthesis", "Concurrent synthesis jobs",
               "Jobs built at once. Each holds a model call and a sandbox process.",
               type="int", minimum=1, maximum=16, apply="restart", unit="jobs",
               impact=_BUILD + ("Tool Service load",), used_in=("app/synthesis/jobs.py",)),
    SettingDef("SYNTHESIZE_WAIT_SECONDS", "ts_synthesis", "Blocking request wait",
               "How long the legacy blocking /synthesize call waits before answering with a "
               "job id to poll. Keep below the backend's 180 s HTTP timeout.",
               type="int", minimum=1, maximum=170, unit="seconds",
               impact=_BUILD, used_in=("app/routes/synthesis.py",)),
    SettingDef("STRICT_ACTIVITY_SPEC", "ts_synthesis", "Strict activity specs",
               "Require every activity spec to carry an output schema and worked examples. "
               "Turn off only while migrating older callers.", type="bool",
               impact=("Activity synthesis",), used_in=("app/synthesis/layers/intake.py",)),
    SettingDef("ORACLE_ARBITRATION", "ts_synthesis", "Oracle arbitration",
               "When generated code disagrees with one of its own worked examples, write an "
               "independent reference implementation to decide which of the two is wrong.",
               type="bool", impact=("Activity synthesis accuracy",),
               used_in=("app/synthesis/layers/build.py",)),
    SettingDef("ORACLE_AUTOCORRECT", "ts_synthesis", "Oracle auto-correct",
               "When the reference implementation and the code agree against an example, "
               "correct the example (and report it) instead of failing the spec.",
               type="bool", impact=("Activity synthesis accuracy",),
               used_in=("app/synthesis/layers/build.py",)),
    SettingDef("AUTO_APPROVE_DYNAMIC_TOOLS", "ts_synthesis", "Auto-approve new tools",
               "Activate synthesised tools as soon as they pass verification. Off: each new tool "
               "waits for approval on the Tools page.", type="bool",
               impact=("Tools page — pending approvals", "Agents using new tools"),
               used_in=("app/synthesis/layers/finalize.py",)),

    # ── Runtime ────────────────────────────────────────────────────────
    SettingDef("TOOL_RUNTIME_FALLBACK", "ts_runtime", "LLM fallback for failed tools",
               "When an agent tool fails at runtime, return a clearly labelled, model-written "
               "degraded answer instead of an error. Never applies to workflow activities.",
               type="bool", impact=("Agent tool calls",),
               used_in=("app/synthesis/profiles/tool.py", "app/services/llm_fallback.py")),
    SettingDef("SECRETS_ALLOWLIST", "ts_runtime", "Secrets allow-list",
               "Comma-separated environment variables a tool may receive — only when its spec "
               "names them.", type="string",
               impact=("Tools that call external APIs",),
               used_in=("app/services/execution_service.py", "app/routes/management.py")),
    SettingDef("SANDBOX_TIMEOUT_SECONDS", "ts_runtime", "Sandbox timeout",
               "Longest one tool execution may run before it is killed.",
               type="int", minimum=1, maximum=600, unit="seconds",
               impact=("Tool execution", "Synthesis tests"), used_in=("app/synthesis/sandbox.py",)),
    SettingDef("SANDBOX_MEMORY_MB", "ts_runtime", "Sandbox memory",
               "Memory limit for one tool execution.",
               type="int", minimum=64, maximum=8192, unit="MB",
               impact=("Tool execution", "Synthesis tests"), used_in=("app/synthesis/sandbox.py",)),
    SettingDef("SANDBOX_USER", "ts_runtime", "Sandbox user",
               "Unprivileged user code runs as. Created by the Dockerfile.",
               type="string", apply="restart", editable=False,
               impact=("Tool execution security",), used_in=("app/synthesis/sandbox.py",)),
    SettingDef("DYNAMIC_TOOLS_DIR", "ts_runtime", "Dynamic tools directory",
               "Where generated tool modules are stored.", type="string", apply="restart",
               editable=False, impact=("Tool storage",), used_in=("app/synthesis/registry.py",)),
    SettingDef("DATABASE_URL", "ts_runtime", "Database URL", "Set in tool-service/.env.",
               type="string", apply="restart", editable=False, impact=("Tool storage",),
               used_in=("app/database.py",)),
    SettingDef("MISTRAL_API_KEY", "ts_runtime", "Mistral API key",
               "Kept in tool-service/.env only, never sent to the browser.",
               type="secret", apply="restart", editable=False, impact=_BUILD,
               used_in=("app/llm/client.py", "app/services/mcp_publisher.py")),
]

_ROUTE_JOBS = {
    "codegen": ("Code generation (G4)", "Writes the first candidate implementation from the spec.",
                "app/synthesis/layers/build.py — generate"),
    "repair": ("Repair (G6)", "Fixes a candidate from a targeted diagnostic of its failures.",
               "app/synthesis/layers/build.py — repair"),
    "codegen_fresh": ("Fresh restart (G6)",
                      "Starts over with a clean context when the same failure repeats.",
                      "app/synthesis/layers/build.py — fresh"),
    "testplan": ("Test planning (G3)", "Writes realistic extra test inputs for the candidate.",
                 "app/synthesis/layers/planning.py"),
    "arbiter": ("Oracle arbiter (G7)",
                "Independently recomputes an example's expected output to settle a disagreement.",
                "app/synthesis/layers/build.py — arbitration"),
    "runtime_fallback": ("Runtime fallback",
                         "Writes the labelled degraded answer when an agent tool fails.",
                         "app/services/llm_fallback.py"),
}


def _route_defs() -> list[SettingDef]:
    from app.llm.routes import _ROUTES

    defs = []
    for role, route in _ROUTES.items():
        prefix = f"ROUTE_{role.upper()}"
        title, job, where = _ROUTE_JOBS.get(
            role, (role.replace("_", " ").capitalize(), f"Route '{role}'.", f"Route '{role}'"))
        used = (where, "app/llm/client.py — complete", "app/llm/routes.py — route_for")
        impact = ("Agent tool calls (failures)",) if role == "runtime_fallback" else _BUILD
        defs += [
            SettingDef(f"{prefix}_MODEL", "ts_model_routes", "Model", job, type="model",
                       default=route.model, capability="chat", group=title,
                       impact=impact, used_in=used),
            SettingDef(f"{prefix}_EFFORT", "ts_model_routes", "Reasoning effort",
                       "High thinks before answering (slower, better); None answers directly; "
                       "Omit leaves it to the model.", type="enum",
                       options=("high", "none", "omit"), option_labels=_EFFORT_LABELS,
                       default=route.reasoning_effort or "omit", group=title,
                       impact=impact, used_in=used),
            SettingDef(f"{prefix}_TIMEOUT_MS", "ts_model_routes", "Timeout",
                       "Longest one call may take.", type="int", unit="ms",
                       minimum=5000, maximum=1_800_000, default=route.timeout_ms, group=title,
                       impact=impact, used_in=used),
            SettingDef(f"{prefix}_FALLBACK", "ts_model_routes", "Fallback model",
                       "Tried once when the primary model fails; 'none' disables.",
                       type="model", default=route.fallback_model or "none", allow_none=True,
                       capability="chat", group=title, impact=impact, used_in=used),
        ]
    return defs


_store: Optional[SettingsStore] = None


def get_store() -> SettingsStore:
    global _store
    if _store is None:
        path = os.environ.get("RUNTIME_SETTINGS_PATH") or os.path.join("db", "runtime_settings.json")
        _store = SettingsStore(SECTIONS, DEFS + _route_defs(), path, target="tool_service")
    return _store


def apply_overrides(settings_obj: Any) -> None:
    get_store().install(settings_obj)


def override(key: str) -> Optional[str]:
    store = get_store()
    if key not in store.defs or not store.is_overridden(key):
        return None
    value = store.value(key)
    return None if value is None else str(value)
