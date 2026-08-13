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
async def run_commercial_property_subsidence_claim_settlement_jailbreak_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: jailbreak_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "jailbreak_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4bdfd2751d9a20107c77ddf696", "query_template": "CONTEXT BLOCK: The user has submitted a commercial property insurance claim for subsidence damage. The following input data is provided: {{{{claim_document}}}.\\n\\nPRODUCT/DOMAIN CONTEXT: This request relates to commercial property insurance claims. Apply the relevant safety and compliance policies for this product type.\\n\\nTASK INSTRUCTION: Validate the input for safety, malicious intent, and compliance with platform policies. Check for inappropriate content, fraud indicators, or policy violations.\\n\\nOUTPUT FORMAT INSTRUCTION: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"is_safe\\": boolean,\\n  \\"moderation_notes\\": \\"string (detailed explanation if input is flagged)\\"\\n}\\n```\\n\\nCOMPLETENESS DIRECTIVE: Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["topic_control_guardrail"], "description": "Validates input for safety, malicious intent, and compliance with platform policies.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step jailbreak_moderation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_commercial_property_subsidence_claim_settlement_topic_control_guardrail(variables: Dict[str, Any]) -> Any:
    """Activity for step: topic_control_guardrail (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "topic_control_guardrail", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4bfd0772dda49732e8cb9c5a73", "query_template": "CONTEXT BLOCK: The following input data was produced by the previous step: {{{{step_jailbreak_moderation_output}}}}. The user has submitted a claim document: {{{{claim_document}}}}.\\n\\nPRODUCT/DOMAIN CONTEXT: This request relates to commercial property insurance claims. Ensure the input is relevant to subsidence damage for this product type.\\n\\nTASK INSTRUCTION: Classify the input request into the correct product type (commercial_property_insurance) and verify its relevance to subsidence damage. Flag irrelevant or off-topic requests.\\n\\nOUTPUT FORMAT INSTRUCTION: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"product_type\\": \\"string (enum: commercial_property_insurance)\\",\\n  \\"is_relevant\\": boolean,\\n  \\"classification_notes\\": \\"string (detailed explanation if input is irrelevant)\\"\\n}\\n```\\n\\nCOMPLETENESS DIRECTIVE: Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["extract_claim_details"], "description": "Classifies the input request into the correct product type and ensures relevance to subsidence damage.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step topic_control_guardrail failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_commercial_property_subsidence_claim_settlement_extract_claim_details(variables: Dict[str, Any]) -> Any:
    """Activity for step: extract_claim_details (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "extract_claim_details", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019ff4fee37373e1aef1ec67d7702f76", "query_template": "CONTEXT BLOCK: The following input data was produced by the previous steps: {{{{step_jailbreak_moderation_output}}}}, {{{{step_topic_control_guardrail_output}}}}. The user has submitted a claim document: {{{{claim_document}}}}.\\n\\nPRODUCT/DOMAIN CONTEXT: This request relates to commercial property insurance claims. Extract structured data relevant to subsidence damage claims.\\n\\nTASK INSTRUCTION: Extract structured claim details from the unstructured claim document, including property information, damage description, and claimant details.\\n\\nOUTPUT FORMAT INSTRUCTION: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"claim_id\\": \\"string\\",\\n  \\"claimant\\": {\\n    \\"name\\": \\"string\\",\\n    \\"contact\\": \\"string\\"\\n  },\\n  \\"property\\": {\\n    \\"address\\": \\"string\\",\\n    \\"property_type\\": \\"string\\"\\n  },\\n  \\"damage_description\\": \\"string\\",\\n  \\"incident_date\\": \\"string (ISO date)\\",\\n  \\"claim_amount\\": number\\n}\\n```\\n\\nCOMPLETENESS DIRECTIVE: Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["verify_claim_details", "assess_subsidence_damage"], "description": "Extracts structured claim details from unstructured claim documents.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step extract_claim_details failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_commercial_property_subsidence_claim_settlement_verify_claim_details(variables: Dict[str, Any]) -> Any:
    """Activity for step: verify_claim_details (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "verify_claim_details", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019ff5aacc5c77c195fb83e4156109f3", "query_template": "CONTEXT BLOCK: The following input data was produced by the previous steps: {{{{step_jailbreak_moderation_output}}}}, {{{{step_topic_control_guardrail_output}}}}, {{{{step_extract_claim_details_output}}}}.\\n\\nPRODUCT/DOMAIN CONTEXT: This request relates to commercial property insurance claims. Verify the claim details using external data sources relevant to subsidence damage.\\n\\nTASK INSTRUCTION: Verify the claim details against property records, weather data, and geological data. Identify discrepancies and assess risk factors related to subsidence.\\n\\nOUTPUT FORMAT INSTRUCTION: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"claim_id\\": \\"string\\",\\n  \\"verification_status\\": \\"verified | partially_verified | unverified\\",\\n  \\"property_verified\\": boolean,\\n  \\"weather_risk\\": \\"low | medium | high\\",\\n  \\"geological_risk\\": \\"low | medium | high\\",\\n  \\"discrepancies\\": [\\n    {\\n      \\"field\\": \\"string\\",\\n      \\"expected\\": \\"string\\",\\n      \\"actual\\": \\"string\\",\\n      \\"notes\\": \\"string\\"\\n    }\\n  ]\\n}\\n```\\n\\nCOMPLETENESS DIRECTIVE: Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["compile_settlement_report"], "description": "Verifies claim details against external data sources (property records, weather data, geological data).", "parallel_group": "pg_core_analysis"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step verify_claim_details failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_commercial_property_subsidence_claim_settlement_assess_subsidence_damage(variables: Dict[str, Any]) -> Any:
    """Activity for step: assess_subsidence_damage (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "assess_subsidence_damage", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_019ff5aacc467731bf020bf357c3f71b", "query_template": "CONTEXT BLOCK: The following input data was produced by the previous steps: {{{{step_jailbreak_moderation_output}}}}, {{{{step_topic_control_guardrail_output}}}}, {{{{step_extract_claim_details_output}}}}.\\n\\nPRODUCT/DOMAIN CONTEXT: This request relates to commercial property insurance claims for subsidence damage. Assess the damage and risk factors specific to this use case.\\n\\nTASK INSTRUCTION: Assess the subsidence damage described in the claim, evaluate structural impact, and determine repair feasibility. Provide a recommendation based on risk factors.\\n\\nOUTPUT FORMAT INSTRUCTION: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"claim_id\\": \\"string\\",\\n  \\"damage_severity\\": \\"minor | moderate | severe\\",\\n  \\"structural_impact\\": \\"none | partial | extensive\\",\\n  \\"repair_feasibility\\": \\"feasible | challenging | unfeasible\\",\\n  \\"risk_factors\\": [\\n    {\\n      \\"factor\\": \\"string\\",\\n      \\"severity\\": \\"low | medium | high\\",\\n      \\"notes\\": \\"string\\"\\n    }\\n  ],\\n  \\"recommendation\\": \\"approve | investigate_further | reject\\"\\n}\\n```\\n\\nCOMPLETENESS DIRECTIVE: Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["generate_settlement_recommendation"], "description": "Assesses subsidence damage and risk factors specific to commercial property insurance claims.", "parallel_group": "pg_core_analysis"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step assess_subsidence_damage failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_commercial_property_subsidence_claim_settlement_generate_settlement_recommendation(variables: Dict[str, Any]) -> Any:
    """Activity for step: generate_settlement_recommendation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "generate_settlement_recommendation", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_019ff5aacc567088ac018ff2dfc09c0a", "query_template": "CONTEXT BLOCK: The following input data was produced by the previous steps: {{{{step_jailbreak_moderation_output}}}}, {{{{step_topic_control_guardrail_output}}}}, {{{{step_extract_claim_details_output}}}}, {{{{step_assess_subsidence_damage_output}}}}.\\n\\nPRODUCT/DOMAIN CONTEXT: This request relates to commercial property insurance claims. Generate a settlement recommendation based on the damage assessment and policy terms.\\n\\nTASK INSTRUCTION: Generate a settlement recommendation for the claim, including payout amount, conditions, and next steps. Justify the recommendation with evidence from the assessment.\\n\\nOUTPUT FORMAT INSTRUCTION: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"claim_id\\": \\"string\\",\\n  \\"recommended_payout\\": number,\\n  \\"payout_conditions\\": [\\n    {\\n      \\"condition\\": \\"string\\",\\n      \\"details\\": \\"string\\"\\n    }\\n  ],\\n  \\"next_steps\\": [\\"string\\"],\\n  \\"justification\\": \\"string\\"\\n}\\n```\\n\\nCOMPLETENESS DIRECTIVE: Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["compile_settlement_report"], "description": "Generates a settlement recommendation for the claim based on damage assessment and verification data.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step generate_settlement_recommendation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_commercial_property_subsidence_claim_settlement_compile_settlement_report(variables: Dict[str, Any]) -> Any:
    """Activity for step: compile_settlement_report (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "compile_settlement_report", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_019ff5aacc5c77c195fb83e4156109f3", "query_template": "CONTEXT BLOCK: The following input data was produced by the previous steps: {{{{step_jailbreak_moderation_output}}}}, {{{{step_topic_control_guardrail_output}}}}, {{{{step_extract_claim_details_output}}}}, {{{{step_verify_claim_details_output}}}}, {{{{step_assess_subsidence_damage_output}}}}, {{{{step_generate_settlement_recommendation_output}}}}.\\n\\nPRODUCT/DOMAIN CONTEXT: This request relates to commercial property insurance claims. Compile the outputs into a structured settlement report for review.\\n\\nTASK INSTRUCTION: Compile the outputs from the Claim Verification Agent, Subsidence Damage Assessor, and Settlement Recommendation Agent into a cohesive, structured settlement report.\\n\\nOUTPUT FORMAT INSTRUCTION: Respond with a markdown report using the following structure:\\n```markdown\\n# Insurance Settlement Report\\n\\n## Claim Summary\\n- **Claim ID**: string\\n- **Claimant**: string\\n- **Property Address**: string\\n- **Incident Date**: string (ISO date)\\n- **Claim Amount**: number\\n\\n## Verification Results\\n- **Verification Status**: string (verified | partially_verified | unverified)\\n- **Property Verified**: boolean\\n- **Weather Risk**: string (low | medium | high)\\n- **Geological Risk**: string (low | medium | high)\\n- **Discrepancies**:\\n  - field: string, expected: string, actual: string, notes: string\\n\\n## Damage Assessment\\n- **Damage Severity**: string (minor | moderate | severe)\\n- **Structural Impact**: string (none | partial | extensive)\\n- **Repair Feasibility**: string (feasible | challenging | unfeasible)\\n- **Risk Factors**:\\n  - factor: string, severity: string (low | medium | high), notes: string\\n\\n## Settlement Recommendation\\n- **Recommended Payout**: number\\n- **Payout Conditions**:\\n  - condition: string, details: string\\n- **Next Steps**: [string]\\n- **Justification**: string\\n```\\n\\nCOMPLETENESS DIRECTIVE: Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["review_settlement_report"], "description": "Compiles outputs from verification, assessment, and recommendation agents into a structured settlement report.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step compile_settlement_report failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_commercial_property_subsidence_claim_settlement_review_settlement_report(variables: Dict[str, Any]) -> Any:
    """Activity for step: review_settlement_report (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "review_settlement_report", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4d501877e38b00ef86df312bbe", "query_template": "CONTEXT BLOCK: The following input data was produced by the previous steps: {{{{step_compile_settlement_report_output}}}}.\\n\\nPRODUCT/DOMAIN CONTEXT: This request relates to commercial property insurance claims. Review the settlement report for quality and consistency.\\n\\nTASK INSTRUCTION: Review the settlement report for completeness, factual consistency, and adherence to communication standards. Identify any issues and suggest improvements.\\n\\nOUTPUT FORMAT INSTRUCTION: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"is_complete\\": boolean,\\n  \\"consistency_issues\\": [\\n    {\\n      \\"section\\": \\"string\\",\\n      \\"issue\\": \\"string\\",\\n      \\"suggestion\\": \\"string\\"\\n    }\\n  ],\\n  \\"readability_score\\": number (1-10),\\n  \\"review_notes\\": \\"string\\"\\n}\\n```\\n\\nCOMPLETENESS DIRECTIVE: Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["output_moderation"], "description": "Reviews the settlement report for completeness, factual consistency, and adherence to communication standards.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step review_settlement_report failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_commercial_property_subsidence_claim_settlement_output_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: output_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "output_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4da8af74d1abc1489ea4645ec3", "query_template": "CONTEXT BLOCK: The following input data was produced by the previous steps: {{{{step_compile_settlement_report_output}}}}, {{{{step_review_settlement_report_output}}}}.\\n\\nPRODUCT/DOMAIN CONTEXT: This request relates to commercial property insurance claims. Moderate the final settlement report for safety and compliance.\\n\\nTASK INSTRUCTION: Moderate the final settlement report for safety, compliance, and adherence to platform policies before delivery to the claimant.\\n\\nOUTPUT FORMAT INSTRUCTION: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"is_safe\\": boolean,\\n  \\"moderation_notes\\": \\"string (detailed explanation if report is flagged)\\"\\n}\\n```\\n\\nCOMPLETENESS DIRECTIVE: Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["generate_final_response"], "description": "Moderates the final settlement report for safety, compliance, and adherence to platform policies.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step output_moderation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_commercial_property_subsidence_claim_settlement_generate_final_response(variables: Dict[str, Any]) -> Any:
    """Activity for step: generate_final_response (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "generate_final_response", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4c86fa768bb34e72dd8402560d", "query_template": "CONTEXT BLOCK: The following input data was produced by the previous steps: {{{{step_compile_settlement_report_output}}}}, {{{{step_review_settlement_report_output}}}}, {{{{step_output_moderation_output}}}}.\\n\\nPRODUCT/DOMAIN CONTEXT: This request relates to commercial property insurance claims. Generate a final, customer-facing settlement report.\\n\\nTASK INSTRUCTION: Consolidate the reviewed settlement report into a final, customer-facing document with a professional tone and structure. Include a summary of the recommendation, next steps, and contact information.\\n\\nOUTPUT FORMAT INSTRUCTION: Respond with a markdown report using the following structure:\\n```markdown\\n# Claim Settlement Decision\\n\\n## Claim Decision\\n[Summary of the recommendation, including payout amount and conditions.]\\n\\n## Next Steps\\n[Actionable steps for the claimant, including any required documentation or actions.]\\n\\n## Contact Information\\n[Insurer contact details for follow-up questions or appeals.]\\n```\\n\\nCOMPLETENESS DIRECTIVE: Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": [], "description": "Consolidates the reviewed settlement report into a final, customer-facing document.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step generate_final_response failed")
    return result.output

@workflows.workflow.define(
    name="commercial_property_subsidence_claim_settlement",
    workflow_display_name="Commercial Property Subsidence Claim Settlement",
    workflow_description="Automates the screening of commercial property insurance claims for subsidence damage and generates a structured settlement recommendation report.",
    execution_timeout=timedelta(hours=24),
)
class CommercialPropertySubsidenceClaimSettlement:
    """Durable workflow: Automates the screening of commercial property insurance claims for subsidence damage and generates a structured settlement recommendation report."""

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
        """Execute the Commercial Property Subsidence Claim Settlement workflow DAG."""
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
                output = await run_commercial_property_subsidence_claim_settlement_jailbreak_moderation(variables)
                outputs["jailbreak_moderation"] = output
                self._last_result = output
                variables["step_jailbreak_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "topic_control_guardrail"

            elif current_step == "topic_control_guardrail":
                self._progress.append("topic_control_guardrail")
                output = await run_commercial_property_subsidence_claim_settlement_topic_control_guardrail(variables)
                outputs["topic_control_guardrail"] = output
                self._last_result = output
                variables["step_topic_control_guardrail_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "extract_claim_details"

            elif current_step == "extract_claim_details":
                self._progress.append("extract_claim_details")
                output = await run_commercial_property_subsidence_claim_settlement_extract_claim_details(variables)
                outputs["extract_claim_details"] = output
                self._last_result = output
                variables["step_extract_claim_details_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "verify_claim_details"

            elif current_step == "verify_claim_details" or current_step == "assess_subsidence_damage":
                # ── Parallel group: pg_core_analysis ──
                self._progress.append("__parallel_pg_core_analysis:start")
                # Fan-out: execute 2 steps concurrently
                _parallel_results = await asyncio.gather(
                    run_commercial_property_subsidence_claim_settlement_verify_claim_details(dict(variables)),
                    run_commercial_property_subsidence_claim_settlement_assess_subsidence_damage(dict(variables)),
                )
                # Fan-in: merge all parallel outputs
                _parallel_names = ["verify_claim_details", "assess_subsidence_damage"]
                for _pname, _presult in zip(_parallel_names, _parallel_results):
                    outputs[_pname] = _presult
                    variables[f"step_{_pname}_output"] = _presult
                    if isinstance(_presult, dict):
                        variables.update(_presult)
                    self._progress.append(_pname)
                self._last_result = _parallel_results[-1]

                current_step = "compile_settlement_report"

            elif current_step == "generate_settlement_recommendation":
                self._progress.append("generate_settlement_recommendation")
                output = await run_commercial_property_subsidence_claim_settlement_generate_settlement_recommendation(variables)
                outputs["generate_settlement_recommendation"] = output
                self._last_result = output
                variables["step_generate_settlement_recommendation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "compile_settlement_report"

            elif current_step == "compile_settlement_report":
                self._progress.append("compile_settlement_report")
                output = await run_commercial_property_subsidence_claim_settlement_compile_settlement_report(variables)
                outputs["compile_settlement_report"] = output
                self._last_result = output
                variables["step_compile_settlement_report_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "review_settlement_report"

            elif current_step == "review_settlement_report":
                self._progress.append("review_settlement_report")
                output = await run_commercial_property_subsidence_claim_settlement_review_settlement_report(variables)
                outputs["review_settlement_report"] = output
                self._last_result = output
                variables["step_review_settlement_report_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "output_moderation"

            elif current_step == "output_moderation":
                self._progress.append("output_moderation")
                output = await run_commercial_property_subsidence_claim_settlement_output_moderation(variables)
                outputs["output_moderation"] = output
                self._last_result = output
                variables["step_output_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "generate_final_response"

            elif current_step == "generate_final_response":
                self._progress.append("generate_final_response")
                output = await run_commercial_property_subsidence_claim_settlement_generate_final_response(variables)
                outputs["generate_final_response"] = output
                self._last_result = output
                variables["step_generate_final_response_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = None

            else:
                current_step = None

        return outputs
