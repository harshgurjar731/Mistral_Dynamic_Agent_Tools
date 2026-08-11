"""
Backfill the ontology from the live inventory.

    python scripts/backfill_annotations.py propose   # write the review file
    python scripts/backfill_annotations.py show      # summarise it
    python scripts/backfill_annotations.py apply     # commit it

`propose` writes to app/ontology/seed/backfill_review.json and changes nothing
else. Read that file — especially the entries marked "low" confidence, which
matched no domain — correct or delete what is wrong, then `apply`.

Nothing here runs at startup. Annotation is a reviewed act, not a boot step.
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import create_tables                     # noqa: E402
import app.ontology.models                                  # noqa: E402,F401
from app.ontology import backfill                           # noqa: E402
from app.ontology.seed_loader import load_seed              # noqa: E402


async def _gather() -> list[dict]:
    """Pull the live inventory and turn it into annotation proposals."""
    from app.dependencies import init_mistral_client, get_mistral_client
    from app.services import agent_service, connector_service
    from app.services.tool_resolver import tool_resolver

    init_mistral_client()
    client = get_mistral_client()

    agents_resp, connectors_resp, tools = await asyncio.gather(
        agent_service.list_agents(client, page=0, page_size=200),
        connector_service.list_connectors(),
        tool_resolver.list_tools(),
        return_exceptions=True,
    )

    proposals: list[dict] = []

    if isinstance(agents_resp, Exception):
        print(f"  ! could not list agents: {agents_resp}")
    else:
        agents = agents_resp.get("items", [])
        proposals += backfill.propose_for_agents(agents)
        print(f"  · {len(agents)} agents")

    if isinstance(connectors_resp, Exception):
        print(f"  ! could not list connectors: {connectors_resp}")
    else:
        connectors = connectors_resp.get("items", [])
        proposals += backfill.propose_for_connectors(connectors)
        print(f"  · {len(connectors)} connectors")

    if isinstance(tools, Exception):
        print(f"  ! could not list tools: {tools}")
    else:
        records = tools if isinstance(tools, list) else []
        proposals += backfill.propose_for_tools(records)
        print(f"  · {len(records)} tools")

    return proposals


def _show() -> None:
    path = backfill.REVIEW_PATH
    if not path.exists():
        print("No review file yet. Run: propose")
        return

    payload = json.loads(path.read_text(encoding="utf-8"))
    proposals = payload.get("proposals", [])
    low = [p for p in proposals if p.get("confidence") == "low"]

    print(f"{len(proposals)} proposals in {path}")
    print(f"{len(low)} matched no domain and need a human decision:\n")
    for p in low[:40]:
        print(f"  {p['subject_type']:9} {p.get('name', '')[:44]:46} {p['subject_id'][:12]}")
    if len(low) > 40:
        print(f"  … and {len(low) - 40} more")


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else "propose"

    create_tables()
    load_seed()

    if command == "propose":
        print("Reading live inventory…")
        proposals = asyncio.run(_gather())
        path = backfill.write_review(proposals)
        print(f"\nWrote {len(proposals)} proposals to {path}")
        print("Review it, then run: python scripts/backfill_annotations.py apply")
    elif command == "show":
        _show()
    elif command == "apply":
        summary = backfill.apply_reviewed()
        print(f"Applied: {summary}")
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
