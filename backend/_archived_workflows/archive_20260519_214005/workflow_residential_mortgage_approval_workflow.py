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
async def run_residential_mortgage_approval_workflow_jailbreak_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: jailbreak_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "jailbreak_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019e3feb3d2b703c877b901d4740f5a6", "query_template": "The user has submitted a mortgage application request. Validate the safety of the following input data to detect malicious or non-compliant requests: {{{{applicant_details}}}}.\n\nThis request relates to residential mortgage processing. Apply the relevant safety and compliance checks for this product.\n\nTASK: Determine if the input is safe for processing. If unsafe, classify the risk level and provide a reason.\n\nOUTPUT FORMAT: Respond with a raw JSON object matching the following contract:\n{\n  \"is_safe\": boolean,\n  \"risk_level\": \"low | medium | high\",\n  \"risk_reason\": \"string\"\n}\n\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["topic_control_guardrail"], "description": "Validates input safety and detects malicious or non-compliant requests before processing."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step jailbreak_moderation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_approval_workflow_topic_control_guardrail(variables: Dict[str, Any]) -> Any:
    """Activity for step: topic_control_guardrail (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "topic_control_guardrail", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019e3feb3e9570a69c36b9e6fccf9cc2", "query_template": "The following data was produced by the previous step: {{{{step_jailbreak_moderation_output}}}}.\n\nThe user has submitted a request for mortgage processing. This request relates to residential mortgage products.\n\nTASK: Ensure the request is relevant to mortgage processing and classify it into a mortgage sub-type (e.g., 'first_time_buyer', 'remortgage', 'buy_to_let', 'fixed_rate').\n\nOUTPUT FORMAT: Respond with a raw JSON object matching the following contract:\n{\n  \"is_relevant\": boolean,\n  \"mortgage_type\": \"string\",\n  \"confidence_score\": number (0.0 to 1.0)\n}\n\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["mortgage_eligibility_assessment"], "description": "Ensures the request is relevant to mortgage processing and classifies it into a mortgage sub-type."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step topic_control_guardrail failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_approval_workflow_mortgage_eligibility_assessment(variables: Dict[str, Any]) -> Any:
    """Activity for step: mortgage_eligibility_assessment (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "mortgage_eligibility_assessment", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_019e3feb3fbf73a883545de8de8b0f0b", "query_template": "The following data was produced by the previous steps:\n- Input data: {{{{applicant_details}}}}\n- Safety validation: {{{{step_jailbreak_moderation_output}}}}\n- Topic classification: {{{{step_topic_control_guardrail_output}}}}\n\nThis request relates to residential mortgage processing. Apply the relevant regulations and metrics for this product.\n\nTASK: Analyse the applicant's financial and property data to determine preliminary mortgage eligibility. Compute key affordability metrics (DTI, LTV), assess creditworthiness, and generate a confidence score for the decision.\n\nUse the following tools as needed:\n1. `fetch_credit_report` to retrieve the applicant's credit report.\n2. `calculate_affordability_metrics` to compute DTI, LTV, disposable income, and monthly repayment estimate.\n\nOUTPUT FORMAT: Respond with a raw JSON object matching the following contract:\n{\n  \"eligibility_status\": \"eligible | ineligible | conditionally_eligible\",\n  \"confidence_score\": number (0.0 to 1.0),\n  \"affordability_metrics\": {\n    \"debt_to_income_ratio\": number (percentage),\n    \"loan_to_value_ratio\": number (percentage),\n    \"disposable_income\": number,\n    \"monthly_repayment_estimate\": number\n  },\n  \"credit_assessment\": {\n    \"credit_score\": integer,\n    \"credit_risk\": \"low | medium | high\"\n  },\n  \"justification\": \"string\"\n}\n\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["financial_risk_assessment"], "description": "Analyses borrower affordability metrics to determine preliminary mortgage eligibility with a confidence score."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step mortgage_eligibility_assessment failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_approval_workflow_financial_risk_assessment(variables: Dict[str, Any]) -> Any:
    """Activity for step: financial_risk_assessment (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "financial_risk_assessment", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019e3feb40f2724eb3c7c23b5625e72e", "query_template": "The following data was produced by the previous steps:\n- Input data: {{{{applicant_details}}}}\n- Eligibility assessment: {{{{step_mortgage_eligibility_assessment_output}}}}\n\nThis request relates to residential mortgage processing. Apply the relevant European mortgage lending standards and affordability regulations.\n\nTASK: Evaluate the repayment risk, probability of arrears, and overall lending exposure for the mortgage application.\n\nOUTPUT FORMAT: Respond with a raw JSON object matching the following contract:\n{\n  \"repayment_risk\": \"low | medium | high\",\n  \"probability_of_arrears\": number (0.0 to 1.0),\n  \"lending_exposure\": \"low | medium | high\",\n  \"regulatory_compliance\": boolean,\n  \"risk_factors\": [\"string\"],\n  \"mitigation_strategies\": [\"string\"]\n}\n\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["mortgage_recommendation"], "description": "Evaluates repayment risk, probability of arrears, and overall lending exposure in alignment with European mortgage lending standards."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step financial_risk_assessment failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_approval_workflow_mortgage_recommendation(variables: Dict[str, Any]) -> Any:
    """Activity for step: mortgage_recommendation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "mortgage_recommendation", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_019e3feb4261714594f45376dd11bca8", "query_template": "The following data was produced by the previous steps:\n- Input data: {{{{applicant_details}}}}\n- Eligibility assessment: {{{{step_mortgage_eligibility_assessment_output}}}}\n- Risk assessment: {{{{step_financial_risk_assessment_output}}}}\n\nThis request relates to residential mortgage processing. Apply the relevant lending criteria and product guidelines.\n\nTASK: Generate a lending recommendation (approved, declined, or conditionally approved) and indicative mortgage terms based on the applicant's eligibility and risk assessment.\n\nUse the `validate_property_details` tool to validate property details as needed.\n\nOUTPUT FORMAT: Respond with a raw JSON object matching the following contract:\n{\n  \"lending_outcome\": \"approved | declined | conditionally_approved\",\n  \"borrowing_amount\": number,\n  \"repayment_period_years\": integer,\n  \"interest_structure\": \"fixed_5_years | variable | tracker\",\n  \"estimated_monthly_instalment\": number,\n  \"conditions\": [\"string\"],\n  \"justification\": \"string\"\n}\n\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["final_response_generation"], "description": "Generates the proposed lending outcome and indicative mortgage terms."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step mortgage_recommendation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_approval_workflow_final_response_generation(variables: Dict[str, Any]) -> Any:
    """Activity for step: final_response_generation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "final_response_generation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019e3feb43b472a0b60e54f15c0bb446", "query_template": "The following data was produced by the previous steps:\n- Input data: {{{{applicant_details}}}}\n- Safety validation: {{{{step_jailbreak_moderation_output}}}}\n- Topic classification: {{{{step_topic_control_guardrail_output}}}}\n- Eligibility assessment: {{{{step_mortgage_eligibility_assessment_output}}}}\n- Risk assessment: {{{{step_financial_risk_assessment_output}}}}\n- Mortgage recommendation: {{{{step_mortgage_recommendation_output}}}}\n\nThis request relates to residential mortgage processing. Apply the relevant communication standards for this product.\n\nTASK: Consolidate all outputs into a structured, customer-friendly mortgage decision document.\n\nOUTPUT FORMAT: Respond with a markdown report using the following structure:\n## Mortgage Decision\n### Outcome (Approved/Declined/Conditionally Approved)\n### Key Terms (Borrowing Amount, Repayment Period, Interest Structure, Monthly Instalment)\n\n## Eligibility Summary\n### Affordability Metrics (DTI, LTV, Disposable Income)\n### Credit Assessment (Credit Score, Credit Risk)\n\n## Risk Assessment\n### Repayment Risk, Probability of Arrears, Lending Exposure\n### Regulatory Compliance Status\n\n## Justification\nDetailed explanation of the decision, citing specific metrics and thresholds.\n\n## Next Steps\nActions for the applicant (e.g., provide additional documents, contact advisor).\n\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["reviewer"], "description": "Consolidates outputs from upstream agents into a structured, customer-friendly mortgage decision document."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step final_response_generation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_approval_workflow_reviewer(variables: Dict[str, Any]) -> Any:
    """Activity for step: reviewer (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "reviewer", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019e3feb451176c999dd1aeb3163b654", "query_template": "The following data was produced by the previous step: {{{{step_final_response_generation_output}}}}.\n\nThis request relates to residential mortgage processing. Apply the relevant financial communication standards for this product.\n\nTASK: Review the mortgage decision document for readability, completeness, factual consistency, and compliance with financial communication standards.\n\nOUTPUT FORMAT: Respond with a raw JSON object matching the following contract:\n{\n  \"is_complete\": boolean,\n  \"readability_score\": number (0.0 to 1.0),\n  \"factual_consistency\": boolean,\n  \"compliance_status\": \"compliant | non_compliant\",\n  \"feedback\": [{\"section\": \"string\", \"issue\": \"string\", \"suggestion\": \"string\"}]\n}\n\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["output_moderation"], "description": "Reviews the final mortgage decision document for readability, completeness, factual consistency, and compliance with financial communication standards."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step reviewer failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_approval_workflow_output_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: output_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "output_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019e3feb4635715d83244bccf98566e4", "query_template": "The following data was produced by the previous steps:\n- Final response: {{{{step_final_response_generation_output}}}}\n- Review feedback: {{{{step_reviewer_output}}}}\n\nThis request relates to residential mortgage processing. Apply the relevant safety checks for this product.\n\nTASK: Perform a final safety check on the mortgage decision document before delivery to the user.\n\nOUTPUT FORMAT: Respond with a raw JSON object matching the following contract:\n{\n  \"is_safe\": boolean,\n  \"risk_level\": \"low | medium | high\",\n  \"risk_reason\": \"string\"\n}\n\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": [], "description": "Performs a final safety check on the mortgage decision document before delivery to the user."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step output_moderation failed")
    return result.output

@workflows.workflow.define(
    name="residential_mortgage_approval_workflow",
    workflow_display_name="Residential Mortgage Approval Workflow",
    workflow_description="Automates end-to-end residential mortgage approval and affordability assessment, processing applicant data, evaluating eligibility, generating lending decisions with justification, and ensuring regulatory compliance and safety.",
    execution_timeout=timedelta(hours=24),
)
class ResidentialMortgageApprovalWorkflow:
    """Durable workflow: Automates end-to-end residential mortgage approval and affordability assessment, processing applicant data, evaluating eligibility, generating lending decisions with justification, and ensuring regulatory compliance and safety."""

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
        """Execute the Residential Mortgage Approval Workflow workflow DAG."""
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
                output = await run_residential_mortgage_approval_workflow_jailbreak_moderation(variables)
                outputs["jailbreak_moderation"] = output
                self._last_result = output
                variables["step_jailbreak_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "topic_control_guardrail"

            elif current_step == "topic_control_guardrail":
                self._progress.append("topic_control_guardrail")
                output = await run_residential_mortgage_approval_workflow_topic_control_guardrail(variables)
                outputs["topic_control_guardrail"] = output
                self._last_result = output
                variables["step_topic_control_guardrail_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "mortgage_eligibility_assessment"

            elif current_step == "mortgage_eligibility_assessment":
                self._progress.append("mortgage_eligibility_assessment")
                output = await run_residential_mortgage_approval_workflow_mortgage_eligibility_assessment(variables)
                outputs["mortgage_eligibility_assessment"] = output
                self._last_result = output
                variables["step_mortgage_eligibility_assessment_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "financial_risk_assessment"

            elif current_step == "financial_risk_assessment":
                self._progress.append("financial_risk_assessment")
                output = await run_residential_mortgage_approval_workflow_financial_risk_assessment(variables)
                outputs["financial_risk_assessment"] = output
                self._last_result = output
                variables["step_financial_risk_assessment_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "mortgage_recommendation"

            elif current_step == "mortgage_recommendation":
                self._progress.append("mortgage_recommendation")
                output = await run_residential_mortgage_approval_workflow_mortgage_recommendation(variables)
                outputs["mortgage_recommendation"] = output
                self._last_result = output
                variables["step_mortgage_recommendation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "final_response_generation"

            elif current_step == "final_response_generation":
                self._progress.append("final_response_generation")
                output = await run_residential_mortgage_approval_workflow_final_response_generation(variables)
                outputs["final_response_generation"] = output
                self._last_result = output
                variables["step_final_response_generation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "reviewer"

            elif current_step == "reviewer":
                self._progress.append("reviewer")
                output = await run_residential_mortgage_approval_workflow_reviewer(variables)
                outputs["reviewer"] = output
                self._last_result = output
                variables["step_reviewer_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "output_moderation"

            elif current_step == "output_moderation":
                self._progress.append("output_moderation")
                output = await run_residential_mortgage_approval_workflow_output_moderation(variables)
                outputs["output_moderation"] = output
                self._last_result = output
                variables["step_output_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = None

            else:
                current_step = None

        return outputs
