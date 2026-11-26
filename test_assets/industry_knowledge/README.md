# Testing industry knowledge — mortgage affordability (no third-party services)

A self-contained use case for the Industry knowledge feature: plans and generated code must
follow industry rules that appear **only** in the uploaded pack, never in the prompt. Every
input is supplied by the user; nothing calls a credit bureau, valuation service, email,
database, web search, document library or any other third-party service. The only external
calls are the platform's own Mistral model calls.

| File | What it is |
|---|---|
| `mortgage_affordability_pack.json` | 11 entries filed under BFSI › Lending: 9 real rules + 2 decoys |
| `../run_inputs/mortgage_affordability_inputs.json` | 3 applications (approve, refer, decline) with exact expected outputs |

The prompts below deliberately leave out every number (7.00% floor, +3.00 points, 85/95% LTV,
40/45% DTI, reason codes). If the plan, the agent instructions and the activity code contain
them, they came from industry knowledge.

---

## 1. Set up

1. **Settings → Industry knowledge**
   - Use industry knowledge: **Auto**
   - Jurisdictions in scope: **UK** (so the US decoy is filtered out)
   - Use in tool and activity code: **On**
   - Industry items per tool or activity: **8** (the default 6 leaves out the LTV formula for this pack)
2. **Industry knowledge → Upload document** → *What it is about*: **BFSI › Lending** →
   File: `mortgage_affordability_pack.json` → **Add and extract**.
   Expected: "11 item(s) imported as approved"; Lending shows 3 approved (+8 below), Mortgage 7,
   Vehicle finance 1.
3. **Planning preview** → goal: *Assess UK residential mortgage applications for affordability*,
   scope **BFSI › Lending › Mortgage** → Preview. Expected:
   - 9 items; **neither** "Qualified Mortgage DTI cap of 43%" (US) **nor** "Balloon payment";
   - *Goal decomposition* shows the MANDATORY stressed-rate, decline and reason-code rules and the
     PROHIBITED protected-characteristics rule;
   - the code block lists the decline/refer rules, DTI, stressed rate, annuity formula and LTV.
4. Leave **Process knowledge off** on the planner pages, so industry knowledge is the only source
   of these rules.

---

## 2. Workflow prompt (Workflows → New → AI planner)

```
Build a workflow that assesses UK residential mortgage applications for affordability.

Input: a list of applications. Each has application_id, gross_annual_income,
existing_monthly_debt, property_value, loan_amount, contract_rate_pct and term_years;
records may carry other fields as well.

For each application: work out the interest rate affordability must be assessed at, the
monthly repayment at that rate, the loan-to-value and the debt-to-income ratio, then decide
approve, refer or decline with the reason codes that apply, following the lending rules for
UK residential mortgages. Return one result per application with application_id,
stressed_rate_pct, monthly_payment_gbp, ltv_pct, dti_pct, decision and reason_codes, plus a
two-sentence plain-English explanation of each decision.

Constraints: everything needed is in the input. Do not use any external API, connector,
credit bureau, property valuation, email, database, web search, document library or other
third-party service. All calculations and the decision must be deterministic code
activities using only the Python standard library; an agent may only write the
explanations.
```

Run the built workflow with `../run_inputs/mortgage_affordability_inputs.json` (the
`applications` list).

### Expected results

| Application | Stressed rate | Monthly payment | LTV | DTI | Decision | Reason codes |
|---|---|---|---|---|---|---|
| APP-1001 | 7.25 | 2046.53 | 75.0 | 28.7 | approve | — |
| APP-1002 | **7.00** (floor: 3.50 + 3.00 = 6.50) | 1839.91 | 90.0 | 37.3 | refer | LTV_REFER_85_95 |
| APP-1003 | 7.75 | 1812.79 | 96.0 | 61.6 | decline | LTV_ABOVE_95, DTI_ABOVE_45 |

No explanation mentions age or postcode, though both are in the inputs.

---

## 3. Agent prompt (Orchestrator chat)

```
Create an agent that assesses one UK residential mortgage application for affordability.
It works out the rate affordability must be assessed at, the monthly repayment at that
rate, the loan-to-value and the debt-to-income ratio, decides approve, refer or decline
with the reason codes that apply under the lending rules for UK residential mortgages, and
explains the decision in two or three sentences. It works only from the figures in the
message: no external API, connector, web search, document library or other third-party
service.

Assess this application: APP-1002, gross annual income £72,000, existing monthly debt
£400, property value £320,000, loan £288,000, contract rate 3.50%, 35-year term,
age 61, postcode LS6 2AB.
```

Expected answer: **refer**, reason code **LTV_REFER_85_95**, stressed rate **7.00%**, monthly
payment **£1,839.91**, LTV **90.0%**, DTI **37.3%**; it does not mention age or postcode.

---

## 4. What to check

**Industry knowledge reached the plan**
- Run timeline → **Industry knowledge** row: "9 industry item(s) for BFSI › Lending › Mortgage
  (4 mandatory)" (the scope may also name Lending).
- Decomposition, data contract, agent design, guardrails and rules rows: their decisions name
  `industry:N` refs (expand the row, or the `industry_knowledge_applied` event).
- Agent instructions mention the decline and refer thresholds, the reason codes and that
  protected characteristics are never used.

**Industry knowledge reached the code**
- Workflows → Activities → the calculation activity: its specification follows the stressed-rate
  floor, the annuity formula, the rounding and the reason codes, and its worked examples
  include a rate at the 7.00% floor.
- Running the inputs above reproduces the table exactly.

**Usage was recorded**
- Industry knowledge → an item → **Where it was used**: the workflow (or agent), the layers
  that used it and how.

**No third-party service was used**
- The plan has no connectors and asks for no credentials (Build prerequisites is empty).
- Every activity is `kind: pure` ("No external API…" as its data source).
- The agents have no tools beyond what was built, no document library and no knowledge graph.

**Negative checks**
- Set *Jurisdictions in scope* to empty and preview again: the US 43% rule now appears.
- Set *Use industry knowledge* to **Off** and plan again: the Industry knowledge row says
  "Off — planning without industry knowledge." and the INDUSTRY KNOWLEDGE blocks disappear
  from the decisions. The 7.00% floor and the reason codes will usually be missing or invented.
