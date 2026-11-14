"""
What can be granted, the built-in roles, and which API routes need what.

Permissions are workspace-level: a user holds them through their role in the
workspace they are working in. Platform administration (workspaces, users,
roles, Settings, the vault master key, cleanup) is not a permission at all —
only a platform admin, signed in on the admin portal, can do it.

The route policy is **deny by default**: an ``/api`` route with no rule here
answers 403, and ``tests/test_auth_policy.py`` fails for any route that lacks
one, so a new endpoint cannot ship open by accident.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class Permission:
    key: str
    group: str
    label: str
    description: str
    #: The data it governs is shared by every workspace, so a change made with
    #: it is seen by all of them. Shown as a warning in the role editor.
    shared: bool = False


PERMISSIONS: list[Permission] = [
    # Design and chat
    Permission("orchestrator.use", "Design", "Use the orchestrator",
               "Describe a goal and let the orchestrator design, create and run a new agent."),
    Permission("chat.use", "Design", "Use chat and the playground",
               "Talk to existing agents and models; see and delete their own conversations."),
    # Agents and tools
    Permission("agents.view", "Agents", "View agents", "See agents and their configuration."),
    Permission("agents.manage", "Agents", "Manage agents",
               "Create, edit, classify and delete agents."),
    Permission("tools.view", "Tools", "View tools", "See dynamic tools and their code."),
    Permission("tools.manage", "Tools", "Manage tools",
               "Synthesize, test, approve, edit and delete dynamic tools."),
    # Workflows
    Permission("workflows.view", "Workflows", "View workflows",
               "See workflows, activities, versions and executions."),
    Permission("workflows.run", "Workflows", "Run workflows",
               "Start, signal, cancel and terminate workflow executions."),
    Permission("workflows.manage", "Workflows", "Build workflows",
               "Plan, create, edit, revise, archive and delete workflows."),
    Permission("workflows.deploy", "Workflows", "Publish and deploy workflows",
               "Publish workflows to Mistral, export and package them."),
    # Integrations
    Permission("connectors.view", "Integrations", "View connectors and MCP servers",
               "See connectors, MCP servers and their tools."),
    Permission("connectors.manage", "Integrations", "Manage connectors and MCP servers",
               "Register, configure, authorize and call connectors and MCP servers."),
    Permission("remote_servers.view", "Integrations", "View remote servers",
               "See remote servers, provider accounts and deployments."),
    Permission("remote_servers.manage", "Integrations", "Manage remote servers",
               "Add servers, run commands on them and deploy tools and workflows to them."),
    # Knowledge
    Permission("knowledge.view", "Knowledge", "View knowledge and libraries",
               "Browse and search knowledge, libraries and the knowledge graph."),
    Permission("knowledge.manage", "Knowledge", "Manage knowledge and libraries",
               "Add and edit knowledge sources, guidance, libraries and their documents."),
    Permission("catalog.view", "Knowledge", "View catalog and processes",
               "See the industry/domain catalog, processes and process templates.", shared=True),
    Permission("catalog.manage", "Knowledge", "Manage catalog and processes",
               "Edit the catalog, processes and process templates. These are shared by every "
               "workspace.", shared=True),
    # Governance
    Permission("rules.view", "Governance", "View rules", "See rules, gates and tool safety rules.",
               shared=True),
    Permission("rules.manage", "Governance", "Manage rules",
               "Create, edit and delete rules, gates and tool safety rules. Rules are shared by "
               "every workspace.", shared=True),
    Permission("reviews.view", "Governance", "View human reviews",
               "See workflow steps waiting for a person."),
    Permission("reviews.decide", "Governance", "Decide human reviews",
               "Approve, correct or reject a workflow step waiting for review."),
    Permission("logs.view", "Governance", "View logs and traces",
               "Read this workspace's traces, execution logs and rule verdicts."),
    # Secrets
    Permission("vault.view", "Vault", "View vault entries",
               "See which credentials exist (never their values)."),
    Permission("vault.manage", "Vault", "Manage vault entries",
               "Add, change, roll back and delete credentials."),
    Permission("vault.reveal", "Vault", "Reveal vault values",
               "Show a stored credential's value. Grant sparingly."),
    # Settings
    Permission("settings.view", "Settings", "View settings",
               "Open the Settings page read-only. Changing settings is for platform admins.",
               shared=True),
]

PERMISSION_KEYS: frozenset[str] = frozenset(p.key for p in PERMISSIONS)
BY_KEY: dict[str, Permission] = {p.key: p for p in PERMISSIONS}

_VIEW = {p.key for p in PERMISSIONS if p.key.endswith(".view")}


@dataclass(frozen=True)
class SystemRole:
    key: str
    name: str
    description: str
    permissions: frozenset[str]


SYSTEM_ROLES: list[SystemRole] = [
    SystemRole(
        "maintainer", "Maintainer",
        "Full control inside the workspace: everything a Builder can do, plus deploying, "
        "remote servers, rules, the catalog and revealing vault values.",
        PERMISSION_KEYS,
    ),
    SystemRole(
        "builder", "Builder",
        "Designs and builds: agents, tools, workflows, connectors, knowledge and vault "
        "entries. Cannot deploy, change shared rules or the catalog, or reveal secrets.",
        frozenset(_VIEW | {
            "orchestrator.use", "chat.use", "agents.manage", "tools.manage",
            "workflows.run", "workflows.manage", "connectors.manage",
            "knowledge.manage", "vault.manage",
        }),
    ),
    SystemRole(
        "operator", "Operator",
        "Uses what others built: chats with agents and runs workflows. Read-only elsewhere.",
        frozenset(_VIEW | {"chat.use", "workflows.run"}),
    ),
    SystemRole(
        "reviewer", "Reviewer",
        "Decides human-review steps and reads logs. Read-only elsewhere.",
        frozenset(_VIEW | {"reviews.decide"}),
    ),
    SystemRole(
        "viewer", "Viewer",
        "Read-only access to everything in the workspace.",
        frozenset(_VIEW),
    ),
]

SYSTEM_ROLE_KEYS = {r.key for r in SYSTEM_ROLES}


def clean_permissions(values) -> list[str]:
    """Known permission keys only, sorted, without duplicates."""
    return sorted({str(v) for v in (values or []) if str(v) in PERMISSION_KEYS})


# ── Route policy ────────────────────────────────────────────────────────────

PUBLIC = "public"      # no session needed
USER = "user"          # any signed-in user
ANY = "any"            # a signed-in user or admin
ADMIN = "admin"        # a platform admin
SELF = "self"          # the route authenticates its own callers (/api/auth/*)


@dataclass(frozen=True)
class Rule:
    methods: frozenset[str]
    pattern: re.Pattern
    #: PUBLIC | USER | ANY | ADMIN | SELF, or "perm" (then ``perms``).
    access: str
    #: Any one of these is enough.
    perms: tuple[str, ...] = ()
    #: For ``perm`` rules: a platform admin may also call it.
    admin_ok: bool = False


def _r(methods: str, pattern: str, access: str = "perm", *perms: str, admin_ok: bool = False) -> Rule:
    ms = frozenset({"GET", "POST", "PUT", "PATCH", "DELETE"} if methods == "*"
                   else methods.split("|"))
    return Rule(ms, re.compile(f"^{pattern}$"), access, tuple(perms), admin_ok)


W = "*"
WRITE = "POST|PUT|PATCH|DELETE"

#: First match wins. Paths are matched without the ``/api`` prefix.
RULES: list[Rule] = [
    # Accounts
    _r(W, r"/auth/.*", SELF),
    _r("POST", r"/admin/auth/login", PUBLIC),
    _r(W, r"/admin/.*", ADMIN),

    # Settings — platform-wide, so changing them is for platform admins
    _r("GET", r"/settings/public", PUBLIC),
    _r("GET", r"/settings/models/catalog", ANY),
    _r("GET", r"/settings", "perm", "settings.view", admin_ok=True),
    _r(W, r"/settings(/.*)?", ADMIN),

    # Is the platform live (plain language, the caller's workspace)
    _r("GET", r"/status", ANY),

    # Live progress of the caller's own requests
    _r("GET", r"/ops/[^/]+/events", ANY),

    # Design and chat
    # With an agent_id this is a chat with that agent; without one it designs a
    # new agent, which the route itself also requires orchestrator.use for.
    _r("POST", r"/orchestrate(/stream)?", "perm", "orchestrator.use", "chat.use"),
    _r("POST", r"/chat/(completions|stream)", "perm", "chat.use", "orchestrator.use"),
    _r("GET|DELETE", r"/conversations(/.*)?", "perm", "chat.use", "orchestrator.use"),
    _r("POST", r"/uploads/image", "perm", "chat.use", "orchestrator.use"),

    # Background runs
    _r("POST", r"/runs/agent", "perm", "orchestrator.use"),
    _r("POST", r"/runs/workflow-plan", "perm", "workflows.manage"),
    _r("POST", r"/runs/workflow-refine", "perm", "workflows.manage"),
    _r("POST", r"/runs/rebuild", "perm", "workflows.manage", "tools.manage"),
    _r("POST", r"/runs/synthesis", "perm", "tools.manage"),
    _r("GET", r"/runs(/[^/]+(/events)?)?", USER),
    _r("POST", r"/runs/[^/]+/(cancel|decisions/[^/]+)", USER),

    # Agents
    _r("GET", r"/agents(/[^/]+)?", "perm", "agents.view"),
    _r(WRITE, r"/agents(/[^/]+)?", "perm", "agents.manage"),

    # Tools and MCP
    _r("GET", r"/tools(/.*)?", "perm", "tools.view"),
    _r(WRITE, r"/tools(/.*)?", "perm", "tools.manage"),
    _r("GET", r"/mcp/.*", "perm", "connectors.view"),
    _r(WRITE, r"/mcp/.*", "perm", "connectors.manage"),

    # Connectors
    _r("GET", r"/connectors(/.*)?", "perm", "connectors.view"),
    _r(WRITE, r"/connectors(/.*)?", "perm", "connectors.manage"),

    # Workflow executions (before /workflows/{name})
    _r("GET", r"/workflows/executions(/.*)?", "perm", "workflows.view"),
    _r("POST", r"/workflows/executions(/.*)?", "perm", "workflows.run"),
    # Workflows
    _r("POST", r"/workflows/[^/]+/execute", "perm", "workflows.run"),
    _r("POST|DELETE", r"/workflows/[^/]+/inputs/.*", "perm", "workflows.run"),
    _r("POST", r"/workflows/[^/]+/(publish|register|export)", "perm", "workflows.deploy"),
    _r(W, r"/workflows/[^/]+/deployment/.*", "perm", "workflows.deploy"),
    _r("GET", r"/workflows(/.*)?", "perm", "workflows.view"),
    _r(WRITE, r"/workflows(/.*)?", "perm", "workflows.manage"),

    # Catalog (ontology). Tagging an agent, tool or workflow is part of building it.
    _r(WRITE, r"/ontology/(annotations(/.*)?|classify)", "perm",
       "agents.manage", "tools.manage", "workflows.manage", "catalog.manage"),
    _r("GET", r"/ontology(/.*)?", "perm", "catalog.view"),
    _r(WRITE, r"/ontology(/.*)?", "perm", "catalog.manage"),

    # Processes
    _r("POST", r"/processes/recommendations/.*", "perm", "knowledge.manage"),
    _r("POST", r"/processes/(validate|templates/preview)", "perm", "catalog.view"),
    _r("GET", r"/processes(/.*)?", "perm", "catalog.view"),
    _r(WRITE, r"/processes(/.*)?", "perm", "catalog.manage"),

    # Knowledge, libraries and graph RAG
    _r("POST", r"/knowledge/retrieve", "perm", "knowledge.view"),
    _r("GET", r"/knowledge(/.*)?", "perm", "knowledge.view"),
    _r(WRITE, r"/knowledge(/.*)?", "perm", "knowledge.manage"),
    _r("POST", r"/rag/(search|graph/query|optimizer/preview)", "perm", "knowledge.view"),
    _r("GET", r"/rag(/.*)?", "perm", "knowledge.view"),
    _r(WRITE, r"/rag(/.*)?", "perm", "knowledge.manage"),
    _r("GET", r"/libraries(/.*)?", "perm", "knowledge.view"),
    _r(WRITE, r"/libraries(/.*)?", "perm", "knowledge.manage"),

    # Rules and tool safety
    _r("PUT", r"/rules/agents/[^/]+", "perm", "rules.manage", "agents.manage"),
    _r("POST", r"/rules/suggest", "perm", "rules.manage", "agents.manage", "workflows.manage"),
    _r("GET", r"/rules(/.*)?", "perm", "rules.view"),
    _r(WRITE, r"/rules(/.*)?", "perm", "rules.manage"),
    _r("GET", r"/safety-rules(/.*)?", "perm", "rules.view"),
    _r(WRITE, r"/safety-rules(/.*)?", "perm", "rules.manage"),

    # Human reviews
    _r("GET", r"/reviews(/[^/]+)?", "perm", "reviews.view"),
    _r("POST", r"/reviews/[^/]+/decision", "perm", "reviews.decide"),

    # Logs
    _r("GET", r"/observability(/.*)?", "perm", "logs.view"),

    # Remote servers
    _r("GET", r"/remote-servers(/.*)?", "perm", "remote_servers.view"),
    _r(WRITE, r"/remote-servers(/.*)?", "perm", "remote_servers.manage"),

    # Vault. The master key is the platform's, not a workspace's.
    _r("POST", r"/vault/(rotate-key|generate-key)", ADMIN),
    _r("POST", r"/vault/secrets/[^/]+/reveal", "perm", "vault.reveal"),
    _r("GET", r"/vault(/.*)?", "perm", "vault.view", "vault.manage", "workflows.manage",
       "tools.manage"),
    _r(WRITE, r"/vault(/.*)?", "perm", "vault.manage"),
]


def export_rules() -> list[dict]:
    """The route policy for the browser, which hides what the caller can't do.

    Same rules, same order, same first-match semantics; the patterns use only
    syntax JavaScript's RegExp reads the same way. The server still decides.
    """
    return [{"methods": sorted(r.methods), "pattern": r.pattern.pattern, "access": r.access,
             "perms": list(r.perms), "admin_ok": r.admin_ok} for r in RULES]


def match(method: str, path: str) -> Optional[Rule]:
    """The rule for an ``/api``-relative path, or None (deny)."""
    method = method.upper()
    for rule in RULES:
        if method in rule.methods and rule.pattern.match(path):
            return rule
    return None
