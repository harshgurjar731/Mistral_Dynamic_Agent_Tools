"""
Golden evaluation for code synthesis — calls the real models.

Runs every spec in ``golden.json`` through the full pipeline against a
throwaway database and reports, per spec and overall: verified or not,
attempts, first-pass rate, which stage failures landed in, and wall time.

Use it to justify a model or prompt change: run before and after, compare.

    python evals/run_evals.py                   # everything
    python evals/run_evals.py --only apply_gst  # one spec
    python evals/run_evals.py --purpose activity --limit 3

Model routes can be overridden per run, e.g.
    ROUTE_CODEGEN_MODEL=mistral-large-2512 python evals/run_evals.py

Results are written to evals/results/<timestamp>.json.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def _isolate() -> None:
    tmp = tempfile.mkdtemp(prefix="evals_")
    os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(tmp, 'evals.db')}".replace("\\", "/")
    os.environ["DYNAMIC_TOOLS_DIR"] = os.path.join(tmp, "dynamic_tools")
    os.environ["AUTO_APPROVE_DYNAMIC_TOOLS"] = "true"
    sys.path.insert(0, ROOT)
    os.chdir(ROOT)  # so .env (MISTRAL_API_KEY) is found


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", action="append", help="spec name (repeatable)")
    parser.add_argument("--purpose", choices=["tool", "activity"])
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()

    _isolate()
    from app import metrics
    from app.database import SessionLocal, init_db
    from app.llm.routes import all_routes
    from app.synthesis.pipeline import run_synthesis
    from app.synthesis.spec import SynthesisSpec

    init_db()
    with open(os.path.join(HERE, "golden.json"), encoding="utf-8") as f:
        specs = json.load(f)
    if args.only:
        specs = [s for s in specs if s["name"] in args.only]
    if args.purpose:
        specs = [s for s in specs if s.get("purpose", "tool") == args.purpose]
    if args.limit:
        specs = specs[: args.limit]

    rows = []
    for raw in specs:
        started = time.monotonic()
        stages: list[str] = []

        def emit(stage, message, data, _stages=stages):
            if stage == "verify" and data and not data.get("ok"):
                _stages.append(data.get("stage", "?"))
            print(f"    [{raw['name']}] {stage}: {message[:140]}")

        print(f"\n>> {raw['name']} ({raw.get('purpose', 'tool')})")
        result = run_synthesis(SynthesisSpec.from_request(**raw), SessionLocal, emit=emit)
        history = (result.get("report") or {}).get("history", "")
        attempts = history.count("#") if history else len(stages) + (1 if result["status"] == "approved" else 0)
        rows.append({
            "name": raw["name"], "purpose": raw.get("purpose", "tool"), "status": result["status"],
            "attempts": attempts, "failed_stages": stages,
            "seconds": round(time.monotonic() - started, 1),
            "message": result.get("message", "")[:400],
        })
        print(f"  -> {result['status']} in {rows[-1]['seconds']}s, {attempts} attempt(s)")

    verified = [r for r in rows if r["status"] in ("approved", "pending_approval")]
    first_pass = [r for r in verified if r["attempts"] == 1]
    summary = {
        "specs": len(rows),
        "verified": len(verified),
        "verified_rate": round(len(verified) / len(rows), 3) if rows else 0,
        "first_pass_rate": round(len(first_pass) / len(rows), 3) if rows else 0,
        "mean_seconds": round(sum(r["seconds"] for r in rows) / len(rows), 1) if rows else 0,
        "routes": {k: v.__dict__ for k, v in all_routes().items()},
        "metrics": metrics.snapshot(),
    }

    print("\n" + "-" * 72)
    for r in rows:
        print(f"{r['status']:<17} {r['attempts']} att  {r['seconds']:>6}s  {r['purpose']:<8} {r['name']}"
              + (f"  <- {','.join(r['failed_stages'])}" if r["failed_stages"] else ""))
    print("-" * 72)
    print(f"verified {summary['verified']}/{summary['specs']}  first-pass {summary['first_pass_rate']:.0%}  "
          f"mean {summary['mean_seconds']}s")

    out_dir = os.path.join(HERE, "results")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, time.strftime("%Y%m%d-%H%M%S") + ".json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "results": rows}, f, indent=2, default=str)
    print(f"results -> {out}")
    return 0 if len(verified) == len(rows) else 1


if __name__ == "__main__":
    sys.exit(main())
