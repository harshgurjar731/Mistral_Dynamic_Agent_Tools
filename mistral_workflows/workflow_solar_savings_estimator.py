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
async def run_solar_savings_estimator_jailbreak_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: jailbreak_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "jailbreak_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4bdfd2751d9a20107c77ddf696", "query_template": "The following data was provided by the user: {{{{roof_area}}}}, {{{{sun_hours}}}}, {{{{electricity_rate}}}}, {{{{installation_cost}}}}, {{{{state}}}}. Assess whether this input is safe to process and does not contain any malicious or harmful content. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": {"is_safe": "boolean: Indicates whether the input is safe to process.", "moderation_notes": "string: Explanation of any safety concerns or null if safe."}}, "next_steps": ["topic_control_guardrail"], "description": "Validates the input for safety and prevents jailbreak attempts.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step jailbreak_moderation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_solar_savings_estimator_topic_control_guardrail(variables: Dict[str, Any]) -> Any:
    """Activity for step: topic_control_guardrail (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "topic_control_guardrail", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4da8af74d1abc1489ea4645ec3", "query_template": "The following data was provided by the user: {{{{roof_area}}}}, {{{{sun_hours}}}}, {{{{electricity_rate}}}}, {{{{installation_cost}}}}, {{{{state}}}}. This request relates to residential solar savings. Assess whether the input is relevant to the solar savings domain. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": {"is_relevant": "boolean: Indicates whether the input is relevant to the solar savings domain.", "classification": "string: Topic classification (e.g., \'solar_savings\')."}}, "next_steps": ["calculate_energy_production"], "description": "Ensures the input is relevant to the solar savings domain.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step topic_control_guardrail failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_solar_savings_estimator_calculate_energy_production(variables: Dict[str, Any]) -> Any:
    """Activity for step: calculate_energy_production (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "calculate_energy_production", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a070da809472698e02e18ad2e4dc8d", "query_template": "The following data was provided by the user: roof area = {{{{roof_area}}}} square metres, average daily sun-hours = {{{{sun_hours}}}}. This request relates to residential solar savings. Calculate the estimated annual energy production in kWh using standard assumptions (panel efficiency: 20%, performance ratio: 0.75, standard panel output: 1 kW per 5 square metres). Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": {"annual_energy_production_kwh": "number: Estimated annual energy production in kilowatt-hours."}}, "next_steps": ["calculate_savings"], "description": "Calculates the estimated annual energy production in kWh from roof area and sun-hours.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step calculate_energy_production failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_solar_savings_estimator_calculate_savings(variables: Dict[str, Any]) -> Any:
    """Activity for step: calculate_savings (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "calculate_savings", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a070da809473d6a1a1efde881f5cea", "query_template": "The following data was produced by the previous step: {{{{step_calculate_energy_production_output}}}} and provided by the user: electricity rate = {{{{electricity_rate}}}} $/kWh, installation cost = {{{{installation_cost}}}} $. This request relates to residential solar savings. Calculate the annual bill savings, simple payback period in years, and total net savings over 25 years. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": {"annual_bill_savings": "number: Annual savings in dollars from solar energy production.", "payback_period_years": "number: Simple payback period in years.", "net_savings_25_years": "number: Total net savings over 25 years, accounting for installation cost."}}, "next_steps": ["fetch_incentives", "generate_recommendation"], "description": "Calculates annual bill savings, payback period, and net savings over 25 years.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step calculate_savings failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_solar_savings_estimator_fetch_incentives(variables: Dict[str, Any]) -> Any:
    """Activity for step: fetch_incentives (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "fetch_incentives", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a070da80997180acd75f3e7f9e84a3", "query_template": "The following data was provided by the user: state = {{{{state}}}}. This request relates to residential solar savings. Fetch and summarize the latest solar incentives, rebates, and tax credits available for this state. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": {"incentives": [{"type": "string: Type of incentive (e.g., tax credit, rebate).", "amount": "string: Monetary value or percentage of cost covered.", "description": "string: Brief explanation of the incentive.", "source": "string: URL or agency name for verification."}]}}, "next_steps": ["merge_results"], "description": "Fetches and summarizes the latest solar incentives and rebates available for the given state.", "parallel_group": "pg_core_analysis"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step fetch_incentives failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_solar_savings_estimator_generate_recommendation(variables: Dict[str, Any]) -> Any:
    """Activity for step: generate_recommendation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "generate_recommendation", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_01a070da80997180acd75f3e7f9e84a4", "query_template": "The following data was produced by the previous steps: {{{{step_calculate_energy_production_output}}}}, {{{{step_calculate_savings_output}}}}. This request relates to residential solar savings. Generate a plain English recommendation for the homeowner based on the solar savings calculations. Frame the recommendation as a strong buy if the payback period is under 10 years; otherwise, frame it cautiously. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["merge_results"], "description": "Generates a plain English recommendation for the homeowner based on solar savings calculations.", "parallel_group": "pg_core_analysis"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step generate_recommendation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy_max_attempts=3,
)
async def run_solar_savings_estimator_merge_results(variables: Dict[str, Any]) -> Any:
    """Activity for step: merge_results (StepType.TRANSFORM)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "merge_results", "type": "transform", "tier": null, "config": {"mappings": {"energy_production": "{{step_calculate_energy_production_output.annual_energy_production_kwh}}", "savings": "{{step_calculate_savings_output}}", "incentives": "{{step_fetch_incentives_output.incentives}}", "recommendation": "{{step_generate_recommendation_output}}"}}, "next_steps": ["final_response_generation"], "description": "Merges the outputs of the incentives and recommendation steps for the final response.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step merge_results failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_solar_savings_estimator_final_response_generation(variables: Dict[str, Any]) -> Any:
    """Activity for step: final_response_generation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "final_response_generation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4da8af74d1abc1489ea4645ec3", "query_template": "The following data was produced by the previous steps: {{{{step_merge_results_output}}}}. This request relates to residential solar savings. Consolidate all outputs into a structured, customer-facing markdown report with the following sections:\\n## Summary\\n## Key Metrics\\n- **Annual Energy Production**: <value> kWh\\n- **Annual Bill Savings**: $<value>\\n- **Payback Period**: <value> years\\n- **Net Savings Over 25 Years**: $<value>\\n## Incentives Available in {{{{state}}}}\\n- List of incentives with descriptions and financial benefits.\\n## Recommendation\\n<Plain English recommendation tailored to the homeowner\'s situation.>\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["reviewer"], "description": "Consolidates all outputs into a structured, customer-facing markdown report.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step final_response_generation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_solar_savings_estimator_reviewer(variables: Dict[str, Any]) -> Any:
    """Activity for step: reviewer (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "reviewer", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4d501877e38b00ef86df312bbe", "query_template": "The following data was produced by the previous step: {{{{step_final_response_generation_output}}}}. Review the output for readability, completeness, and factual consistency. Provide feedback and suggested improvements. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["output_moderation"], "description": "Reviews the final output for readability, completeness, and factual consistency.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step reviewer failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_solar_savings_estimator_output_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: output_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "output_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4c86fa768bb34e72dd8402560d", "query_template": "The following data was produced by the previous step: {{{{step_reviewer_output}}}}. Assess whether the final response is safe and appropriate for delivery. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": {"is_safe": "boolean: Indicates whether the output is safe for delivery.", "moderation_notes": "string: Explanation of any safety concerns or null if safe."}}, "next_steps": [], "description": "Ensures the final response is safe and appropriate for delivery.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step output_moderation failed")
    return result.output

@workflows.workflow.define(
    name="solar_savings_estimator",
    workflow_display_name="Solar Savings Estimator",
    workflow_description="Automates the estimation of rooftop solar savings for a homeowner by calculating energy production, bill savings, payback period, and providing a tailored recommendation with state-specific incentives.",
    execution_timeout=timedelta(hours=24),
)
class SolarSavingsEstimator:
    """Durable workflow: Automates the estimation of rooftop solar savings for a homeowner by calculating energy production, bill savings, payback period, and providing a tailored recommendation with state-specific incentives."""

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
        """Execute the Solar Savings Estimator workflow DAG."""
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
                output = await run_solar_savings_estimator_jailbreak_moderation(variables)
                outputs["jailbreak_moderation"] = output
                self._last_result = output
                variables["step_jailbreak_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "topic_control_guardrail"

            elif current_step == "topic_control_guardrail":
                self._progress.append("topic_control_guardrail")
                output = await run_solar_savings_estimator_topic_control_guardrail(variables)
                outputs["topic_control_guardrail"] = output
                self._last_result = output
                variables["step_topic_control_guardrail_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "calculate_energy_production"

            elif current_step == "calculate_energy_production":
                self._progress.append("calculate_energy_production")
                output = await run_solar_savings_estimator_calculate_energy_production(variables)
                outputs["calculate_energy_production"] = output
                self._last_result = output
                variables["step_calculate_energy_production_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "calculate_savings"

            elif current_step == "calculate_savings":
                self._progress.append("calculate_savings")
                output = await run_solar_savings_estimator_calculate_savings(variables)
                outputs["calculate_savings"] = output
                self._last_result = output
                variables["step_calculate_savings_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "fetch_incentives"

            elif current_step == "fetch_incentives" or current_step == "generate_recommendation":
                # ── Parallel group: pg_core_analysis ──
                self._progress.append("__parallel_pg_core_analysis:start")
                # Fan-out: execute 2 steps concurrently
                _parallel_results = await asyncio.gather(
                    run_solar_savings_estimator_fetch_incentives(dict(variables)),
                    run_solar_savings_estimator_generate_recommendation(dict(variables)),
                )
                # Fan-in: merge all parallel outputs
                _parallel_names = ["fetch_incentives", "generate_recommendation"]
                for _pname, _presult in zip(_parallel_names, _parallel_results):
                    outputs[_pname] = _presult
                    variables[f"step_{_pname}_output"] = _presult
                    if isinstance(_presult, dict):
                        variables.update(_presult)
                    self._progress.append(_pname)
                self._last_result = _parallel_results[-1]

                current_step = "merge_results"

            elif current_step == "merge_results":
                self._progress.append("merge_results")
                output = await run_solar_savings_estimator_merge_results(variables)
                outputs["merge_results"] = output
                self._last_result = output
                variables["step_merge_results_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "final_response_generation"

            elif current_step == "final_response_generation":
                self._progress.append("final_response_generation")
                output = await run_solar_savings_estimator_final_response_generation(variables)
                outputs["final_response_generation"] = output
                self._last_result = output
                variables["step_final_response_generation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "reviewer"

            elif current_step == "reviewer":
                self._progress.append("reviewer")
                output = await run_solar_savings_estimator_reviewer(variables)
                outputs["reviewer"] = output
                self._last_result = output
                variables["step_reviewer_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "output_moderation"

            elif current_step == "output_moderation":
                self._progress.append("output_moderation")
                output = await run_solar_savings_estimator_output_moderation(variables)
                outputs["output_moderation"] = output
                self._last_result = output
                variables["step_output_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = None

            else:
                current_step = None

        return outputs
