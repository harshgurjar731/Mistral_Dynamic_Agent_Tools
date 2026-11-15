"""
Planner benchmark — plan reference goals end to end and score what comes out.

Run whenever a planning prompt, a layer or a model route changes:

    python -m evals.planner_benchmark                 # every goal, cleaned up afterwards
    python -m evals.planner_benchmark --goal sme_equipment_finance --keep
    python -m evals.planner_benchmark --out report.json

Each goal is planned by the real workflow pipeline on the configured models
(the review step accepts automatically — there is nobody to ask), including
the Verify stage's dry run. A plan scores on:

* ``contract``     a data contract was decided and passes its own checks
* ``valid``        the workflow validated (after any rewinds)
* ``dry_run``      every designed scenario passed (after any repairs)
* ``self_repairs`` decisions that needed their self-check repair, and those still failing
* ``rewinds``      times validation sent the plan back to an earlier layer
* ``repairs``      dry-run repair rounds applied

Everything a plan created (agents, activities, the workflow) is rolled back
afterwards unless ``--keep`` is given. This costs real model calls.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from typing import Any

GOALS: dict[str, str] = {
    "sme_equipment_finance": (
        "Build a credit decision workflow for SME equipment finance applications: screen the "
        "application, check it is complete, require a 10% deposit, calculate the monthly instalment, "
        "DSCR and loan-to-value, screen against the internal watchlist, assess credit risk from the "
        "internal credit file, apply the lending policy to approve, refer or decline with recorded "
        "reasons, send referrals and amounts above £250,000 to an underwriter, and draft a decision "
        "letter checked by output moderation."),
    "insurance_claim_triage": (
        "Triage motor insurance claims: validate the claim form, check the policy was active on the "
        "loss date, compute the excess and the payable amount, score fraud indicators, route "
        "high-risk claims to a human investigator, and draft the settlement or rejection letter."),
    "invoice_processing": (
        "Process supplier invoices: extract the line items, match them to the purchase order within "
        "a 2% tolerance, compute VAT and totals, flag duplicates, and send mismatches for approval "
        "before producing the payment record."),
    "kyc_onboarding": (
        "Onboard a new retail banking customer: validate identity details, screen against sanctions "
        "and PEP lists, assess risk as low, medium or high from the declared occupation, country and "
        "expected activity, require enhanced due diligence review for high risk, and draft the "
        "welcome or decline message."),
    "it_incident_routing": (
        "Route IT incidents: classify the incident category and priority from the description, look "
        "up the affected service owner, compute the SLA deadline from the priority, escalate P1 "
        "incidents to on-call, and draft the acknowledgement to the reporter."),
}


def score(ctx: Any) -> dict:
    """The benchmark's measures for one finished plan (pure: reads the context only)."""
    from app.core.stages import REWIND_COUNT_KEY
    from app.layers.workflow.data_contract_layer import check_contract, contract_of
    from app.layers.workflow.finalize_layers import VALIDATION_FAILED_KEY

    spec = ctx.workflow_spec
    meta = ctx.metadata
    contract = contract_of(spec) if spec else None
    dry = meta.get("dry_run") or {}
    repairs = sum(1 for r in dry.get("rounds") or [] if (r.get("repair") or {}).get("applied"))
    self_repairs = [e.data for e in ctx.events if e.event == "sublayer"
                    and str((e.data or {}).get("id", "")).startswith("repair_")]
    return {
        "error": ctx.error,
        "contract": bool(contract) and not check_contract(contract, spec.capabilities),
        "valid": spec is not None and spec.definition is not None and not meta.get(VALIDATION_FAILED_KEY),
        "dry_run": bool(dry.get("passed")),
        "scenarios": [{"name": o.get("name"), "passed": o.get("passed"), "problems": o.get("problems", [])[:3]}
                      for o in dry.get("scenarios") or []],
        "self_repairs": len(self_repairs),
        "unresolved_checks": meta.get("unresolved_postconditions") or {},
        "rewinds": int(meta.get(REWIND_COUNT_KEY) or 0),
        "repairs": repairs,
        "steps": len(spec.definition.steps) if spec is not None and spec.definition is not None else 0,
    }


async def plan(goal: str, keep: bool) -> dict:
    from app.core.context import PipelineContext
    from app.dependencies import get_mistral_client
    from app.layers import workflow_pipeline
    from app.layers.workflow import plan_control

    ctx = PipelineContext(query=goal, client=get_mistral_client())
    started = time.monotonic()
    await workflow_pipeline.execute(ctx)
    result = {**score(ctx), "seconds": round(time.monotonic() - started)}
    if not keep:
        try:
            await plan_control.roll_back_plan(ctx, "benchmark clean-up")
        except Exception as e:  # noqa: BLE001
            result["cleanup_error"] = str(e)
    return result


async def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--goal", choices=sorted(GOALS), action="append")
    ap.add_argument("--keep", action="store_true", help="keep what each plan created")
    ap.add_argument("--out", help="write the full report as JSON")
    args = ap.parse_args(argv)

    from app.db_setup import prepare_database

    prepare_database(seed_rules=False)
    report = {}
    for key in args.goal or sorted(GOALS):
        print(f"── {key}", flush=True)
        try:
            report[key] = await plan(GOALS[key], args.keep)
        except Exception as e:  # noqa: BLE001 — one goal failing does not stop the benchmark
            report[key] = {"error": f"{type(e).__name__}: {e}"}
        r = report[key]
        print(f"   contract={r.get('contract')} valid={r.get('valid')} dry_run={r.get('dry_run')} "
              f"rewinds={r.get('rewinds')} repairs={r.get('repairs')} self_repairs={r.get('self_repairs')}"
              + (f" error={r['error']}" if r.get("error") else ""), flush=True)
    passed = sum(1 for r in report.values() if r.get("valid") and r.get("dry_run"))
    print(f"\n{passed} of {len(report)} goal(s) planned valid and passed their dry run.")
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2, default=str)
    return 0 if passed == len(report) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
