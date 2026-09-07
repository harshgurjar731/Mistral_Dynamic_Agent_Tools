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
async def run_cloud_cost_estimator_jailbreak_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: jailbreak_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "jailbreak_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4bdfd2751d9a20107c77ddf696", "query_template": "The following data was provided by the user: {{{{instance_type}}}}, {{{{number_of_instances}}}}, {{{{hours_running_per_month}}}}, {{{{provisioned_storage_gb}}}}, {{{{monthly_data_egress_gb}}}}, {{{{region}}}}. Validate this input for safety and detect any malicious requests. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": {"is_safe": "boolean", "moderation_notes": "string (optional, present if is_safe is false)"}}, "next_steps": ["topic_control_guardrail"], "description": "Validates input for safety and malicious request detection before processing.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step jailbreak_moderation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_cloud_cost_estimator_topic_control_guardrail(variables: Dict[str, Any]) -> Any:
    """Activity for step: topic_control_guardrail (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "topic_control_guardrail", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4da8af74d1abc1489ea4645ec3", "query_template": "The following data was provided by the user: {{{{instance_type}}}}, {{{{number_of_instances}}}}, {{{{hours_running_per_month}}}}, {{{{provisioned_storage_gb}}}}, {{{{monthly_data_egress_gb}}}}, {{{{region}}}}. This request relates to cloud cost estimation. Classify the input to ensure it is relevant to this topic. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": {"is_relevant": "boolean", "topic": "string (e.g., \'cloud_cost_estimation\')", "confidence": "number (0.0 to 1.0)"}}, "next_steps": ["fetch_compute_pricing", "fetch_storage_pricing", "fetch_egress_pricing"], "description": "Classifies the input request to ensure it is relevant to cloud cost estimation.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step topic_control_guardrail failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_cloud_cost_estimator_fetch_compute_pricing(variables: Dict[str, Any]) -> Any:
    """Activity for step: fetch_compute_pricing (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "fetch_compute_pricing", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a0711922ed7049abbdd846f89a9737", "query_template": "The following data was provided by the user: {{{{region}}}}. This request relates to cloud cost estimation for compute resources. Fetch the current published per-hour rate for compute in the specified region. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": {"unit_rate": "number", "currency": "string (USD)", "region": "string", "component": "string (compute | storage | egress)"}}, "next_steps": ["calculate_compute_cost"], "description": "Fetches current published cloud pricing rates for compute in the given region.", "parallel_group": "pg_pricing_lookup"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step fetch_compute_pricing failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_cloud_cost_estimator_fetch_storage_pricing(variables: Dict[str, Any]) -> Any:
    """Activity for step: fetch_storage_pricing (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "fetch_storage_pricing", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a0711922ed7049abbdd846f89a9737", "query_template": "The following data was provided by the user: {{{{region}}}}. This request relates to cloud cost estimation for storage resources. Fetch the current published per-GB-month rate for storage in the specified region. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": {"unit_rate": "number", "currency": "string (USD)", "region": "string", "component": "string (compute | storage | egress)"}}, "next_steps": ["calculate_storage_cost"], "description": "Fetches current published cloud pricing rates for storage in the given region.", "parallel_group": "pg_pricing_lookup"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step fetch_storage_pricing failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_cloud_cost_estimator_fetch_egress_pricing(variables: Dict[str, Any]) -> Any:
    """Activity for step: fetch_egress_pricing (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "fetch_egress_pricing", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a0711922ed7049abbdd846f89a9737", "query_template": "The following data was provided by the user: {{{{region}}}}. This request relates to cloud cost estimation for egress resources. Fetch the current published per-GB rate for egress in the specified region. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": {"unit_rate": "number", "currency": "string (USD)", "region": "string", "component": "string (compute | storage | egress)"}}, "next_steps": ["calculate_egress_cost"], "description": "Fetches current published cloud pricing rates for egress in the given region.", "parallel_group": "pg_pricing_lookup"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step fetch_egress_pricing failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_cloud_cost_estimator_calculate_compute_cost(variables: Dict[str, Any]) -> Any:
    """Activity for step: calculate_compute_cost (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "calculate_compute_cost", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a0711922e2767192feec1499e468d8", "query_template": "The following data was produced by the previous step: {{{{step_fetch_compute_pricing_output}}}}. The user provided: {{{{number_of_instances}}}}, {{{{hours_running_per_month}}}}. Calculate the monthly compute cost using the per-hour rate and the provided quantity. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": {"cost_component": "string (compute | storage | egress)", "cost": "number", "currency": "string (USD)"}}, "next_steps": ["merge_costs"], "description": "Calculates the monthly compute cost using the fetched pricing rate.", "parallel_group": "pg_cost_calculation"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step calculate_compute_cost failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_cloud_cost_estimator_calculate_storage_cost(variables: Dict[str, Any]) -> Any:
    """Activity for step: calculate_storage_cost (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "calculate_storage_cost", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a0711922e2767192feec1499e468d8", "query_template": "The following data was produced by the previous step: {{{{step_fetch_storage_pricing_output}}}}. The user provided: {{{{provisioned_storage_gb}}}}. Calculate the monthly storage cost using the per-GB-month rate and the provided quantity. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": {"cost_component": "string (compute | storage | egress)", "cost": "number", "currency": "string (USD)"}}, "next_steps": ["merge_costs"], "description": "Calculates the monthly storage cost using the fetched pricing rate.", "parallel_group": "pg_cost_calculation"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step calculate_storage_cost failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_cloud_cost_estimator_calculate_egress_cost(variables: Dict[str, Any]) -> Any:
    """Activity for step: calculate_egress_cost (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "calculate_egress_cost", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a0711922e2767192feec1499e468d8", "query_template": "The following data was produced by the previous step: {{{{step_fetch_egress_pricing_output}}}}. The user provided: {{{{monthly_data_egress_gb}}}}. Calculate the monthly egress cost using the per-GB rate and the provided quantity. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": {"cost_component": "string (compute | storage | egress)", "cost": "number", "currency": "string (USD)"}}, "next_steps": ["merge_costs"], "description": "Calculates the monthly egress cost using the fetched pricing rate.", "parallel_group": "pg_cost_calculation"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step calculate_egress_cost failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy_max_attempts=3,
)
async def run_cloud_cost_estimator_merge_costs(variables: Dict[str, Any]) -> Any:
    """Activity for step: merge_costs (StepType.TRANSFORM)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "merge_costs", "type": "transform", "tier": null, "config": {"mappings": {"compute_cost": "{{step_calculate_compute_cost_output.cost}}", "storage_cost": "{{step_calculate_storage_cost_output.cost}}", "egress_cost": "{{step_calculate_egress_cost_output.cost}}", "currency": "{{step_calculate_compute_cost_output.currency}}"}}, "next_steps": ["generate_cost_breakdown"], "description": "Merges the outputs of the compute, storage, and egress cost calculations into a single object.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step merge_costs failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_cloud_cost_estimator_generate_cost_breakdown(variables: Dict[str, Any]) -> Any:
    """Activity for step: generate_cost_breakdown (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "generate_cost_breakdown", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_01a0711922e6764a95005003705da537", "query_template": "The following cost data was produced by previous steps: {{{{step_merge_costs_output}}}}. This request relates to cloud cost estimation. Combine the compute, storage, and egress costs into a customer-facing breakdown. Identify the dominant cost component and provide 2-3 concrete recommendations for reducing the total bill. Respond with a markdown report using ## section headers. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["output_moderation"], "description": "Combines compute, storage, and egress costs into a customer-facing breakdown with actionable savings recommendations.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step generate_cost_breakdown failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_cloud_cost_estimator_output_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: output_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "output_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4da8af74d1abc1489ea4645ec3", "query_template": "The following data was produced by the previous step: {{{{step_generate_cost_breakdown_output}}}}. Validate this output for safety and compliance before delivery. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": {"is_safe": "boolean", "moderation_notes": "string (optional, present if is_safe is false)"}}, "next_steps": ["final_response_generation"], "description": "Validates the final output for safety and compliance before delivery.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step output_moderation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_cloud_cost_estimator_final_response_generation(variables: Dict[str, Any]) -> Any:
    """Activity for step: final_response_generation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "final_response_generation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4c86fa768bb34e72dd8402560d", "query_template": "The following data was produced by the previous step: {{{{step_generate_cost_breakdown_output}}}}. Consolidate and format the final response for the customer. The report must follow this structure:\\n\\n## Summary\\n## Total Monthly Cloud Bill\\n## Cost Breakdown (Compute, Storage, Egress)\\n## Dominant Cost Component\\n## Recommendations for Reducing Costs\\n## Next Steps (if applicable)\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": [], "description": "Consolidates and formats the final response for the customer.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step final_response_generation failed")
    return result.output

@workflows.workflow.define(
    name="cloud_cost_estimator",
    workflow_display_name="Cloud Cost Estimator",
    workflow_description="Automates the estimation of a customer's monthly cloud bill by calculating compute, storage, and egress costs independently, then combining them into a cost breakdown with actionable savings recommendations.",
    execution_timeout=timedelta(hours=24),
)
class CloudCostEstimator:
    """Durable workflow: Automates the estimation of a customer's monthly cloud bill by calculating compute, storage, and egress costs independently, then combining them into a cost breakdown with actionable savings recommendations."""

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
        """Execute the Cloud Cost Estimator workflow DAG."""
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
                output = await run_cloud_cost_estimator_jailbreak_moderation(variables)
                outputs["jailbreak_moderation"] = output
                self._last_result = output
                variables["step_jailbreak_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "topic_control_guardrail"

            elif current_step == "topic_control_guardrail":
                self._progress.append("topic_control_guardrail")
                output = await run_cloud_cost_estimator_topic_control_guardrail(variables)
                outputs["topic_control_guardrail"] = output
                self._last_result = output
                variables["step_topic_control_guardrail_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "fetch_compute_pricing"

            elif current_step == "fetch_compute_pricing" or current_step == "fetch_storage_pricing" or current_step == "fetch_egress_pricing":
                # ── Parallel group: pg_pricing_lookup ──
                self._progress.append("__parallel_pg_pricing_lookup:start")
                # Fan-out: execute 3 steps concurrently
                _parallel_results = await asyncio.gather(
                    run_cloud_cost_estimator_fetch_compute_pricing(dict(variables)),
                    run_cloud_cost_estimator_fetch_storage_pricing(dict(variables)),
                    run_cloud_cost_estimator_fetch_egress_pricing(dict(variables)),
                )
                # Fan-in: merge all parallel outputs
                _parallel_names = ["fetch_compute_pricing", "fetch_storage_pricing", "fetch_egress_pricing"]
                for _pname, _presult in zip(_parallel_names, _parallel_results):
                    outputs[_pname] = _presult
                    variables[f"step_{_pname}_output"] = _presult
                    if isinstance(_presult, dict):
                        variables.update(_presult)
                    self._progress.append(_pname)
                self._last_result = _parallel_results[-1]

                current_step = "calculate_compute_cost"

            elif current_step == "calculate_compute_cost" or current_step == "calculate_storage_cost" or current_step == "calculate_egress_cost":
                # ── Parallel group: pg_cost_calculation ──
                self._progress.append("__parallel_pg_cost_calculation:start")
                # Fan-out: execute 3 steps concurrently
                _parallel_results = await asyncio.gather(
                    run_cloud_cost_estimator_calculate_compute_cost(dict(variables)),
                    run_cloud_cost_estimator_calculate_storage_cost(dict(variables)),
                    run_cloud_cost_estimator_calculate_egress_cost(dict(variables)),
                )
                # Fan-in: merge all parallel outputs
                _parallel_names = ["calculate_compute_cost", "calculate_storage_cost", "calculate_egress_cost"]
                for _pname, _presult in zip(_parallel_names, _parallel_results):
                    outputs[_pname] = _presult
                    variables[f"step_{_pname}_output"] = _presult
                    if isinstance(_presult, dict):
                        variables.update(_presult)
                    self._progress.append(_pname)
                self._last_result = _parallel_results[-1]

                current_step = "merge_costs"

            elif current_step == "merge_costs":
                self._progress.append("merge_costs")
                output = await run_cloud_cost_estimator_merge_costs(variables)
                outputs["merge_costs"] = output
                self._last_result = output
                variables["step_merge_costs_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "generate_cost_breakdown"

            elif current_step == "generate_cost_breakdown":
                self._progress.append("generate_cost_breakdown")
                output = await run_cloud_cost_estimator_generate_cost_breakdown(variables)
                outputs["generate_cost_breakdown"] = output
                self._last_result = output
                variables["step_generate_cost_breakdown_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "output_moderation"

            elif current_step == "output_moderation":
                self._progress.append("output_moderation")
                output = await run_cloud_cost_estimator_output_moderation(variables)
                outputs["output_moderation"] = output
                self._last_result = output
                variables["step_output_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "final_response_generation"

            elif current_step == "final_response_generation":
                self._progress.append("final_response_generation")
                output = await run_cloud_cost_estimator_final_response_generation(variables)
                outputs["final_response_generation"] = output
                self._last_result = output
                variables["step_final_response_generation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = None

            else:
                current_step = None

        return outputs
