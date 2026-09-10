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
async def run_parcel_shipping_quote_generation_input_safety_validation(variables: Dict[str, Any]) -> Any:
    """Activity for step: input_safety_validation (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "input_safety_validation", "type": "tool", "tier": "foundation", "config": {"tool_name": "validate_input_safety", "arguments": {"raw_claim_submission": "{{raw_shipment_request}}"}}, "next_steps": ["shipment_details_parsing"], "description": "Validates the incoming shipment request for malicious content, jailbreak attempts, or malformed data.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step input_safety_validation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_parcel_shipping_quote_generation_shipment_details_parsing(variables: Dict[str, Any]) -> Any:
    """Activity for step: shipment_details_parsing (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "shipment_details_parsing", "type": "tool", "tier": "domain", "config": {"tool_name": "parse_shipment_details", "arguments": {"validated_shipment_request": "{{step_input_safety_validation_output}}"}}, "next_steps": ["volumetric_weight_calculation"], "description": "Extracts and structures origin country, destination country, weight, dimensions, and declared value from the validated request.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step shipment_details_parsing failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_parcel_shipping_quote_generation_volumetric_weight_calculation(variables: Dict[str, Any]) -> Any:
    """Activity for step: volumetric_weight_calculation (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "volumetric_weight_calculation", "type": "tool", "tier": "domain", "config": {"tool_name": "calculate_volumetric_weight", "arguments": {"parsed_shipment_details": "{{step_shipment_details_parsing_output}}"}}, "next_steps": ["base_charge_calculation"], "description": "Calculates the volumetric weight (L\\u00d7W\\u00d7H/5000) and determines the chargeable weight as the greater of actual or volumetric weight.", "parallel_group": "shipment_details_parsing_fanout"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step volumetric_weight_calculation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_parcel_shipping_quote_generation_shipping_zone_determination(variables: Dict[str, Any]) -> Any:
    """Activity for step: shipping_zone_determination (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "shipping_zone_determination", "type": "tool", "tier": "use_case", "config": {"tool_name": "determine_shipping_zone", "arguments": {"parsed_shipment_details": {"origin_country": "{{step_shipment_details_parsing_output.origin_country}}", "destination_country": "{{step_shipment_details_parsing_output.destination_country}}"}}}, "next_steps": ["base_charge_calculation"], "description": "Classifies the shipment route into zone 1 (EU\\u2192EU), zone 2 (EU\\u2192UK), or zone 3 (all other routes).", "parallel_group": "shipment_details_parsing_fanout"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step shipping_zone_determination failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_parcel_shipping_quote_generation_insurance_calculation(variables: Dict[str, Any]) -> Any:
    """Activity for step: insurance_calculation (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "insurance_calculation", "type": "tool", "tier": "domain", "config": {"tool_name": null, "arguments": {"declared_value": "{{step_shipment_details_parsing_output.declared_value}}"}, "transform_code": "insurance_cost = {{step_shipment_details_parsing_output.declared_value}} * 0.015"}, "next_steps": ["base_charge_calculation"], "description": "Calculates insurance cost as 1.5% of the declared value.", "parallel_group": "shipment_details_parsing_fanout"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step insurance_calculation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_parcel_shipping_quote_generation_base_charge_calculation(variables: Dict[str, Any]) -> Any:
    """Activity for step: base_charge_calculation (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "base_charge_calculation", "type": "tool", "tier": "use_case", "config": {"tool_name": null, "arguments": {"chargeable_weight": "{{step_volumetric_weight_calculation_output.chargeable_weight}}", "zone": "{{step_shipping_zone_determination_output.zone}}"}, "transform_code": "zone_rates = {\'1\': 4.20, \'2\': 6.10, \'3\': 9.80}; base_charge = {{step_volumetric_weight_calculation_output.chargeable_weight}} * zone_rates.get(str({{step_shipping_zone_determination_output.zone}}), 9.80)"}, "next_steps": ["fuel_surcharge_calculation"], "description": "Applies the per-kg rate for the determined zone to the chargeable weight to compute the base shipping charge.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step base_charge_calculation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_parcel_shipping_quote_generation_fuel_surcharge_calculation(variables: Dict[str, Any]) -> Any:
    """Activity for step: fuel_surcharge_calculation (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "fuel_surcharge_calculation", "type": "tool", "tier": "use_case", "config": {"tool_name": null, "arguments": {"base_charge": "{{step_base_charge_calculation_output.base_charge}}"}, "transform_code": "fuel_surcharge = {{step_base_charge_calculation_output.base_charge}} * 0.12"}, "next_steps": ["quote_compilation"], "description": "Adds a 12% fuel surcharge to the base charge.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step fuel_surcharge_calculation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_parcel_shipping_quote_generation_quote_compilation(variables: Dict[str, Any]) -> Any:
    """Activity for step: quote_compilation (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "quote_compilation", "type": "tool", "tier": "use_case", "config": {"tool_name": null, "arguments": {"chargeable_weight": "{{step_volumetric_weight_calculation_output.chargeable_weight}}", "zone": "{{step_shipping_zone_determination_output.zone}}", "base_charge": "{{step_base_charge_calculation_output.base_charge}}", "fuel_surcharge": "{{step_fuel_surcharge_calculation_output.fuel_surcharge}}", "insurance_cost": "{{step_insurance_calculation_output.insurance_cost}}", "declared_value": "{{step_shipment_details_parsing_output.declared_value}}"}, "transform_code": "zone_rates = {\'1\': 4.20, \'2\': 6.10, \'3\': 9.80}; line_items = [ {\'description\': \'Base shipping charge\', \'amount\': {{step_base_charge_calculation_output.base_charge}}}, {\'description\': \'Fuel surcharge (12%)\', \'amount\': {{step_fuel_surcharge_calculation_output.fuel_surcharge}}}, {\'description\': \'Insurance (1.5%)\', \'amount\': {{step_insurance_calculation_output.insurance_cost}}} ]; total = {{step_base_charge_calculation_output.base_charge}} + {{step_fuel_surcharge_calculation_output.fuel_surcharge}} + {{step_insurance_calculation_output.insurance_cost}}", "guardrail_policy": "Ensure all calculations (base charge, fuel surcharge, insurance) are precise and match the declared input values to prevent misquotation."}, "next_steps": ["output_safety_validation"], "description": "Compiles all calculated components into a structured line-item table and computes the total quote amount.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step quote_compilation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_parcel_shipping_quote_generation_output_safety_validation(variables: Dict[str, Any]) -> Any:
    """Activity for step: output_safety_validation (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "output_safety_validation", "type": "tool", "tier": "foundation", "config": {"tool_name": "validate_output_safety", "arguments": {"settlement_letter": "{{step_quote_compilation_output.line_items}}", "claim_summary": {"quote_details": {"chargeable_weight": "{{step_volumetric_weight_calculation_output.chargeable_weight}}", "zone": "{{step_shipping_zone_determination_output.zone}}", "base_charge": "{{step_base_charge_calculation_output.base_charge}}", "fuel_surcharge": "{{step_fuel_surcharge_calculation_output.fuel_surcharge}}", "insurance_cost": "{{step_insurance_calculation_output.insurance_cost}}", "total": "{{step_quote_compilation_output.total}}"}}}, "guardrail_policy": "Validate that the output does not contain malformed data, misleading figures, or inconsistencies that could lead to incorrect user decisions."}, "next_steps": [], "description": "Validates the final quote for compliance with communication standards, readability, and factual consistency before delivery.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step output_safety_validation failed")
    return result.output

@workflows.workflow.define(
    name="parcel_shipping_quote_generation",
    workflow_display_name="Parcel Shipping Quote Generation",
    workflow_description="Generates a precise shipping quote for a parcel based on dimensions, weight, route, and declared value, including fuel surcharge and insurance.",
    execution_timeout=timedelta(hours=24),
)
class ParcelShippingQuoteGeneration:
    """Durable workflow: Generates a precise shipping quote for a parcel based on dimensions, weight, route, and declared value, including fuel surcharge and insurance."""

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
        """Execute the Parcel Shipping Quote Generation workflow DAG."""
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
                output = await run_parcel_shipping_quote_generation_input_safety_validation(variables)
                outputs["input_safety_validation"] = output
                self._last_result = output
                variables["step_input_safety_validation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "shipment_details_parsing"

            elif current_step == "shipment_details_parsing":
                self._progress.append("shipment_details_parsing")
                output = await run_parcel_shipping_quote_generation_shipment_details_parsing(variables)
                outputs["shipment_details_parsing"] = output
                self._last_result = output
                variables["step_shipment_details_parsing_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "volumetric_weight_calculation"

            elif current_step == "volumetric_weight_calculation" or current_step == "shipping_zone_determination" or current_step == "insurance_calculation":
                # ── Parallel group: shipment_details_parsing_fanout ──
                self._progress.append("__parallel_shipment_details_parsing_fanout:start")
                # Fan-out: execute 3 steps concurrently
                _parallel_results = await asyncio.gather(
                    run_parcel_shipping_quote_generation_volumetric_weight_calculation(dict(variables)),
                    run_parcel_shipping_quote_generation_shipping_zone_determination(dict(variables)),
                    run_parcel_shipping_quote_generation_insurance_calculation(dict(variables)),
                )
                # Fan-in: merge all parallel outputs
                _parallel_names = ["volumetric_weight_calculation", "shipping_zone_determination", "insurance_calculation"]
                for _pname, _presult in zip(_parallel_names, _parallel_results):
                    outputs[_pname] = _presult
                    variables[f"step_{_pname}_output"] = _presult
                    if isinstance(_presult, dict):
                        variables.update(_presult)
                    self._progress.append(_pname)
                self._last_result = _parallel_results[-1]

                current_step = "base_charge_calculation"

            elif current_step == "base_charge_calculation":
                self._progress.append("base_charge_calculation")
                output = await run_parcel_shipping_quote_generation_base_charge_calculation(variables)
                outputs["base_charge_calculation"] = output
                self._last_result = output
                variables["step_base_charge_calculation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "fuel_surcharge_calculation"

            elif current_step == "fuel_surcharge_calculation":
                self._progress.append("fuel_surcharge_calculation")
                output = await run_parcel_shipping_quote_generation_fuel_surcharge_calculation(variables)
                outputs["fuel_surcharge_calculation"] = output
                self._last_result = output
                variables["step_fuel_surcharge_calculation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "quote_compilation"

            elif current_step == "quote_compilation":
                self._progress.append("quote_compilation")
                output = await run_parcel_shipping_quote_generation_quote_compilation(variables)
                outputs["quote_compilation"] = output
                self._last_result = output
                variables["step_quote_compilation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "output_safety_validation"

            elif current_step == "output_safety_validation":
                self._progress.append("output_safety_validation")
                output = await run_parcel_shipping_quote_generation_output_safety_validation(variables)
                outputs["output_safety_validation"] = output
                self._last_result = output
                variables["step_output_safety_validation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = None

            else:
                current_step = None

        return outputs
