# Agent and Workflow Design Guidelines — Finance Operations

Version 1.2 · Owner: Automation Centre of Excellence

These guidelines apply to every AI agent and automated workflow built for finance
operations, including procure-to-pay (P2P), accounts payable and vendor management.

## 1. Choosing the agent type

1.1 Always use a task agent with a strict output schema for document extraction work
whose steps are fixed, such as invoice capture, W-9 validation or bank-letter checks.
Extraction from standard forms must not be done by an open-ended agent.

1.2 Use a conversational agent whenever the user interacts through dialogue, for example a
requisition copilot in the procurement portal. A conversational agent must clarify ambiguous
requests before it drafts anything.

1.3 Use a goal agent only when the work is genuinely open-ended, such as proactive sourcing
or category strategy. Goal agents are never allowed to run without a human in the loop.

1.4 When quotes or documents arrive in mixed formats (PDF, Excel, email) and the comparison
takes many steps, use a planner–executor design so that the plan can be reviewed before it
is executed.

## 2. Self-checking and human oversight

2.1 Any agent that writes to the ERP or whose mistakes have financial impact must check its own
output before returning it (reflective pattern). Totals must reconcile and every extracted
amount must be traceable to the source document.

2.2 Never let an agent post a payment or change vendor bank details without a human review
step. This is a segregation-of-duties requirement under SOX.

2.3 For high-volume invoice processing, review only exceptions: invoices that fail the
three-way match or exceed 10,000 USD go to the AP clerk queue. Everything else continues.

2.4 Process mining and budget checks are analytics and rules, not agents. Do not create an
agent for work that a deterministic rule or a query can do.

## 3. Designing agent instructions

3.1 Every agent's instructions should state its input contract, its output schema and what it
does when the input is outside the contract (return a structured error, do not guess).

3.2 Keep task agents to a small tool budget: four tool rounds is usually enough for extraction.

3.3 Agents that read policy documents should cite the policy section they relied on.

## 4. Naming

4.1 Agent names should reflect the business domain, not the product or vendor. Prefer
"Invoice Extraction Agent" to "SAP Invoice Bot".

## 5. Data handling

5.1 Bank account numbers and tax IDs are personal or financial data. They must be redacted
from logs and must not be sent to third-party services without a data processing agreement.

5.2 Use the client's ERP daily exchange-rate table when the external FX service is unavailable.
