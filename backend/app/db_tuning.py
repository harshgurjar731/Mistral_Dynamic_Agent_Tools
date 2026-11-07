"""
Engine settings for the backend's database, shared by every engine on it.

SQLite allows one writer at a time. Out of the box it also makes readers wait
for writers (rollback journal), fails a waiting writer after 5 s ("database is
locked") and fsyncs on every commit. With many users and background runs that
turns into queued page loads and spurious errors, so every connection gets:

* ``journal_mode=WAL`` — readers never block on, or block, the writer;
* ``busy_timeout=30000`` — a writer waits its turn instead of failing;
* ``synchronous=NORMAL`` — safe with WAL (no corruption on a crash; at most the
  last transactions before a power cut are lost), far fewer fsyncs;
* a larger in-memory page cache and memory for temporary tables.

The pool is sized for the I/O thread count (app.core.runtime), so threads do
not queue for a connection. Other databases get pre-ping and the same pool.
"""

from __future__ import annotations

import logging

from sqlalchemy import event

logger = logging.getLogger(__name__)


def engine_kwargs(url: str) -> dict:
    if url.startswith("sqlite"):
        return {
            "connect_args": {"check_same_thread": False, "timeout": 30},
            "pool_size": 20,
            "max_overflow": 60,
            "pool_timeout": 60,
        }
    return {"pool_pre_ping": True, "pool_size": 20, "max_overflow": 40}


def _sqlite_pragmas(dbapi_conn, _record) -> None:
    cur = dbapi_conn.cursor()
    try:
        for pragma in ("journal_mode=WAL", "synchronous=NORMAL", "busy_timeout=30000",
                       "temp_store=MEMORY", "cache_size=-16000"):
            try:
                cur.execute(f"PRAGMA {pragma}")
            except Exception as e:  # noqa: BLE001 — e.g. a read-only or network filesystem
                logger.debug("PRAGMA %s not applied: %s", pragma, e)
    finally:
        cur.close()


def tune(engine) -> None:
    if engine is not None and engine.dialect.name == "sqlite":
        event.listen(engine, "connect", _sqlite_pragmas)
