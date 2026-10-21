"""
The Tool Service's settings as the backend's Settings page shows them.

Values are persisted to ``db/runtime_settings.json`` (the ``tool-db`` volume),
so a change survives a container rebuild. ``used_in`` says where each value is
read — keep it current.
"""

from __future__ import annotations

import os
from typing import Any, Optional

from app.runtime_config import Section, SettingDef, SettingsStore

SECTIONS = [
    Section("ts_model_routes", "Tool Service model routes",
            "Which model writes, repairs and checks synthesised tools and activities "
            "(tool-service/app/llm/routes.py).", "route"),
    Section("ts_synthesis", "Tool synthesis",
            "Attempts, budgets and verification for building tools and activities.", "wrench"),
    Section("ts_runtime", "Tool runtime & sandbox", "How generated code is executed.", "box"),
]

DEFS: list[SettingDef] = [
    # ── Synthesis ──────────────────────────────────────────────────────
    SettingDef("TOOL_MODEL_MAX_ATTEMPTS", "ts_synthesis", "Model call attempts",
               "Transport retries per model call before the route's fallback model.",
               type="int", minimum=1, maximum=10, used_in=("app/llm/client.py",)),
    SettingDef("TOOL_SYNTHESIS_MAX_ATTEMPTS", "ts_synthesis", "Generate / repair passes",
               "Build attempts per synthesis job.", type="int", minimum=1, maximum=20,
               used_in=("app/synthesis/layers/build.py",)),
    SettingDef("SYNTHESIS_WALL_CLOCK_SECONDS", "ts_synthesis", "Job time budget (s)",
               "Hard wall-clock limit per job across all attempts.", type="int",
               minimum=60, maximum=7200, used_in=("app/synthesis/pipeline.py",)),
    SettingDef("SYNTHESIS_WORKERS", "ts_synthesis", "Concurrent synthesis jobs",
               "Each holds a model call and a sandbox process.", type="int", minimum=1,
               maximum=16, apply="restart", used_in=("app/synthesis/jobs.py",)),
    SettingDef("SYNTHESIZE_WAIT_SECONDS", "ts_synthesis", "Blocking /synthesize wait (s)",
               "How long the legacy endpoint waits before answering with a job id.",
               type="int", minimum=1, maximum=170, used_in=("app/routes/synthesis.py",)),
    SettingDef("STRICT_ACTIVITY_SPEC", "ts_synthesis", "Strict activity specs",
               "Activities must carry an output schema and worked examples.", type="bool",
               used_in=("app/synthesis/layers/intake.py",)),
    SettingDef("ORACLE_ARBITRATION", "ts_synthesis", "Oracle arbitration",
               "When an activity disagrees with its own example, write an independent "
               "reference implementation to decide which is wrong.", type="bool",
               used_in=("app/synthesis/layers/build.py",)),
    SettingDef("ORACLE_AUTOCORRECT", "ts_synthesis", "Oracle auto-correct",
               "When the reference and the code agree against an example, correct the example.",
               type="bool", used_in=("app/synthesis/layers/build.py",)),
    SettingDef("AUTO_APPROVE_DYNAMIC_TOOLS", "ts_synthesis", "Auto-approve new tools",
               "Activate synthesised tools without manual approval.", type="bool",
               used_in=("app/synthesis/layers/finalize.py",)),

    # ── Runtime ────────────────────────────────────────────────────────
    SettingDef("TOOL_RUNTIME_FALLBACK", "ts_runtime", "LLM fallback for failed tools",
               "A labelled, model-written degraded answer when an agent tool fails. Never "
               "applies to activities.", type="bool",
               used_in=("app/synthesis/profiles/tool.py", "app/services/llm_fallback.py")),
    SettingDef("SECRETS_ALLOWLIST", "ts_runtime", "Secrets allow-list",
               "Comma-separated environment variables a tool may receive.", type="string",
               used_in=("app/services/execution_service.py", "app/routes/management.py")),
    SettingDef("SANDBOX_TIMEOUT_SECONDS", "ts_runtime", "Sandbox timeout (s)", "",
               type="int", minimum=1, maximum=600, used_in=("app/synthesis/sandbox.py",)),
    SettingDef("SANDBOX_MEMORY_MB", "ts_runtime", "Sandbox memory (MB)", "",
               type="int", minimum=64, maximum=8192, used_in=("app/synthesis/sandbox.py",)),
    SettingDef("SANDBOX_USER", "ts_runtime", "Sandbox user", "Unprivileged user code runs as.",
               type="string", apply="restart", editable=False,
               used_in=("app/synthesis/sandbox.py",)),
    SettingDef("DYNAMIC_TOOLS_DIR", "ts_runtime", "Dynamic tools directory", "",
               type="string", apply="restart", editable=False,
               used_in=("app/synthesis/registry.py",)),
    SettingDef("DATABASE_URL", "ts_runtime", "Database URL", "Set in tool-service/.env.",
               type="string", apply="restart", editable=False, used_in=("app/database.py",)),
    SettingDef("MISTRAL_API_KEY", "ts_runtime", "Mistral API key", "Set in tool-service/.env.",
               type="secret", apply="restart", editable=False,
               used_in=("app/llm/client.py", "app/services/mcp_publisher.py")),
]

_ROUTE_USE = {
    "codegen": "G4 first generation — app/synthesis/layers/build.py",
    "repair": "G6 repair from a diagnostic — app/synthesis/layers/build.py",
    "codegen_fresh": "G6 fresh restart — app/synthesis/layers/build.py",
    "testplan": "G3 extra test inputs — app/synthesis/layers/planning.py",
    "arbiter": "G7 oracle recomputation — app/synthesis/layers/build.py",
    "runtime_fallback": "Degraded answer for a failed tool — app/services/llm_fallback.py",
}


def _route_defs() -> list[SettingDef]:
    from app.llm.routes import _ROUTES

    defs = []
    for role, route in _ROUTES.items():
        prefix = f"ROUTE_{role.upper()}"
        group = role.replace("_", " ").capitalize()
        where = (_ROUTE_USE.get(role, f"Route '{role}'"), "app/llm/client.py")
        defs += [
            SettingDef(f"{prefix}_MODEL", "ts_model_routes", "Model", "", type="model",
                       default=route.model, capability="chat", group=group, used_in=where),
            SettingDef(f"{prefix}_EFFORT", "ts_model_routes", "Reasoning effort",
                       "high | none | omit (do not send).", type="enum",
                       options=("high", "none", "omit"),
                       default=route.reasoning_effort or "omit", group=group, used_in=where),
            SettingDef(f"{prefix}_TIMEOUT_MS", "ts_model_routes", "Timeout (ms)", "", type="int",
                       minimum=5000, maximum=1_800_000, default=route.timeout_ms, group=group,
                       used_in=where),
            SettingDef(f"{prefix}_FALLBACK", "ts_model_routes", "Fallback model",
                       "Tried once when the primary fails; 'none' disables.", type="model",
                       default=route.fallback_model or "none", allow_none=True,
                       capability="chat", group=group, used_in=where),
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
