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
async def run_residential_mortgage_assessment_workflow_jailbreak_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: jailbreak_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "jailbreak_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4bdfd2751d9a20107c77ddf696", "query_template": "The following data was provided by the user: {{{{document_text}}}} and {{{{bank_statement_text}}}}.\\n\\nThis request relates to a residential mortgage application. Validate the input for safety and detect any malicious or inappropriate content.\\n\\nTask: Assess the safety of the input data and determine if it is safe to proceed with the mortgage assessment workflow.\\n\\nOutput format: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"is_safe\\": boolean,\\n  \\"risk_level\\": \\"string (enum: [\'low\', \'medium\', \'high\'])\\",\\n  \\"risk_reasons\\": \\"array of strings\\"\\n}\\n```\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["topic_control_guardrail"], "description": "Validates input safety and detects malicious requests before processing.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step jailbreak_moderation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_assessment_workflow_topic_control_guardrail(variables: Dict[str, Any]) -> Any:
    """Activity for step: topic_control_guardrail (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "topic_control_guardrail", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4bfd0772dda49732e8cb9c5a73", "query_template": "The following data was provided by the user: {{{{document_text}}}} and {{{{bank_statement_text}}}}.\\n\\nThis request relates to a mortgage application. Classify the request into the correct product sub-type (e.g., \'residential_mortgage\') and ensure it is relevant for processing.\\n\\nTask: Classify the request and confirm its relevance for a residential mortgage assessment.\\n\\nOutput format: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"product_type\\": \\"string (e.g., \'residential_mortgage\')\\",\\n  \\"is_relevant\\": boolean,\\n  \\"classification_confidence\\": \\"number (0.0 to 1.0)\\"\\n}\\n```\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["extract_applicant_details"], "description": "Classifies the request into the correct product sub-type and ensures relevance.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step topic_control_guardrail failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_assessment_workflow_extract_applicant_details(variables: Dict[str, Any]) -> Any:
    """Activity for step: extract_applicant_details (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "extract_applicant_details", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019ff4fee37373e1aef1ec67d7702f76", "query_template": "The following data was provided by the user: {{{{document_text}}}}.\\n\\nThis request relates to a residential mortgage application. Extract structured applicant details, including personal information, employment details, income, assets, and liabilities.\\n\\nTask: Use the `extract_applicant_details` tool to process the document text and return structured data.\\n\\nOutput format: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"applicant_details\\": {\\n    \\"applicant_name\\": \\"string\\",\\n    \\"applicant_address\\": \\"string\\",\\n    \\"employer_name\\": \\"string\\",\\n    \\"employment_status\\": \\"string\\",\\n    \\"annual_income\\": number,\\n    \\"other_income_sources\\": [\\n      {\\n        \\"source\\": \\"string\\",\\n        \\"amount\\": number\\n      }\\n    ],\\n    \\"assets\\": [\\n      {\\n        \\"type\\": \\"string\\",\\n        \\"value\\": number\\n      }\\n    ],\\n    \\"liabilities\\": [\\n      {\\n        \\"type\\": \\"string\\",\\n        \\"amount\\": number\\n      }\\n    ]\\n  },\\n  \\"extraction_confidence\\": \\"number (0.0 to 1.0)\\"\\n}\\n```\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["verify_income"], "description": "Extracts structured applicant details from unstructured mortgage application documents.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step extract_applicant_details failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_assessment_workflow_verify_income(variables: Dict[str, Any]) -> Any:
    """Activity for step: verify_income (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "verify_income", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019ff4fee48771f4987b5120c2bac1b8", "query_template": "The following data was provided by the user: {{{{bank_statement_text}}}} and the extracted applicant details: {{{{step_extract_applicant_details_output}}}}.\\n\\nThis request relates to a residential mortgage application. Verify the applicant\'s declared income against their bank statements.\\n\\nTask: Use the `verify_income_against_bank_statements` tool to analyze transaction patterns and identify discrepancies between the declared income and actual deposits.\\n\\nOutput format: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"verification_status\\": \\"string (enum: [\'verified\', \'partially_verified\', \'not_verified\'])\\",\\n  \\"confidence_score\\": \\"number (0.0 to 1.0)\\",\\n  \\"discrepancies\\": [\\n    {\\n      \\"description\\": \\"string\\",\\n      \\"expected_amount\\": number,\\n      \\"actual_amount\\": number\\n    }\\n  ],\\n  \\"verified_income\\": number\\n}\\n```\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["risk_assessment", "eligibility_assessment"], "description": "Verifies the applicant\'s declared income against bank statements.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step verify_income failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_assessment_workflow_risk_assessment(variables: Dict[str, Any]) -> Any:
    """Activity for step: risk_assessment (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "risk_assessment", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019f3627303e72a68f7d1ac2b2e7a74e", "query_template": "The following data was produced by previous steps: applicant details {{{{step_extract_applicant_details_output}}}}, income verification {{{{step_verify_income_output}}}}.\\n\\nThis request relates to a residential mortgage. Analyze the applicant\'s financial data to determine lending risk, producing a risk score and actionable recommendation.\\n\\nTask: Assess the financial risk based on the provided data and generate a risk score, risk assessment, and recommendation.\\n\\nOutput format: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"risk_score\\": \\"number (0.0 to 1.0)\\",\\n  \\"risk_assessment\\": \\"string (enum: [\'low\', \'medium\', \'high\'])\\",\\n  \\"recommendation\\": \\"string (enum: [\'approve\', \'conditionally_approve\', \'reject\'])\\",\\n  \\"risk_factors\\": \\"array of strings\\"\\n}\\n```\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["compile_report"], "description": "Analyzes customer financial data to determine lending risk.", "parallel_group": "pg_core_analysis"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step risk_assessment failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_assessment_workflow_eligibility_assessment(variables: Dict[str, Any]) -> Any:
    """Activity for step: eligibility_assessment (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "eligibility_assessment", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_019ff4974331769293a7b779a97ae670", "query_template": "The following data was produced by previous steps: applicant details {{{{step_extract_applicant_details_output}}}}, income verification {{{{step_verify_income_output}}}}.\\n\\nThis request relates to a residential mortgage. Assess the applicant\'s eligibility based on LTV ratio, affordability, and regulatory rules.\\n\\nTask: Calculate the LTV ratio, affordability score, and determine eligibility status.\\n\\nOutput format: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"ltv_ratio\\": number,\\n  \\"affordability_score\\": \\"number (0.0 to 1.0)\\",\\n  \\"eligibility_status\\": \\"string (enum: [\'approved\', \'conditionally_approved\', \'rejected\'])\\",\\n  \\"eligibility_reasons\\": \\"array of strings\\"\\n}\\n```\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["compile_report"], "description": "Assesses mortgage eligibility based on LTV, affordability, and regulatory rules.", "parallel_group": "pg_core_analysis"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step eligibility_assessment failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_assessment_workflow_compile_report(variables: Dict[str, Any]) -> Any:
    """Activity for step: compile_report (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "compile_report", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_019ff4ea32ef75b2a6b12988985bac08", "query_template": "The following data was produced by previous steps: applicant details {{{{step_extract_applicant_details_output}}}}, income verification {{{{step_verify_income_output}}}}, risk assessment {{{{step_risk_assessment_output}}}}, eligibility assessment {{{{step_eligibility_assessment_output}}}}.\\n\\nThis request relates to a residential mortgage. Compile the outputs into a structured mortgage approval report.\\n\\nTask: Synthesize the data into a markdown report with the following sections:\\n## Applicant Details\\n## Income Verification\\n## Mortgage Eligibility Assessment\\n## Financial Risk Assessment\\n## Mortgage Recommendation\\n## Final Decision\\n\\nOutput format: Respond with a markdown report using the specified section headers and structured data.\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["generate_recommendation"], "description": "Compiles outputs from eligibility, risk, and recommendation agents into a structured mortgage approval report.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step compile_report failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_assessment_workflow_generate_recommendation(variables: Dict[str, Any]) -> Any:
    """Activity for step: generate_recommendation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "generate_recommendation", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_019ff4974488741e8078aaa309409f98", "query_template": "The following data was produced by previous steps: applicant details {{{{step_extract_applicant_details_output}}}}, income verification {{{{step_verify_income_output}}}}, risk assessment {{{{step_risk_assessment_output}}}}, eligibility assessment {{{{step_eligibility_assessment_output}}}}.\\n\\nThis request relates to a residential mortgage. Generate a mortgage recommendation including fixed/variable rate options, repayment period, and LTV band.\\n\\nTask: Provide a recommendation for the mortgage terms based on the applicant\'s financial profile and eligibility.\\n\\nOutput format: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"recommended_rate_type\\": \\"string (enum: [\'fixed\', \'variable\'])\\",\\n  \\"recommended_repayment_period\\": \\"number (in years)\\",\\n  \\"recommended_ltv_band\\": \\"string (e.g., \'60-70%\', \'70-80%\')\\",\\n  \\"apr\\": number,\\n  \\"recommendation_reasons\\": \\"array of strings\\"\\n}\\n```\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["final_response_generation"], "description": "Generates a mortgage recommendation including fixed/variable rate options, repayment period, and LTV band.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step generate_recommendation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_assessment_workflow_final_response_generation(variables: Dict[str, Any]) -> Any:
    """Activity for step: final_response_generation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "final_response_generation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4c86fa768bb34e72dd8402560d", "query_template": "The following data was produced by previous steps: applicant details {{{{step_extract_applicant_details_output}}}}, income verification {{{{step_verify_income_output}}}}, risk assessment {{{{step_risk_assessment_output}}}}, eligibility assessment {{{{step_eligibility_assessment_output}}}}, mortgage recommendation {{{{step_generate_recommendation_output}}}}, compiled report {{{{step_compile_report_output}}}}.\\n\\nThis request relates to a residential mortgage. Consolidate all outputs into a structured, customer-facing mortgage approval response.\\n\\nTask: Synthesize all previous outputs into a final markdown report with the following structure:\\n# Mortgage Application Decision\\n## Summary of Assessment\\n## Key Findings\\n## Next Steps\\n\\nOutput format: Respond with a markdown report using the specified section headers and structured data.\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["reviewer"], "description": "Consolidates all upstream outputs into a structured, customer-facing mortgage approval response.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step final_response_generation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_assessment_workflow_reviewer(variables: Dict[str, Any]) -> Any:
    """Activity for step: reviewer (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "reviewer", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4d501877e38b00ef86df312bbe", "query_template": "The following data was produced by the final response generation step: {{{{step_final_response_generation_output}}}}.\\n\\nThis request relates to a residential mortgage. Review the final report for completeness, consistency, and adherence to communication standards.\\n\\nTask: Provide feedback on the report\'s structure, clarity, and completeness. Suggest improvements if necessary.\\n\\nOutput format: Respond with a markdown report using the following sections:\\n## Review Summary\\n## Completeness Check\\n## Consistency Check\\n## Suggested Improvements\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["output_moderation"], "description": "Reviews the final report for completeness, consistency, and adherence to communication standards.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step reviewer failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_mortgage_assessment_workflow_output_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: output_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "output_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4da8af74d1abc1489ea4645ec3", "query_template": "The following data was produced by the reviewer step: {{{{step_reviewer_output}}}} and the final response: {{{{step_final_response_generation_output}}}}.\\n\\nThis request relates to a residential mortgage. Validate the final response for safety, compliance, and appropriateness.\\n\\nTask: Assess the final response for compliance and safety before delivery to the customer.\\n\\nOutput format: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"is_safe\\": boolean,\\n  \\"compliance_status\\": \\"string (enum: [\'compliant\', \'non_compliant\'])\\",\\n  \\"moderation_reasons\\": \\"array of strings\\"\\n}\\n```\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": [], "description": "Validates the final response for safety, compliance, and appropriateness before delivery.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step output_moderation failed")
    return result.output

@workflows.workflow.define(
    name="residential_mortgage_assessment_workflow",
    workflow_display_name="Residential Mortgage Assessment Workflow",
    workflow_description="Automates the end-to-end assessment of a residential mortgage application, including document extraction, income verification, LTV calculation, affordability checks, and approval recommendation.",
    execution_timeout=timedelta(hours=24),
)
class ResidentialMortgageAssessmentWorkflow:
    """Durable workflow: Automates the end-to-end assessment of a residential mortgage application, including document extraction, income verification, LTV calculation, affordability checks, and approval recommendation."""

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
        """Execute the Residential Mortgage Assessment Workflow workflow DAG."""
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
                output = await run_residential_mortgage_assessment_workflow_jailbreak_moderation(variables)
                outputs["jailbreak_moderation"] = output
                self._last_result = output
                variables["step_jailbreak_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "topic_control_guardrail"

            elif current_step == "topic_control_guardrail":
                self._progress.append("topic_control_guardrail")
                output = await run_residential_mortgage_assessment_workflow_topic_control_guardrail(variables)
                outputs["topic_control_guardrail"] = output
                self._last_result = output
                variables["step_topic_control_guardrail_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "extract_applicant_details"

            elif current_step == "extract_applicant_details":
                self._progress.append("extract_applicant_details")
                output = await run_residential_mortgage_assessment_workflow_extract_applicant_details(variables)
                outputs["extract_applicant_details"] = output
                self._last_result = output
                variables["step_extract_applicant_details_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "verify_income"

            elif current_step == "verify_income":
                self._progress.append("verify_income")
                output = await run_residential_mortgage_assessment_workflow_verify_income(variables)
                outputs["verify_income"] = output
                self._last_result = output
                variables["step_verify_income_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "risk_assessment"

            elif current_step == "risk_assessment" or current_step == "eligibility_assessment":
                # ── Parallel group: pg_core_analysis ──
                self._progress.append("__parallel_pg_core_analysis:start")
                # Fan-out: execute 2 steps concurrently
                _parallel_results = await asyncio.gather(
                    run_residential_mortgage_assessment_workflow_risk_assessment(dict(variables)),
                    run_residential_mortgage_assessment_workflow_eligibility_assessment(dict(variables)),
                )
                # Fan-in: merge all parallel outputs
                _parallel_names = ["risk_assessment", "eligibility_assessment"]
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
                output = await run_residential_mortgage_assessment_workflow_compile_report(variables)
                outputs["compile_report"] = output
                self._last_result = output
                variables["step_compile_report_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "generate_recommendation"

            elif current_step == "generate_recommendation":
                self._progress.append("generate_recommendation")
                output = await run_residential_mortgage_assessment_workflow_generate_recommendation(variables)
                outputs["generate_recommendation"] = output
                self._last_result = output
                variables["step_generate_recommendation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "final_response_generation"

            elif current_step == "final_response_generation":
                self._progress.append("final_response_generation")
                output = await run_residential_mortgage_assessment_workflow_final_response_generation(variables)
                outputs["final_response_generation"] = output
                self._last_result = output
                variables["step_final_response_generation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "reviewer"

            elif current_step == "reviewer":
                self._progress.append("reviewer")
                output = await run_residential_mortgage_assessment_workflow_reviewer(variables)
                outputs["reviewer"] = output
                self._last_result = output
                variables["step_reviewer_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "output_moderation"

            elif current_step == "output_moderation":
                self._progress.append("output_moderation")
                output = await run_residential_mortgage_assessment_workflow_output_moderation(variables)
                outputs["output_moderation"] = output
                self._last_result = output
                variables["step_output_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = None

            else:
                current_step = None

        return outputs
