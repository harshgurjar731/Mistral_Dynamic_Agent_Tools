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
async def run_residential_subsidence_claim_settlement_input_safety_validation(variables: Dict[str, Any]) -> Any:
    """Activity for step: input_safety_validation (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "input_safety_validation", "type": "tool", "tier": "foundation", "config": {"tool_name": "validate_input_safety", "arguments": {"raw_claim_submission": "{{raw_claim_submission}}"}}, "next_steps": ["claim_data_extraction"], "description": "Screen the inbound claim for prompt-injection and off-topic content to ensure safety before processing.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step input_safety_validation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_subsidence_claim_settlement_claim_data_extraction(variables: Dict[str, Any]) -> Any:
    """Activity for step: claim_data_extraction (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "claim_data_extraction", "type": "tool", "tier": "domain", "config": {"tool_name": "extract_claim_data", "arguments": {"validated_claim_input": "{{raw_claim_submission}}"}}, "next_steps": ["policy_excess_calculation"], "description": "Extract policyholder details, property address, and claimed amount from the validated claim form.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step claim_data_extraction failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_subsidence_claim_settlement_policy_excess_calculation(variables: Dict[str, Any]) -> Any:
    """Activity for step: policy_excess_calculation (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "policy_excess_calculation", "type": "tool", "tier": "use_case", "config": {"tool_name": "calculate_policy_excess", "arguments": {"extracted_claim_data": "{{step_claim_data_extraction_output}}"}}, "next_steps": ["depreciation_adjusted_settlement"], "description": "Compute the policy excess based on the extracted claim details and policy terms.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step policy_excess_calculation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_subsidence_claim_settlement_depreciation_adjusted_settlement(variables: Dict[str, Any]) -> Any:
    """Activity for step: depreciation_adjusted_settlement (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "depreciation_adjusted_settlement", "type": "tool", "tier": "use_case", "config": {"tool_name": "calculate_depreciation_adjusted_settlement", "arguments": {"extracted_claim_data": "{{step_claim_data_extraction_output}}", "calculated_excess": "{{step_policy_excess_calculation_output.calculated_excess}}"}}, "next_steps": ["underwriting_guideline_check"], "description": "Calculate the depreciation-adjusted settlement figure using the stated formula.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step depreciation_adjusted_settlement failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_subsidence_claim_settlement_underwriting_guideline_check(variables: Dict[str, Any]) -> Any:
    """Activity for step: underwriting_guideline_check (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "underwriting_guideline_check", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a08578066976f7881ad4b055038a4c", "query_template": "Check this residential subsidence claim against our underwriting guidelines.\\n\\nClaim:\\n- Policy number: {{step_claim_data_extraction_output.policy_number}}\\n- Property address: {{step_claim_data_extraction_output.property_address}}\\n- Property built: {{step_claim_data_extraction_output.property_built}}\\n- Amount claimed: {{step_claim_data_extraction_output.claim_amount}}\\n- Date damage noticed: {{step_claim_data_extraction_output.date_damage_noticed}}\\n- Description: {{step_claim_data_extraction_output.description}}\\n- Previous claims: {{step_claim_data_extraction_output.previous_claims}}\\n\\nAnswer in your standard output format, as a JSON object only with no other text. It must include is_compliant, compliance_status and compliance_notes."}, "next_steps": ["fraud_threshold_assessment"], "description": "Verify the claim against underwriting guideline documents to ensure compliance.", "parallel_group": "parallel_compliance_checks"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step underwriting_guideline_check failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_subsidence_claim_settlement_fraud_risk_scoring(variables: Dict[str, Any]) -> Any:
    """Activity for step: fraud_risk_scoring (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "fraud_risk_scoring", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a08578069d766c904ade9d632f70d0", "query_template": "Score the fraud risk of this residential subsidence claim.\\n\\nClaim:\\n- Policy number: {{step_claim_data_extraction_output.policy_number}}\\n- Property address: {{step_claim_data_extraction_output.property_address}}\\n- Property built: {{step_claim_data_extraction_output.property_built}}\\n- Amount claimed: {{step_claim_data_extraction_output.claim_amount}}\\n- Date damage noticed: {{step_claim_data_extraction_output.date_damage_noticed}}\\n- Description: {{step_claim_data_extraction_output.description}}\\n- Previous claims: {{step_claim_data_extraction_output.previous_claims}}\\n\\nSet fraud_evaluation_result to true only when the claim should go to manual investigation, which means a fraud_risk_score above 70.\\n\\nReply with a JSON object only, no other text:\\n{\\"fraud_risk_score\\": <0-100>, \\"fraud_evaluation_result\\": true or false, \\"reasons\\": \\"<one sentence>\\"}", "guardrail_policy": "Fraud risk scoring must not expose raw claim history or internal fraud indicators in any output. Only the final boolean flag (`fraud_evaluation_result`) may be passed downstream."}, "next_steps": ["fraud_threshold_assessment"], "description": "Score the claim\'s fraud risk based on claim history and extracted details.", "parallel_group": "parallel_compliance_checks"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step fraud_risk_scoring failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy_max_attempts=3,
)
async def run_residential_subsidence_claim_settlement_fraud_threshold_assessment(variables: Dict[str, Any]) -> Any:
    """Activity for step: fraud_threshold_assessment (StepType.CONDITION)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "fraud_threshold_assessment", "type": "condition", "tier": "use_case", "config": {"expression": "{{step_fraud_risk_scoring_output.fraud_evaluation_result}} == True or {{step_underwriting_guideline_check_output.is_compliant}} != True", "true_step": "manual_investigation_placeholder", "false_step": "claim_summary_generation"}, "next_steps": [], "description": "Route to manual investigation if fraud is flagged or underwriting compliance was not positively verified; otherwise proceed to settlement.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step fraud_threshold_assessment failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy_max_attempts=3,
)
async def run_residential_subsidence_claim_settlement_manual_investigation_placeholder(variables: Dict[str, Any]) -> Any:
    """Activity for step: manual_investigation_placeholder (StepType.TRANSFORM)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "manual_investigation_placeholder", "type": "transform", "tier": "use_case", "config": {"transform_code": "uw = variables.get(\'step_underwriting_guideline_check_output\') or {}\\nfr = variables.get(\'step_fraud_risk_scoring_output\') or {}\\ntry:\\n    uw = json.loads(uw)\\nexcept:\\n    pass\\ntry:\\n    fr = json.loads(fr)\\nexcept:\\n    pass\\ntry:\\n    flagged = fr.get(\'fraud_evaluation_result\') is True\\n    status = uw.get(\'compliance_status\')\\n    if uw.get(\'is_compliant\') is not True:\\n        reason = uw.get(\'compliance_notes\')\\n    else:\\n        reason = fr.get(\'reasons\')\\nexcept:\\n    flagged, status, reason = None, None, None\\noutput = dict(\\n    routed_to=\'manual_investigation\',\\n    fraud_flagged=flagged,\\n    compliance_status=status,\\n    reason=reason or \'Flagged for fraud, or underwriting compliance could not be verified.\',\\n)\\n"}, "next_steps": [], "description": "Placeholder step to represent routing to manual investigation. This step halts the workflow.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step manual_investigation_placeholder failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_subsidence_claim_settlement_claim_summary_generation(variables: Dict[str, Any]) -> Any:
    """Activity for step: claim_summary_generation (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "claim_summary_generation", "type": "tool", "tier": "foundation", "config": {"tool_name": "generate_claim_summary", "arguments": {"extracted_claim_details": "{{step_claim_data_extraction_output}}", "calculated_policy_excess": "{{step_policy_excess_calculation_output.calculated_excess}}", "depreciation_adjusted_settlement_figure": "{{step_depreciation_adjusted_settlement_output.adjusted_settlement_figure}}", "underwriting_compliance_result": "{{step_underwriting_guideline_check_output}}", "fraud_assessment_result": "{{step_fraud_risk_scoring_output.fraud_evaluation_result}}"}}, "next_steps": ["settlement_letter_generation"], "description": "Produce a structured summary of the claim, including settlement details and compliance results.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step claim_summary_generation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_subsidence_claim_settlement_settlement_letter_generation(variables: Dict[str, Any]) -> Any:
    """Activity for step: settlement_letter_generation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "settlement_letter_generation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4c86fa768bb34e72dd8402560d", "query_template": "Write a customer-facing settlement letter for this residential subsidence claim.\\n\\nUse ONLY the details below. Do not invent an insurer name, phone number, email address, claim reference, date or any amount, and do not do any arithmetic of your own. Where a detail is not provided, leave a clearly marked placeholder such as [INSURER NAME] for a person to complete.\\n\\n- Policyholder: {{step_claim_data_extraction_output.policyholder_details.name}}\\n- Property address: {{step_claim_data_extraction_output.property_address}}\\n- Policy number: {{step_claim_data_extraction_output.policy_number}}\\n- Amount claimed: {{step_claim_data_extraction_output.claim_amount}}\\n- Policy excess: {{step_policy_excess_calculation_output.calculated_excess}}\\n- Depreciation rate applied: {{step_claim_data_extraction_output.depreciation_rate}}\\n- Settlement payable: {{step_depreciation_adjusted_settlement_output.adjusted_settlement_figure}}\\n\\nDo not mention the fraud assessment or the underwriting notes; they are internal.", "guardrail_policy": "Ensure no sensitive internal data (e.g., fraud risk score, underwriting compliance notes) is included in the settlement letter. Only approved, customer-facing details may be present."}, "next_steps": ["output_safety_validation"], "description": "Generate a customer-facing settlement letter for the policyholder.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step settlement_letter_generation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_residential_subsidence_claim_settlement_output_safety_validation(variables: Dict[str, Any]) -> Any:
    """Activity for step: output_safety_validation (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "output_safety_validation", "type": "tool", "tier": "foundation", "config": {"tool_name": "validate_output_safety", "arguments": {"settlement_letter": "{{step_settlement_letter_generation_output}}", "claim_summary": "{{step_claim_summary_generation_output}}"}}, "next_steps": [], "description": "Validate the settlement letter for safety and compliance before delivery to the policyholder.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step output_safety_validation failed")
    return result.output

@workflows.workflow.define(
    name="residential_subsidence_claim_settlement",
    workflow_display_name="Residential Subsidence Claim Settlement",
    workflow_description="Process and settle residential subsidence claims by validating, assessing, and calculating settlement amounts while detecting fraud risks.",
    execution_timeout=timedelta(hours=24),
)
class ResidentialSubsidenceClaimSettlement:
    """Durable workflow: Process and settle residential subsidence claims by validating, assessing, and calculating settlement amounts while detecting fraud risks."""

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
        """Execute the Residential Subsidence Claim Settlement workflow DAG."""
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
                output = await run_residential_subsidence_claim_settlement_input_safety_validation(variables)
                outputs["input_safety_validation"] = output
                self._last_result = output
                variables["step_input_safety_validation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "claim_data_extraction"

            elif current_step == "claim_data_extraction":
                self._progress.append("claim_data_extraction")
                output = await run_residential_subsidence_claim_settlement_claim_data_extraction(variables)
                outputs["claim_data_extraction"] = output
                self._last_result = output
                variables["step_claim_data_extraction_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "policy_excess_calculation"

            elif current_step == "policy_excess_calculation":
                self._progress.append("policy_excess_calculation")
                output = await run_residential_subsidence_claim_settlement_policy_excess_calculation(variables)
                outputs["policy_excess_calculation"] = output
                self._last_result = output
                variables["step_policy_excess_calculation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "depreciation_adjusted_settlement"

            elif current_step == "depreciation_adjusted_settlement":
                self._progress.append("depreciation_adjusted_settlement")
                output = await run_residential_subsidence_claim_settlement_depreciation_adjusted_settlement(variables)
                outputs["depreciation_adjusted_settlement"] = output
                self._last_result = output
                variables["step_depreciation_adjusted_settlement_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "underwriting_guideline_check"

            elif current_step == "underwriting_guideline_check" or current_step == "fraud_risk_scoring":
                # ── Parallel group: parallel_compliance_checks ──
                self._progress.append("__parallel_parallel_compliance_checks:start")
                # Fan-out: execute 2 steps concurrently
                _parallel_results = await asyncio.gather(
                    run_residential_subsidence_claim_settlement_underwriting_guideline_check(dict(variables)),
                    run_residential_subsidence_claim_settlement_fraud_risk_scoring(dict(variables)),
                )
                # Fan-in: merge all parallel outputs
                _parallel_names = ["underwriting_guideline_check", "fraud_risk_scoring"]
                for _pname, _presult in zip(_parallel_names, _parallel_results):
                    outputs[_pname] = _presult
                    variables[f"step_{_pname}_output"] = _presult
                    if isinstance(_presult, dict):
                        variables.update(_presult)
                    self._progress.append(_pname)
                self._last_result = _parallel_results[-1]

                current_step = "fraud_threshold_assessment"

            elif current_step == "fraud_threshold_assessment":
                self._progress.append("fraud_threshold_assessment")
                output = await run_residential_subsidence_claim_settlement_fraud_threshold_assessment(variables)
                outputs["fraud_threshold_assessment"] = output
                self._last_result = output
                variables["step_fraud_threshold_assessment_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                # Condition step: output contains {next_step: ...}
                if isinstance(output, dict) and "next_step" in output:
                    current_step = output["next_step"]
                else:
                    current_step = None

            elif current_step == "manual_investigation_placeholder":
                self._progress.append("manual_investigation_placeholder")
                output = await run_residential_subsidence_claim_settlement_manual_investigation_placeholder(variables)
                outputs["manual_investigation_placeholder"] = output
                self._last_result = output
                variables["step_manual_investigation_placeholder_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = None

            elif current_step == "claim_summary_generation":
                self._progress.append("claim_summary_generation")
                output = await run_residential_subsidence_claim_settlement_claim_summary_generation(variables)
                outputs["claim_summary_generation"] = output
                self._last_result = output
                variables["step_claim_summary_generation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "settlement_letter_generation"

            elif current_step == "settlement_letter_generation":
                self._progress.append("settlement_letter_generation")
                output = await run_residential_subsidence_claim_settlement_settlement_letter_generation(variables)
                outputs["settlement_letter_generation"] = output
                self._last_result = output
                variables["step_settlement_letter_generation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "output_safety_validation"

            elif current_step == "output_safety_validation":
                self._progress.append("output_safety_validation")
                output = await run_residential_subsidence_claim_settlement_output_safety_validation(variables)
                outputs["output_safety_validation"] = output
                self._last_result = output
                variables["step_output_safety_validation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = None

            else:
                current_step = None

        return outputs
