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
async def run_hr_policy_question_resolution_validate_input_safety(variables: Dict[str, Any]) -> Any:
    """Activity for step: validate_input_safety (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "validate_input_safety", "type": "tool", "tier": "foundation", "config": {"tool_name": "validate_input_safety", "arguments": {"employee_question": "{{employee_question}}"}}, "next_steps": ["classify_question_topic"], "description": "Detect and reject malicious, inappropriate, or off-topic requests to ensure workflow safety.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step validate_input_safety failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_hr_policy_question_resolution_classify_question_topic(variables: Dict[str, Any]) -> Any:
    """Activity for step: classify_question_topic (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "classify_question_topic", "type": "tool", "tier": "domain", "config": {"tool_name": "classify_question_topic", "arguments": {"validated_question": "{{step_validate_input_safety_output.validated_question}}"}}, "next_steps": ["retrieve_relevant_handbook_sections"], "description": "Classify the employee\'s question into a predefined HR topic (leave, benefits, conduct, payroll).", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step classify_question_topic failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_hr_policy_question_resolution_retrieve_relevant_handbook_sections(variables: Dict[str, Any]) -> Any:
    """Activity for step: retrieve_relevant_handbook_sections (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "retrieve_relevant_handbook_sections", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a08f6c2a7e76eb88504765f1947917", "query_template": "You are an HR policy assistant. An employee has asked the following question: \'{{employee_question}}\'.\\n\\nThe question has been classified under the topic: \'{{step_classify_question_topic_output.classified_topic}}\'.\\n\\nSearch the HR Handbook for sections relevant to this topic and return exact text passages with their citations (section title and page/paragraph number).\\n\\nRespond with a JSON object containing an array of retrieved sections, each with \'section_text\', \'section_title\', and \'citation\'.", "guardrail_policy": "Enforce strict PII redaction on the query before searching the HR Handbook to prevent logging or exposure of sensitive employee details."}, "next_steps": ["generate_handbook_based_answer"], "description": "Search the HR handbook for sections relevant to the classified question topic.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step retrieve_relevant_handbook_sections failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_hr_policy_question_resolution_generate_handbook_based_answer(variables: Dict[str, Any]) -> Any:
    """Activity for step: generate_handbook_based_answer (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "generate_handbook_based_answer", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_01a08f6c2d0973e58a434bff2ed6a7a8", "query_template": "You are an HR policy assistant tasked with answering an employee\'s question using the HR handbook.\\n\\nEmployee question: \'{{employee_question}}\'\\n\\nRelevant handbook sections:\\n{{#step_retrieve_relevant_handbook_sections_output.retrieved_sections}}\\n- Section: {{section_title}}\\n  Citation: {{citation}}\\n  Text: {{section_text}}\\n{{/step_retrieve_relevant_handbook_sections_output.retrieved_sections}}\\n\\nFormulate a precise, policy-compliant answer to the employee\'s question using the provided handbook sections. If no relevant section is found, state that the handbook does not address the question.\\n\\nRespond with a JSON object containing:\\n- \'handbook_answer\': The answer derived strictly from the handbook or a statement that the handbook does not cover the question.\\n- \'cited_section\': The exact title, subsection, and citation of the handbook section used (null if no section is found).", "guardrail_policy": "Ensure the generated answer does not include or infer PII from the handbook or the original question, even if the handbook contains such data."}, "next_steps": ["assess_answer_sufficiency"], "description": "Formulate a precise answer to the employee\'s question using the retrieved handbook sections and cite the source.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step generate_handbook_based_answer failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_hr_policy_question_resolution_assess_answer_sufficiency(variables: Dict[str, Any]) -> Any:
    """Activity for step: assess_answer_sufficiency (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "assess_answer_sufficiency", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a08f6c2d1b74598156eff2108d11f6", "query_template": "You are an HR policy assistant evaluating whether a handbook-based answer fully addresses an employee\'s question.\\n\\nEmployee question: \'{{employee_question}}\'\\n\\nHandbook-based answer: \'{{step_generate_handbook_based_answer_output.handbook_answer}}\'\\n\\nCited section: \'{{step_generate_handbook_based_answer_output.cited_section}}\'\\n\\nDetermine if the handbook answer is sufficient to address the employee\'s question. If the answer is ambiguous, incomplete, or the handbook does not cover the question, flag it for HR escalation.\\n\\nRespond with a JSON object containing:\\n- \'sufficiency_flag\': Boolean (true if the answer is sufficient, false otherwise).\\n- \'routing_decision\': String (\'handbook\' if sufficient, \'hr_escalation\' if insufficient)."}, "next_steps": ["route_to_hr_or_review"], "description": "Determine if the handbook-based answer fully addresses the employee\'s question or if routing to HR is required.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step assess_answer_sufficiency failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy_max_attempts=3,
)
async def run_hr_policy_question_resolution_route_to_hr_or_review(variables: Dict[str, Any]) -> Any:
    """Activity for step: route_to_hr_or_review (StepType.CONDITION)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "route_to_hr_or_review", "type": "condition", "tier": "domain", "config": {"true_step": "review_response_quality", "false_step": "route_to_hr_team", "expression": "{{step_assess_answer_sufficiency_output.routing_decision == \'handbook\'}}"}, "next_steps": [], "description": "Branch the workflow based on whether the answer is sufficient (proceed to review) or insufficient (route to HR).", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step route_to_hr_or_review failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_hr_policy_question_resolution_route_to_hr_team(variables: Dict[str, Any]) -> Any:
    """Activity for step: route_to_hr_team (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "route_to_hr_team", "type": "tool", "tier": "foundation", "config": {"tool_name": "route_to_hr_team", "arguments": {"validated_question": "{{employee_question}}", "routing_decision": false}, "guardrail_policy": "If routing to HR, ensure the escalation message does not include the original question verbatim; summarize the topic and intent only."}, "next_steps": ["review_response_quality"], "description": "Escalate the question to the HR team if the handbook does not provide a sufficient answer.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step route_to_hr_team failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_hr_policy_question_resolution_review_response_quality(variables: Dict[str, Any]) -> Any:
    """Activity for step: review_response_quality (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "review_response_quality", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_01a08f6c2d18735488089ae8fa6e499e", "query_template": "You are an HR policy assistant reviewing a response to an employee\'s question for clarity, completeness, and compliance.\\n\\nEmployee question: \'{{employee_question}}\'\\n\\nResponse to review:\\n{{#if step_assess_answer_sufficiency_output.routing_decision == \'handbook\'}}\\n- Handbook answer: \'{{step_generate_handbook_based_answer_output.handbook_answer}}\'\\n- Cited section: \'{{step_generate_handbook_based_answer_output.cited_section}}\'\\n{{else}}\\n- Routing confirmation: \'This question has been escalated to the HR team for further assistance.\'\\n{{/if}}\\n\\nEvaluate the response for clarity, completeness, and compliance with company communication standards. If the response is handbook-based, ensure the citation is accurate. If the response is a routing confirmation, ensure it is clear and professional.\\n\\nRespond with a JSON object containing:\\n- \'reviewed_response\': {\\n    \'response_text\': The final, approved response text (revised if needed).\\n    \'compliance_status\': \'compliant\' or \'non_compliant\'.\\n    \'clarity_score\': Integer (1-5).\\n    \'completeness_score\': Integer (1-5).\\n    \'citations\': Array of objects with \'section\' and \'page\' (if applicable).\\n    \'adjustments_made\': Array of strings describing changes made.\\n    \'routing_decision\': \'handbook\' or \'hr_escalation\'.\\n  }"}, "next_steps": ["generate_final_response"], "description": "Ensure the response (either handbook-based or routing confirmation) is clear, complete, and compliant with communication standards.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step review_response_quality failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_hr_policy_question_resolution_generate_final_response(variables: Dict[str, Any]) -> Any:
    """Activity for step: generate_final_response (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "generate_final_response", "type": "tool", "tier": "foundation", "config": {"tool_name": "generate_final_response", "arguments": {"reviewed_response": "{{step_review_response_quality_output.reviewed_response.response_text}}", "routing_decision": "{{step_assess_answer_sufficiency_output.routing_decision == \'hr_escalation\'}}"}}, "next_steps": ["validate_output_safety"], "description": "Consolidate the reviewed response into a structured, employee-facing document.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step generate_final_response failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_hr_policy_question_resolution_validate_output_safety(variables: Dict[str, Any]) -> Any:
    """Activity for step: validate_output_safety (StepType.TOOL)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "validate_output_safety", "type": "tool", "tier": "foundation", "config": {"tool_name": "validate_output_safety", "arguments": {"final_response": "{{step_generate_final_response_output.final_response}}"}}, "next_steps": [], "description": "Ensure the final response is safe, appropriate, and free from harmful or misleading content before delivery.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step validate_output_safety failed")
    return result.output

@workflows.workflow.define(
    name="hr_policy_question_resolution",
    workflow_display_name="Hr Policy Question Resolution",
    workflow_description="Classify and answer an employee's HR policy question using the HR handbook, or route to HR if unanswerable.",
    execution_timeout=timedelta(hours=24),
)
class HrPolicyQuestionResolution:
    """Durable workflow: Classify and answer an employee's HR policy question using the HR handbook, or route to HR if unanswerable."""

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
        """Execute the Hr Policy Question Resolution workflow DAG."""
        # Use workflow.now() for determinism-safe timestamps
        started_at = workflow.now()
        variables = dict(input.variables)
        current_step: Optional[str] = "validate_input_safety"
        visited: set = set()
        outputs: Dict[str, Any] = {}

        while current_step and len(visited) < 50:
            if current_step in visited:
                break  # cycle guard
            visited.add(current_step)

            if current_step == "validate_input_safety":
                self._progress.append("validate_input_safety")
                output = await run_hr_policy_question_resolution_validate_input_safety(variables)
                outputs["validate_input_safety"] = output
                self._last_result = output
                variables["step_validate_input_safety_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "classify_question_topic"

            elif current_step == "classify_question_topic":
                self._progress.append("classify_question_topic")
                output = await run_hr_policy_question_resolution_classify_question_topic(variables)
                outputs["classify_question_topic"] = output
                self._last_result = output
                variables["step_classify_question_topic_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "retrieve_relevant_handbook_sections"

            elif current_step == "retrieve_relevant_handbook_sections":
                self._progress.append("retrieve_relevant_handbook_sections")
                output = await run_hr_policy_question_resolution_retrieve_relevant_handbook_sections(variables)
                outputs["retrieve_relevant_handbook_sections"] = output
                self._last_result = output
                variables["step_retrieve_relevant_handbook_sections_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "generate_handbook_based_answer"

            elif current_step == "generate_handbook_based_answer":
                self._progress.append("generate_handbook_based_answer")
                output = await run_hr_policy_question_resolution_generate_handbook_based_answer(variables)
                outputs["generate_handbook_based_answer"] = output
                self._last_result = output
                variables["step_generate_handbook_based_answer_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "assess_answer_sufficiency"

            elif current_step == "assess_answer_sufficiency":
                self._progress.append("assess_answer_sufficiency")
                output = await run_hr_policy_question_resolution_assess_answer_sufficiency(variables)
                outputs["assess_answer_sufficiency"] = output
                self._last_result = output
                variables["step_assess_answer_sufficiency_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "route_to_hr_or_review"

            elif current_step == "route_to_hr_or_review":
                self._progress.append("route_to_hr_or_review")
                output = await run_hr_policy_question_resolution_route_to_hr_or_review(variables)
                outputs["route_to_hr_or_review"] = output
                self._last_result = output
                variables["step_route_to_hr_or_review_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                # Condition step: output contains {next_step: ...}
                if isinstance(output, dict) and "next_step" in output:
                    current_step = output["next_step"]
                else:
                    current_step = None

            elif current_step == "route_to_hr_team":
                self._progress.append("route_to_hr_team")
                output = await run_hr_policy_question_resolution_route_to_hr_team(variables)
                outputs["route_to_hr_team"] = output
                self._last_result = output
                variables["step_route_to_hr_team_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "review_response_quality"

            elif current_step == "review_response_quality":
                self._progress.append("review_response_quality")
                output = await run_hr_policy_question_resolution_review_response_quality(variables)
                outputs["review_response_quality"] = output
                self._last_result = output
                variables["step_review_response_quality_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "generate_final_response"

            elif current_step == "generate_final_response":
                self._progress.append("generate_final_response")
                output = await run_hr_policy_question_resolution_generate_final_response(variables)
                outputs["generate_final_response"] = output
                self._last_result = output
                variables["step_generate_final_response_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "validate_output_safety"

            elif current_step == "validate_output_safety":
                self._progress.append("validate_output_safety")
                output = await run_hr_policy_question_resolution_validate_output_safety(variables)
                outputs["validate_output_safety"] = output
                self._last_result = output
                variables["step_validate_output_safety_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = None

            else:
                current_step = None

        return outputs
