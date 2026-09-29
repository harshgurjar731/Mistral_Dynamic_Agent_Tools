"""
Registry — persistence, versioning and loading of built tools.

Registration is atomic in the order that matters:

    1. the module is proven to import, in the sandbox (never in-process first)
    2. it is written to a temp file and moved into place with os.replace
    3. the version row is committed
    4. only then, for an approved version, is it loaded and made active

The previous path wrote the file, executed it inside the service process, and
only then touched the database — so a module that failed at import raised out
of a request handler as a 500, after verification had passed.
"""

from __future__ import annotations

import importlib.util
import json
import logging
import os
import tempfile
import threading
from hashlib import sha256
from typing import Callable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import settings
from app.models import ToolRecord
from app.synthesis.sandbox import check_imports
from app.synthesis.spec import SynthesisSpec

logger = logging.getLogger(__name__)

_cache_lock = threading.RLock()
#: (name, version_no) → run callable.
_cache: dict[tuple[str, int], Callable] = {}


class RegistrationError(Exception):
    """The module could not be installed."""


# ── Lookup ────────────────────────────────────────────────────────────────


def parse_ref(ref: str) -> tuple[str, Optional[int]]:
    """``"name@3"`` → ``("name", 3)``; ``"name"`` → ``("name", None)``."""
    if "@" in ref:
        name, _, version = ref.partition("@")
        version = version.lstrip("v")
        if version.isdigit():
            return name, int(version)
    return ref, None


def resolve(db: Session, name: str, version_no: Optional[int] = None) -> Optional[ToolRecord]:
    """The version to run: the pinned one, else the active one.

    Falls back to the newest approved version when no row is flagged active
    (a database written before versioning, mid-backfill).
    """
    query = db.query(ToolRecord).filter(ToolRecord.name == name)
    if version_no is not None:
        return query.filter(ToolRecord.version_no == version_no).first()
    active = query.filter(ToolRecord.is_active.is_(True)).first()
    if active:
        return active
    return (query.filter(ToolRecord.status == "approved")
            .order_by(ToolRecord.version_no.desc()).first()) or query.order_by(
        ToolRecord.version_no.desc()).first()


def find_by_hash(db: Session, content_hash: str) -> Optional[ToolRecord]:
    return db.query(ToolRecord).filter_by(hash=content_hash).first()


def next_version_no(db: Session, name: str) -> int:
    current = db.query(func.max(ToolRecord.version_no)).filter(ToolRecord.name == name).scalar()
    return int(current or 0) + 1


def versions_of(db: Session, name: str) -> list[ToolRecord]:
    return (db.query(ToolRecord).filter(ToolRecord.name == name)
            .order_by(ToolRecord.version_no.desc()).all())


def spec_of(record: ToolRecord) -> SynthesisSpec:
    """The spec a version was built from — reconstructed for legacy rows."""
    if record.spec_json:
        try:
            return SynthesisSpec.from_dict(json.loads(record.spec_json))
        except (ValueError, TypeError):
            logger.warning("Unreadable spec_json on tool %s", record.id)
    try:
        fn = json.loads(record.schema_json).get("function", {})
    except ValueError:
        fn = {}
    output_schema = None
    if record.output_schema_json:
        try:
            output_schema = json.loads(record.output_schema_json)
        except ValueError:
            pass
    return SynthesisSpec.from_request(
        name=record.name,
        description=fn.get("description", record.name),
        parameters=fn.get("parameters", {}),
        purpose=record.purpose or "tool",
        kind=record.kind or "pure",
        output_schema=output_schema,
        side_effects=record.side_effects or "none",
        origin="legacy",
    )


def input_schema_of(record: ToolRecord) -> dict:
    try:
        return json.loads(record.schema_json).get("function", {}).get("parameters", {}) or {}
    except (ValueError, AttributeError):
        return {}


def output_schema_of(record: ToolRecord) -> Optional[dict]:
    if not record.output_schema_json:
        return None
    try:
        return json.loads(record.output_schema_json)
    except ValueError:
        return None


# ── Writing ───────────────────────────────────────────────────────────────


def version_hash(spec_hash: str, code: str) -> str:
    """Unique row identity: the spec plus the exact code that implements it."""
    return sha256(f"{spec_hash}:{code}".encode()).hexdigest()


def write_module(code: str, name: str, version_no: int, content_hash: str) -> str:
    """Prove the module imports, then move it into place atomically."""
    problem = check_imports(code)
    if problem:
        raise RegistrationError(f"module failed to import in the sandbox: {problem}")

    directory = settings.DYNAMIC_TOOLS_DIR
    os.makedirs(directory, exist_ok=True)
    module_path = os.path.join(directory, f"{name}_v{version_no}_{content_hash[:8]}.py")
    fd, tmp = tempfile.mkstemp(dir=directory, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(code)
        os.replace(tmp, module_path)
    except OSError as e:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise RegistrationError(f"could not write module: {e}") from e
    return module_path.replace("\\", "/")


def create_version(
    db: Session,
    *,
    spec: SynthesisSpec,
    code: str,
    status: str,
    report: dict,
    test_plan: Optional[dict],
    review_required: bool = False,
    spec_hash: Optional[str] = None,
    version_label: str = "1.0.0",
    row_hash: Optional[str] = None,
    version_no: Optional[int] = None,
) -> ToolRecord:
    """Insert a new version row (and write its module when approved).

    ``row_hash`` overrides the computed identity — used by imports, which must
    keep the source instance's hash so a re-import is recognised.
    """
    spec_hash = spec_hash or spec.content_hash()
    row_hash = row_hash or version_hash(spec_hash, code)
    existing = find_by_hash(db, row_hash)
    if existing:
        return existing

    taken = {v.version_no for v in versions_of(db, spec.name)}
    if version_no is None or version_no in taken:
        version_no = next_version_no(db, spec.name)
    module_path = write_module(code, spec.name, version_no, row_hash) if status == "approved" else None

    record = ToolRecord(
        name=spec.name,
        hash=row_hash,
        version=version_label,
        version_no=version_no,
        schema_json=json.dumps(spec.tool_schema()),
        output_schema_json=json.dumps(spec.output_schema) if spec.output_schema else None,
        source_code=code,
        module_path=module_path,
        status=status,
        sandbox_output=report.get("history", ""),
        purpose=spec.purpose,
        kind=spec.kind,
        side_effects=spec.side_effects,
        spec_json=json.dumps(spec.to_dict(), default=str),
        test_plan_json=json.dumps(test_plan) if test_plan else None,
        report_json=json.dumps(report, default=str),
        review_required=review_required,
        is_active=False,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    if status == "approved":
        activate(db, record)
    return record


def approve(db: Session, record: ToolRecord) -> ToolRecord:
    """Approve a pending version: install its module and make it active."""
    if not record.module_path or not os.path.exists(record.module_path):
        record.module_path = write_module(record.source_code, record.name,
                                          record.version_no or 1, record.hash)
    record.status = "approved"
    db.commit()
    activate(db, record)
    return record


def activate(db: Session, record: ToolRecord) -> None:
    """Make ``record`` the version that runs by default, and load it."""
    if record.status != "approved":
        raise RegistrationError(f"version {record.version_no} of '{record.name}' is "
                                f"'{record.status}', not approved")
    (db.query(ToolRecord)
       .filter(ToolRecord.name == record.name, ToolRecord.id != record.id)
       .update({ToolRecord.is_active: False}, synchronize_session=False))
    record.is_active = True
    db.commit()
    try:
        load(record, force=True)
    except Exception as e:  # noqa: BLE001 — loading is retried lazily on first call
        logger.warning("Activated '%s' v%s but could not preload it: %s",
                       record.name, record.version_no, e)


# ── Loading ───────────────────────────────────────────────────────────────


def load(record: ToolRecord, *, force: bool = False) -> Callable:
    """The ``run`` callable for a version, cached by (name, version)."""
    key = (record.name, int(record.version_no or 1))
    with _cache_lock:
        if not force and key in _cache:
            return _cache[key]
        if not record.module_path or not os.path.exists(record.module_path):
            if record.status == "approved" and record.source_code:
                record.module_path = write_module(record.source_code, record.name,
                                                  key[1], record.hash)
            else:
                raise RegistrationError(f"'{record.name}' v{key[1]} has no module on disk")
        module_name = f"dyn_{record.name}_v{key[1]}"
        spec = importlib.util.spec_from_file_location(module_name, record.module_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        run = getattr(module, "run", None)
        if not callable(run):
            raise RegistrationError(f"'{record.name}' has no callable `run`")
        _cache[key] = run
        return run


def evict(name: str, version_no: Optional[int] = None) -> None:
    with _cache_lock:
        for key in [k for k in _cache if k[0] == name and (version_no is None or k[1] == version_no)]:
            del _cache[key]


def delete_name(db: Session, name: str) -> int:
    """Remove every version of ``name`` from disk, cache and database."""
    removed = 0
    for record in versions_of(db, name):
        if record.module_path and os.path.exists(record.module_path):
            try:
                os.remove(record.module_path)
            except OSError as e:
                logger.warning("Could not delete %s: %s", record.module_path, e)
        db.delete(record)
        removed += 1
    db.commit()
    evict(name)
    return removed


def warm(db: Session) -> int:
    """Load every active version at startup."""
    loaded = 0
    for record in db.query(ToolRecord).filter(ToolRecord.is_active.is_(True)).all():
        try:
            load(record)
            loaded += 1
        except Exception as e:  # noqa: BLE001
            logger.warning("Could not load '%s' v%s: %s", record.name, record.version_no, e)
    return loaded
