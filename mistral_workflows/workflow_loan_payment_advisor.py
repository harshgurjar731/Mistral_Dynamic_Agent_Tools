import os
import sys
import json
import asyncio
from typing import Dict, Any, List, Optional
from datetime import timedelta
from pydantic import BaseModel
import mistralai.workflows as workflows
from mistralai.workflows import workflow

# Ensure backend path is available for step_runners
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../backend"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.services.workflow_engine.step_runners import run_step
from app.services.workflow_engine.models import WorkflowStep, StepType

class DynamicInput(BaseModel):
    """Input model for the workflow. Pass user variables as a flat dict."""
    variables: Dict[str, Any] = {}

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_loan_payment_advisor_jailbreak_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: jailbreak_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "jailbreak_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4bdfd2751d9a20107c77ddf696", "query_template": "The following data was provided by the user: principal: {{{principal}}}, annual_interest_rate: {{{annual_interest_rate}}}, term_years: {{{term_years}}}. This request relates to loan payment calculations. Validate the input for malicious or unsafe content. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["topic_control_guardrail"], "description": "Validates input for malicious or unsafe content before processing.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step jailbreak_moderation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_loan_payment_advisor_topic_control_guardrail(variables: Dict[str, Any]) -> Any:
    """Activity for step: topic_control_guardrail (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "topic_control_guardrail", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4da8af74d1abc1489ea4645ec3", "query_template": "The following data was provided by the user: principal: {{{principal}}}, annual_interest_rate: {{{annual_interest_rate}}}, term_years: {{{term_years}}}. This request relates to loan payment calculations. Ensure the input is relevant to this topic. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["calculate_loan_repayment"], "description": "Ensures the input is relevant to loan payment calculations and customer advisory.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step topic_control_guardrail failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_loan_payment_advisor_calculate_loan_repayment(variables: Dict[str, Any]) -> Any:
    """Activity for step: calculate_loan_repayment (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "calculate_loan_repayment", "type": "tool", "tier": null, "config": {"tool_name": "calculate_loan_repayment", "arguments": {"principal": "{{{principal}}}", "annual_interest_rate": "{{{annual_interest_rate}}}", "term_years": "{{{term_years}}}"}}, "next_steps": ["loan_payment_advisor"], "description": "Calculates the fixed monthly repayment and total interest paid over the life of the loan using standard amortization formulas.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step calculate_loan_repayment failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_loan_payment_advisor_loan_payment_advisor(variables: Dict[str, Any]) -> Any:
    """Activity for step: loan_payment_advisor (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "loan_payment_advisor", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a066ee2df277d387a537dabd18203e", "query_template": "The following data was produced by the previous step: {{{step_calculate_loan_repayment_output}}}. This request relates to loan payment advisory for a customer. Review the calculated loan repayment details and write a plain-English explanation for the customer. Include what they\'re paying monthly, how much interest they\'ll pay in total, and one practical tip for reducing that interest. Respond with a markdown report using ## section headers. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["final_response_generation"], "description": "Generates a customer-friendly explanation of loan repayment details, including monthly payment, total interest, and a practical tip for reducing interest.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step loan_payment_advisor failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_loan_payment_advisor_final_response_generation(variables: Dict[str, Any]) -> Any:
    """Activity for step: final_response_generation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "final_response_generation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4c86fa768bb34e72dd8402560d", "query_template": "The following data was produced by the previous steps: Calculation results: {{{step_calculate_loan_repayment_output}}}, Customer explanation: {{{step_loan_payment_advisor_output}}}. This request relates to loan payment advisory. Consolidate these outputs into a structured, customer-facing response with the following sections:\\n\\n## Loan Payment Summary\\nStructured summary of the loan repayment details (monthly payment and total interest).\\n\\n## Your Loan Explained\\nCustomer-friendly explanation of the loan terms and interest-saving tip.\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["reviewer"], "description": "Consolidates all upstream outputs into a structured, customer-facing response.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step final_response_generation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_loan_payment_advisor_reviewer(variables: Dict[str, Any]) -> Any:
    """Activity for step: reviewer (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "reviewer", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4d501877e38b00ef86df312bbe", "query_template": "The following data is the final output to be delivered to the customer: {{{step_final_response_generation_output}}}. Review this output for readability, completeness, and factual consistency. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["output_moderation"], "description": "Ensures the final output is safe, appropriate, and free of harmful or misleading content before delivery to the customer.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step reviewer failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_loan_payment_advisor_output_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: output_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "output_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4d501877e38b00ef86df312bbe", "query_template": "The following data is the final output to be delivered to the customer: {{{step_final_response_generation_output}}}. Ensure this output is safe, appropriate, and free of harmful or misleading content. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": [], "description": "Ensures the final output is relevant and safe for delivery to the customer.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step output_moderation failed")
    return result.output

@workflows.workflow.define(
    name="loan_payment_advisor",
    workflow_display_name="Loan Payment Advisor",
    workflow_description="Automates the calculation of loan repayment details and generates a customer-friendly explanation of the loan offer, including monthly payment, total interest, and a practical tip for interest reduction.",
    execution_timeout=timedelta(hours=24),
)
class LoanPaymentAdvisor:
    """Durable workflow: Automates the calculation of loan repayment details and generates a customer-friendly explanation of the loan offer, including monthly payment, total interest, and a practical tip for interest reduction."""

    def __init__(self) -> None:
        self._progress: List[str] = []
        self._user_signals: List[str] = []
        self._last_result: Any = None

    # ── Signals (async fire-and-forget from UI / le Chat) ──────────
    @workflows.workflow.signal
    def user_message(self, message: str) -> None:
        """Receive a user message signal during execution."""
        self._user_signals.append(message)

    # ── Queries (sync state reads for live progress polling) ────────
    @workflows.workflow.query
    def get_progress(self) -> List[str]:
        """Return the list of completed step IDs so far."""
        return self._progress

    @workflows.workflow.query
    def get_last_result(self) -> Any:
        """Return the output of the last completed step."""
        return self._last_result

    # ── Entrypoint ──────────────────────────────────────────────────
    @workflows.workflow.entrypoint
    async def run(self, input: DynamicInput) -> Any:
        """Execute the Loan Payment Advisor workflow DAG."""
        # Use workflow.now() for determinism-safe timestamps
        started_at = workflow.now()
        variables = dict(input.variables)
        current_step: Optional[str] = "jailbreak_moderation"
        visited: set = set()
        outputs: Dict[str, Any] = {}

        while current_step and len(visited) < 50:
            if current_step in visited:
                break  # cycle guard
            visited.add(current_step)

            if current_step == "jailbreak_moderation":
                self._progress.append("jailbreak_moderation")
                output = await run_loan_payment_advisor_jailbreak_moderation(variables)
                outputs["jailbreak_moderation"] = output
                self._last_result = output
                variables["step_jailbreak_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "topic_control_guardrail"

            elif current_step == "topic_control_guardrail":
                self._progress.append("topic_control_guardrail")
                output = await run_loan_payment_advisor_topic_control_guardrail(variables)
                outputs["topic_control_guardrail"] = output
                self._last_result = output
                variables["step_topic_control_guardrail_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "calculate_loan_repayment"

            elif current_step == "calculate_loan_repayment":
                self._progress.append("calculate_loan_repayment")
                output = await run_loan_payment_advisor_calculate_loan_repayment(variables)
                outputs["calculate_loan_repayment"] = output
                self._last_result = output
                variables["step_calculate_loan_repayment_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "loan_payment_advisor"

            elif current_step == "loan_payment_advisor":
                self._progress.append("loan_payment_advisor")
                output = await run_loan_payment_advisor_loan_payment_advisor(variables)
                outputs["loan_payment_advisor"] = output
                self._last_result = output
                variables["step_loan_payment_advisor_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "final_response_generation"

            elif current_step == "final_response_generation":
                self._progress.append("final_response_generation")
                output = await run_loan_payment_advisor_final_response_generation(variables)
                outputs["final_response_generation"] = output
                self._last_result = output
                variables["step_final_response_generation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "reviewer"

            elif current_step == "reviewer":
                self._progress.append("reviewer")
                output = await run_loan_payment_advisor_reviewer(variables)
                outputs["reviewer"] = output
                self._last_result = output
                variables["step_reviewer_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "output_moderation"

            elif current_step == "output_moderation":
                self._progress.append("output_moderation")
                output = await run_loan_payment_advisor_output_moderation(variables)
                outputs["output_moderation"] = output
                self._last_result = output
                variables["step_output_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = None

            else:
                current_step = None

        return outputs
