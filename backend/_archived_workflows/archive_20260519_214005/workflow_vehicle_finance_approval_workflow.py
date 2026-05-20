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
async def run_vehicle_finance_approval_workflow_jailbreak_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: jailbreak_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "jailbreak_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019e3feb3d2b703c877b901d4740f5a6", "query_template": "The following data was provided by the user: {{{{applicant_data}}}}.\n\nThis request relates to vehicle finance processing. Validate the input for safety and compliance. Ensure the request contains no malicious, harmful, or non-compliant content.\n\nTask: Determine if the input is safe for processing. If it is not safe, provide the risk level and reason for violation.\n\nOutput format: Respond with a raw JSON object matching the following schema:\n```json\n{\n  \"is_safe\": \"boolean\",\n  \"risk_level\": \"string (e.g., 'low', 'medium', 'high')\",\n  \"violation_reason\": \"string (description if is_safe is false, else null)\"\n}\n```\n\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["topic_control_guardrail"], "description": "Validates input safety and detects malicious or non-compliant requests."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step jailbreak_moderation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_vehicle_finance_approval_workflow_topic_control_guardrail(variables: Dict[str, Any]) -> Any:
    """Activity for step: topic_control_guardrail (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "topic_control_guardrail", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019e3feb3e9570a69c36b9e6fccf9cc2", "query_template": "The following data was produced by the previous step: {{{{step_jailbreak_moderation_output}}}}.\n\nThis request relates to vehicle finance processing. Classify the request into a vehicle finance sub-type (e.g., new car, used vehicle, motorcycle, EV, commercial) and ensure it is relevant to vehicle finance.\n\nTask: Determine if the request is relevant to vehicle finance. If it is relevant, provide the sub-type and confidence score. If it is not relevant, provide the reason for irrelevance.\n\nOutput format: Respond with a raw JSON object matching the following schema:\n```json\n{\n  \"is_relevant\": \"boolean\",\n  \"sub_type\": \"string (e.g., 'new_car', 'used_vehicle', 'motorcycle', 'electric_vehicle', 'commercial_vehicle')\",\n  \"confidence\": \"float (0.0 to 1.0)\",\n  \"irrelevance_reason\": \"string (description if is_relevant is false, else null)\"\n}\n```\n\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["check_relevance"], "description": "Classifies the request into a vehicle finance sub-type and ensures relevance to vehicle finance processing."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step topic_control_guardrail failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy_max_attempts=3,
)
async def run_vehicle_finance_approval_workflow_check_relevance(variables: Dict[str, Any]) -> Any:
    """Activity for step: check_relevance (StepType.CONDITION)"""
    step_def = WorkflowStep.model_validate({"id": "check_relevance", "type": "condition", "tier": null, "config": {"expression": "{{{{step_topic_control_guardrail_output.is_relevant}}}} == true", "true_step": "vehicle_finance_eligibility_assessment", "false_step": "irrelevant_request_response", "fallback_step": "irrelevant_request_response"}, "next_steps": [], "description": "Checks if the request is relevant to vehicle finance."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step check_relevance failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_vehicle_finance_approval_workflow_irrelevant_request_response(variables: Dict[str, Any]) -> Any:
    """Activity for step: irrelevant_request_response (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "irrelevant_request_response", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019e3feb43b472a0b60e54f15c0bb446", "query_template": "The following data was produced by the previous step: {{{{step_topic_control_guardrail_output}}}}.\n\nThis request is not relevant to vehicle finance processing. Generate a polite and clear response informing the user that their request is not relevant to vehicle finance.\n\nTask: Create a structured, customer-friendly response explaining why the request is not relevant.\n\nOutput format: Respond with a markdown report using the following structure:\n## Summary\nExplain why the request is not relevant to vehicle finance.\n\n## Next Steps\nProvide guidance on what the user can do next.\n\nProvide a complete, thorough response. Do not return an empty response.", "expected_output_contract": "markdown_report"}, "next_steps": ["reviewer"], "description": "Generates a response for irrelevant requests."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step irrelevant_request_response failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_vehicle_finance_approval_workflow_vehicle_finance_eligibility_assessment(variables: Dict[str, Any]) -> Any:
    """Activity for step: vehicle_finance_eligibility_assessment (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "vehicle_finance_eligibility_assessment", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_019e3ff1ab27702c80a08ea807fb2984", "query_template": "The following data was produced by the previous steps:\n- User input: {{{{applicant_data}}}}\n- Safety validation: {{{{step_jailbreak_moderation_output}}}}\n- Topic classification: {{{{step_topic_control_guardrail_output}}}}\n\nThis request relates to vehicle finance processing. Analyse the applicant's eligibility for vehicle finance by evaluating their financial profile, creditworthiness, and the vehicle's value.\n\nTask: Use the provided tools to fetch credit reports, validate vehicle details, and calculate affordability metrics. Determine a preliminary eligibility status and confidence score.\n\nOutput format: Respond with a raw JSON object matching the following schema:\n```json\n{\n  \"eligibility_status\": \"string (eligible | ineligible | conditionally_eligible)\",\n  \"confidence_score\": \"float (0.0 to 1.0)\",\n  \"affordability_metrics\": {\n    \"debt_to_income_ratio\": \"float\",\n    \"loan_to_value_ratio\": \"float\",\n    \"monthly_repayment_capacity\": \"float\",\n    \"disposable_income\": \"float\"\n  },\n  \"credit_assessment\": {\n    \"credit_score\": \"integer\",\n    \"credit_utilisation\": \"float\",\n    \"payment_history_summary\": \"string\"\n  },\n  \"vehicle_assessment\": {\n    \"market_value\": \"float\",\n    \"depreciation_rate\": \"float\",\n    \"finance_eligibility\": \"boolean\",\n    \"validation_notes\": [\"string\"]\n  },\n  \"justification\": [\"string\"]\n}\n```\n\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["financial_risk_assessment"], "description": "Analyses borrower affordability metrics, creditworthiness, vehicle value, and deposit to determine preliminary eligibility for vehicle finance."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step vehicle_finance_eligibility_assessment failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_vehicle_finance_approval_workflow_financial_risk_assessment(variables: Dict[str, Any]) -> Any:
    """Activity for step: financial_risk_assessment (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "financial_risk_assessment", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019e3feb40f2724eb3c7c23b5625e72e", "query_template": "The following data was produced by the previous step: {{{{step_vehicle_finance_eligibility_assessment_output}}}}.\n\nThis request relates to vehicle finance processing. Evaluate the repayment risk, depreciation exposure, and probability of arrears for the vehicle finance application. Ensure alignment with European consumer credit regulations.\n\nTask: Assess the risk level, probability of arrears, and depreciation exposure. Identify key risk factors and propose mitigations where applicable.\n\nOutput format: Respond with a raw JSON object matching the following schema:\n```json\n{\n  \"risk_level\": \"string (low | medium | high)\",\n  \"probability_of_arrears\": \"float (0.0 to 1.0)\",\n  \"depreciation_exposure\": \"float (0.0 to 1.0)\",\n  \"regulatory_compliance\": \"boolean\",\n  \"risk_factors\": [\n    {\n      \"factor\": \"string\",\n      \"severity\": \"string (low | medium | high)\",\n      \"mitigation\": \"string\"\n    }\n  ],\n  \"justification\": \"string\"\n}\n```\n\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["vehicle_finance_recommendation"], "description": "Evaluates repayment risk, depreciation-related exposure, and probability of arrears in alignment with European consumer credit standards."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step financial_risk_assessment failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_vehicle_finance_approval_workflow_vehicle_finance_recommendation(variables: Dict[str, Any]) -> Any:
    """Activity for step: vehicle_finance_recommendation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "vehicle_finance_recommendation", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_019e3ff1ac6475758a98f0fed6ef402e", "query_template": "The following data was produced by the previous steps:\n- Eligibility assessment: {{{{step_vehicle_finance_eligibility_assessment_output}}}}\n- Risk assessment: {{{{step_financial_risk_assessment_output}}}}\n\nThis request relates to vehicle finance processing. Generate a lending outcome (approved, declined, or conditionally approved) and propose indicative finance terms.\n\nTask: Determine the lending outcome and propose terms such as borrowing amount, APR, repayment duration, deposit requirements, and balloon payment conditions where applicable.\n\nOutput format: Respond with a raw JSON object matching the following schema:\n```json\n{\n  \"lending_outcome\": \"string (approved | declined | conditionally_approved)\",\n  \"finance_terms\": {\n    \"borrowing_amount\": \"float\",\n    \"apr\": \"float\",\n    \"repayment_duration_months\": \"integer\",\n    \"deposit_required\": \"float\",\n    \"balloon_payment\": \"float (null if not applicable)\",\n    \"estimated_monthly_instalment\": \"float\"\n  },\n  \"conditions\": [\"string\"],\n  \"justification\": \"string\"\n}\n```\n\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["final_response_generation"], "description": "Generates the proposed lending outcome with indicative finance terms such as APR, repayment duration, and deposit requirements."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step vehicle_finance_recommendation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_vehicle_finance_approval_workflow_final_response_generation(variables: Dict[str, Any]) -> Any:
    """Activity for step: final_response_generation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "final_response_generation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019e3feb43b472a0b60e54f15c0bb446", "query_template": "The following data was produced by the previous steps:\n- Eligibility assessment: {{{{step_vehicle_finance_eligibility_assessment_output}}}}\n- Risk assessment: {{{{step_financial_risk_assessment_output}}}}\n- Finance recommendation: {{{{step_vehicle_finance_recommendation_output}}}}\n\nThis request relates to vehicle finance processing. Consolidate the outputs into a clear, structured, and customer-friendly explanation of the lending decision.\n\nTask: Create a markdown report summarising the lending decision, finance terms, eligibility summary, risk assessment, and next steps.\n\nOutput format: Respond with a markdown report using the following structure:\n## Summary\nProvide a brief summary of the lending decision.\n\n## Key Findings / Results\nSummarise the key findings from the eligibility and risk assessments.\n\n## Details\nProvide detailed information on the finance terms, eligibility metrics, and risk factors.\n\n## Recommendations (if applicable)\nInclude any recommendations or conditions for approval.\n\n## Next Steps\nOutline the next steps for the user.\n\nProvide a complete, thorough response. Do not return an empty response.", "expected_output_contract": "markdown_report"}, "next_steps": ["reviewer"], "description": "Consolidates outputs from upstream agents into a clear, structured, and customer-friendly explanation of the lending decision."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step final_response_generation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_vehicle_finance_approval_workflow_reviewer(variables: Dict[str, Any]) -> Any:
    """Activity for step: reviewer (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "reviewer", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019e3feb451176c999dd1aeb3163b654", "query_template": "The following data was produced by the previous step: {{{{step_final_response_generation_output}}}}.\n\nReview the final response for readability, completeness, factual consistency, and compliance with financial communication standards.\n\nTask: Evaluate the response and provide scores for readability, completeness, and factual consistency. Identify any issues and suggest improvements.\n\nOutput format: Respond with a raw JSON object matching the following schema:\n```json\n{\n  \"is_approved\": \"boolean\",\n  \"readability_score\": \"float (0.0 to 1.0)\",\n  \"completeness_score\": \"float (0.0 to 1.0)\",\n  \"factual_consistency_score\": \"float (0.0 to 1.0)\",\n  \"issues\": [\n    {\n      \"issue\": \"string\",\n      \"severity\": \"string (low | medium | high)\",\n      \"suggestion\": \"string\"\n    }\n  ]\n}\n```\n\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["check_review_approval"], "description": "Reviews the final response for readability, completeness, factual consistency, and compliance with financial communication standards."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step reviewer failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy_max_attempts=3,
)
async def run_vehicle_finance_approval_workflow_check_review_approval(variables: Dict[str, Any]) -> Any:
    """Activity for step: check_review_approval (StepType.CONDITION)"""
    step_def = WorkflowStep.model_validate({"id": "check_review_approval", "type": "condition", "tier": null, "config": {"expression": "{{{{step_reviewer_output.is_approved}}}} == true", "true_step": "output_moderation", "false_step": "final_response_generation", "fallback_step": "final_response_generation"}, "next_steps": [], "description": "Checks if the final response is approved by the reviewer."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step check_review_approval failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_vehicle_finance_approval_workflow_output_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: output_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "output_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019e3feb4635715d83244bccf98566e4", "query_template": "The following data was produced by the previous step: {{{{step_final_response_generation_output}}}}.\n\nPerform a final safety check on the response to ensure it contains no harmful, misleading, or non-compliant content.\n\nTask: Determine if the response is safe for delivery. If it is not safe, provide the risk level and reason for violation.\n\nOutput format: Respond with a raw JSON object matching the following schema:\n```json\n{\n  \"is_safe\": \"boolean\",\n  \"risk_level\": \"string (e.g., 'low', 'medium', 'high')\",\n  \"violation_reason\": \"string (description if is_safe is false, else null)\"\n}\n```\n\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": [], "description": "Performs a final safety gate on the response to ensure it contains no harmful, misleading, or non-compliant content."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step output_moderation failed")
    return result.output

@workflows.workflow.define(
    name="vehicle_finance_approval_workflow",
    workflow_display_name="Vehicle Finance Approval Workflow",
    workflow_description="Automates end-to-end vehicle finance approval and affordability assessment, processing applicant data, evaluating eligibility, generating lending decisions with justification, and ensuring regulatory compliance and safety.",
    execution_timeout=timedelta(hours=24),
)
class VehicleFinanceApprovalWorkflow:
    """Durable workflow: Automates end-to-end vehicle finance approval and affordability assessment, processing applicant data, evaluating eligibility, generating lending decisions with justification, and ensuring regulatory compliance and safety."""

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
        """Execute the Vehicle Finance Approval Workflow workflow DAG."""
        # Use workflow.now() for determinism-safe timestamps
        started_at = workflow.now()
        variables = dict(input.variables)
        current_step: Optional[str] = "jailbreak_moderation"
        visited: set = set()
        last_output: Any = None

        while current_step and len(visited) < 50:
            if current_step in visited:
                break  # cycle guard
            visited.add(current_step)

            if current_step == "jailbreak_moderation":
                self._progress.append("jailbreak_moderation")
                output = await run_vehicle_finance_approval_workflow_jailbreak_moderation(variables)
                last_output = output
                self._last_result = output
                variables["step_jailbreak_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "topic_control_guardrail"

            elif current_step == "topic_control_guardrail":
                self._progress.append("topic_control_guardrail")
                output = await run_vehicle_finance_approval_workflow_topic_control_guardrail(variables)
                last_output = output
                self._last_result = output
                variables["step_topic_control_guardrail_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "check_relevance"

            elif current_step == "check_relevance":
                self._progress.append("check_relevance")
                output = await run_vehicle_finance_approval_workflow_check_relevance(variables)
                last_output = output
                self._last_result = output
                variables["step_check_relevance_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                # Condition step: output contains {next_step: ...}
                if isinstance(output, dict) and "next_step" in output:
                    current_step = output["next_step"]
                else:
                    current_step = None

            elif current_step == "irrelevant_request_response":
                self._progress.append("irrelevant_request_response")
                output = await run_vehicle_finance_approval_workflow_irrelevant_request_response(variables)
                last_output = output
                self._last_result = output
                variables["step_irrelevant_request_response_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "reviewer"

            elif current_step == "vehicle_finance_eligibility_assessment":
                self._progress.append("vehicle_finance_eligibility_assessment")
                output = await run_vehicle_finance_approval_workflow_vehicle_finance_eligibility_assessment(variables)
                last_output = output
                self._last_result = output
                variables["step_vehicle_finance_eligibility_assessment_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "financial_risk_assessment"

            elif current_step == "financial_risk_assessment":
                self._progress.append("financial_risk_assessment")
                output = await run_vehicle_finance_approval_workflow_financial_risk_assessment(variables)
                last_output = output
                self._last_result = output
                variables["step_financial_risk_assessment_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "vehicle_finance_recommendation"

            elif current_step == "vehicle_finance_recommendation":
                self._progress.append("vehicle_finance_recommendation")
                output = await run_vehicle_finance_approval_workflow_vehicle_finance_recommendation(variables)
                last_output = output
                self._last_result = output
                variables["step_vehicle_finance_recommendation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "final_response_generation"

            elif current_step == "final_response_generation":
                self._progress.append("final_response_generation")
                output = await run_vehicle_finance_approval_workflow_final_response_generation(variables)
                last_output = output
                self._last_result = output
                variables["step_final_response_generation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "reviewer"

            elif current_step == "reviewer":
                self._progress.append("reviewer")
                output = await run_vehicle_finance_approval_workflow_reviewer(variables)
                last_output = output
                self._last_result = output
                variables["step_reviewer_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "check_review_approval"

            elif current_step == "check_review_approval":
                self._progress.append("check_review_approval")
                output = await run_vehicle_finance_approval_workflow_check_review_approval(variables)
                last_output = output
                self._last_result = output
                variables["step_check_review_approval_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                # Condition step: output contains {next_step: ...}
                if isinstance(output, dict) and "next_step" in output:
                    current_step = output["next_step"]
                else:
                    current_step = None

            elif current_step == "output_moderation":
                self._progress.append("output_moderation")
                output = await run_vehicle_finance_approval_workflow_output_moderation(variables)
                last_output = output
                self._last_result = output
                variables["step_output_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = None

            else:
                current_step = None

        return last_output
