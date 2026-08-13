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
async def run_patient_case_triage_workflow_jailbreak_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: jailbreak_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "jailbreak_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4bdfd2751d9a20107c77ddf696", "query_template": "The following data is the inbound patient case provided by the user: {{{{patient_case}}}}. Validate this input for safety and detect any malicious or inappropriate requests. Apply the relevant safety protocols for clinical triage automation. Respond with a JSON object containing the keys: \'is_safe\' (boolean), \'risk_level\' (string: \'none\' | \'low\' | \'medium\' | \'high\'), and \'risk_reason\' (string, optional). Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["topic_control_guardrail"], "description": "Validates inbound patient case input for safety, detecting malicious or inappropriate requests before processing.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step jailbreak_moderation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_patient_case_triage_workflow_topic_control_guardrail(variables: Dict[str, Any]) -> Any:
    """Activity for step: topic_control_guardrail (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "topic_control_guardrail", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4bfd0772dda49732e8cb9c5a73", "query_template": "The following data was produced by the previous step: {{{{step_jailbreak_moderation_output}}}}. The inbound patient case is: {{{{patient_case}}}}. Classify this case into relevant clinical categories and ensure it is appropriate for triage automation. This request relates to clinical triage. Apply the relevant clinical guidelines and metrics for this domain. Respond with a JSON object containing the keys: \'is_relevant\' (boolean), \'clinical_category\' (string, e.g., \'cardiology\', \'neurology\'), and \'irrelevance_reason\' (string, optional). Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["medical_information_extractor"], "description": "Classifies the inbound patient case into relevant clinical categories and ensures it is appropriate for triage automation.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step topic_control_guardrail failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_patient_case_triage_workflow_medical_information_extractor(variables: Dict[str, Any]) -> Any:
    """Activity for step: medical_information_extractor (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "medical_information_extractor", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019fdb2ae51f7401830a0e5bf9b49fd1", "query_template": "The following data was produced by the previous steps: {{{{step_jailbreak_moderation_output}}}}, {{{{step_topic_control_guardrail_output}}}}. The inbound patient case is: {{{{patient_case}}}}. Extract structured clinical information from this unstructured patient data. This request relates to clinical triage. Apply the relevant clinical guidelines and metrics for this domain. Respond with a JSON object containing the keys: \'patient_info\' (object: name, age, gender), \'symptoms\' (array of objects: description, onset, severity), \'medical_history\' (array of objects: condition, diagnosis_date, treatment), \'laboratory_reports\' (array of objects: test_name, result, reference_range), and \'diagnostic_images\' (array of objects: image_type, findings). Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["preliminary_diagnosis_generator", "investigation_recommender"], "description": "Extracts structured clinical information from unstructured patient data, including symptoms, medical history, laboratory reports, and diagnostic images.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step medical_information_extractor failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_patient_case_triage_workflow_preliminary_diagnosis_generator(variables: Dict[str, Any]) -> Any:
    """Activity for step: preliminary_diagnosis_generator (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "preliminary_diagnosis_generator", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019fdb2ae62e70329b0ef961362c6d99", "query_template": "The following data was produced by the previous steps: {{{{step_jailbreak_moderation_output}}}}, {{{{step_topic_control_guardrail_output}}}}, {{{{step_medical_information_extractor_output}}}}. The inbound patient case is: {{{{patient_case}}}}. Analyze the extracted patient data to generate a preliminary diagnosis, including differential diagnoses and confidence scores. This request relates to clinical triage. Apply the relevant clinical guidelines and metrics for this domain. Use the search_medical_knowledge_base tool if needed to gather supporting evidence. Respond with a markdown report using the following structure: ## Preliminary Diagnosis, ## Differential Diagnoses (bulleted list with confidence scores), ## Supporting Evidence, and ## Contradictory Evidence. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["merge_results"], "description": "Analyzes extracted patient data to generate a preliminary diagnosis, including differential diagnoses and confidence scores.", "parallel_group": "pg_core_analysis"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step preliminary_diagnosis_generator failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_patient_case_triage_workflow_investigation_recommender(variables: Dict[str, Any]) -> Any:
    """Activity for step: investigation_recommender (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "investigation_recommender", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019fdb2ae76274c68d89ff08f06e31a8", "query_template": "The following data was produced by the previous steps: {{{{step_jailbreak_moderation_output}}}}, {{{{step_topic_control_guardrail_output}}}}, {{{{step_medical_information_extractor_output}}}}. The inbound patient case is: {{{{patient_case}}}}. Recommend additional investigations (e.g., lab tests, imaging) based on the extracted patient data to refine the diagnosis. This request relates to clinical triage. Apply the relevant clinical guidelines and metrics for this domain. Use the search_medical_knowledge_base tool if needed to gather supporting evidence. Respond with a numbered list of recommended investigations, each with fields: \'investigation_type\' (string), \'rationale\' (string), \'priority\' (string: \'high\' | \'medium\' | \'low\'), and \'clinical_guidelines\' (string, optional). Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "structured_list"}, "next_steps": ["merge_results"], "description": "Recommends additional investigations (e.g., lab tests, imaging) based on the preliminary diagnosis and patient data to refine the diagnosis.", "parallel_group": "pg_core_analysis"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step investigation_recommender failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy_max_attempts=3,
)
async def run_patient_case_triage_workflow_merge_results(variables: Dict[str, Any]) -> Any:
    """Activity for step: merge_results (StepType.TRANSFORM)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "merge_results", "type": "transform", "tier": null, "config": {"mappings": {"preliminary_diagnosis": "{{step_preliminary_diagnosis_generator_output}}", "recommended_investigations": "{{step_investigation_recommender_output}}", "medical_information": "{{step_medical_information_extractor_output}}"}}, "next_steps": ["final_response_generation"], "description": "Merges the outputs of the preliminary diagnosis and investigation recommendation steps for further processing.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step merge_results failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_patient_case_triage_workflow_final_response_generation(variables: Dict[str, Any]) -> Any:
    """Activity for step: final_response_generation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "final_response_generation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4c86fa768bb34e72dd8402560d", "query_template": "The following data was produced by the previous steps: {{{{step_jailbreak_moderation_output}}}}, {{{{step_topic_control_guardrail_output}}}}, {{{{step_medical_information_extractor_output}}}}, {{{{step_preliminary_diagnosis_generator_output}}}}, {{{{step_investigation_recommender_output}}}}. Compile all triage outputs into a structured, clinician-facing report. This request relates to clinical triage. Apply the relevant clinical communication standards for this domain. Respond with a markdown report using the following structure: # Patient Triage Report, ## Patient Information, ## Preliminary Diagnosis, ## Recommended Investigations, and ## Additional Notes. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["reviewer"], "description": "Compiles all triage outputs into a structured, clinician-facing report for final delivery.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step final_response_generation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_patient_case_triage_workflow_reviewer(variables: Dict[str, Any]) -> Any:
    """Activity for step: reviewer (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "reviewer", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4d501877e38b00ef86df312bbe", "query_template": "The following data was produced by the previous steps: {{{{step_final_response_generation_output}}}}. Review the triage output for completeness, factual consistency, and adherence to clinical communication standards. This request relates to clinical triage. Apply the relevant clinical guidelines and metrics for this domain. Respond with a markdown report using the following structure: ## Review Summary, ## Strengths, ## Gaps (bulleted list), and ## Suggested Improvements. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["output_moderation"], "description": "Reviews the triage output for completeness, factual consistency, and adherence to clinical communication standards.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step reviewer failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_patient_case_triage_workflow_output_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: output_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "output_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4da8af74d1abc1489ea4645ec3", "query_template": "The following data was produced by the previous steps: {{{{step_final_response_generation_output}}}}, {{{{step_reviewer_output}}}}. Validate the final triage report for safety, appropriateness, and compliance before delivery. This request relates to clinical triage. Apply the relevant safety protocols for this domain. Respond with a JSON object containing the keys: \'is_approved\' (boolean), \'moderation_notes\' (string, optional), and \'safety_concerns\' (array of strings, optional). Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": [], "description": "Validates the final triage report for safety, appropriateness, and compliance before delivery.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step output_moderation failed")
    return result.output

@workflows.workflow.define(
    name="patient_case_triage_workflow",
    workflow_display_name="Patient Case Triage Workflow",
    workflow_description="Automates the triage of inbound patient cases by extracting medical information, generating a preliminary diagnosis, and recommending additional investigations to refine the diagnosis.",
    execution_timeout=timedelta(hours=24),
)
class PatientCaseTriageWorkflow:
    """Durable workflow: Automates the triage of inbound patient cases by extracting medical information, generating a preliminary diagnosis, and recommending additional investigations to refine the diagnosis."""

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
        """Execute the Patient Case Triage Workflow workflow DAG."""
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
                output = await run_patient_case_triage_workflow_jailbreak_moderation(variables)
                outputs["jailbreak_moderation"] = output
                self._last_result = output
                variables["step_jailbreak_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "topic_control_guardrail"

            elif current_step == "topic_control_guardrail":
                self._progress.append("topic_control_guardrail")
                output = await run_patient_case_triage_workflow_topic_control_guardrail(variables)
                outputs["topic_control_guardrail"] = output
                self._last_result = output
                variables["step_topic_control_guardrail_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "medical_information_extractor"

            elif current_step == "medical_information_extractor":
                self._progress.append("medical_information_extractor")
                output = await run_patient_case_triage_workflow_medical_information_extractor(variables)
                outputs["medical_information_extractor"] = output
                self._last_result = output
                variables["step_medical_information_extractor_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "preliminary_diagnosis_generator"

            elif current_step == "preliminary_diagnosis_generator" or current_step == "investigation_recommender":
                # ── Parallel group: pg_core_analysis ──
                self._progress.append("__parallel_pg_core_analysis:start")
                # Fan-out: execute 2 steps concurrently
                _parallel_results = await asyncio.gather(
                    run_patient_case_triage_workflow_preliminary_diagnosis_generator(dict(variables)),
                    run_patient_case_triage_workflow_investigation_recommender(dict(variables)),
                )
                # Fan-in: merge all parallel outputs
                _parallel_names = ["preliminary_diagnosis_generator", "investigation_recommender"]
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
                output = await run_patient_case_triage_workflow_merge_results(variables)
                outputs["merge_results"] = output
                self._last_result = output
                variables["step_merge_results_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "final_response_generation"

            elif current_step == "final_response_generation":
                self._progress.append("final_response_generation")
                output = await run_patient_case_triage_workflow_final_response_generation(variables)
                outputs["final_response_generation"] = output
                self._last_result = output
                variables["step_final_response_generation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "reviewer"

            elif current_step == "reviewer":
                self._progress.append("reviewer")
                output = await run_patient_case_triage_workflow_reviewer(variables)
                outputs["reviewer"] = output
                self._last_result = output
                variables["step_reviewer_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "output_moderation"

            elif current_step == "output_moderation":
                self._progress.append("output_moderation")
                output = await run_patient_case_triage_workflow_output_moderation(variables)
                outputs["output_moderation"] = output
                self._last_result = output
                variables["step_output_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = None

            else:
                current_step = None

        return outputs
