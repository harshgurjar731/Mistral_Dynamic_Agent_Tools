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
async def run_insurance_claim_validation_pipeline_input_safety_validation(variables: Dict[str, Any]) -> Any:
    """Activity for step: input_safety_validation (tool)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "input_safety_validation", "type": "tool", "tier": "foundation", "config": {"tool_name": "input_safety_validation_2", "tool_version": 1, "arguments": {"claim_id": "{{claim_id}}", "claimant_id": "{{claimant_id}}", "policy_id": "{{policy_id}}"}, "code_requirement": {"name": "input_safety_validation_2", "description": "Validates that claim_id, claimant_id, and policy_id are safe strings. Each must be a non-empty string of exactly 1 to 100 characters containing only alphanumeric characters (A-Z, a-z, 0-9), hyphens (-), and underscores (_). If all inputs are valid, validated_claim_inputs contains the original inputs as an object with the three fields. If any input fails validation (wrong length, empty, or contains disallowed characters), validated_claim_inputs is set to null.", "purpose": "activity", "kind": "pure", "input_schema": {"type": "object", "properties": {"claim_id": {"type": "string"}, "claimant_id": {"type": "string"}, "policy_id": {"type": "string"}}, "required": ["claim_id", "claimant_id", "policy_id"], "additionalProperties": false}, "output_schema": {"type": "object", "properties": {"validated_claim_inputs": {"type": ["object", "null"], "properties": {"claim_id": {"type": "string"}, "claimant_id": {"type": "string"}, "policy_id": {"type": "string"}}, "required": ["claim_id", "claimant_id", "policy_id"], "additionalProperties": false}}, "required": ["validated_claim_inputs"], "additionalProperties": false}, "examples": [{"input": {"claim_id": "CLM-2026-001", "claimant_id": "CLT-NAME-XXXX", "policy_id": "POL-12345"}, "output": {"validated_claim_inputs": {"claim_id": "CLM-2026-001", "claimant_id": "CLT-NAME-XXXX", "policy_id": "POL-12345"}}, "note": "All inputs are non-empty strings of 1-100 chars with only allowed characters (alphanumeric, hyphen, underscore)."}, {"input": {"claim_id": "CLM-2026-001; DROP TABLE claims", "claimant_id": "CLT-NAME-XXXX", "policy_id": "POL-12345"}, "output": {"validated_claim_inputs": null}, "note": "claim_id contains a semicolon and space, which are disallowed characters. Validation fails."}, {"input": {"claim_id": "", "claimant_id": "CLT-NAME-XXXX", "policy_id": "POL-12345"}, "output": {"validated_claim_inputs": null}, "note": "claim_id is an empty string. Validation fails."}, {"input": {"claim_id": "A", "claimant_id": "B", "policy_id": "C"}, "output": {"validated_claim_inputs": {"claim_id": "A", "claimant_id": "B", "policy_id": "C"}}, "note": "All inputs are minimal valid strings (length 1) with allowed characters."}, {"input": {"claim_id": "A-B_C0123456789", "claimant_id": "X_Y-Z_1234567890", "policy_id": "a-b_c-d-e_f"}, "output": {"validated_claim_inputs": {"claim_id": "A-B_C0123456789", "claimant_id": "X_Y-Z_1234567890", "policy_id": "a-b_c-d-e_f"}}, "note": "All inputs use only allowed characters (alphanumeric, hyphen, underscore) and are within 1-100 length."}], "api_details": "No external API. This is a pure computation using the standard library.", "secrets": [], "side_effects": "none", "http_fixtures": [], "origin": "workflow"}}, "next_steps": ["claim_integrity_validation"], "description": "Validates the incoming claim request for malicious or malformed input to ensure system safety.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step input_safety_validation failed')
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_insurance_claim_validation_pipeline_claim_integrity_validation(variables: Dict[str, Any]) -> Any:
    """Activity for step: claim_integrity_validation (agent)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "claim_integrity_validation", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a0eccb5fb0716db0ca4020562b84c0", "query_template": "You are the Claim Integrity Validator. Your task is to verify the structural and logical integrity of the insurance claim with ID {{claim_id}}.\\n\\nGiven the following data:\\n- Claim documents: {{step_input_safety_validation_output.validated_claim_inputs.claim_id | get_claim_documents_data([\'claim_form\',\'policy_document\',\'id_proof\'])}}\\n- Claimant history: {{step_input_safety_validation_output.validated_claim_inputs.claimant_id | get_claimant_history}}\\n- Policy details: {{step_input_safety_validation_output.validated_claim_inputs.policy_id | get_policy_details}}\\n\\nPerform the following checks:\\n1. **Required Fields**: Verify that claimant name, DOB, policy number, incident date, and submission date are all present.\\n2. **Date Logic**: Ensure incident date < treatment date (if present) < submission date.\\n3. **Policy Active**: Confirm the incident date falls between the policy start and end dates. FAIL if the policy is not found.\\n4. **Duplicate Check**: Ensure no prior claim has the same policy number and incident date.\\n\\nFor each check, provide:\\n- A result (PASS, FAIL, or FLAG).\\n- An explanation citing the actual field values used.\\n\\nReturn a JSON object with the following structure:\\n{\\n  \\"agent\\": \\"Claim Integrity Validator\\",\\n  \\"status\\": \\"PASS | FAIL | FLAG\\",\\n  \\"checks\\": [\\n    {\\n      \\"name\\": \\"<check_name>\\",\\n      \\"result\\": \\"PASS | FAIL | FLAG\\",\\n      \\"explanation\\": \\"<explanation_citing_field_values>\\"\\n    }\\n  ],\\n  \\"overall_reason\\": \\"<1-2_sentence_summary>\\"\\n}\\n\\nIf any check fails, the top-level status must be FAIL. If any check is flagged, the status must be FLAG. Otherwise, the status is PASS.", "guardrail_policy": "Redact claimant_id and policy_id from logs and error messages to prevent PII leakage in observability tools."}, "next_steps": ["medical_validation"], "description": "Verify the structural and logical integrity of the claim, including required fields, date logic, policy activation, and duplicate checks.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step claim_integrity_validation failed')
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_insurance_claim_validation_pipeline_medical_validation(variables: Dict[str, Any]) -> Any:
    """Activity for step: medical_validation (agent)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "medical_validation", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a0eccb602177d2a45943c2cc796af5", "query_template": "You are the Claim Medical Validator. Your task is to validate the medical aspects of the insurance claim with ID {{claim_id}}.\\n\\nGiven the following medical documents:\\n- Medical report: {{step_input_safety_validation_output.validated_claim_inputs.claim_id | get_claim_documents_data([\'medical_report\',\'lab_reports\'])}}\\n\\nPerform the following checks:\\n1. **Diagnosis Present**: Verify that a diagnosis is stated in the medical report.\\n2. **ICD Code Format**: Ensure the ICD code follows the ICD-10 format (e.g., M51.16, S72.001A).\\n3. **Provider Mentioned**: Confirm that a doctor, hospital, or clinic is named.\\n4. **Medical Documentation**: Ensure the report, SOAP notes, or lab content is present and not empty.\\n\\nFor each check, provide:\\n- A result (PASS, FAIL, or FLAG).\\n- An explanation citing the actual field values used.\\n\\nReturn a JSON object with the following structure:\\n{\\n  \\"agent\\": \\"Claim Medical Validator\\",\\n  \\"status\\": \\"PASS | FAIL | FLAG\\",\\n  \\"checks\\": [\\n    {\\n      \\"name\\": \\"<check_name>\\",\\n      \\"result\\": \\"PASS | FAIL | FLAG\\",\\n      \\"explanation\\": \\"<explanation_citing_field_values>\\"\\n    }\\n  ],\\n  \\"overall_reason\\": \\"<1-2_sentence_summary>\\"\\n}\\n\\nIf any check fails, the top-level status must be FAIL. If any check is flagged, the status must be FLAG. Otherwise, the status is PASS."}, "next_steps": ["treatment_validation"], "description": "Validate the medical aspects of the claim, including diagnosis presence, ICD code format, provider details, and medical documentation.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step medical_validation failed')
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_insurance_claim_validation_pipeline_treatment_validation(variables: Dict[str, Any]) -> Any:
    """Activity for step: treatment_validation (agent)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "treatment_validation", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a0eccb5faf73c5b02c99340b25a1ef", "query_template": "You are the Claim Treatment Validator. Your task is to validate the treatment details of the insurance claim with ID {{claim_id}}.\\n\\nGiven the following documents:\\n- Treatment records: {{step_input_safety_validation_output.validated_claim_inputs.claim_id | get_claim_documents_data([\'prescription_records\',\'bills_invoices\',\'medical_report\'])}}\\n\\nPerform the following checks:\\n1. **Treatment Documented**: Verify that a procedure or medication is named.\\n2. **Treatment Matches Diagnosis**: Cross-check the treatment against the diagnosis in the medical report.\\n3. **Billing Present**: Ensure an invoice exists and is not empty.\\n4. **Amount Documented**: Confirm that a billed amount or total is stated.\\n\\nFor each check, provide:\\n- A result (PASS, FAIL, or FLAG).\\n- An explanation citing the actual field values used.\\n\\nReturn a JSON object with the following structure:\\n{\\n  \\"agent\\": \\"Claim Treatment Validator\\",\\n  \\"status\\": \\"PASS | FAIL | FLAG\\",\\n  \\"checks\\": [\\n    {\\n      \\"name\\": \\"<check_name>\\",\\n      \\"result\\": \\"PASS | FAIL | FLAG\\",\\n      \\"explanation\\": \\"<explanation_citing_field_values>\\"\\n    }\\n  ],\\n  \\"overall_reason\\": \\"<1-2_sentence_summary>\\"\\n}\\n\\nIf any check fails, the top-level status must be FAIL. If any check is flagged, the status must be FLAG. Otherwise, the status is PASS."}, "next_steps": ["disability_validation"], "description": "Validate the treatment details of the claim, including treatment documentation, alignment with diagnosis, billing presence, and amount documentation.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step treatment_validation failed')
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_insurance_claim_validation_pipeline_disability_validation(variables: Dict[str, Any]) -> Any:
    """Activity for step: disability_validation (agent)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "disability_validation", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a0eccb5fbf7223af91d3999076cb2c", "query_template": "You are the Claim Disability Validator. Your task is to validate the disability aspects of the insurance claim with ID {{claim_id}}.\\n\\nGiven the following documents:\\n- Disability certificate: {{step_input_safety_validation_output.validated_claim_inputs.claim_id | get_claim_documents_data([\'disability_certificate\',\'medical_report\'])}}\\n\\nPerform the following checks:\\n1. **Certificate Present**: Verify that the disability certificate is present and includes issuing_doctor, issuing_medical_board, or a licensed authority. FAIL only if the certificate is missing.\\n2. **Severity Mentioned**: Ensure severity, disability_nature, percentage_of_disability, or a severity keyword in disability_type is mentioned.\\n3. **Limitations Consistent with Diagnosis**: Confirm that the disability limitations are consistent with the diagnosis. FAIL only on a clear, direct medical contradiction.\\n\\nFor each check, provide:\\n- A result (PASS, FAIL, or FLAG).\\n- An explanation citing the actual field values used.\\n\\nReturn a JSON object with the following structure:\\n{\\n  \\"agent\\": \\"Claim Disability Validator\\",\\n  \\"status\\": \\"PASS | FAIL | FLAG\\",\\n  \\"checks\\": [\\n    {\\n      \\"name\\": \\"<check_name>\\",\\n      \\"result\\": \\"PASS | FAIL | FLAG\\",\\n      \\"explanation\\": \\"<explanation_citing_field_values>\\"\\n    }\\n  ],\\n  \\"overall_reason\\": \\"<1-2_sentence_summary>\\"\\n}\\n\\nIf any check fails, the top-level status must be FAIL. If any check is flagged, the status must be FLAG. Otherwise, the status is PASS."}, "next_steps": ["litigation_risk_validation"], "description": "Validate the disability aspects of the claim, including certificate presence, severity mention, and consistency with diagnosis.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step disability_validation failed')
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_insurance_claim_validation_pipeline_litigation_risk_validation(variables: Dict[str, Any]) -> Any:
    """Activity for step: litigation_risk_validation (agent)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "litigation_risk_validation", "type": "agent", "tier": "domain", "config": {"agent_id": "ag_01a0eccb601c717eb8d48d87ca4ba4c5", "query_template": "You are the Claim Litigation Risk Agent. Your task is to assess the litigation risk of the insurance claim with ID {{claim_id}}.\\n\\nGiven the following data:\\n- Legal documents: {{step_input_safety_validation_output.validated_claim_inputs.claim_id | get_claim_documents_data([\'legal_letter\',\'claim_form\'])}}\\n- Claimant history: {{step_input_safety_validation_output.validated_claim_inputs.claimant_id | get_claimant_history}}\\n\\nPerform the following checks:\\n1. **Attorney Involvement**: Check for a legal letter, attorney, law firm, or court reference. FLAG if found.\\n2. **Multiple Recent Claims**: FLAG if claims_last_12_months > 2; FAIL if > 5.\\n3. **Suspicious Language**: FLAG if any of the following terms are found: lawsuit, legal action, court, negligence, damages, compensation demand, fraud, false claim, or fabricated. List the terms found.\\n\\nFor each check, provide:\\n- A result (PASS, FAIL, or FLAG).\\n- An explanation citing the actual field values or terms used.\\n\\nReturn a JSON object with the following structure:\\n{\\n  \\"agent\\": \\"Claim Litigation Risk Agent\\",\\n  \\"status\\": \\"PASS | FAIL | FLAG\\",\\n  \\"checks\\": [\\n    {\\n      \\"name\\": \\"<check_name>\\",\\n      \\"result\\": \\"PASS | FAIL | FLAG\\",\\n      \\"explanation\\": \\"<explanation_citing_field_values_or_terms>\\"\\n    }\\n  ],\\n  \\"overall_reason\\": \\"<1-2_sentence_summary>\\"\\n}\\n\\nIf any check fails, the top-level status must be FAIL. If any check is flagged, the status must be FLAG. Otherwise, the status is PASS.", "guardrail_policy": "Mask any PII in the \'suspicious language\' check explanations (e.g., attorney names, claimant references) before including them in the final report."}, "next_steps": ["rule_based_baseline_recommendation"], "description": "Assess the litigation risk of the claim, including attorney involvement, recent claims history, and suspicious language.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step litigation_risk_validation failed')
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_insurance_claim_validation_pipeline_rule_based_baseline_recommendation(variables: Dict[str, Any]) -> Any:
    """Activity for step: rule_based_baseline_recommendation (tool)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "rule_based_baseline_recommendation", "type": "tool", "tier": "foundation", "config": {"tool_name": "rule_based_baseline_recommendation", "tool_version": 1, "arguments": {"integrity_result": "{{step_claim_integrity_validation_output}}", "medical_result": "{{step_medical_validation_output}}", "treatment_result": "{{step_treatment_validation_output}}", "disability_result": "{{step_disability_validation_output}}", "litigation_result": "{{step_litigation_risk_validation_output}}"}, "code_requirement": {"name": "rule_based_baseline_recommendation", "description": "Deterministically computes a baseline recommendation from the five validator results. - If any validator has status \'FAIL\', output baseline_status=\'REJECT\' and baseline_suggestion lists all validators with status \'FAIL\' in the order: claim_integrity, medical, treatment, disability, litigation. - Else if any validator has status \'FLAG\' or \'ERROR\', output baseline_status=\'REVIEW BEFORE APPROVAL\' and baseline_suggestion lists all validators with status \'FLAG\' or \'ERROR\' in the same order. - Else output baseline_status=\'APPROVE\' and baseline_suggestion=\'All validators passed. Recommend APPROVE.\' The suggestion text is a plain-English sentence that names the affected agents by their workflow key.", "purpose": "activity", "kind": "pure", "input_schema": {"type": "object", "properties": {"integrity_result": {"type": "object", "properties": {"agent": {"type": "string"}, "status": {"type": "string", "enum": ["PASS", "FAIL", "FLAG", "ERROR"]}, "checks": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "result": {"type": "string", "enum": ["PASS", "FAIL", "FLAG"]}, "explanation": {"type": "string"}}, "required": ["name", "result", "explanation"]}}, "overall_reason": {"type": "string"}}, "required": ["agent", "status", "checks", "overall_reason"]}, "medical_result": {"type": "object", "properties": {"agent": {"type": "string"}, "status": {"type": "string", "enum": ["PASS", "FAIL", "FLAG", "ERROR"]}, "checks": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "result": {"type": "string", "enum": ["PASS", "FAIL", "FLAG"]}, "explanation": {"type": "string"}}, "required": ["name", "result", "explanation"]}}, "overall_reason": {"type": "string"}}, "required": ["agent", "status", "checks", "overall_reason"]}, "treatment_result": {"type": "object", "properties": {"agent": {"type": "string"}, "status": {"type": "string", "enum": ["PASS", "FAIL", "FLAG", "ERROR"]}, "checks": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "result": {"type": "string", "enum": ["PASS", "FAIL", "FLAG"]}, "explanation": {"type": "string"}}, "required": ["name", "result", "explanation"]}}, "overall_reason": {"type": "string"}}, "required": ["agent", "status", "checks", "overall_reason"]}, "disability_result": {"type": "object", "properties": {"agent": {"type": "string"}, "status": {"type": "string", "enum": ["PASS", "FAIL", "FLAG", "ERROR"]}, "checks": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "result": {"type": "string", "enum": ["PASS", "FAIL", "FLAG"]}, "explanation": {"type": "string"}}, "required": ["name", "result", "explanation"]}}, "overall_reason": {"type": "string"}}, "required": ["agent", "status", "checks", "overall_reason"]}, "litigation_result": {"type": "object", "properties": {"agent": {"type": "string"}, "status": {"type": "string", "enum": ["PASS", "FAIL", "FLAG", "ERROR"]}, "checks": {"type": "array", "items": {"type": "object", "properties": {"name": {"type": "string"}, "result": {"type": "string", "enum": ["PASS", "FAIL", "FLAG"]}, "explanation": {"type": "string"}}, "required": ["name", "result", "explanation"]}}, "overall_reason": {"type": "string"}}, "required": ["agent", "status", "checks", "overall_reason"]}}, "required": ["integrity_result", "medical_result", "treatment_result", "disability_result", "litigation_result"]}, "output_schema": {"type": "object", "properties": {"baseline_status": {"type": "string", "enum": ["APPROVE", "REVIEW BEFORE APPROVAL", "REJECT"]}, "baseline_suggestion": {"type": "string"}}, "required": ["baseline_status", "baseline_suggestion"]}, "examples": [{"input": {"integrity_result": {"agent": "Claim Integrity Validation", "status": "PASS", "checks": [{"name": "Required Fields", "result": "PASS", "explanation": "All required fields present."}], "overall_reason": "All integrity checks passed."}, "medical_result": {"agent": "Medical Validation", "status": "PASS", "checks": [{"name": "Diagnosis Present", "result": "PASS", "explanation": "Diagnosis is present."}], "overall_reason": "Medical documentation is valid."}, "treatment_result": {"agent": "Treatment Validation", "status": "PASS", "checks": [{"name": "Treatment Documented", "result": "PASS", "explanation": "Treatment is documented."}], "overall_reason": "Treatment documentation is valid."}, "disability_result": {"agent": "Disability Validation", "status": "PASS", "checks": [{"name": "Certificate Present", "result": "PASS", "explanation": "Certificate is present."}], "overall_reason": "Disability certificate is valid."}, "litigation_result": {"agent": "Litigation Risk Validation", "status": "PASS", "checks": [{"name": "Attorney Involvement", "result": "PASS", "explanation": "No attorney involvement."}], "overall_reason": "No litigation risk detected."}}, "output": {"baseline_status": "APPROVE", "baseline_suggestion": "All validators passed. Recommend APPROVE."}, "note": "All validators have status PASS \\u2192 baseline_status=APPROVE, suggestion indicates all passed."}, {"input": {"integrity_result": {"agent": "Claim Integrity Validation", "status": "FAIL", "checks": [{"name": "Policy Active", "result": "FAIL", "explanation": "Incident date 2025-01-15 is outside policy period (2024-01-01 to 2024-12-31)."}], "overall_reason": "Policy not active on incident date."}, "medical_result": {"agent": "Medical Validation", "status": "PASS", "checks": [{"name": "Diagnosis Present", "result": "PASS", "explanation": "Diagnosis is present."}], "overall_reason": "Medical documentation is valid."}, "treatment_result": {"agent": "Treatment Validation", "status": "PASS", "checks": [{"name": "Treatment Documented", "result": "PASS", "explanation": "Treatment is documented."}], "overall_reason": "Treatment documentation is valid."}, "disability_result": {"agent": "Disability Validation", "status": "PASS", "checks": [{"name": "Certificate Present", "result": "PASS", "explanation": "Certificate is present."}], "overall_reason": "Disability certificate is valid."}, "litigation_result": {"agent": "Litigation Risk Validation", "status": "PASS", "checks": [{"name": "Attorney Involvement", "result": "PASS", "explanation": "No attorney involvement."}], "overall_reason": "No litigation risk detected."}}, "output": {"baseline_status": "REJECT", "baseline_suggestion": "Reject due to failures in the following validators: claim_integrity"}, "note": "claim_integrity has status FAIL \\u2192 baseline_status=REJECT, suggestion lists claim_integrity as the failing validator."}, {"input": {"integrity_result": {"agent": "Claim Integrity Validation", "status": "PASS", "checks": [{"name": "Required Fields", "result": "PASS", "explanation": "All required fields present."}], "overall_reason": "All integrity checks passed."}, "medical_result": {"agent": "Medical Validation", "status": "FLAG", "checks": [{"name": "ICD Code Format", "result": "FLAG", "explanation": "ICD code \'M51.16\' is valid but unusual for this claim type."}], "overall_reason": "ICD code format flagged for review."}, "treatment_result": {"agent": "Treatment Validation", "status": "PASS", "checks": [{"name": "Treatment Documented", "result": "PASS", "explanation": "Treatment is documented."}], "overall_reason": "Treatment documentation is valid."}, "disability_result": {"agent": "Disability Validation", "status": "ERROR", "checks": [], "overall_reason": "Agent failed: network timeout"}, "litigation_result": {"agent": "Litigation Risk Validation", "status": "PASS", "checks": [{"name": "Attorney Involvement", "result": "PASS", "explanation": "No attorney involvement."}], "overall_reason": "No litigation risk detected."}}, "output": {"baseline_status": "REVIEW BEFORE APPROVAL", "baseline_suggestion": "Review needed due to flags or errors in the following validators: medical, disability"}, "note": "No FAIL statuses; medical=FLAG and disability=ERROR \\u2192 baseline_status=REVIEW BEFORE APPROVAL, suggestion lists medical and disability in workflow order."}], "api_details": "No external API. This is a pure computation using the standard library.", "secrets": [], "side_effects": "none", "http_fixtures": [], "origin": "workflow"}}, "next_steps": ["claim_report_synthesis"], "description": "Generate a deterministic baseline recommendation based on the results of all validator agents.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step rule_based_baseline_recommendation failed')
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_insurance_claim_validation_pipeline_claim_report_synthesis(variables: Dict[str, Any]) -> Any:
    """Activity for step: claim_report_synthesis (agent)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "claim_report_synthesis", "type": "agent", "tier": "foundation", "config": {"agent_id": "ag_01a0eccb622073bfa255fb1615ba2519", "query_template": "You are the Claim Report Synthesizer. Your task is to synthesize the results of all validator agents into a coherent, explainable report for the human adjuster.\\n\\nGiven the following validator results:\\n- Claim Integrity: {{step_claim_integrity_validation_output.status}} \\u2014 {{step_claim_integrity_validation_output.overall_reason}}\\n- Medical: {{step_medical_validation_output.status}} \\u2014 {{step_medical_validation_output.overall_reason}}\\n- Treatment: {{step_treatment_validation_output.status}} \\u2014 {{step_treatment_validation_output.overall_reason}}\\n- Disability: {{step_disability_validation_output.status}} \\u2014 {{step_disability_validation_output.overall_reason}}\\n- Litigation: {{step_litigation_risk_validation_output.status}} \\u2014 {{step_litigation_risk_validation_output.overall_reason}}\\n\\nAnd the full validator results:\\n{{step_claim_integrity_validation_output}}\\n{{step_medical_validation_output}}\\n{{step_treatment_validation_output}}\\n{{step_disability_validation_output}}\\n{{step_litigation_risk_validation_output}}\\n\\nProvide a JSON object with the following structure:\\n{\\n  \\"overall_status\\": \\"APPROVE | REVIEW BEFORE APPROVAL | REJECT\\",\\n  \\"suggestion\\": \\"<3-8_sentences_for_adjuster_naming_each_FAIL/FLAG_issue>\\"\\n}\\n\\nTone: Balanced, suggests but does not decide, and never assumes fraud without evidence. If overall_status is missing, default to REVIEW BEFORE APPROVAL."}, "next_steps": ["output_safety_validation"], "description": "Synthesize the results of all validator agents into a coherent, explainable report for the human adjuster.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step claim_report_synthesis failed')
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_insurance_claim_validation_pipeline_output_safety_validation(variables: Dict[str, Any]) -> Any:
    """Activity for step: output_safety_validation (tool)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "output_safety_validation", "type": "tool", "tier": "foundation", "config": {"tool_name": "output_safety_validation_2", "tool_version": 1, "arguments": {"adjuster_report": {"claim_id": "{{claim_id}}", "claimant_name": "{{step_input_safety_validation_output.validated_claim_inputs.claimant_id}}", "agent_results": {"claim_integrity": "{{step_claim_integrity_validation_output}}", "medical": "{{step_medical_validation_output}}", "treatment": "{{step_treatment_validation_output}}", "disability": "{{step_disability_validation_output}}", "litigation": "{{step_litigation_risk_validation_output}}"}, "overall_status": "{{step_claim_report_synthesis_output.overall_status | default(\'REVIEW BEFORE APPROVAL\', true)}}", "suggestion": "{{step_claim_report_synthesis_output.suggestion | default(step_rule_based_baseline_recommendation_output.baseline_suggestion, true)}}"}}}, "next_steps": ["save_claim_report"], "description": "Validate the final output for safety, compliance, and adherence to communication standards before delivery.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step output_safety_validation failed')
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_insurance_claim_validation_pipeline_save_claim_report(variables: Dict[str, Any]) -> Any:
    """Activity for step: save_claim_report (tool)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "save_claim_report", "type": "tool", "tier": "foundation", "config": {"tool_name": "save_claim_report", "arguments": {"claim_id": "{{claim_id}}", "agent_results": {"claim_integrity": "{{step_claim_integrity_validation_output}}", "medical": "{{step_medical_validation_output}}", "treatment": "{{step_treatment_validation_output}}", "disability": "{{step_disability_validation_output}}", "litigation": "{{step_litigation_risk_validation_output}}"}, "suggestion": "{{step_output_safety_validation_output.validated_adjuster_report.suggestion}}", "overall_status": "{{step_output_safety_validation_output.validated_adjuster_report.overall_status}}"}, "guardrail_policy": "Enforce write-only access to the document store, with no read or delete permissions for the workflow. Log the document ID and timestamp of every write for auditability."}, "next_steps": [], "description": "Persist the final validated report for the claim, replacing any previous report.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step save_claim_report failed')
    return result.output

@workflows.workflow.define(
    name='insurance_claim_validation_pipeline',
    workflow_display_name='Insurance Claim Validation Pipeline',
    workflow_description='Automated validation of insurance claims with structured document inputs, producing a suggested outcome and explainable report for human adjuster review.',
    execution_timeout=timedelta(hours=24),
)
class InsuranceClaimValidationPipeline:
    """Durable workflow: Automated validation of insurance claims with structured document inputs, producing a suggested outcome and explainable report for human adjuster review."""

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
        """Execute the Insurance Claim Validation Pipeline workflow DAG."""
        # Use workflow.now() for determinism-safe timestamps
        started_at = workflow.now()
        variables = dict(input.variables)
        current_step: Optional[str] = 'input_safety_validation'
        visited: set = set()
        outputs: Dict[str, Any] = {}

        while current_step and len(visited) < 50:
            if current_step in visited:
                break  # cycle guard
            visited.add(current_step)

            if current_step is None:
                break
            elif current_step == 'input_safety_validation':
                self._progress.append('input_safety_validation')
                output = await run_insurance_claim_validation_pipeline_input_safety_validation(variables)
                outputs['input_safety_validation'] = output
                self._last_result = output
                variables['step_input_safety_validation_output'] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = 'claim_integrity_validation'

            elif current_step == 'claim_integrity_validation':
                self._progress.append('claim_integrity_validation')
                output = await run_insurance_claim_validation_pipeline_claim_integrity_validation(variables)
                outputs['claim_integrity_validation'] = output
                self._last_result = output
                variables['step_claim_integrity_validation_output'] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = 'medical_validation'

            elif current_step == 'medical_validation':
                self._progress.append('medical_validation')
                output = await run_insurance_claim_validation_pipeline_medical_validation(variables)
                outputs['medical_validation'] = output
                self._last_result = output
                variables['step_medical_validation_output'] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = 'treatment_validation'

            elif current_step == 'treatment_validation':
                self._progress.append('treatment_validation')
                output = await run_insurance_claim_validation_pipeline_treatment_validation(variables)
                outputs['treatment_validation'] = output
                self._last_result = output
                variables['step_treatment_validation_output'] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = 'disability_validation'

            elif current_step == 'disability_validation':
                self._progress.append('disability_validation')
                output = await run_insurance_claim_validation_pipeline_disability_validation(variables)
                outputs['disability_validation'] = output
                self._last_result = output
                variables['step_disability_validation_output'] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = 'litigation_risk_validation'

            elif current_step == 'litigation_risk_validation':
                self._progress.append('litigation_risk_validation')
                output = await run_insurance_claim_validation_pipeline_litigation_risk_validation(variables)
                outputs['litigation_risk_validation'] = output
                self._last_result = output
                variables['step_litigation_risk_validation_output'] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = 'rule_based_baseline_recommendation'

            elif current_step == 'rule_based_baseline_recommendation':
                self._progress.append('rule_based_baseline_recommendation')
                output = await run_insurance_claim_validation_pipeline_rule_based_baseline_recommendation(variables)
                outputs['rule_based_baseline_recommendation'] = output
                self._last_result = output
                variables['step_rule_based_baseline_recommendation_output'] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = 'claim_report_synthesis'

            elif current_step == 'claim_report_synthesis':
                self._progress.append('claim_report_synthesis')
                output = await run_insurance_claim_validation_pipeline_claim_report_synthesis(variables)
                outputs['claim_report_synthesis'] = output
                self._last_result = output
                variables['step_claim_report_synthesis_output'] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = 'output_safety_validation'

            elif current_step == 'output_safety_validation':
                self._progress.append('output_safety_validation')
                output = await run_insurance_claim_validation_pipeline_output_safety_validation(variables)
                outputs['output_safety_validation'] = output
                self._last_result = output
                variables['step_output_safety_validation_output'] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = 'save_claim_report'

            elif current_step == 'save_claim_report':
                self._progress.append('save_claim_report')
                output = await run_insurance_claim_validation_pipeline_save_claim_report(variables)
                outputs['save_claim_report'] = output
                self._last_result = output
                variables['step_save_claim_report_output'] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = None

            else:
                current_step = None

        return outputs
