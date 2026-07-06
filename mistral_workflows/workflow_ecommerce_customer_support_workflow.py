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
async def run_ecommerce_customer_support_workflow_jailbreak_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: jailbreak_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "jailbreak_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4bdfd2751d9a20107c77ddf696", "query_template": "The following data was provided by the user: {{{{customer_request}}}}. This request relates to e-commerce customer support. Validate the request for safety, detecting any malicious or harmful content. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["topic_control_guardrail"], "description": "Validates incoming customer support requests for safety, detecting malicious or harmful content before processing.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step jailbreak_moderation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_ecommerce_customer_support_workflow_topic_control_guardrail(variables: Dict[str, Any]) -> Any:
    """Activity for step: topic_control_guardrail (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "topic_control_guardrail", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4bfd0772dda49732e8cb9c5a73", "query_template": "The following data was produced by the previous step: {{{{step_jailbreak_moderation_output}}}}. The customer\'s request is: {{{{customer_request}}}}. This request relates to e-commerce customer support. Classify the request into a relevant topic and check for relevance to e-commerce support. Provide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["support_intent_classifier"], "description": "Classifies the customer support request into a relevant topic and checks for relevance to e-commerce support.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step topic_control_guardrail failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_ecommerce_customer_support_workflow_support_intent_classifier(variables: Dict[str, Any]) -> Any:
    """Activity for step: support_intent_classifier (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "support_intent_classifier", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019f363aa46074f8a4dc5526fe1dda41", "query_template": "The following data was produced by the previous steps: {{{{step_jailbreak_moderation_output}}}}, {{{{step_topic_control_guardrail_output}}}}. The customer\'s request is: {{{{customer_request}}}}. This request relates to e-commerce customer support. Analyze the request to determine the customer\'s intent and identify the information required to resolve it. Provide a complete, thorough response in the specified JSON format. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["information_extractor"], "description": "Classifies the customer\'s intent based on the support request and determines the appropriate resolution path.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step support_intent_classifier failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_ecommerce_customer_support_workflow_information_extractor(variables: Dict[str, Any]) -> Any:
    """Activity for step: information_extractor (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "information_extractor", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019f363aa56870f3940b5fb4654dd185", "query_template": "The following data was produced by the previous steps: {{{{step_jailbreak_moderation_output}}}}, {{{{step_topic_control_guardrail_output}}}}, {{{{step_support_intent_classifier_output}}}}. The customer\'s request is: {{{{customer_request}}}}. Extract the required information from the request based on the fields identified by the intent classifier. Provide a complete, thorough response in the specified JSON format. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["request_validator"], "description": "Extracts structured information from the customer\'s support request based on the required fields identified by the intent classifier.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step information_extractor failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_ecommerce_customer_support_workflow_request_validator(variables: Dict[str, Any]) -> Any:
    """Activity for step: request_validator (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "request_validator", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019f363aa79d77e4a02e937962f444df", "query_template": "The following data was produced by the previous steps: {{{{step_jailbreak_moderation_output}}}}, {{{{step_topic_control_guardrail_output}}}}, {{{{step_support_intent_classifier_output}}}}, {{{{step_information_extractor_output}}}}. The customer\'s request is: {{{{customer_request}}}}. This request relates to e-commerce customer support. Validate the request against e-commerce policies and determine if it is actionable. Provide a complete, thorough response in the specified JSON format. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["resolution_generator"], "description": "Validates the customer\'s request against e-commerce policies and determines if the request is actionable.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step request_validator failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_ecommerce_customer_support_workflow_resolution_generator(variables: Dict[str, Any]) -> Any:
    """Activity for step: resolution_generator (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "resolution_generator", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019f363aa69172d5bff9bab2273abcb6", "query_template": "The following data was produced by the previous steps: {{{{step_jailbreak_moderation_output}}}}, {{{{step_topic_control_guardrail_output}}}}, {{{{step_support_intent_classifier_output}}}}, {{{{step_information_extractor_output}}}}, {{{{step_request_validator_output}}}}. The customer\'s request is: {{{{customer_request}}}}. This request relates to e-commerce customer support. Generate a resolution for the customer\'s support request based on the intent, extracted information, and validation results. Provide a complete, thorough response in the specified JSON format. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["final_response_generation"], "description": "Generates a resolution for the customer\'s support request based on the intent, extracted information, and validation results.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step resolution_generator failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_ecommerce_customer_support_workflow_final_response_generation(variables: Dict[str, Any]) -> Any:
    """Activity for step: final_response_generation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "final_response_generation", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019efd4c86fa768bb34e72dd8402560d", "query_template": "The following data was produced by the previous steps: {{{{step_jailbreak_moderation_output}}}}, {{{{step_topic_control_guardrail_output}}}}, {{{{step_support_intent_classifier_output}}}}, {{{{step_information_extractor_output}}}}, {{{{step_request_validator_output}}}}, {{{{step_resolution_generator_output}}}}. The customer\'s request is: {{{{customer_request}}}}. This request relates to e-commerce customer support. Consolidate all upstream outputs into a structured, customer-facing response. The response must follow this structure:\\n\\n## Summary\\n## Key Findings / Results\\n## Details\\n## Recommendations (if applicable)\\n## Next Steps (if applicable)\\n\\nProvide a complete, thorough response in markdown format. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["reviewer"], "description": "Consolidates all upstream outputs into a structured, customer-facing response.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step final_response_generation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_ecommerce_customer_support_workflow_reviewer(variables: Dict[str, Any]) -> Any:
    """Activity for step: reviewer (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "reviewer", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4d501877e38b00ef86df312bbe", "query_template": "The following data was produced by the previous steps: {{{{step_final_response_generation_output}}}}. Review the generated resolution for readability, completeness, factual consistency, and adherence to communication standards. Provide a complete, thorough response in the specified JSON format. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["output_moderation"], "description": "Reviews the generated resolution for readability, completeness, factual consistency, and adherence to communication standards.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step reviewer failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_ecommerce_customer_support_workflow_output_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: output_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "output_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4da8af74d1abc1489ea4645ec3", "query_template": "The following data was produced by the previous steps: {{{{step_final_response_generation_output}}}}, {{{{step_reviewer_output}}}}. Perform a final safety and quality check on the customer-facing response. Provide a complete, thorough response in the specified JSON format. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": [], "description": "Performs a final safety and quality check on the customer-facing response before delivery.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step output_moderation failed")
    return result.output

@workflows.workflow.define(
    name="ecommerce_customer_support_workflow",
    workflow_display_name="Ecommerce Customer Support Workflow",
    workflow_description="Automates the end-to-end processing of customer support requests for an e-commerce platform, including intent classification, information extraction, validation, resolution generation, and professional response preparation.",
    execution_timeout=timedelta(hours=24),
)
class EcommerceCustomerSupportWorkflow:
    """Durable workflow: Automates the end-to-end processing of customer support requests for an e-commerce platform, including intent classification, information extraction, validation, resolution generation, and professional response preparation."""

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
        """Execute the Ecommerce Customer Support Workflow workflow DAG."""
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
                output = await run_ecommerce_customer_support_workflow_jailbreak_moderation(variables)
                outputs["jailbreak_moderation"] = output
                self._last_result = output
                variables["step_jailbreak_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "topic_control_guardrail"

            elif current_step == "topic_control_guardrail":
                self._progress.append("topic_control_guardrail")
                output = await run_ecommerce_customer_support_workflow_topic_control_guardrail(variables)
                outputs["topic_control_guardrail"] = output
                self._last_result = output
                variables["step_topic_control_guardrail_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "support_intent_classifier"

            elif current_step == "support_intent_classifier":
                self._progress.append("support_intent_classifier")
                output = await run_ecommerce_customer_support_workflow_support_intent_classifier(variables)
                outputs["support_intent_classifier"] = output
                self._last_result = output
                variables["step_support_intent_classifier_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "information_extractor"

            elif current_step == "information_extractor":
                self._progress.append("information_extractor")
                output = await run_ecommerce_customer_support_workflow_information_extractor(variables)
                outputs["information_extractor"] = output
                self._last_result = output
                variables["step_information_extractor_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "request_validator"

            elif current_step == "request_validator":
                self._progress.append("request_validator")
                output = await run_ecommerce_customer_support_workflow_request_validator(variables)
                outputs["request_validator"] = output
                self._last_result = output
                variables["step_request_validator_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "resolution_generator"

            elif current_step == "resolution_generator":
                self._progress.append("resolution_generator")
                output = await run_ecommerce_customer_support_workflow_resolution_generator(variables)
                outputs["resolution_generator"] = output
                self._last_result = output
                variables["step_resolution_generator_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "final_response_generation"

            elif current_step == "final_response_generation":
                self._progress.append("final_response_generation")
                output = await run_ecommerce_customer_support_workflow_final_response_generation(variables)
                outputs["final_response_generation"] = output
                self._last_result = output
                variables["step_final_response_generation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "reviewer"

            elif current_step == "reviewer":
                self._progress.append("reviewer")
                output = await run_ecommerce_customer_support_workflow_reviewer(variables)
                outputs["reviewer"] = output
                self._last_result = output
                variables["step_reviewer_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "output_moderation"

            elif current_step == "output_moderation":
                self._progress.append("output_moderation")
                output = await run_ecommerce_customer_support_workflow_output_moderation(variables)
                outputs["output_moderation"] = output
                self._last_result = output
                variables["step_output_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = None

            else:
                current_step = None

        return outputs
