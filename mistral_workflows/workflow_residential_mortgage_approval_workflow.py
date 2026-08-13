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
async def run_residential_mortgage_approval_workflow_fetch_application_data(variables: Dict[str, Any]) -> Any:
    """Activity for step: fetch_application_data (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "fetch_application_data", "type": "tool", "tier": null, "config": {"tool_name": "fetch_mortgage_application_data", "arguments": {"application_id": "{{application_id}}"}}, "next_steps": ["jailbreak_moderation"], "description": "Fetches residential mortgage application data including applicant financials, property details, and supporting documents.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step fetch_application_data failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_approval_workflow_jailbreak_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: jailbreak_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "jailbreak_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4bdfd2751d9a20107c77ddf696", "query_template": "The following data was produced by the previous step: {{step_fetch_application_data_output}}.\\n\\nTASK: Validate the safety of this mortgage application request. Detect any malicious, inappropriate, or unsafe content.\\n\\nOUTPUT FORMAT: Respond with a raw JSON object matching the following schema:\\n{\\n  \\"is_safe\\": boolean,\\n  \\"risk_level\\": \\"string (low | medium | high)\\",\\n  \\"risk_reason\\": \\"string (null if is_safe is true)\\"\\n}\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["check_safety"], "description": "Validates input safety and detects malicious or inappropriate requests before processing.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step jailbreak_moderation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_approval_workflow_check_safety(variables: Dict[str, Any]) -> Any:
    """Activity for step: check_safety (StepType.CONDITION)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "check_safety", "type": "condition", "tier": null, "config": {"expression": "{{step_jailbreak_moderation_output.is_safe}} == true", "true_step": "topic_control_guardrail", "false_step": "final_response_generation_reject", "fallback_step": "final_response_generation_reject"}, "next_steps": [], "description": "Checks if the input is safe for further processing.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step check_safety failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_approval_workflow_topic_control_guardrail(variables: Dict[str, Any]) -> Any:
    """Activity for step: topic_control_guardrail (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "topic_control_guardrail", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4bfd0772dda49732e8cb9c5a73", "query_template": "The following data was produced by the previous step: {{step_fetch_application_data_output}}.\\n\\nThis request relates to residential mortgages. Apply the relevant regulations and metrics for this product.\\n\\nTASK: Classify this request into the correct product type and ensure it is relevant to residential mortgages.\\n\\nOUTPUT FORMAT: Respond with a raw JSON object matching the following schema:\\n{\\n  \\"product_type\\": \\"string (residential_mortgage | other)\\",\\n  \\"is_relevant\\": boolean,\\n  \\"confidence_score\\": \\"number (0.0-1.0)\\"\\n}\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["check_relevance"], "description": "Classifies the request into the correct product type and ensures relevance to residential mortgages.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step topic_control_guardrail failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_approval_workflow_check_relevance(variables: Dict[str, Any]) -> Any:
    """Activity for step: check_relevance (StepType.CONDITION)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "check_relevance", "type": "condition", "tier": null, "config": {"expression": "{{step_topic_control_guardrail_output.is_relevant}} == true && {{step_topic_control_guardrail_output.product_type}} == \'residential_mortgage\'", "true_step": "eligibility_assessment", "false_step": "final_response_generation_reject", "fallback_step": "final_response_generation_reject"}, "next_steps": [], "description": "Checks if the request is relevant to residential mortgages.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step check_relevance failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_approval_workflow_eligibility_assessment(variables: Dict[str, Any]) -> Any:
    """Activity for step: eligibility_assessment (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "eligibility_assessment", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_019ff4974331769293a7b779a97ae670", "query_template": "The following data was produced by the previous step: {{step_fetch_application_data_output}}.\\n\\nThis request relates to residential mortgages. Apply the relevant regulations and metrics for this product.\\n\\nTASK: Assess the mortgage eligibility of this application based on LTV, affordability, and regulatory rules.\\n\\nOUTPUT FORMAT: Respond with a raw JSON object matching the following schema:\\n{\\n  \\"eligibility_status\\": \\"string (approved | conditionally_approved | rejected)\\",\\n  \\"ltv_ratio\\": \\"number\\",\\n  \\"affordability_score\\": \\"number (0-100)\\",\\n  \\"regulatory_compliance\\": boolean,\\n  \\"conditions\\": [\\"string\\"],\\n  \\"rejection_reasons\\": [\\"string\\"]\\n}\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["compile_report"], "description": "Assesses mortgage eligibility based on LTV, affordability, and regulatory rules specific to residential mortgages.", "parallel_group": "pg_core_analysis"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step eligibility_assessment failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_approval_workflow_risk_assessment(variables: Dict[str, Any]) -> Any:
    """Activity for step: risk_assessment (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "risk_assessment", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019f3627303e72a68f7d1ac2b2e7a74e", "query_template": "The following data was produced by the previous step: {{step_fetch_application_data_output}}.\\n\\nThis request relates to residential mortgages. Apply the relevant regulations and metrics for this product.\\n\\nTASK: Analyze the financial data to determine lending risk and produce a risk score and recommendation.\\n\\nOUTPUT FORMAT: Respond with a raw JSON object matching the following schema:\\n{\\n  \\"risk_score\\": \\"number (0-100)\\",\\n  \\"risk_category\\": \\"string (low | medium | high)\\",\\n  \\"recommendation\\": \\"string (approve | conditionally_approve | reject)\\",\\n  \\"risk_factors\\": [\\"string\\"],\\n  \\"mitigants\\": [\\"string\\"]\\n}\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["compile_report"], "description": "Analyzes financial data to determine lending risk, producing a risk score and recommendation.", "parallel_group": "pg_core_analysis"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step risk_assessment failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_approval_workflow_recommendation_agent(variables: Dict[str, Any]) -> Any:
    """Activity for step: recommendation_agent (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "recommendation_agent", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_019ff4974488741e8078aaa309409f98", "query_template": "The following data was produced by the previous step: {{step_fetch_application_data_output}}.\\n\\nThis request relates to residential mortgages. Apply the relevant regulations and metrics for this product.\\n\\nTASK: Generate a mortgage recommendation including fixed/variable rate options, repayment period, and LTV band.\\n\\nOUTPUT FORMAT: Respond with a raw JSON object matching the following schema:\\n{\\n  \\"recommended_rate_type\\": \\"string (fixed | variable | hybrid)\\",\\n  \\"repayment_period_years\\": \\"number\\",\\n  \\"ltv_band\\": \\"string (e.g., 60-70%)\\",\\n  \\"apr\\": \\"number\\",\\n  \\"monthly_payment\\": \\"number\\",\\n  \\"product_features\\": [\\"string\\"]\\n}\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["compile_report"], "description": "Generates a mortgage recommendation including fixed/variable rate options, repayment period, and LTV band.", "parallel_group": "pg_core_analysis"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step recommendation_agent failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_approval_workflow_compile_report(variables: Dict[str, Any]) -> Any:
    """Activity for step: compile_report (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "compile_report", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_019ff4ea32ef75b2a6b12988985bac08", "query_template": "The following data was produced by the previous steps:\\n- Eligibility Assessment: {{step_eligibility_assessment_output}}\\n- Risk Assessment: {{step_risk_assessment_output}}\\n- Recommendation: {{step_recommendation_agent_output}}\\n\\nTASK: Compile the outputs from the Mortgage Eligibility Assessor, Financial Risk Assessor, and Mortgage Recommendation Agent into a cohesive, structured mortgage approval report.\\n\\nOUTPUT FORMAT: Respond with a markdown report using the following structure:\\n## Executive Summary\\n- Brief overview of eligibility status, risk level, and recommendation.\\n\\n## Eligibility Assessment\\n- LTV ratio: [value]\\n- Affordability score: [value]\\n- Regulatory compliance: [yes/no]\\n- Conditions (if any): [list]\\n- Rejection reasons (if any): [list]\\n\\n## Financial Risk Assessment\\n- Risk score: [value]\\n- Risk category: [low/medium/high]\\n- Key risk factors: [list]\\n- Mitigants: [list]\\n\\n## Mortgage Recommendation\\n- Recommended rate type: [fixed/variable/hybrid]\\n- Repayment period: [years]\\n- LTV band: [range]\\n- APR: [value]\\n- Monthly payment: [value]\\n- Product features: [list]\\n\\n## Conditions and Next Steps\\n- List any conditions for approval or next steps for the applicant.\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["reviewer"], "description": "Compiles outputs from eligibility, risk, and recommendation agents into a structured mortgage approval report.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step compile_report failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_approval_workflow_reviewer(variables: Dict[str, Any]) -> Any:
    """Activity for step: reviewer (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "reviewer", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4d501877e38b00ef86df312bbe", "query_template": "The following data was produced by the previous step: {{step_compile_report_output}}.\\n\\nTASK: Review the mortgage approval report for readability, completeness, factual consistency, and compliance with communication standards.\\n\\nOUTPUT FORMAT: Respond with a raw JSON object matching the following schema:\\n{\\n  \\"readability_score\\": \\"number (0-100)\\",\\n  \\"completeness_score\\": \\"number (0-100)\\",\\n  \\"factual_consistency_score\\": \\"number (0-100)\\",\\n  \\"issues\\": [\\n    {\\n      \\"section\\": \\"string\\",\\n      \\"issue_description\\": \\"string\\",\\n      \\"severity\\": \\"string (low | medium | high)\\"\\n    }\\n  ],\\n  \\"suggested_improvements\\": [\\"string\\"]\\n}\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["final_response_generation"], "description": "Reviews the mortgage approval report for readability, completeness, factual consistency, and compliance with communication standards.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step reviewer failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_approval_workflow_final_response_generation(variables: Dict[str, Any]) -> Any:
    """Activity for step: final_response_generation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "final_response_generation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4c86fa768bb34e72dd8402560d", "query_template": "The following data was produced by the previous steps:\\n- Mortgage Approval Report: {{step_compile_report_output}}\\n- Reviewer Feedback: {{step_reviewer_output}}\\n\\nTASK: Consolidate the reviewed mortgage approval report into a final, customer-facing document. Incorporate any suggested improvements from the reviewer.\\n\\nOUTPUT FORMAT: Respond with a markdown report using the following structure:\\n## Summary\\n## Key Findings / Results\\n## Details\\n## Recommendations (if applicable)\\n## Next Steps (if applicable)\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["output_moderation"], "description": "Consolidates the reviewed mortgage approval report into a final, customer-facing document.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step final_response_generation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_approval_workflow_final_response_generation_reject(variables: Dict[str, Any]) -> Any:
    """Activity for step: final_response_generation_reject (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "final_response_generation_reject", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4c86fa768bb34e72dd8402560d", "query_template": "The request was rejected due to safety or relevance concerns. Generate a polite and professional rejection message.\\n\\nTASK: Create a final response indicating the request cannot be processed.\\n\\nOUTPUT FORMAT: Respond with a markdown report using the following structure:\\n## Summary\\n## Reason for Rejection\\n\\nProvide a complete, thorough response. Do not return an empty response.", "expected_output_contract": "markdown_report"}, "next_steps": ["output_moderation"], "description": "Generates a rejection response for unsafe or irrelevant requests.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step final_response_generation_reject failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_approval_workflow_output_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: output_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "output_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4da8af74d1abc1489ea4645ec3", "query_template": "The following data was produced by the previous step: {{step_final_response_generation_output}}.\\n\\nTASK: Perform a final safety and compliance check on the mortgage approval report before delivery.\\n\\nOUTPUT FORMAT: Respond with a raw JSON object matching the following schema:\\n{\\n  \\"is_safe\\": boolean,\\n  \\"compliance_status\\": \\"string (compliant | non_compliant)\\",\\n  \\"issues\\": [\\"string\\"]\\n}\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": [], "description": "Performs a final safety and compliance check on the mortgage approval report before delivery.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step output_moderation failed")
    return result.output

@workflows.workflow.define(
    name="residential_mortgage_approval_workflow",
    workflow_display_name="Residential Mortgage Approval Workflow",
    workflow_description="Automates the end-to-end assessment of a residential mortgage application, producing a structured approval report with eligibility, risk assessment, and recommendation.",
    execution_timeout=timedelta(hours=24),
)
class ResidentialMortgageApprovalWorkflow:
    """Durable workflow: Automates the end-to-end assessment of a residential mortgage application, producing a structured approval report with eligibility, risk assessment, and recommendation."""

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
        current_step: Optional[str] = "fetch_application_data"
        visited: set = set()
        outputs: Dict[str, Any] = {}

        while current_step and len(visited) < 50:
            if current_step in visited:
                break  # cycle guard
            visited.add(current_step)

            if current_step == "fetch_application_data":
                self._progress.append("fetch_application_data")
                output = await run_residential_mortgage_approval_workflow_fetch_application_data(variables)
                outputs["fetch_application_data"] = output
                self._last_result = output
                variables["step_fetch_application_data_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "jailbreak_moderation"

            elif current_step == "jailbreak_moderation":
                self._progress.append("jailbreak_moderation")
                output = await run_residential_mortgage_approval_workflow_jailbreak_moderation(variables)
                outputs["jailbreak_moderation"] = output
                self._last_result = output
                variables["step_jailbreak_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "check_safety"

            elif current_step == "check_safety":
                self._progress.append("check_safety")
                output = await run_residential_mortgage_approval_workflow_check_safety(variables)
                outputs["check_safety"] = output
                self._last_result = output
                variables["step_check_safety_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                # Condition step: output contains {next_step: ...}
                if isinstance(output, dict) and "next_step" in output:
                    current_step = output["next_step"]
                else:
                    current_step = None

            elif current_step == "topic_control_guardrail":
                self._progress.append("topic_control_guardrail")
                output = await run_residential_mortgage_approval_workflow_topic_control_guardrail(variables)
                outputs["topic_control_guardrail"] = output
                self._last_result = output
                variables["step_topic_control_guardrail_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "check_relevance"

            elif current_step == "check_relevance":
                self._progress.append("check_relevance")
                output = await run_residential_mortgage_approval_workflow_check_relevance(variables)
                outputs["check_relevance"] = output
                self._last_result = output
                variables["step_check_relevance_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                # Condition step: output contains {next_step: ...}
                if isinstance(output, dict) and "next_step" in output:
                    current_step = output["next_step"]
                else:
                    current_step = None

            elif current_step == "eligibility_assessment" or current_step == "risk_assessment" or current_step == "recommendation_agent":
                # ── Parallel group: pg_core_analysis ──
                self._progress.append("__parallel_pg_core_analysis:start")
                # Fan-out: execute 3 steps concurrently
                _parallel_results = await asyncio.gather(
                    run_residential_mortgage_approval_workflow_eligibility_assessment(dict(variables)),
                    run_residential_mortgage_approval_workflow_risk_assessment(dict(variables)),
                    run_residential_mortgage_approval_workflow_recommendation_agent(dict(variables)),
                )
                # Fan-in: merge all parallel outputs
                _parallel_names = ["eligibility_assessment", "risk_assessment", "recommendation_agent"]
                for _pname, _presult in zip(_parallel_names, _parallel_results):
                    outputs[_pname] = _presult
                    variables[f"step_{_pname}_output"] = _presult
                    if isinstance(_presult, dict):
                        variables.update(_presult)
                    self._progress.append(_pname)
                self._last_result = _parallel_results[-1]

                current_step = "compile_report"

            elif current_step == "compile_report":
                self._progress.append("compile_report")
                output = await run_residential_mortgage_approval_workflow_compile_report(variables)
                outputs["compile_report"] = output
                self._last_result = output
                variables["step_compile_report_output"] = output
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

                current_step = "final_response_generation"

            elif current_step == "final_response_generation":
                self._progress.append("final_response_generation")
                output = await run_residential_mortgage_approval_workflow_final_response_generation(variables)
                outputs["final_response_generation"] = output
                self._last_result = output
                variables["step_final_response_generation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "output_moderation"

            elif current_step == "final_response_generation_reject":
                self._progress.append("final_response_generation_reject")
                output = await run_residential_mortgage_approval_workflow_final_response_generation_reject(variables)
                outputs["final_response_generation_reject"] = output
                self._last_result = output
                variables["step_final_response_generation_reject_output"] = output
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
