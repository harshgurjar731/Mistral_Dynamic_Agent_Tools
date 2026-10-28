"""
BuildPrerequisitesLayer — settle what the build needs from its user, before
anything is built.

Placed in the workflow pipeline after ExecutionModeLayer (the steps and how each
runs are known; nothing has been created) and in the agent pipeline after
RequirementAnalysisLayer (before CapabilityGapLayer can build a tool). A
standalone tool or activity synthesis runs it on its own, stage "tool", before
the code pipeline (``app.runs.runners.synthesis``); its request is in
``ctx.query`` and its purpose in ``ctx.metadata["purpose"]``.

The outcome is recorded in ``ctx.metadata["build_prerequisites"]``:

    {"items": [PrereqItem…], "reasoning": str, "choice": continue|cancel|stop,
     "asked": bool, "stage": workflow|agent}

and announced as a ``prerequisites`` event for the timeline. A cancel (the
user's) or a stop (the unattended policy) ends the build there, with nothing
created; the runner reports it as cancelled.
"""

from __future__ import annotations

import json
import logging

from app.build_prereqs import analysis, ask, resolve
from app.build_prereqs.models import METADATA_KEY, PrereqItem, summary
from app.core.context import PipelineContext
from app.core.layer import Layer, NextFn

logger = logging.getLogger(__name__)

#: Set when the build stopped here; the runners report the run as cancelled.
STOPPED_KEY = "prerequisites_stopped"


class BuildPrerequisitesLayer(Layer):
    label = "Check what the build needs from you"
    detail = ("Works out which credentials, service URLs and facts this needs, uses what the "
              "vault already holds, and asks you for the rest — before anything is built.")

    def __init__(self, stage: str):
        self.stage = stage                      # workflow | agent | tool
        self.name = f"{stage}_prerequisites"

    def should_run(self, ctx: PipelineContext) -> bool:
        if not self.enabled:
            return False
        if self.stage == "workflow":
            from app.layers.workflow.base import workflow_ready

            return workflow_ready(ctx)
        if self.stage == "tool":
            return True
        return not ctx.agent_id and not ctx.conversation_id

    def _prompt(self, ctx: PipelineContext) -> tuple[str, set[str] | None, str]:
        """``(user prompt, known step ids, what is being built)``."""
        if self.stage == "workflow":
            spec = ctx.workflow_spec
            return (analysis.workflow_user_prompt(spec.goal, spec.capabilities),
                    {c.id for c in spec.capabilities},
                    spec.workflow_name or "this workflow")
        if self.stage == "tool":
            purpose = str(ctx.metadata.get("purpose") or "tool")
            return (analysis.tool_user_prompt(ctx.query, purpose), None,
                    "this activity" if purpose == "activity" else "this tool")
        block = ctx.requirements.as_prompt_block() if ctx.requirements else "(not analysed)"
        return analysis.agent_user_prompt(ctx.query, block), None, "this agent"

    async def process(self, ctx: PipelineContext, next: NextFn) -> PipelineContext:
        from app.config import settings

        if not settings.PREREQ_CHECK_ENABLED:
            ctx.set_layer_summary(self.name, "Switched off in Settings → Vault.")
            return await next(ctx)

        ctx.emit("status", "Working out what this build needs from you…")
        user, known_steps, subject = self._prompt(ctx)
        try:
            items, reasoning = await analysis.analyse(
                ctx.client, user=user, ask_information=bool(settings.PREREQ_ASK_FOR_INFORMATION),
                known_steps=known_steps)
        except Exception as e:  # noqa: BLE001 — a failed check must not block the build
            logger.warning("Build prerequisite analysis failed: %s", e)
            ctx.set_layer_summary(self.name, "Could not be checked — building without the "
                                             "prerequisite check.")
            self._record(ctx, [], f"Check failed: {e}", "continue", asked=False)
            return await next(ctx)

        await resolve.attach_candidates(items)
        await resolve.auto_resolve(
            items, use_vault=bool(settings.VAULT_ENABLED and settings.PREREQ_AUTO_USE_VAULT),
            env_fallback=bool(settings.VAULT_ENV_FALLBACK))

        pending = [i for i in items if not i.settled]
        wants_question = bool(pending) or (bool(items) and settings.PREREQ_ASK_WHEN_SATISFIED)
        choice, asked = "continue", False
        if wants_question and ask.can_ask(ctx):
            asked = True
            choice = await ask.settle_interactively(
                ctx, items, stage=self.stage, subject=subject,
                title=(f"{subject[:1].upper()}{subject[1:]} needs {len(pending)} thing(s) from you "
                       f"before it is built" if pending else
                       f"Confirm what {subject} will use before it is built"))
        elif pending and settings.PREREQ_UNATTENDED_POLICY == "stop":
            choice = "stop"
        else:
            resolve.settle_unattended(items)

        self._record(ctx, items, reasoning, choice, asked=asked)
        if choice in ("cancel", "stop"):
            return await self._stop(ctx, items, choice, next)
        return await next(ctx)

    # ── Outcome ─────────────────────────────────────────────────────────

    def _record(self, ctx: PipelineContext, items: list[PrereqItem], reasoning: str,
                choice: str, *, asked: bool) -> None:
        ctx.metadata[METADATA_KEY] = {"items": [i.as_dict() for i in items],
                                      "reasoning": reasoning, "choice": choice, "asked": asked,
                                      "stage": self.stage}
        counts = summary(items)
        ctx.emit("prerequisites", {"stage": self.stage, "choice": choice, "asked": asked,
                                   "reasoning": reasoning, "counts": counts,
                                   "items": [i.public() for i in items]})
        if not items:
            text = reasoning or "Nothing is needed from you."
        else:
            parts = [f"{n} {label}" for label, n in (
                ("from the vault", counts["vault"]), ("from the environment", counts["environment"]),
                ("answered", counts["answered"]), ("skipped", counts["skipped"]),
                ("to add later", counts["deferred"]), ("unsettled", counts["pending"])) if n]
            text = f"{len(items)} prerequisite(s): " + ", ".join(parts) + "."
        ctx.set_layer_summary(self.name, text)

    async def _stop(self, ctx: PipelineContext, items: list[PrereqItem], choice: str,
                    next: NextFn) -> PipelineContext:
        missing = [i.label for i in items if not i.settled]
        message = ("Stopped before building, at your request — nothing was created."
                   if choice == "cancel" else
                   "Not built: it needs " + "; ".join(missing) + ", and nobody could be asked. "
                   "Add them to the vault (Settings → Vault) and start again, or set 'When nobody "
                   "can be asked' to proceed.")
        ctx.metadata[STOPPED_KEY] = choice
        ctx.emit("status", message)
        if self.stage == "workflow":
            ctx.emit("fatal_error", json.dumps({"error": message, "reason": f"prerequisites_{choice}",
                                                "prerequisites": [i.public() for i in items]}))
            # Not set_error: that announces a failure. Setting the error still
            # stops every later layer (``workflow_ready``).
            ctx.error = message
            return await next(ctx)
        ctx.error = message
        if self.stage == "agent":
            ctx.emit("error", message)
        # The agent layers do not check ctx.error, so the chain ends here; a
        # standalone synthesis reads STOPPED_KEY and builds nothing.
        return ctx
