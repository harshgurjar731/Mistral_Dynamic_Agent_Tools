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
async def run_subsidence_claim_settlement_input_safety_validation(variables: Dict[str, Any]) -> Any:
    """Activity for step: input_safety_validation (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "input_safety_validation", "type": "tool", "tier": "foundation", "config": {"tool_name": "validate_output_safety", "arguments": {"input": "{{raw_claim_input}}"}}, "next_steps": ["claim_data_extraction"], "description": "Screen inbound claim for prompt-injection and off-topic content to ensure safety and relevance.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step input_safety_validation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_subsidence_claim_settlement_claim_data_extraction(variables: Dict[str, Any]) -> Any:
    """Activity for step: claim_data_extraction (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "claim_data_extraction", "type": "tool", "tier": "domain", "config": {"tool_name": "extract_claim_data", "arguments": {"validated_claim_input": "{{step_input_safety_validation_output}}"}}, "next_steps": ["policy_excess_calculation", "underwriting_guideline_compliance_check", "fraud_risk_scoring"], "description": "Extract policyholder details, property address, and claimed amount from the claim form.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step claim_data_extraction failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_subsidence_claim_settlement_policy_excess_calculation(variables: Dict[str, Any]) -> Any:
    """Activity for step: policy_excess_calculation (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "policy_excess_calculation", "type": "tool", "tier": "use_case", "config": {"tool_name": "calculate_policy_excess", "arguments": {"extracted_claim_data": "{{step_claim_data_extraction_output}}"}}, "next_steps": ["depreciation_adjusted_settlement"], "description": "Compute the policy excess based on the extracted claim data and policy terms.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step policy_excess_calculation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_subsidence_claim_settlement_depreciation_adjusted_settlement(variables: Dict[str, Any]) -> Any:
    """Activity for step: depreciation_adjusted_settlement (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "depreciation_adjusted_settlement", "type": "tool", "tier": "use_case", "config": {"tool_name": "calculate_depreciation_adjusted_settlement", "arguments": {"extracted_claim_data": "{{step_claim_data_extraction_output}}", "calculated_excess": "{{step_policy_excess_calculation_output}}"}}, "next_steps": ["claim_summary_generation", "settlement_letter_generation"], "description": "Compute the depreciation-adjusted settlement figure using the stated formula.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step depreciation_adjusted_settlement failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_subsidence_claim_settlement_underwriting_guideline_compliance_check(variables: Dict[str, Any]) -> Any:
    """Activity for step: underwriting_guideline_compliance_check (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "underwriting_guideline_compliance_check", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a08578066976f7881ad4b055038a4c", "query_template": "You are an underwriting guideline compliance checker for residential subsidence claims. Verify the following claim data against the underwriting guidelines:\\n\\nClaim Data:\\n- Policyholder: {{policyholder_details.name}}\\n- Contact: {{policyholder_details.contact_information}}\\n- Property Address: {{property_address}}\\n- Claimed Amount: {{claimed_amount}}\\n\\nProduce a structured compliance check result detailing adherence to underwriting guidelines. Include compliance status, non-compliant findings (if any), and compliant findings (if any). Ensure the output matches the specified output contract."}, "next_steps": ["claim_summary_generation"], "description": "Verify the claim against underwriting guideline documents for compliance.", "parallel_group": "parallel_checks"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step underwriting_guideline_compliance_check failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_subsidence_claim_settlement_fraud_risk_scoring(variables: Dict[str, Any]) -> Any:
    """Activity for step: fraud_risk_scoring (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "fraud_risk_scoring", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a08578069d766c904ade9d632f70d0", "query_template": "You are a fraud risk scorer for residential subsidence claims. Analyze the following claim data and score its fraud risk on a scale from 0.0 to 1.0, where higher values indicate higher fraud risk:\\n\\nClaim Data:\\n- Policyholder: {{policyholder_details.name}}\\n- Contact: {{policyholder_details.contact_information}}\\n- Property Address: {{property_address}}\\n- Claimed Amount: {{claimed_amount}}\\n\\nProvide the fraud_risk_score and a rationale for the score, detailing specific fraud indicators or patterns that contributed to it.", "guardrail_policy": "Ensure the SQL query tool does not expose raw claim history data; only aggregate fraud indicators or anonymized patterns may be returned."}, "next_steps": ["claim_summary_generation"], "description": "Score the claim\'s fraud risk based on claim history and extracted data.", "parallel_group": "parallel_checks"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step fraud_risk_scoring failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy_max_attempts=3,
)
async def run_subsidence_claim_settlement_fraud_threshold_evaluation(variables: Dict[str, Any]) -> Any:
    """Activity for step: fraud_threshold_evaluation (StepType.CONDITION)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "fraud_threshold_evaluation", "type": "condition", "tier": "use_case", "config": {"true_step": "manual_investigation_placeholder", "false_step": "claim_summary_generation", "expression": "{{fraud_risk_score}} > 0.7"}, "next_steps": [], "description": "Determine if the fraud risk score exceeds the threshold for manual investigation.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step fraud_threshold_evaluation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy_max_attempts=3,
)
async def run_subsidence_claim_settlement_manual_investigation_placeholder(variables: Dict[str, Any]) -> Any:
    """Activity for step: manual_investigation_placeholder (StepType.TRANSFORM)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "manual_investigation_placeholder", "type": "transform", "tier": "use_case", "config": {"transform_code": "None"}, "next_steps": [], "description": "Placeholder step to represent routing to manual investigation. This step does not produce output for downstream steps.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step manual_investigation_placeholder failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_subsidence_claim_settlement_claim_summary_generation(variables: Dict[str, Any]) -> Any:
    """Activity for step: claim_summary_generation (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "claim_summary_generation", "type": "tool", "tier": "foundation", "config": {"tool_name": "generate_claim_summary", "arguments": {"policyholder_details": "{{policyholder_details}}", "property_address": "{{property_address}}", "claimed_amount": "{{claimed_amount}}", "calculated_excess": "{{step_policy_excess_calculation_output}}", "adjusted_settlement_figure": "{{step_depreciation_adjusted_settlement_output}}", "compliance_check_result": "{{step_underwriting_guideline_compliance_check_output.compliance_status}}", "compliance_notes": "{{step_underwriting_guideline_compliance_check_output.non_compliant_findings}}", "fraud_risk_score": "{{fraud_risk_score}}", "fraud_evaluation_result": "{{step_fraud_threshold_evaluation_output}}"}, "guardrail_policy": "Restrict access to the claim summary output to authorized personnel only; enforce logging of all access attempts."}, "next_steps": ["output_safety_validation"], "description": "Produce a structured summary of the claim, including settlement details and compliance results.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step claim_summary_generation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_subsidence_claim_settlement_settlement_letter_generation(variables: Dict[str, Any]) -> Any:
    """Activity for step: settlement_letter_generation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "settlement_letter_generation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4c86fa768bb34e72dd8402560d", "query_template": "You are a settlement letter generator for residential subsidence claims. Draft a customer-facing settlement letter for the following claim:\\n\\nClaim Details:\\n- Policyholder: {{policyholder_details.name}}\\n- Contact: {{policyholder_details.contact_information}}\\n- Property Address: {{property_address}}\\n- Claimed Amount: {{claimed_amount}}\\n- Calculated Excess: {{step_policy_excess_calculation_output}}\\n- Adjusted Settlement Figure: {{step_depreciation_adjusted_settlement_output}}\\n\\nThe letter should be professional, clear, and concise, detailing the settlement amount and any relevant terms.", "guardrail_policy": "Enforce redaction of all PII (e.g., contact information, property address) except the policyholder\'s name and settlement amount in the final letter output."}, "next_steps": ["output_safety_validation"], "description": "Generate a customer-facing settlement letter for the policyholder.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step settlement_letter_generation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_subsidence_claim_settlement_output_safety_validation(variables: Dict[str, Any]) -> Any:
    """Activity for step: output_safety_validation (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "output_safety_validation", "type": "tool", "tier": "foundation", "config": {"tool_name": "validate_output_safety", "arguments": {"settlement_letter": "{{step_settlement_letter_generation_output}}", "claim_summary": "{{step_claim_summary_generation_output}}"}}, "next_steps": [], "description": "Validate the settlement letter and claim summary for safety and compliance before delivery.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step output_safety_validation failed")
    return result.output

@workflows.workflow.define(
    name="subsidence_claim_settlement",
    workflow_display_name="Subsidence Claim Settlement",
    workflow_description="Process and settle residential subsidence insurance claims with fraud detection and policy compliance checks.",
    execution_timeout=timedelta(hours=24),
)
class SubsidenceClaimSettlement:
    """Durable workflow: Process and settle residential subsidence insurance claims with fraud detection and policy compliance checks."""

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
        """Execute the Subsidence Claim Settlement workflow DAG."""
        # Use workflow.now() for determinism-safe timestamps
        started_at = workflow.now()
        variables = dict(input.variables)
        current_step: Optional[str] = "input_safety_validation"
        visited: set = set()
        outputs: Dict[str, Any] = {}

        while current_step and len(visited) < 50:
            if current_step in visited:
                break  # cycle guard
            visited.add(current_step)

            if current_step == "input_safety_validation":
                self._progress.append("input_safety_validation")
                output = await run_subsidence_claim_settlement_input_safety_validation(variables)
                outputs["input_safety_validation"] = output
                self._last_result = output
                variables["step_input_safety_validation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "claim_data_extraction"

            elif current_step == "claim_data_extraction":
                self._progress.append("claim_data_extraction")
                output = await run_subsidence_claim_settlement_claim_data_extraction(variables)
                outputs["claim_data_extraction"] = output
                self._last_result = output
                variables["step_claim_data_extraction_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "policy_excess_calculation"

            elif current_step == "policy_excess_calculation":
                self._progress.append("policy_excess_calculation")
                output = await run_subsidence_claim_settlement_policy_excess_calculation(variables)
                outputs["policy_excess_calculation"] = output
                self._last_result = output
                variables["step_policy_excess_calculation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "depreciation_adjusted_settlement"

            elif current_step == "depreciation_adjusted_settlement":
                self._progress.append("depreciation_adjusted_settlement")
                output = await run_subsidence_claim_settlement_depreciation_adjusted_settlement(variables)
                outputs["depreciation_adjusted_settlement"] = output
                self._last_result = output
                variables["step_depreciation_adjusted_settlement_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "claim_summary_generation"

            elif current_step == "underwriting_guideline_compliance_check" or current_step == "fraud_risk_scoring":
                # ── Parallel group: parallel_checks ──
                self._progress.append("__parallel_parallel_checks:start")
                # Fan-out: execute 2 steps concurrently
                _parallel_results = await asyncio.gather(
                    run_subsidence_claim_settlement_underwriting_guideline_compliance_check(dict(variables)),
                    run_subsidence_claim_settlement_fraud_risk_scoring(dict(variables)),
                )
                # Fan-in: merge all parallel outputs
                _parallel_names = ["underwriting_guideline_compliance_check", "fraud_risk_scoring"]
                for _pname, _presult in zip(_parallel_names, _parallel_results):
                    outputs[_pname] = _presult
                    variables[f"step_{_pname}_output"] = _presult
                    if isinstance(_presult, dict):
                        variables.update(_presult)
                    self._progress.append(_pname)
                self._last_result = _parallel_results[-1]

                current_step = "claim_summary_generation"

            elif current_step == "fraud_threshold_evaluation":
                self._progress.append("fraud_threshold_evaluation")
                output = await run_subsidence_claim_settlement_fraud_threshold_evaluation(variables)
                outputs["fraud_threshold_evaluation"] = output
                self._last_result = output
                variables["step_fraud_threshold_evaluation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                # Condition step: output contains {next_step: ...}
                if isinstance(output, dict) and "next_step" in output:
                    current_step = output["next_step"]
                else:
                    current_step = None

            elif current_step == "manual_investigation_placeholder":
                self._progress.append("manual_investigation_placeholder")
                output = await run_subsidence_claim_settlement_manual_investigation_placeholder(variables)
                outputs["manual_investigation_placeholder"] = output
                self._last_result = output
                variables["step_manual_investigation_placeholder_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = None

            elif current_step == "claim_summary_generation":
                self._progress.append("claim_summary_generation")
                output = await run_subsidence_claim_settlement_claim_summary_generation(variables)
                outputs["claim_summary_generation"] = output
                self._last_result = output
                variables["step_claim_summary_generation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "output_safety_validation"

            elif current_step == "settlement_letter_generation":
                self._progress.append("settlement_letter_generation")
                output = await run_subsidence_claim_settlement_settlement_letter_generation(variables)
                outputs["settlement_letter_generation"] = output
                self._last_result = output
                variables["step_settlement_letter_generation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "output_safety_validation"

            elif current_step == "output_safety_validation":
                self._progress.append("output_safety_validation")
                output = await run_subsidence_claim_settlement_output_safety_validation(variables)
                outputs["output_safety_validation"] = output
                self._last_result = output
                variables["step_output_safety_validation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = None

            else:
                current_step = None

        return outputs
