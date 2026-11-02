"""
Smoke test for best-practice knowledge, agent types and recommendation import.

Runs against a backend that is already started (default http://localhost:8000).

    python test_assets/scripts/smoke_test.py                       # no Mistral calls
    python test_assets/scripts/smoke_test.py --domain domain.x     # file recommendations under a domain
    python test_assets/scripts/smoke_test.py --distill             # also distil the guidelines (calls Mistral)
    python test_assets/scripts/smoke_test.py --import              # save the enriched recommendations

Guidance items it creates are tagged "smoke-test" so --cleanup can remove them.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import requests

ASSETS = Path(__file__).resolve().parents[1]
TAG = "smoke-test"
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--domain", default=None, help="Catalog domain id to file recommendations under")
    ap.add_argument("--distill", action="store_true", help="Distil the guidelines document (calls Mistral)")
    ap.add_argument("--import", dest="do_import", action="store_true", help="Save the enriched recommendations")
    ap.add_argument("--cleanup", action="store_true", help="Delete guidance items this script created, then exit")
    args = ap.parse_args()
    api = args.base.rstrip("/") + "/api"
    s = requests.Session()

    try:
        s.get(args.base.rstrip("/") + "/health", timeout=10).raise_for_status()
    except Exception as e:
        print(f"Backend not reachable at {args.base}: {e}")
        return 2

    mine = [i for i in s.get(f"{api}/knowledge/items", params={"kind": "guidance"}).json()["items"]
            if TAG in (i.get("tags") or [])]
    if args.cleanup:
        for i in mine:
            s.delete(f"{api}/knowledge/items/{i['id']}")
        print(f"Removed {len(mine)} smoke-test guidance item(s).")
        return 0

    # 1. Load ready-made guidance (idempotent: skipped when already loaded).
    items = json.loads((ASSETS / "best_practices" / "guidance_items.json").read_text(encoding="utf-8"))
    have = {i["title"] for i in mine}
    created = 0
    for item in items:
        if item["title"] in have:
            continue
        r = s.post(f"{api}/knowledge/items", json={**item, "tags": [TAG]})
        created += r.ok
        if not r.ok:
            check(f"create guidance '{item['title']}'", False, r.text[:200])
    check("guidance items loaded", True, f"{created} new, {len(have)} already there")

    counts = s.get(f"{api}/knowledge/counts").json()["counts"].get("guidance", {})
    check("active guidance present", counts.get("active", 0) >= 8, json.dumps(counts))

    # 2. Retrieval: the invoice process facts should surface the task-agent and self-check items,
    #    and drop the conversational one (its condition is false for these facts).
    doc = json.loads((ASSETS / "process_documents" / "invoice_extraction_v2.json").read_text(encoding="utf-8"))
    facts = {k: doc[k] for k in ("execution_profile", "governance", "integrations")}
    r = s.post(f"{api}/knowledge/retrieve", json={"goal": "Extract supplier invoices and post them to SAP",
                                                  "facts": facts}).json()
    titles = [i["title"] for i in r["items"]]
    check("task-agent guidance retrieved", "Task agent for fixed-step extraction" in titles)
    check("self-check guidance retrieved", "Self-check anything with financial impact" in titles)
    check("conversational guidance filtered out", "Conversational agent for dialogue" not in titles)
    check("proposed item not used", "State the input contract" not in titles)
    check("archetype view rendered", "agent_archetype" in r["rendered"], ", ".join(sorted(r["rendered"])))

    # 3. Recommendation import (preview unless --import).
    for name in ("p2p_recommendations_flat.json", "p2p_recommendations_enriched.json"):
        content = (ASSETS / "recommendations" / name).read_text(encoding="utf-8")
        save = args.do_import and "enriched" in name
        data = {"content": content, "save": "true" if save else "false"}
        if args.domain:
            data["domain_id"] = args.domain
        rep = s.post(f"{api}/processes/recommendations/import", data=data).json()
        if "summary" not in rep:
            check(f"import {name}", False, json.dumps(rep)[:300])
            continue
        missing = sum(len(x["missing"]) for x in rep["imported"] + rep["needs_domain"])
        check(f"import {name} ({'saved' if save else 'preview'})", not rep["errors"],
              f"{rep['summary']} {missing} missing attribute(s) in total")
        if rep["needs_domain"] and not args.domain:
            cands = rep["needs_domain"][0].get("candidates") or []
            print("       no domain matched L0 — rerun with --domain <id>"
                  + (f"; closest: {', '.join(c['concept_id'] for c in cands)}" if cands else ""))

    # 4. Distil the guidelines document through Mistral OCR + mistral-large (opt-in).
    if args.distill:
        path = ASSETS / "best_practices" / "agent_design_guidelines.pdf"
        with path.open("rb") as fh:
            r = s.post(f"{api}/knowledge/sources", files={"file": (path.name, fh, "application/pdf")},
                       data={"title": "Finance automation guidelines (smoke test)"}, timeout=600)
        if check("distil guidelines PDF", r.ok, r.text[:300] if not r.ok else ""):
            res = r.json()["result"]
            check("items distilled", res["created"] > 0,
                  f"{res['created']} created, {res['conflicts']} conflicting, {res['skipped_duplicates']} duplicates")

    # 5. Review inbox reachable.
    r = s.get(f"{api}/reviews")
    check("review inbox reachable", r.ok, f"{r.json().get('count', '?')} pending" if r.ok else r.text[:200])

    failed = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
