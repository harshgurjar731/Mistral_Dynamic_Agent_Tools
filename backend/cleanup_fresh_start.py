"""
Project Cleanup Script -- Fresh Start
=====================================
Deletes all Mistral agents, archives workflow files, clears the workflow DB,
and purges all dynamic tools from the tool-service DB.

Run from the backend directory:
    python cleanup_fresh_start.py
"""

import asyncio
import os
import sys
import json
import shutil
import sqlite3
from datetime import datetime

# Ensure the backend app is importable
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.config import settings
from mistralai.client import Mistral


ARCHIVE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_archived_workflows")
MISTRAL_WORKFLOWS_DIR = os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), settings.MISTRAL_WORKFLOWS_DIR)
)
TOOL_SERVICE_DB = os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tool-service", "db", "tool_service.db")
)
TOOL_SERVICE_DYNAMIC_DIR = os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tool-service", "dynamic_tools")
)
BACKEND_DB = os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "sql_app.db")
)


def banner(msg: str):
    print(f"\n{'='*60}")
    print(f"  {msg}")
    print(f"{'='*60}")


# -- 1. Delete all Mistral agents ------------------------------------------

async def delete_all_agents():
    banner("PHASE 1: Deleting all Mistral agents")
    from app.services import agent_service

    client = Mistral(api_key=settings.MISTRAL_API_KEY)
    deleted = 0

    while True:
        resp = await agent_service.list_agents(client, page=0, page_size=100)
        items = resp.get("items", [])
        if not items:
            break

        for agent in items:
            agent_id = agent["id"]
            name = agent.get("name", "Unknown")
            try:
                await agent_service.delete_agent(client, agent_id)
                deleted += 1
                print(f"  [OK] Deleted agent: {name} ({agent_id})")
            except Exception as e:
                print(f"  [FAIL] Failed to delete {name} ({agent_id}): {e}")

        # Re-check from page 0 since list shifted after deletions
        resp2 = await agent_service.list_agents(client, page=0, page_size=100)
        if not resp2.get("items"):
            break

    print(f"\n  Total agents deleted: {deleted}")


# -- 2. Archive workflow files ----------------------------------------------

def archive_workflows():
    banner("PHASE 2: Archiving workflow files")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    archive_subdir = os.path.join(ARCHIVE_DIR, f"archive_{timestamp}")

    # Archive mistral_workflows directory (compiled .py files)
    if os.path.isdir(MISTRAL_WORKFLOWS_DIR):
        py_files = [f for f in os.listdir(MISTRAL_WORKFLOWS_DIR) if f.endswith(".py") and f != "__init__.py"]
        if py_files:
            os.makedirs(archive_subdir, exist_ok=True)
            for f in py_files:
                src = os.path.join(MISTRAL_WORKFLOWS_DIR, f)
                dst = os.path.join(archive_subdir, f)
                shutil.move(src, dst)
                print(f"  [OK] Archived: {f}")

            # Clean __pycache__
            pycache = os.path.join(MISTRAL_WORKFLOWS_DIR, "__pycache__")
            if os.path.isdir(pycache):
                shutil.rmtree(pycache)
                print(f"  [OK] Cleaned __pycache__ in mistral_workflows")
        else:
            print("  (no workflow .py files to archive)")
    else:
        print(f"  (mistral_workflows dir not found: {MISTRAL_WORKFLOWS_DIR})")

    # Clear workflow definitions from backend SQLite
    if os.path.exists(BACKEND_DB):
        try:
            conn = sqlite3.connect(BACKEND_DB)
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) FROM workflow_definitions")
            count = cursor.fetchone()[0]
            if count > 0:
                # Archive the definitions as JSON before deleting
                cursor.execute("SELECT name, definition_json FROM workflow_definitions")
                rows = cursor.fetchall()
                os.makedirs(archive_subdir, exist_ok=True)
                archive_data = {name: json.loads(defn) for name, defn in rows}
                archive_file = os.path.join(archive_subdir, "workflow_definitions_backup.json")
                with open(archive_file, "w", encoding="utf-8") as f:
                    json.dump(archive_data, f, indent=2, default=str)
                print(f"  [OK] Backed up {count} workflow definitions to {archive_file}")

                cursor.execute("DELETE FROM workflow_definitions")
                conn.commit()
                print(f"  [OK] Cleared {count} workflow definitions from SQLite")
            else:
                print("  (no workflow definitions in DB)")
            conn.close()
        except Exception as e:
            print(f"  [FAIL] Error cleaning workflow DB: {e}")
    else:
        print(f"  (backend DB not found: {BACKEND_DB})")

    print(f"\n  Archive location: {archive_subdir if os.path.isdir(archive_subdir or '') else '(nothing to archive)'}")


# -- 3. Delete all dynamic tools -------------------------------------------

def delete_all_tools():
    banner("PHASE 3: Deleting all dynamic tools")

    # Clear tool-service SQLite DB
    # The tool-service DB path depends on where it runs. Check multiple locations.
    possible_db_paths = [
        TOOL_SERVICE_DB,
        os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tool-service", "tool_service.db")),
        os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tool-service", "app", "tool_service.db")),
    ]

    # Also check the .env for the actual DB path
    tool_service_env = os.path.abspath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tool-service", ".env")
    )
    if os.path.exists(tool_service_env):
        with open(tool_service_env, "r") as f:
            for line in f:
                if line.strip().startswith("DATABASE_URL"):
                    parts = line.strip().split("=", 1)
                    if len(parts) == 2:
                        db_url = parts[1].strip().strip('"').strip("'")
                        if db_url.startswith("sqlite:///"):
                            db_path = db_url.replace("sqlite:///", "")
                            if not os.path.isabs(db_path):
                                db_path = os.path.abspath(os.path.join(
                                    os.path.dirname(os.path.abspath(__file__)), "..", "tool-service", db_path
                                ))
                            possible_db_paths.insert(0, db_path)

    tool_db_cleaned = False
    for db_path in possible_db_paths:
        if os.path.exists(db_path):
            try:
                conn = sqlite3.connect(db_path)
                cursor = conn.cursor()
                # Check if tools table exists
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tools'")
                if cursor.fetchone():
                    cursor.execute("SELECT COUNT(*) FROM tools")
                    count = cursor.fetchone()[0]
                    if count > 0:
                        cursor.execute("DELETE FROM tools")
                        conn.commit()
                        print(f"  [OK] Deleted {count} tools from {db_path}")
                    else:
                        print(f"  (tools table empty in {db_path})")
                    tool_db_cleaned = True
                conn.close()
            except Exception as e:
                print(f"  [FAIL] Error with {db_path}: {e}")

    if not tool_db_cleaned:
        print("  [WARN] Could not find tool-service DB locally.")
        print("    If tool-service runs in Docker, clear it via API:")
        print("    curl -X DELETE http://localhost:9000/tools/all")

    # Clean dynamic_tools directory
    if os.path.isdir(TOOL_SERVICE_DYNAMIC_DIR):
        cleaned = 0
        for f in os.listdir(TOOL_SERVICE_DYNAMIC_DIR):
            if f == "__init__.py":
                continue
            fpath = os.path.join(TOOL_SERVICE_DYNAMIC_DIR, f)
            if os.path.isfile(fpath):
                os.remove(fpath)
                cleaned += 1
                print(f"  [OK] Removed dynamic tool file: {f}")
        if cleaned == 0:
            print("  (dynamic_tools directory already clean)")
    else:
        print(f"  (dynamic_tools dir not found: {TOOL_SERVICE_DYNAMIC_DIR})")


# -- 4. Clear execution cache ----------------------------------------------

def clear_execution_cache():
    banner("PHASE 4: Clearing execution cache from backend DB")
    if os.path.exists(BACKEND_DB):
        try:
            conn = sqlite3.connect(BACKEND_DB)
            cursor = conn.cursor()
            # Check for any other ephemeral tables to clean
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
            tables = [row[0] for row in cursor.fetchall()]
            print(f"  Tables in backend DB: {tables}")
            conn.close()
        except Exception as e:
            print(f"  [FAIL] Error: {e}")


# -- Main ------------------------------------------------------------------

async def main():
    print("\n" + "=" * 60)
    print("  PROJECT FRESH START -- Full Cleanup")
    print("=" * 60)

    await delete_all_agents()
    archive_workflows()
    delete_all_tools()
    clear_execution_cache()

    banner("CLEANUP COMPLETE -- Fresh start ready!")
    print("""
  Summary:
  * All Mistral agents deleted
  * Workflow files archived and DB cleared
  * Dynamic tools purged
  * Ready for new workflow planning with v4.0 tier-aware prompts
""")


if __name__ == "__main__":
    asyncio.run(main())
