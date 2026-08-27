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
async def run_support_ticket_triage_and_reply_draft_jailbreak_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: jailbreak_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "jailbreak_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4bdfd2751d9a20107c77ddf696", "query_template": "The following data was provided by the user: {{{{support_ticket}}}}\\n\\nThis request relates to customer support ticket triage. Validate the input for safety, detecting any malicious or inappropriate content.\\n\\nTask: Assess the safety of the support ticket input. Determine if it is safe for processing or if it contains harmful, abusive, or policy-violating content.\\n\\nOutput format: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"is_safe\\": boolean,\\n  \\"risk_level\\": \\"string (low | medium | high)\\",\\n  \\"risk_reason\\": \\"string (null if is_safe is true)\\"\\n}\\n```\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["intent_classification"], "description": "Validates the input support ticket for safety, detecting malicious or inappropriate requests.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step jailbreak_moderation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_support_ticket_triage_and_reply_draft_intent_classification(variables: Dict[str, Any]) -> Any:
    """Activity for step: intent_classification (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "intent_classification", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019f363aa46074f8a4dc5526fe1dda41", "query_template": "The following data was produced by the previous step: {{{{step_jailbreak_moderation_output}}}}\\n\\nThis request relates to customer support ticket triage. Classify the customer\'s intent based on the support ticket content.\\n\\nTask: Analyze the support ticket and classify the customer\'s intent. Identify the required fields for resolution and provide a confidence score.\\n\\nOutput format: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"intent\\": \\"string (e.g., \'order_status\', \'refund_request\', \'technical_issue\')\\",\\n  \\"required_fields\\": [\\"string\\"],\\n  \\"confidence\\": \\"float (0.0-1.0)\\"\\n}\\n```\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["information_extraction"], "description": "Classifies the customer\'s intent based on the support request and determines the required resolution path.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step intent_classification failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_support_ticket_triage_and_reply_draft_information_extraction(variables: Dict[str, Any]) -> Any:
    """Activity for step: information_extraction (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "information_extraction", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019f363aa56870f3940b5fb4654dd185", "query_template": "The following data was produced by the previous steps:\\n- Support ticket: {{{{support_ticket}}}}\\n- Intent classification: {{{{step_intent_classification_output}}}}\\n\\nThis request relates to customer support ticket triage. Extract structured information from the support ticket based on the required fields identified by the intent classifier.\\n\\nTask: Extract the required fields from the support ticket and identify any missing fields.\\n\\nOutput format: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"extracted_fields\\": {\\n    \\"field_name\\": \\"string (value extracted from the request)\\"\\n  },\\n  \\"missing_fields\\": [\\"string\\"]\\n}\\n```\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["request_validation"], "description": "Extracts structured information from the support request based on the required fields identified by the intent classifier.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step information_extraction failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_support_ticket_triage_and_reply_draft_request_validation(variables: Dict[str, Any]) -> Any:
    """Activity for step: request_validation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "request_validation", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_019f363aa69172d5bff9bab2273abcb6", "query_template": "The following data was produced by the previous steps:\\n- Support ticket: {{{{support_ticket}}}}\\n- Extracted information: {{{{step_information_extraction_output}}}}\\n\\nThis request relates to customer support ticket triage. Validate the support request against business policies to determine if it is actionable.\\n\\nTask: Assess the support request for policy compliance and actionability. Provide reasons for validation and any policy violations.\\n\\nOutput format: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"is_actionable\\": boolean,\\n  \\"validation_reasons\\": [\\"string\\"],\\n  \\"policy_violations\\": [\\"string\\"]\\n}\\n```\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["account_context_gathering", "support_reply_drafting"], "description": "Validates the support request against business policies to determine if it is actionable.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step request_validation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_support_ticket_triage_and_reply_draft_account_context_gathering(variables: Dict[str, Any]) -> Any:
    """Activity for step: account_context_gathering (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "account_context_gathering", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_01a03dc4bfe6752b98bf766438bdad15", "query_template": "The following data was produced by the previous steps:\\n- Support ticket: {{{{support_ticket}}}}\\n- Extracted information: {{{{step_information_extraction_output}}}}\\n\\nThis request relates to customer support ticket triage. Gather account context for the customer associated with the support request.\\n\\nTask: Use the customer identifier from the extracted information to fetch account context from the CRM or order management system. Compile the data into a structured format.\\n\\nOutput format: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"customer_id\\": \\"string\\",\\n  \\"account_status\\": \\"string\\",\\n  \\"order_history\\": [\\n    {\\n      \\"order_id\\": \\"string\\",\\n      \\"date\\": \\"string\\",\\n      \\"status\\": \\"string\\",\\n      \\"items\\": [\\n        {\\n          \\"product_id\\": \\"string\\",\\n          \\"name\\": \\"string\\",\\n          \\"quantity\\": integer\\n        }\\n      ]\\n    }\\n  ],\\n  \\"recent_interactions\\": [\\n    {\\n      \\"date\\": \\"string\\",\\n      \\"type\\": \\"string\\",\\n      \\"summary\\": \\"string\\"\\n    }\\n  ]\\n}\\n```\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": ["merge_results"], "description": "Gathers account context from external systems (e.g., CRM) to enrich the support request with customer history and status.", "parallel_group": "pg_core_processing"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step account_context_gathering failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_support_ticket_triage_and_reply_draft_support_reply_drafting(variables: Dict[str, Any]) -> Any:
    """Activity for step: support_reply_drafting (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "support_reply_drafting", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_01a03dc4bfd2735d8a8d43540e450587", "query_template": "The following data was produced by the previous steps:\\n- Support ticket: {{{{support_ticket}}}}\\n- Intent classification: {{{{step_intent_classification_output}}}}\\n- Extracted information: {{{{step_information_extraction_output}}}}\\n- Request validation: {{{{step_request_validation_output}}}}\\n- Account context: {{{{step_account_context_gathering_output}}}}\\n\\nThis request relates to customer support ticket triage. Draft a reply to the support ticket based on the provided context.\\n\\nTask: Draft a professional, empathetic, and actionable response to the customer\'s support ticket. Include a subject line, body, next steps, and internal notes for the reviewer.\\n\\nOutput format: Respond with a markdown report using the following structure:\\n```markdown\\n## Subject: <Concise subject line>\\n\\n## Body:\\n<Polite and professional response addressing the customer\'s issue.>\\n\\n## Next Steps:\\n<Clear action items or follow-up required.>\\n\\n## Notes:\\n<Internal notes for the reviewer, including unresolved questions or policy considerations.>\\n```\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["merge_results"], "description": "Drafts a reply to the support ticket based on the intent, extracted information, validation results, and account context.", "parallel_group": "pg_core_processing"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step support_reply_drafting failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=30),
    retry_policy_max_attempts=3,
)
async def run_support_ticket_triage_and_reply_draft_merge_results(variables: Dict[str, Any]) -> Any:
    """Activity for step: merge_results (StepType.TRANSFORM)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "merge_results", "type": "transform", "tier": null, "config": {"mappings": {"account_context": "{{step_account_context_gathering_output}}", "drafted_reply": "{{step_support_reply_drafting_output}}"}}, "next_steps": ["final_response_generation"], "description": "Merges the outputs of the account context gathering and support reply drafting steps for downstream processing.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step merge_results failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_support_ticket_triage_and_reply_draft_final_response_generation(variables: Dict[str, Any]) -> Any:
    """Activity for step: final_response_generation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "final_response_generation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4c86fa768bb34e72dd8402560d", "query_template": "The following data was produced by the previous steps:\\n- Support ticket: {{{{support_ticket}}}}\\n- Jailbreak moderation: {{{{step_jailbreak_moderation_output}}}}\\n- Intent classification: {{{{step_intent_classification_output}}}}\\n- Extracted information: {{{{step_information_extraction_output}}}}\\n- Request validation: {{{{step_request_validation_output}}}}\\n- Account context: {{{{step_merge_results_output.account_context}}}}\\n- Drafted reply: {{{{step_merge_results_output.drafted_reply}}}}\\n\\nThis request relates to customer support ticket triage. Consolidate all outputs into a structured, customer-facing support ticket reply.\\n\\nTask: Synthesize all previous step outputs into a well-structured, human-readable final report. Include customer details, issue summary, drafted reply, reviewer notes, and status.\\n\\nOutput format: Respond with a markdown report using the following structure:\\n```markdown\\n# Support Ticket Reply Draft\\n\\n## Customer Details:\\n<Customer name, ID, and contact information>\\n\\n## Issue Summary:\\n<Brief summary of the customer\'s request>\\n\\n## Drafted Reply:\\n<The drafted response to the customer>\\n\\n## Reviewer Notes:\\n<Internal notes and review feedback>\\n\\n## Status:\\n<Draft | Ready for Review | Needs Revision>\\n```\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["reviewer"], "description": "Consolidates all outputs into a structured, customer-facing support ticket reply ready for human review.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step final_response_generation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_support_ticket_triage_and_reply_draft_reviewer(variables: Dict[str, Any]) -> Any:
    """Activity for step: reviewer (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "reviewer", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4d501877e38b00ef86df312bbe", "query_template": "The following data was produced by the previous step: {{{{step_final_response_generation_output}}}}\\n\\nThis request relates to customer support ticket triage. Review the drafted support reply for completeness, tone, factual consistency, and adherence to communication standards.\\n\\nTask: Assess the drafted reply and provide a detailed review, including strengths, areas for improvement, suggested edits, and a final assessment.\\n\\nOutput format: Respond with a markdown report using the following structure:\\n```markdown\\n## Review Summary:\\n<Overall assessment of the draft>\\n\\n## Strengths:\\n<Bullet points highlighting what was done well>\\n\\n## Areas for Improvement:\\n<Bullet points identifying issues or gaps>\\n\\n## Suggested Edits:\\n<Specific recommendations for revisions>\\n\\n## Final Assessment:\\n<Approved | Needs Revision>\\n```\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "markdown_report"}, "next_steps": ["output_moderation"], "description": "Reviews the drafted support reply for completeness, tone, factual consistency, and adherence to communication standards.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step reviewer failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_support_ticket_triage_and_reply_draft_output_moderation(variables: Dict[str, Any]) -> Any:
    """Activity for step: output_moderation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "output_moderation", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_019efd4da8af74d1abc1489ea4645ec3", "query_template": "The following data was produced by the previous step: {{{{step_reviewer_output}}}}\\n\\nThis request relates to customer support ticket triage. Moderate the final support reply for safety, compliance, and appropriateness.\\n\\nTask: Assess the final output for safety, compliance, and tone issues. Provide suggested edits if necessary.\\n\\nOutput format: Respond with a raw JSON object matching the following schema:\\n```json\\n{\\n  \\"is_safe\\": boolean,\\n  \\"compliance_issues\\": [\\"string\\"],\\n  \\"tone_issues\\": [\\"string\\"],\\n  \\"suggested_edits\\": [\\"string\\"]\\n}\\n```\\n\\nProvide a complete, thorough response. Do not return an empty response. If any information is uncertain, state your assumption and continue.", "expected_output_contract": "json_object"}, "next_steps": [], "description": "Moderates the final support reply for safety, compliance, and appropriateness before delivery.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step output_moderation failed")
    return result.output

@workflows.workflow.define(
    name="support_ticket_triage_and_reply_draft",
    workflow_display_name="Support Ticket Triage And Reply Draft",
    workflow_description="Automates the triage of inbound support tickets, gathers relevant account context, and drafts a reply for human review.",
    execution_timeout=timedelta(hours=24),
)
class SupportTicketTriageAndReplyDraft:
    """Durable workflow: Automates the triage of inbound support tickets, gathers relevant account context, and drafts a reply for human review."""

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
        """Execute the Support Ticket Triage And Reply Draft workflow DAG."""
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
                output = await run_support_ticket_triage_and_reply_draft_jailbreak_moderation(variables)
                outputs["jailbreak_moderation"] = output
                self._last_result = output
                variables["step_jailbreak_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "intent_classification"

            elif current_step == "intent_classification":
                self._progress.append("intent_classification")
                output = await run_support_ticket_triage_and_reply_draft_intent_classification(variables)
                outputs["intent_classification"] = output
                self._last_result = output
                variables["step_intent_classification_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "information_extraction"

            elif current_step == "information_extraction":
                self._progress.append("information_extraction")
                output = await run_support_ticket_triage_and_reply_draft_information_extraction(variables)
                outputs["information_extraction"] = output
                self._last_result = output
                variables["step_information_extraction_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "request_validation"

            elif current_step == "request_validation":
                self._progress.append("request_validation")
                output = await run_support_ticket_triage_and_reply_draft_request_validation(variables)
                outputs["request_validation"] = output
                self._last_result = output
                variables["step_request_validation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "account_context_gathering"

            elif current_step == "account_context_gathering" or current_step == "support_reply_drafting":
                # ── Parallel group: pg_core_processing ──
                self._progress.append("__parallel_pg_core_processing:start")
                # Fan-out: execute 2 steps concurrently
                _parallel_results = await asyncio.gather(
                    run_support_ticket_triage_and_reply_draft_account_context_gathering(dict(variables)),
                    run_support_ticket_triage_and_reply_draft_support_reply_drafting(dict(variables)),
                )
                # Fan-in: merge all parallel outputs
                _parallel_names = ["account_context_gathering", "support_reply_drafting"]
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
                output = await run_support_ticket_triage_and_reply_draft_merge_results(variables)
                outputs["merge_results"] = output
                self._last_result = output
                variables["step_merge_results_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "final_response_generation"

            elif current_step == "final_response_generation":
                self._progress.append("final_response_generation")
                output = await run_support_ticket_triage_and_reply_draft_final_response_generation(variables)
                outputs["final_response_generation"] = output
                self._last_result = output
                variables["step_final_response_generation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "reviewer"

            elif current_step == "reviewer":
                self._progress.append("reviewer")
                output = await run_support_ticket_triage_and_reply_draft_reviewer(variables)
                outputs["reviewer"] = output
                self._last_result = output
                variables["step_reviewer_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = "output_moderation"

            elif current_step == "output_moderation":
                self._progress.append("output_moderation")
                output = await run_support_ticket_triage_and_reply_draft_output_moderation(variables)
                outputs["output_moderation"] = output
                self._last_result = output
                variables["step_output_moderation_output"] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = None

            else:
                current_step = None

        return outputs
