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
    step_def = WorkflowStep.model_validate(json.loads('{"id": "jailbreak_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019e415a755877e6a8529cfdc9977ae3", "query_template": "CONTEXT BLOCK: The user has submitted the following mortgage application details: {{{{applicant_data}}}}.\\n\\nPRODUCT/DOMAIN CONTEXT: This request relates to residential mortgage processing. Ensure the input complies with safety and regulatory standards for financial services.\\n\\nTASK INSTRUCTION: Analyze the input for safety, compliance, and malicious intent. Classify the request and determine the appropriate action (block, sanitize, or allow).\\n\\nOUTPUT FORMAT INSTRUCTION: Respond with a raw JSON object matching the output_contract: {\\n  \\"classification\\": \\"string (safe | suspicious | restricted | malicious)\\",\\n  \\"confidence_score\\": \\"float (0.0\\u20131.0)\\",\\n  \\"explanation\\": \\"string\\",\\n  \\"action\\": \\"string (block | sanitize | allow)\\",\\n  \\"moderation_response\\": \\"object\\"\\n}.\\n\\nCOMPLETENESS DIRECTIVE: Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["topic_control_guardrail"], "description": "Validates input safety and detects malicious or non-compliant requests before processing.", "parallel_group": null}'))
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
    step_def = WorkflowStep.model_validate(json.loads('{"id": "topic_control_guardrail", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019e415ec0ec72c7816c3b75ca36a093", "query_template": "CONTEXT BLOCK: The following data was produced by the previous step: {{{{step_jailbreak_moderation_output}}}}.\\n\\nPRODUCT/DOMAIN CONTEXT: This request relates to residential mortgage processing. Classify the request into the appropriate subcategory (e.g., eligibility check, remortgage, buy-to-let).\\n\\nTASK INSTRUCTION: Determine if the request is relevant to mortgage processing and classify it accordingly. Provide routing recommendations if applicable.\\n\\nOUTPUT FORMAT INSTRUCTION: Respond with a raw JSON object matching the output_contract:\\n{\\n  \\"relevant_request\\": {\\n    \\"domain\\": \\"string (e.g., \'mortgage processing\')\\",\\n    \\"subcategory\\": \\"string (e.g., \'eligibility check\')\\",\\n    \\"confidence_score\\": \\"float (0.0\\u20131.0)\\",\\n    \\"routing_recommendation\\": \\"string\\",\\n    \\"is_safe\\": \\"boolean\\"\\n  },\\n  \\"irrelevant_request\\": {\\n    \\"reason\\": \\"string\\",\\n    \\"suggested_alternatives\\": \\"array of strings\\"\\n  }\\n}.\\n\\nCOMPLETENESS DIRECTIVE: Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["mortgage_eligibility_assessment"], "description": "Classifies user requests into mortgage processing subcategories and ensures relevance.", "parallel_group": null}'))
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
    step_def = WorkflowStep.model_validate(json.loads('{"id": "mortgage_eligibility_assessment", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_019e444af7cb7538b5815beb4038513e", "query_template": "CONTEXT BLOCK: The following data was produced by the previous steps:\\n- User input: {{{{applicant_data}}}}\\n- Moderation result: {{{{step_jailbreak_moderation_output}}}}\\n- Topic classification: {{{{step_topic_control_guardrail_output}}}}\\n\\nPRODUCT/DOMAIN CONTEXT: This request relates to residential mortgage processing. Apply European mortgage lending standards and affordability regulations.\\n\\nTASK INSTRUCTION: Analyze the borrower\'s financial profile (income, debt, credit history, property details) to determine preliminary mortgage eligibility. Calculate key metrics (DTI, LTV) and assign a confidence score.\\n\\nOUTPUT FORMAT INSTRUCTION: Respond with a raw JSON object matching the output_contract:\\n{\\n  \\"eligibility_status\\": \\"string (approved | declined | conditionally_approved)\\",\\n  \\"confidence_score\\": \\"float (0.0\\u20131.0)\\",\\n  \\"affordability_metrics\\": {\\n    \\"gross_annual_income\\": \\"float\\",\\n    \\"debt_to_income_ratio\\": \\"float\\",\\n    \\"loan_to_value_ratio\\": \\"float\\",\\n    \\"credit_score\\": \\"integer\\",\\n    \\"employment_status\\": \\"string\\",\\n    \\"existing_commitments\\": \\"float\\"\\n  },\\n  \\"justification\\": \\"string (detailed explanation of eligibility decision)\\"\\n}.\\n\\nCOMPLETENESS DIRECTIVE: Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["financial_risk_assessment"], "description": "Evaluates borrower affordability metrics to determine preliminary mortgage eligibility with a confidence score.", "parallel_group": null}'))
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
    step_def = WorkflowStep.model_validate(json.loads('{"id": "financial_risk_assessment", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019e444af8ec753eb3492c17aff82687", "query_template": "CONTEXT BLOCK: The following data was produced by the previous steps:\\n- User input: {{{{applicant_data}}}}\\n- Eligibility assessment: {{{{step_mortgage_eligibility_assessment_output}}}}\\n\\nPRODUCT/DOMAIN CONTEXT: This request relates to residential mortgage processing. Apply European mortgage lending standards and risk assessment guidelines.\\n\\nTASK INSTRUCTION: Evaluate the repayment risk, probability of arrears, and overall lending exposure for the mortgage application. Provide risk factors and mitigation strategies.\\n\\nOUTPUT FORMAT INSTRUCTION: Respond with a raw JSON object matching the output_contract:\\n{\\n  \\"risk_level\\": \\"string (low | medium | high)\\",\\n  \\"probability_of_arrears\\": \\"float (0.0\\u20131.0)\\",\\n  \\"lending_exposure\\": \\"float (monetary value)\\",\\n  \\"regulatory_alignment\\": \\"boolean\\",\\n  \\"risk_factors\\": \\"array of strings\\",\\n  \\"mitigation_strategies\\": \\"array of strings\\"\\n}.\\n\\nCOMPLETENESS DIRECTIVE: Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["mortgage_recommendation"], "description": "Evaluates repayment risk, probability of arrears, and lending exposure for mortgage applications.", "parallel_group": null}'))
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
    step_def = WorkflowStep.model_validate(json.loads('{"id": "mortgage_recommendation", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_019e444afa0373dcaeb293eaabbc0d1c", "query_template": "CONTEXT BLOCK: The following data was produced by the previous steps:\\n- User input: {{{{applicant_data}}}}\\n- Eligibility assessment: {{{{step_mortgage_eligibility_assessment_output}}}}\\n- Risk assessment: {{{{step_financial_risk_assessment_output}}}}\\n\\nPRODUCT/DOMAIN CONTEXT: This request relates to residential mortgage processing. Apply regulatory constraints and borrower affordability metrics.\\n\\nTASK INSTRUCTION: Generate proposed mortgage terms (borrowing amount, repayment period, interest structure) based on eligibility and risk assessments. Ensure terms align with borrower affordability and regulatory standards.\\n\\nOUTPUT FORMAT INSTRUCTION: Respond with a raw JSON object matching the output_contract:\\n{\\n  \\"lending_outcome\\": \\"string (approved | declined | conditionally_approved)\\",\\n  \\"proposed_terms\\": {\\n    \\"borrowing_amount\\": \\"float\\",\\n    \\"repayment_period_years\\": \\"integer\\",\\n    \\"interest_structure\\": \\"string (fixed | variable | tracker)\\",\\n    \\"estimated_monthly_instalment\\": \\"float\\",\\n    \\"ltv_band\\": \\"string (e.g., \'75-80%\')\\",\\n    \\"conditions\\": \\"array of strings\\"\\n  },\\n  \\"justification\\": \\"string (detailed explanation of terms and conditions)\\"\\n}.\\n\\nCOMPLETENESS DIRECTIVE: Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["final_response_generation"], "description": "Generates proposed mortgage terms (borrowing amount, repayment period, interest structure) based on eligibility and risk assessments.", "parallel_group": null}'))
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
    step_def = WorkflowStep.model_validate(json.loads('{"id": "final_response_generation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019e444afb167370ba294ef532bd42be", "query_template": "CONTEXT BLOCK: The following data was produced by the previous steps:\\n- User input: {{{{applicant_data}}}}\\n- Moderation result: {{{{step_jailbreak_moderation_output}}}}\\n- Topic classification: {{{{step_topic_control_guardrail_output}}}}\\n- Eligibility assessment: {{{{step_mortgage_eligibility_assessment_output}}}}\\n- Risk assessment: {{{{step_financial_risk_assessment_output}}}}\\n- Mortgage recommendation: {{{{step_mortgage_recommendation_output}}}}\\n\\nPRODUCT/DOMAIN CONTEXT: This request relates to residential mortgage processing. Synthesize all outputs into a clear, structured, and customer-friendly report.\\n\\nTASK INSTRUCTION: Consolidate all outputs into a markdown report with the following sections:\\n## Mortgage Decision Summary\\n## Eligibility Assessment\\n## Risk Evaluation\\n## Proposed Terms\\n## Next Steps\\n\\nEnsure the report is readable, complete, and compliant with financial communication standards.\\n\\nOUTPUT FORMAT INSTRUCTION: Respond with a markdown report matching the output_contract:\\nmarkdown_report.\\n\\nCOMPLETENESS DIRECTIVE: Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["reviewer"], "description": "Consolidates outputs from upstream agents into a structured, customer-friendly mortgage decision document.", "parallel_group": null}'))
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
    step_def = WorkflowStep.model_validate(json.loads('{"id": "reviewer", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019e444afc40746d907cd3d688988184", "query_template": "CONTEXT BLOCK: The following data was produced by the previous step: {{{{step_final_response_generation_output}}}}.\\n\\nPRODUCT/DOMAIN CONTEXT: This request relates to residential mortgage processing. Review the final response for quality and compliance.\\n\\nTASK INSTRUCTION: Review the final mortgage decision document for readability, completeness, factual consistency, and compliance with financial communication standards. Provide scores and identify any issues.\\n\\nOUTPUT FORMAT INSTRUCTION: Respond with a raw JSON object matching the output_contract:\\n{\\n  \\"readability_score\\": \\"float (0.0\\u20131.0)\\",\\n  \\"completeness_score\\": \\"float (0.0\\u20131.0)\\",\\n  \\"factual_consistency_score\\": \\"float (0.0\\u20131.0)\\",\\n  \\"compliance_score\\": \\"float (0.0\\u20131.0)\\",\\n  \\"issues\\": \\"array of objects\\",\\n  \\"approved\\": \\"boolean\\"\\n}.\\n\\nCOMPLETENESS DIRECTIVE: Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["output_moderation"], "description": "Reviews the final mortgage decision document for readability, completeness, factual consistency, and compliance.", "parallel_group": null}'))
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
    step_def = WorkflowStep.model_validate(json.loads('{"id": "output_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019e444afd5a741fa2a4bac91f19f4d6", "query_template": "CONTEXT BLOCK: The following data was produced by the previous steps:\\n- Final response: {{{{step_final_response_generation_output}}}}\\n- Reviewer output: {{{{step_reviewer_output}}}}\\n\\nPRODUCT/DOMAIN CONTEXT: This request relates to residential mortgage processing. Perform a final safety and compliance check before delivery.\\n\\nTASK INSTRUCTION: Validate the final mortgage decision document for safety, compliance, and regulatory alignment. Determine the appropriate action (allow, block, or sanitize).\\n\\nOUTPUT FORMAT INSTRUCTION: Respond with a raw JSON object matching the output_contract:\\n{\\n  \\"is_safe\\": \\"boolean\\",\\n  \\"moderation_notes\\": \\"string\\",\\n  \\"action\\": \\"string (allow | block | sanitize)\\"\\n}.\\n\\nCOMPLETENESS DIRECTIVE: Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": [], "description": "Performs a final safety and compliance check on the mortgage decision document before delivery to the user.", "parallel_group": null}'))
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
