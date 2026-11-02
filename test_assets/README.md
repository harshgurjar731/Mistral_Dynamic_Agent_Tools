# Test assets — best-practice knowledge, agent types, governance

Everything needed to test the flow end to end: guidance in, agent types decided, human
oversight placed, reviews decided.

| File | What it tests |
|---|---|
| `best_practices/agent_design_guidelines.md` / `.docx` / `.pdf` | The same best-practice document in three formats — text, Word (OCR, python-docx fallback), PDF (Mistral OCR, pypdf fallback) |
| `best_practices/guidance_items.json` | 9 ready-made guidance items (8 active, 1 proposed) with conditions and effects — tests the build flow without depending on distillation |
| `recommendations/p2p_recommendations_flat.json` | Your original export — import, inference, missing-attribute report |
| `recommendations/p2p_recommendations_enriched.json` | 5 recommendations in the structured format, each exercising a different path (below) |
| `process_documents/invoice_extraction_v2.json` | A template-v2 process document with integrations, a connector that needs approval, and exceptions-only review |
| `run_inputs/invoice_inputs.json` | A clean invoice and an exception invoice to run the built workflow on |
| `scripts/smoke_test.py` | Automated API checks against a running backend |

All files were checked against the backend: the guidance loads, the process document is
valid v2, both recommendation files import with every document valid.

---

## 0. Start

```bash
# backend (from backend/)
uvicorn app.main:app --reload --port 8000
# frontend (from the repo root)
npm run dev
```

Use `domain.finance_ops` (Finance operations) as the domain below. Its synonyms include
"accounts payable", so leaving the domain blank should match it too — if the preview lists
the recommendations under "need a domain", enter it explicitly.

The run inputs in `run_inputs/` are the values to type into the workflow's run form; match them
to the input fields the planner gave the workflow (usually the invoice text).

## 1. Automated smoke test (no Mistral calls)

```bash
python test_assets/scripts/smoke_test.py --domain domain.finance_ops
```

Expected: every check passes —

- 9 guidance items loaded, at least 8 active
- retrieval for the invoice process returns **Task agent for fixed-step extraction** and
  **Self-check anything with financial impact**; **Conversational agent for dialogue** is
  filtered out (its condition is false); the proposed item is not used
- both recommendation files preview with 0 failures; the flat one reports missing attributes

Remove what it created afterwards with `--cleanup`.

## 2. Distil a best-practice document (calls Mistral)

UI: **Knowledge → Sources → File** → choose `agent_design_guidelines.pdf` (then try the `.docx`
and a URL).  Or: `python test_assets/scripts/smoke_test.py --distill`.

Expected:

- source status **distilled**, message "Extracted with mistral_ocr"
- roughly 10–15 items under **Guidance → Waiting for review**, each with a page and a quote
- items such as "never post a payment without review" as **avoid**, "always use a task agent…"
  as **must**, with conditions like `execution_profile.workflow_determinism = fixed_steps`
- items that restate the ready-made ones (if you loaded those first) are skipped as duplicates
  or marked **conflicting** if they contradict
- **Approve** a few. Check **Try retrieval** with goal "Extract supplier invoices and post them
  to SAP" and the facts box — approved items appear, ranked, with the layer view they go to.

## 3. Import recommendations

UI: **Processes → Import recommendations** → choose a file → enter `domain.finance_ops` →
**Preview**, then **Import**.

| File | Expected preview |
|---|---|
| flat | 8 imported, all valid; every row lists missing attributes (workflow determinism, interaction mode, systems, authority…); `implementation_type` shown as inferred; #6–#8 warn "Evidence from generic market research is rated high confidence" |
| enriched | 5 imported, all valid; #003, #006, #008 report nothing missing |

After **Import**, the Processes page shows Finance operations › Procure to Pay / Accounts
Payable › … › each L3, each with a document (the two vendor-master items become two versions).

## 4. Build a workflow from a recommendation

UI: **Workflows → New → AI planner**. Turn **Process knowledge on**, leave **Guidance auto**.
Use the goals below (the matching process is picked from the inventory; or attach
`invoice_extraction_v2.json` for #1).

Watch the timeline rows **Knowledge context**, **Choose agent types**, **Expand multi-agent
patterns** and **Place human oversight**.

| # | Goal | Expected agent types (the "Choose agent types" summary) | Expected oversight / structure |
|---|---|---|---|
| 1 | "Extract incoming supplier invoices, match them to the purchase order and goods receipt, and post matched invoices to SAP." | the extraction agent: **task + tool_using_react, reflective**, decided by **guidance**, 4 tool rounds | a gate `gate_<step>` on `needs_review`, then `review_<step>` for the AP clerk; a review in front of the SAP posting connector (it needs approval); validation passes the governance checks |
| 2 | "Compare supplier quotations in PDF and Excel for a closed RFQ, normalise currencies and draft the selection justification." | **task + planner_executor, multi_agent**, decided by the **document** | 3 sub-agents added (planner, extractor, verifier) as handoff targets — not steps; after provisioning the parent gets `handoffs`; a review after the comparison for the procurement specialist |
| 3 | "Analyse weekly spend and market conditions and propose sourcing opportunities with draft RFQs." | **goal + planner_executor**, model preference reasoning | human-in-the-loop forced (goal agents never run unsupervised): a review after the goal step |
| 4 | "Stage vendor bank-detail changes and have a finance supervisor verify and release them." | ideally **no agent steps** — the recommendation is `workflow_config` and guidance "No agents for rules or analytics" applies | if the planner still creates an agent, that is a finding to report |
| 5 | "Help a requestor fill in a purchase requisition through conversation and suggest the cost center and tax code." | **conversational + tool_using_react** (run it in the **Orchestrator** chat page too) | sampled monitoring (10%), no blocking review |

Then turn **Guidance off** and plan goal 1 again: the "Choose agent types" summary should
say **by rules** or **by default** instead of **by guidance**, and the round budget is no longer 4.

## 5. Run it and decide a review

Execute the workflow from goal 1 with `run_inputs/invoice_inputs.json`:

- **clean** — should pass the gate and reach the posting approval review
- **exception** — amount over 10,000, PO total mismatch, partial receipt, changed bank
  account: the extraction agent should flag `needs_review`, and the run stops at the AP clerk review

Open **Reviews**: the waiting step shows the extracted fields. Try each decision:
**Approve** (run continues), **Correct and continue** (edited values replace the agent's),
**Reject** with a comment (run fails with the comment as the reason).

## 6. Feedback

Roll back a planned workflow in the review step at the end of planning, three times, with the
same guidance in scope. **Knowledge → Feedback** counts the rollbacks; on the third the item
goes back to **Waiting for review** with "Flagged for review".

## 7. Expected agent types for the enriched file (computed offline)

Deterministic tiers only, with the ready-made guidance loaded — what the build should arrive
at before any model call:

| Recommendation | Type + patterns | Decided by | Oversight |
|---|---|---|---|
| P2P-REC-001 Requisition copilot | conversational + tool_using_react | rules (user_dialogue) | on the loop, 10% sample |
| P2P-REC-003 Quote comparison | task + tool_using_react, planner_executor, multi_agent | document (declared design) | in the loop, every transaction |
| P2P-REC-004 Maker-checker | (no agent expected — workflow_config) | — | in the loop |
| P2P-REC-006 Invoice extraction | task + tool_using_react, reflective; 4 rounds | guidance (must, conditions true) | in the loop, exceptions only |
| P2P-REC-008 Proactive sourcing | goal + tool_using_react, planner_executor | rules (open_ended) | in the loop (forced for goal agents) |
