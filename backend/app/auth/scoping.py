"""
Workspace isolation for the local database.

Tables whose rows belong to one workspace carry a ``workspace_id`` column and
are registered here. Two SQLAlchemy session events then do the rest, for every
session in the process (``app.database``'s and the workflow engine's own):

* ``do_orm_execute`` adds ``workspace_id = <current workspace>`` to every ORM
  SELECT, UPDATE and DELETE on a registered table — including ``Session.get``
  and ``query(...).delete()`` — so a store that knows nothing about workspaces
  still only ever sees its own workspace's rows.
* ``before_flush`` stamps new rows with the current workspace, or with the
  Default workspace when there is none (boot tasks, the worker process — both
  run on the platform key, which is the Default workspace's).

No current workspace (boot, a platform admin, ``context.unscoped()``) means no
filter: system code sees every row. Raw SQL (``text()``) is not filtered, so
the tables that are queried that way are shared by design (knowledge, process
templates) and are not registered.
"""

from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import event, inspect, text
from sqlalchemy.orm import Session, with_loader_criteria

from app.auth.context import current_workspace_id

logger = logging.getLogger(__name__)

_SCOPED: list[type] = []
_installed = False
_default_workspace_id: Optional[str] = None


def register(*models: type) -> None:
    for model in models:
        if model not in _SCOPED:
            if "workspace_id" not in model.__table__.columns:
                raise TypeError(f"{model.__name__} has no workspace_id column")
            _SCOPED.append(model)


def scoped_models() -> list[type]:
    return list(_SCOPED)


def set_default_workspace(workspace_id: Optional[str]) -> None:
    global _default_workspace_id
    _default_workspace_id = workspace_id


def default_workspace_id() -> Optional[str]:
    return _default_workspace_id


def _criteria(state) -> None:
    ws = current_workspace_id()
    if not ws or not _SCOPED:
        return
    if not (state.is_select or state.is_update or state.is_delete):
        return
    if state.is_select and (state.is_column_load or state.is_relationship_load):
        return
    if state.execution_options.get("skip_workspace_scope"):
        return
    state.statement = state.statement.options(*[
        with_loader_criteria(model, lambda cls: cls.workspace_id == ws, include_aliases=True)
        for model in _SCOPED
    ])


def _stamp(session: Session, flush_context, instances) -> None:
    if not _SCOPED:
        return
    ws = current_workspace_id() or _default_workspace_id
    if not ws:
        return
    scoped = tuple(_SCOPED)
    for obj in session.new:
        if isinstance(obj, scoped) and getattr(obj, "workspace_id", None) is None:
            obj.workspace_id = ws


def install() -> None:
    global _installed
    if _installed:
        return
    event.listen(Session, "do_orm_execute", _criteria)
    event.listen(Session, "before_flush", _stamp)
    _installed = True


# ── Migration ───────────────────────────────────────────────────────────────

def ensure_columns(default_workspace: Optional[str]) -> dict[str, int]:
    """Add ``workspace_id`` to registered tables that predate it and give
    every row without one to the Default workspace. Idempotent."""
    summary: dict[str, int] = {}
    seen: set[tuple[int, str]] = set()
    for model in _SCOPED:
        engine = _engine_for(model)
        table = model.__tablename__
        if engine is None or (id(engine), table) in seen:
            continue
        seen.add((id(engine), table))
        try:
            columns = {c["name"] for c in inspect(engine).get_columns(table)}
        except Exception:
            continue  # the table does not exist yet; create_all will make it right
        with engine.begin() as conn:
            if "workspace_id" not in columns:
                conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN workspace_id VARCHAR'))
                conn.execute(text(
                    f'CREATE INDEX IF NOT EXISTS "ix_{table}_workspace_id" ON "{table}" (workspace_id)'))
            if default_workspace:
                result = conn.execute(
                    text(f'UPDATE "{table}" SET workspace_id = :ws WHERE workspace_id IS NULL'),
                    {"ws": default_workspace},
                )
                if result.rowcount:
                    summary[table] = result.rowcount
    return summary


def count_rows(workspace_id: str) -> dict[str, int]:
    """Rows a workspace owns, per table — a workspace with data is not deleted."""
    out: dict[str, int] = {}
    seen: set[tuple[int, str]] = set()
    for model in _SCOPED:
        engine = _engine_for(model)
        table = model.__tablename__
        if engine is None or (id(engine), table) in seen:
            continue
        seen.add((id(engine), table))
        try:
            with engine.connect() as conn:
                n = conn.execute(text(f'SELECT COUNT(*) FROM "{table}" WHERE workspace_id = :ws'),
                                 {"ws": workspace_id}).scalar() or 0
        except Exception:
            n = 0
        if n:
            out[table] = int(n)
    return out


def _engine_for(model):
    from app.database import engine as main_engine

    if model.__module__ == "app.services.workflow_engine.engine":
        from app.services.workflow_engine import engine as wf_engine

        return getattr(wf_engine, "_engine", main_engine)
    return main_engine
