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
async def run_collect_patient_data(variables: Dict[str, Any]) -> Any:
    """Activity for step: collect_patient_data (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "collect_patient_data", "type": "agent", "config": {"agent_id": "ag_019dfbe92367774ba8492e9e9893adf1", "query_template": "Collect the following patient information:\n- Chief complaint: {chief_complaint}\n- Vital signs: {vitals}\n- Demographics: {demographics}\n- Allergies: {allergies}\n\nValidate all inputs and return structured data."}, "next_steps": ["analyze_patient_history"], "description": "Collects and validates initial patient information including chief complaint and vital signs."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step collect_patient_data failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_analyze_patient_history(variables: Dict[str, Any]) -> Any:
    """Activity for step: analyze_patient_history (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "analyze_patient_history", "type": "agent", "config": {"agent_id": "ag_019dfbe924c6745493a260dea1d75055", "query_template": "Analyze the patient's medical history for the following:\n- High-risk conditions\n- Chronic conditions\n- Medication allergies\n- Recent ED visits\n- Implantable devices\n\nPatient ID: {patient_id}\n\nReturn structured analysis with clinical implications."}, "next_steps": ["calculate_esi_score"], "description": "Analyzes patient history for red flags and chronic conditions that may affect triage."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step analyze_patient_history failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_calculate_esi_score(variables: Dict[str, Any]) -> Any:
    """Activity for step: calculate_esi_score (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "calculate_esi_score", "type": "agent", "config": {"agent_id": "ag_019dfbe925ec73f581a525a36b9088b8", "query_template": "Calculate the ESI score using the following inputs:\n- Chief complaint: {chief_complaint}\n- Vitals: {vitals}\n- Resource needs: {resource_needs}\n- History flags: {history_flags}\n\nReturn the ESI score and rationale."}, "next_steps": ["check_esi_level"], "description": "Calculates Emergency Severity Index (ESI) score based on clinical presentation."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step calculate_esi_score failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy_max_attempts=3,
)
async def run_check_esi_level(variables: Dict[str, Any]) -> Any:
    """Activity for step: check_esi_level (StepType.CONDITION)"""
    step_def = WorkflowStep.model_validate({"id": "check_esi_level", "type": "condition", "config": {"expression": "{esi_score} == 1", "true_step": "activate_trauma_team", "false_step": "route_to_specialist_step"}, "next_steps": [], "description": "Branches workflow based on ESI score severity."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step check_esi_level failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy_max_attempts=3,
)
async def run_activate_trauma_team(variables: Dict[str, Any]) -> Any:
    """Activity for step: activate_trauma_team (StepType.TRANSFORM)"""
    step_def = WorkflowStep.model_validate({"id": "activate_trauma_team", "type": "transform", "config": {"mappings": {"trauma_activation": true, "skip_non_critical": true}}, "next_steps": ["assign_bed_esi1"], "description": "Activates trauma team for ESI-1 patients and skips non-critical steps."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step activate_trauma_team failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_route_to_specialist_step(variables: Dict[str, Any]) -> Any:
    """Activity for step: route_to_specialist_step (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "route_to_specialist_step", "type": "agent", "config": {"agent_id": "ag_019dfbe9270676c8a184e4369a31b6eb", "query_template": "Determine the appropriate specialist team based on:\n- Chief complaint: {chief_complaint}\n- ESI score: {esi_score}\n- History flags: {history_flags}\n- Vital sign abnormalities: {vital_sign_concerns}\n\nReturn the specialist route and rationale."}, "next_steps": ["generate_lab_orders"], "description": "Determines appropriate specialist team based on clinical presentation and ESI score."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step route_to_specialist_step failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_generate_lab_orders(variables: Dict[str, Any]) -> Any:
    """Activity for step: generate_lab_orders (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "generate_lab_orders", "type": "agent", "config": {"agent_id": "ag_019dfbe9282d707caf8bcb4963715a9f", "query_template": "Generate lab and imaging orders based on:\n- Chief complaint: {chief_complaint}\n- ESI score: {esi_score}\n- History flags: {history_flags}\n- Vital sign abnormalities: {vital_sign_concerns}\n\nReturn the list of orders with rationale."}, "next_steps": ["assign_bed"], "description": "Generates appropriate lab and imaging orders based on clinical presentation."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step generate_lab_orders failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_assign_bed(variables: Dict[str, Any]) -> Any:
    """Activity for step: assign_bed (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "assign_bed", "type": "agent", "config": {"agent_id": "ag_019dfbe9295671a6b6a3830c79a156b9", "query_template": "Assign the appropriate bed type based on:\n- ESI score: {esi_score}\n- Chief complaint: {chief_complaint}\n- Isolation needs: {isolation_needed}\n- Monitoring requirements: {monitoring_needs}\n\nReturn the bed assignment and rationale."}, "next_steps": ["notify_family"], "description": "Assigns appropriate bed type based on clinical needs and ESI score."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step assign_bed failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_assign_bed_esi1(variables: Dict[str, Any]) -> Any:
    """Activity for step: assign_bed_esi1 (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "assign_bed_esi1", "type": "agent", "config": {"agent_id": "ag_019dfbe9295671a6b6a3830c79a156b9", "query_template": "Assign the highest acuity bed available for this ESI-1 patient:\n- Chief complaint: {chief_complaint}\n- Isolation needs: {isolation_needed}\n\nReturn the bed assignment and rationale."}, "next_steps": ["notify_family_esi1"], "description": "Assigns highest acuity bed for ESI-1 patients."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step assign_bed_esi1 failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_notify_family(variables: Dict[str, Any]) -> Any:
    """Activity for step: notify_family (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "notify_family", "type": "agent", "config": {"agent_id": "ag_019dfbe92a7270bd92235195ec9aa9a8", "query_template": "Determine family notification requirements based on:\n- Triage level: {triage_level}\n- Patient consent: {consent_given}\n- Local regulations: {local_regulations}\n\nNotify family using the appropriate method and return confirmation."}, "next_steps": ["log_triage_event"], "description": "Handles family notifications based on triage level and consent status."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step notify_family failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_notify_family_esi1(variables: Dict[str, Any]) -> Any:
    """Activity for step: notify_family_esi1 (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "notify_family_esi1", "type": "agent", "config": {"agent_id": "ag_019dfbe92a7270bd92235195ec9aa9a8", "query_template": "Ensure immediate in-person notification for this ESI-1 patient:\n- Patient ID: {patient_id}\n- Triage level: ESI-1\n- Consent status: {consent_given}\n\nReturn notification confirmation."}, "next_steps": ["log_triage_event_esi1"], "description": "Handles immediate family notifications for ESI-1 patients."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step notify_family_esi1 failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_log_triage_event(variables: Dict[str, Any]) -> Any:
    """Activity for step: log_triage_event (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "log_triage_event", "type": "agent", "config": {"agent_id": "ag_019dfbe92ba977bebf3472c34cf60d48", "query_template": "Log the following triage data in the EHR audit log:\n- Patient ID: {patient_id}\n- ESI score: {esi_score}\n- Bed assignment: {bed_assignment}\n- Specialist route: {specialist_route}\n- Lab orders: {lab_orders}\n\nReturn audit confirmation."}, "next_steps": ["compile_final_output"], "description": "Records all triage decisions in the EHR audit log."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step log_triage_event failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_log_triage_event_esi1(variables: Dict[str, Any]) -> Any:
    """Activity for step: log_triage_event_esi1 (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "log_triage_event_esi1", "type": "agent", "config": {"agent_id": "ag_019dfbe92ba977bebf3472c34cf60d48", "query_template": "Log the following triage data for this ESI-1 patient:\n- Patient ID: {patient_id}\n- ESI score: 1\n- Bed assignment: {bed_assignment}\n- Trauma activation: true\n- Lab orders: {lab_orders}\n\nReturn audit confirmation."}, "next_steps": ["compile_final_output_esi1"], "description": "Records all triage decisions for ESI-1 patients in the EHR audit log."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step log_triage_event_esi1 failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_compile_final_output(variables: Dict[str, Any]) -> Any:
    """Activity for step: compile_final_output (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "compile_final_output", "type": "agent", "config": {"agent_id": "ag_019dfbe9222c733f8dd3dc5a17a299c4", "query_template": "Compile the final triage output as a structured clinical decision flowchart using all collected data:\n- Patient ID: {patient_id}\n- Triage level: {triage_level}\n- Chief complaint: {chief_complaint}\n- Vitals: {vitals}\n- History flags: {history_flags}\n- Specialist route: {specialist_route}\n- Lab orders: {lab_orders}\n- Bed assignment: {bed_assignment}\n- Family notified: {family_notified}\n\nInclude clinical decision logic for all severity branches."}, "next_steps": [], "description": "Compiles all triage decisions into a structured clinical decision flowchart."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step compile_final_output failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_compile_final_output_esi1(variables: Dict[str, Any]) -> Any:
    """Activity for step: compile_final_output_esi1 (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "compile_final_output_esi1", "type": "agent", "config": {"agent_id": "ag_019dfbe9222c733f8dd3dc5a17a299c4", "query_template": "Compile the final triage output for this ESI-1 patient as a structured clinical decision flowchart:\n- Patient ID: {patient_id}\n- Triage level: ESI-1\n- Chief complaint: {chief_complaint}\n- Vitals: {vitals}\n- Trauma activation: true\n- Bed assignment: {bed_assignment}\n- Family notified: {family_notified}\n\nInclude clinical decision logic for trauma pathway."}, "next_steps": [], "description": "Compiles all triage decisions for ESI-1 patients into a structured clinical decision flowchart."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step compile_final_output_esi1 failed")
    return result.output

@workflows.workflow.define(
    name="emergency_department_triage_workflow",
    workflow_display_name="Emergency Department Triage Workflow",
    workflow_description="Automated patient intake and triage workflow for hospital emergency departments with adaptive routing based on clinical severity and history.",
    execution_timeout=timedelta(hours=24),
)
class EmergencyDepartmentTriageWorkflow:
    """Durable workflow: Automated patient intake and triage workflow for hospital emergency departments with adaptive routing based on clinical severity and history."""

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
        """Execute the Emergency Department Triage Workflow workflow DAG."""
        # Use workflow.now() for determinism-safe timestamps
        started_at = workflow.now()
        variables = dict(input.variables)
        current_step: Optional[str] = "collect_patient_data"
        visited: set = set()
        last_output: Any = None

        while current_step and len(visited) < 50:
            if current_step in visited:
                break  # cycle guard
            visited.add(current_step)

            if current_step == "collect_patient_data":
                self._progress.append("collect_patient_data")
                output = await run_collect_patient_data(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_collect_patient_data_output"] = output

                current_step = "analyze_patient_history"

            elif current_step == "analyze_patient_history":
                self._progress.append("analyze_patient_history")
                output = await run_analyze_patient_history(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_analyze_patient_history_output"] = output

                current_step = "calculate_esi_score"

            elif current_step == "calculate_esi_score":
                self._progress.append("calculate_esi_score")
                output = await run_calculate_esi_score(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_calculate_esi_score_output"] = output

                current_step = "check_esi_level"

            elif current_step == "check_esi_level":
                self._progress.append("check_esi_level")
                output = await run_check_esi_level(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_check_esi_level_output"] = output

                # Condition step: output contains {next_step: ...}
                if isinstance(output, dict) and "next_step" in output:
                    current_step = output["next_step"]
                else:
                    current_step = None

            elif current_step == "activate_trauma_team":
                self._progress.append("activate_trauma_team")
                output = await run_activate_trauma_team(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_activate_trauma_team_output"] = output

                current_step = "assign_bed_esi1"

            elif current_step == "route_to_specialist_step":
                self._progress.append("route_to_specialist_step")
                output = await run_route_to_specialist_step(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_route_to_specialist_step_output"] = output

                current_step = "generate_lab_orders"

            elif current_step == "generate_lab_orders":
                self._progress.append("generate_lab_orders")
                output = await run_generate_lab_orders(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_generate_lab_orders_output"] = output

                current_step = "assign_bed"

            elif current_step == "assign_bed":
                self._progress.append("assign_bed")
                output = await run_assign_bed(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_assign_bed_output"] = output

                current_step = "notify_family"

            elif current_step == "assign_bed_esi1":
                self._progress.append("assign_bed_esi1")
                output = await run_assign_bed_esi1(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_assign_bed_esi1_output"] = output

                current_step = "notify_family_esi1"

            elif current_step == "notify_family":
                self._progress.append("notify_family")
                output = await run_notify_family(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_notify_family_output"] = output

                current_step = "log_triage_event"

            elif current_step == "notify_family_esi1":
                self._progress.append("notify_family_esi1")
                output = await run_notify_family_esi1(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_notify_family_esi1_output"] = output

                current_step = "log_triage_event_esi1"

            elif current_step == "log_triage_event":
                self._progress.append("log_triage_event")
                output = await run_log_triage_event(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_log_triage_event_output"] = output

                current_step = "compile_final_output"

            elif current_step == "log_triage_event_esi1":
                self._progress.append("log_triage_event_esi1")
                output = await run_log_triage_event_esi1(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_log_triage_event_esi1_output"] = output

                current_step = "compile_final_output_esi1"

            elif current_step == "compile_final_output":
                self._progress.append("compile_final_output")
                output = await run_compile_final_output(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_compile_final_output_output"] = output

                current_step = None

            elif current_step == "compile_final_output_esi1":
                self._progress.append("compile_final_output_esi1")
                output = await run_compile_final_output_esi1(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_compile_final_output_esi1_output"] = output

                current_step = None

            else:
                current_step = None

        return last_output
