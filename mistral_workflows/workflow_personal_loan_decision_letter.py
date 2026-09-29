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
async def run_personal_loan_decision_letter_input_safety_validation(variables: Dict[str, Any]) -> Any:
    """Activity for step: input_safety_validation (tool)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "input_safety_validation", "type": "tool", "tier": "foundation", "config": {"tool_name": "input_safety_validation", "tool_version": 1, "arguments": {"applicant_name": "{{applicant_name}}", "email": "{{email}}", "phone": "{{phone}}", "country_code": "{{country_code}}", "monthly_gross_income": "{{monthly_gross_income}}", "existing_monthly_debt_payments": "{{existing_monthly_debt_payments}}", "loan_amount": "{{loan_amount}}", "loan_currency": "{{loan_currency}}", "annual_rate_percent": "{{annual_rate_percent}}", "tenure_months": "{{tenure_months}}", "applicant_notes": "{{applicant_notes}}"}, "code_requirement": {"name": "input_safety_validation", "description": "Validate all string inputs for malicious content, control characters, and excessive length. Checks: all string fields must be <= 1000 characters, must not contain SQL injection patterns (\';\', \'--\', \'/*\', \'*/\', \'UNION\', \'SELECT\', \'INSERT\', \'UPDATE\', \'DELETE\', \'DROP\', \'OR 1=1\', \\"OR \'1\'=\'1\'\\", \'EXEC\'), must not contain XSS patterns (\'<script\', \'</script>\', \'javascript:\', \'onerror=\', \'onload=\', \'onclick=\'), and must not contain control characters (ASCII codes < 32 except tab (9), newline (10), carriage return (13)). Non-string fields are validated by the input schema. Returns is_safe=true only if all string checks pass; otherwise is_safe=false with all error messages collected in safety_errors.", "purpose": "activity", "kind": "pure", "input_schema": {"type": "object", "properties": {"applicant_name": {"type": "string"}, "email": {"type": "string"}, "phone": {"type": "string"}, "country_code": {"type": "string"}, "monthly_gross_income": {"type": "number"}, "existing_monthly_debt_payments": {"type": "array", "items": {"type": "number"}}, "loan_amount": {"type": "number"}, "loan_currency": {"type": "string"}, "annual_rate_percent": {"type": "number"}, "tenure_months": {"type": "integer"}, "applicant_notes": {"type": "string"}}, "required": ["applicant_name", "email", "phone", "country_code", "monthly_gross_income", "existing_monthly_debt_payments", "loan_amount", "loan_currency", "annual_rate_percent", "tenure_months", "applicant_notes"]}, "output_schema": {"type": "object", "properties": {"is_safe": {"type": "boolean"}, "safety_errors": {"type": "array", "items": {"type": "string"}}}, "required": ["is_safe", "safety_errors"]}, "examples": [{"input": {"applicant_name": "Alice Smith", "email": "alice@example.com", "phone": "+447911123456", "country_code": "44", "monthly_gross_income": 4000, "existing_monthly_debt_payments": [500, 200], "loan_amount": 15000, "loan_currency": "GBP", "annual_rate_percent": 4.5, "tenure_months": 36, "applicant_notes": "Need a loan for a new car."}, "output": {"is_safe": true, "safety_errors": []}, "note": "All string fields are safe, within length limits (<=1000), and contain no malicious patterns or control characters."}, {"input": {"applicant_name": "<script>alert(1)</script>", "email": "bob@example.com; DROP TABLE users", "phone": "+447911123456", "country_code": "44", "monthly_gross_income": 4000, "existing_monthly_debt_payments": [500, 200], "loan_amount": 10000, "loan_currency": "EUR", "annual_rate_percent": 5.0, "tenure_months": 12, "applicant_notes": "hello\\u0000world"}, "output": {"is_safe": false, "safety_errors": ["applicant_name contains XSS pattern: <script", "email contains SQL injection pattern: ;", "applicant_notes contains control characters"]}, "note": "applicant_name triggers XSS check on \'<script\'; email triggers SQL check on \';\'; applicant_notes contains ASCII 0 (null byte, a control character). All other fields conform to schema and pass safety checks."}], "api_details": "No external API. This is a pure computation using the standard library.", "secrets": [], "side_effects": "none", "http_fixtures": [], "origin": "workflow"}}, "next_steps": ["application_data_validation"], "description": "Validates all string inputs for malicious content, control characters, and excessive length.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step input_safety_validation failed')
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_personal_loan_decision_letter_application_data_validation(variables: Dict[str, Any]) -> Any:
    """Activity for step: application_data_validation (tool)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "application_data_validation", "type": "tool", "tier": "domain", "config": {"tool_name": "application_data_validation", "tool_version": 1, "arguments": {"applicant_name": "{{applicant_name}}", "email": "{{email}}", "monthly_gross_income": "{{monthly_gross_income}}", "existing_monthly_debt_payments": "{{existing_monthly_debt_payments}}", "loan_amount": "{{loan_amount}}", "loan_currency": "{{loan_currency}}", "annual_rate_percent": "{{annual_rate_percent}}", "tenure_months": "{{tenure_months}}"}, "code_requirement": {"name": "application_data_validation", "description": "Validates the application data fields. Checks: email must contain \'@\'; monthly_gross_income, loan_amount, and each element of existing_monthly_debt_payments must be numbers > 0; annual_rate_percent must be a number >= 0; tenure_months must be an integer between 6 and 84 inclusive. Returns is_valid (true if all checks pass), error_count (total number of validation errors), and error_messages (array of error strings, one per failed check).", "purpose": "activity", "kind": "pure", "input_schema": {"type": "object", "properties": {"applicant_name": {"type": "string"}, "email": {"type": "string"}, "monthly_gross_income": {"type": "number"}, "existing_monthly_debt_payments": {"type": "array", "items": {"type": "number"}}, "loan_amount": {"type": "number"}, "loan_currency": {"type": "string"}, "annual_rate_percent": {"type": "number"}, "tenure_months": {"type": "integer"}}, "required": ["applicant_name", "email", "monthly_gross_income", "existing_monthly_debt_payments", "loan_amount", "loan_currency", "annual_rate_percent", "tenure_months"]}, "output_schema": {"type": "object", "properties": {"is_valid": {"type": "boolean"}, "error_count": {"type": "integer"}, "error_messages": {"type": "array", "items": {"type": "string"}}}, "required": ["is_valid", "error_count", "error_messages"]}, "examples": [{"input": {"applicant_name": "Alice Smith", "email": "alice@test.com", "monthly_gross_income": 4000, "existing_monthly_debt_payments": [150, 250], "loan_amount": 15000, "loan_currency": "GBP", "annual_rate_percent": 0, "tenure_months": 12}, "output": {"is_valid": true, "error_count": 0, "error_messages": []}, "note": "All fields valid: email contains \'@\', all numeric fields > 0 (annual_rate_percent is 0 which is allowed), tenure_months is integer 12 (6-84)."}, {"input": {"applicant_name": "Bob Jones", "email": "bobjones.com", "monthly_gross_income": -500, "existing_monthly_debt_payments": [100, -50], "loan_amount": 0, "loan_currency": "EUR", "annual_rate_percent": -2, "tenure_months": 5}, "output": {"is_valid": false, "error_count": 6, "error_messages": ["email must contain \'@\'", "monthly_gross_income must be > 0", "existing_monthly_debt_payments[1] must be > 0", "loan_amount must be > 0", "annual_rate_percent must be >= 0", "tenure_months must be an integer between 6 and 84"]}, "note": "6 errors: email missing \'@\'; monthly_gross_income (-500) <= 0; existing_monthly_debt_payments[1] (-50) <= 0; loan_amount (0) <= 0; annual_rate_percent (-2) < 0; tenure_months (5) < 6."}], "api_details": "No external API. This is a pure computation using the standard library.", "secrets": [], "side_effects": "none", "http_fixtures": [], "origin": "workflow"}}, "next_steps": ["currency_conversion"], "description": "Validates the structure and constraints of the application data fields.", "parallel_group": "input_safety_validation_fanout"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step application_data_validation failed')
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_personal_loan_decision_letter_phone_number_normalisation(variables: Dict[str, Any]) -> Any:
    """Activity for step: phone_number_normalisation (tool)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "phone_number_normalisation", "type": "tool", "tier": "domain", "config": {"tool_name": "phone_number_normalisation", "tool_version": 1, "arguments": {"phone": "{{phone}}", "country_code": "{{country_code}}"}, "code_requirement": {"name": "phone_number_normalisation", "description": "Normalise a phone number to E.164 format. Extract all digit characters from the phone string. If the resulting digit string starts with \'00\', replace those two characters with \'+\'. If it starts with a single \'0\', replace that \'0\' with \'+\' followed by the country_code. Otherwise, prefix the digit string with \'+\' followed by the country_code. The output is always a string that starts with \'+\' and contains only digits thereafter.", "purpose": "activity", "kind": "pure", "input_schema": {"type": "object", "properties": {"phone": {"type": "string"}, "country_code": {"type": "string"}}, "required": ["phone", "country_code"]}, "output_schema": {"type": "object", "properties": {"normalised_phone_number": {"type": "string"}}, "required": ["normalised_phone_number"]}, "examples": [{"input": {"phone": "07123 456789", "country_code": "44"}, "output": {"normalised_phone_number": "+447123456789"}, "note": "Extract digits \\u2192 \'07123456789\'. Single leading \'0\' \\u2192 replace with \'+44\' \\u2192 \'+447123456789\'"}, {"input": {"phone": "0044 123 456 789", "country_code": "44"}, "output": {"normalised_phone_number": "+44123456789"}, "note": "Extract digits \\u2192 \'0044123456789\'. Leading \'00\' \\u2192 replace with \'+\' \\u2192 \'+44123456789\'"}, {"input": {"phone": "123-456-7890", "country_code": "1"}, "output": {"normalised_phone_number": "+11234567890"}, "note": "Extract digits \\u2192 \'1234567890\'. No leading \'0\' \\u2192 prefix with \'+1\' \\u2192 \'+11234567890\'"}, {"input": {"phone": "", "country_code": "44"}, "output": {"normalised_phone_number": "+44"}, "note": "Extract digits \\u2192 \'\' (empty). No leading \'0\' \\u2192 prefix with \'+44\' \\u2192 \'+44\'"}, {"input": {"phone": "000", "country_code": "44"}, "output": {"normalised_phone_number": "+0"}, "note": "Extract digits \\u2192 \'000\'. Leading \'00\' \\u2192 replace with \'+\' \\u2192 \'+0\' (remaining digit \'0\' kept)"}], "api_details": "No external API. This is a pure computation using the standard library.", "secrets": [], "side_effects": "none", "http_fixtures": [], "origin": "workflow"}}, "next_steps": ["currency_conversion"], "description": "Normalises the applicant\'s phone number to E.164 format.", "parallel_group": "input_safety_validation_fanout"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step phone_number_normalisation failed')
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_personal_loan_decision_letter_personal_data_masking(variables: Dict[str, Any]) -> Any:
    """Activity for step: personal_data_masking (tool)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "personal_data_masking", "type": "tool", "tier": "foundation", "config": {"tool_name": "personal_data_masking", "tool_version": 1, "arguments": {"applicant_notes": "{{applicant_notes}}"}, "code_requirement": {"name": "personal_data_masking", "description": "Replace every email address (any substring containing \'@\' with valid local-part and domain structure) with the literal string \'[EMAIL]\'. Replace every contiguous sequence of 9 or more decimal digits (0-9) with the literal string \'[NUMBER]\'. The masking is applied globally to the entire input string, and replacements are case-sensitive for the masking strings.", "purpose": "activity", "kind": "pure", "input_schema": {"type": "object", "properties": {"applicant_notes": {"type": "string", "description": "Free-text notes provided by the applicant"}}, "required": ["applicant_notes"]}, "output_schema": {"type": "object", "properties": {"masked_notes": {"type": "string", "description": "The applicant_notes with all email addresses replaced by \'[EMAIL]\' and all contiguous sequences of 9+ digits replaced by \'[NUMBER]\'"}}, "required": ["masked_notes"]}, "examples": [{"input": {"applicant_notes": "Email me at alice@example.com or call 1234567890"}, "output": {"masked_notes": "Email me at [EMAIL] or call [NUMBER]"}, "note": "Email \'alice@example.com\' (10 chars before @, 11 chars after) is replaced with [EMAIL]. The 10-digit sequence \'1234567890\' is replaced with [NUMBER]."}, {"input": {"applicant_notes": "SSN: 12345678, phone: 07700900123, email: test@test.co.uk"}, "output": {"masked_notes": "SSN: 12345678, phone: [NUMBER], email: [EMAIL]"}, "note": "8-digit SSN \'12345678\' is not masked (less than 9 digits). 11-digit phone \'07700900123\' is masked as [NUMBER]. Email \'test@test.co.uk\' is masked as [EMAIL]."}, {"input": {"applicant_notes": "No personal data in this text"}, "output": {"masked_notes": "No personal data in this text"}, "note": "No email addresses or 9+ digit sequences are present, so the string is returned unchanged."}, {"input": {"applicant_notes": "Contact: user+tag@sub.domain.co.uk, ID: 123456789012345"}, "output": {"masked_notes": "Contact: [EMAIL], ID: [NUMBER]"}, "note": "Complex email \'user+tag@sub.domain.co.uk\' (with \'+\' and subdomains) is masked. 15-digit ID \'123456789012345\' is masked."}], "api_details": "No external API. This is a pure computation using the standard library.", "secrets": [], "side_effects": "none", "http_fixtures": [], "origin": "workflow"}}, "next_steps": ["currency_conversion"], "description": "Masks sensitive personal data in the applicant\'s notes to protect privacy.", "parallel_group": "input_safety_validation_fanout"}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step personal_data_masking failed')
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_personal_loan_decision_letter_currency_conversion(variables: Dict[str, Any]) -> Any:
    """Activity for step: currency_conversion (tool)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "currency_conversion", "type": "tool", "tier": "domain", "config": {"tool_name": "currency_conversion", "tool_version": 1, "arguments": {"from_currency": "{{loan_currency}}", "to_currency": "GBP", "amount": "{{loan_amount}}"}, "code_requirement": {"name": "currency_conversion", "description": "Convert an amount from one currency to another using the latest ECB reference rate from the Frankfurter API. When from_currency equals to_currency, return the amount unchanged with rate 1 and today\'s date without calling the API. The converted amount is rounded to 2 decimal places using Python\'s round() (banker\'s rounding).", "purpose": "activity", "kind": "http", "input_schema": {"type": "object", "properties": {"from_currency": {"type": "string"}, "to_currency": {"type": "string"}, "amount": {"type": "number"}}, "required": ["from_currency", "to_currency", "amount"]}, "output_schema": {"type": "object", "properties": {"amount": {"type": "number"}, "rate": {"type": "number"}, "date": {"type": "string"}}, "required": ["amount", "rate", "date"]}, "examples": [{"input": {"from_currency": "EUR", "to_currency": "EUR", "amount": 500.0}, "output": {"amount": 500.0, "rate": 1.0, "date": "2026-01-15"}, "note": "from_currency equals to_currency, so amount is unchanged, rate is 1, and date is today (2026-01-15). No API call is made."}, {"input": {"from_currency": "EUR", "to_currency": "GBP", "amount": 100.0}, "output": {"amount": 86.24, "rate": 0.86235, "date": "2026-01-15"}, "note": "API returns rate 0.86235 for GBP. 100 * 0.86235 = 86.235, rounded to 2 decimals is 86.24."}], "api_details": "GET https://api.frankfurter.app/latest?from={from_currency}&to={to_currency}. No authentication required. Response is JSON with fields: amount (number), base (string), date (string in YYYY-MM-DD), rates (object mapping currency codes to their exchange rates).", "secrets": [], "side_effects": "read-only", "http_fixtures": [{"status": 200, "json": {"amount": 1.0, "base": "EUR", "date": "2026-01-15", "rates": {"GBP": 0.86235}}, "for_input": {"from_currency": "EUR", "to_currency": "GBP", "amount": 100.0}}], "origin": "workflow"}, "guardrail_policy": "Enforce HTTPS and validate the Frankfurter API response schema (must include \'amount\', \'rate\', and \'date\' fields)."}, "next_steps": ["loan_repayment_calculation"], "description": "Converts the loan amount from the specified currency to GBP using the latest ECB reference rate.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step currency_conversion failed')
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_personal_loan_decision_letter_loan_repayment_calculation(variables: Dict[str, Any]) -> Any:
    """Activity for step: loan_repayment_calculation (tool)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "loan_repayment_calculation", "type": "tool", "tier": "domain", "config": {"tool_name": "loan_repayment_calculation", "tool_version": 1, "arguments": {"amount_gbp": "{{step_currency_conversion_output.amount}}", "annual_rate_percent": "{{annual_rate_percent}}", "tenure_months": "{{tenure_months}}"}, "code_requirement": {"name": "loan_repayment_calculation", "description": "Calculates the monthly instalment (EMI), total payment, and total interest for a loan in GBP. Uses the formula EMI = P*r*(1+r)^n / ((1+r)^n - 1) where P = amount_gbp, r = annual_rate_percent/1200, and n = tenure_months. If annual_rate_percent is 0, EMI = P/n. EMI is rounded to 2 decimal places. total_payment = round(EMI * n, 2). total_interest = round(total_payment - P, 2). Assumes amount_gbp > 0, annual_rate_percent >= 0, and tenure_months > 0.", "purpose": "activity", "kind": "pure", "input_schema": {"type": "object", "properties": {"amount_gbp": {"type": "number", "description": "Loan amount in GBP (must be positive)"}, "annual_rate_percent": {"type": "number", "description": "Annual interest rate in percent (must be non-negative)"}, "tenure_months": {"type": "integer", "description": "Loan tenure in months (must be positive integer)"}}, "required": ["amount_gbp", "annual_rate_percent", "tenure_months"]}, "output_schema": {"type": "object", "properties": {"monthly_instalment": {"type": "number", "description": "Monthly payment amount in GBP, rounded to 2 decimal places"}, "total_payment": {"type": "number", "description": "Total amount paid over the loan term in GBP, rounded to 2 decimal places"}, "total_interest": {"type": "number", "description": "Total interest paid over the loan term in GBP, rounded to 2 decimal places"}}, "required": ["monthly_instalment", "total_payment", "total_interest"]}, "examples": [{"input": {"amount_gbp": 10000, "annual_rate_percent": 5.0, "tenure_months": 12}, "output": {"monthly_instalment": 856.07, "total_payment": 10272.84, "total_interest": 272.84}, "note": "r = 5.0/1200 = 0.004166666666666667. (1+r)^12 \\u2248 1.0511618978. EMI = 10000 * 0.004166666666666667 * 1.0511618978 / (1.0511618978 - 1) \\u2248 856.0705128 \\u2192 rounded to 856.07. total_payment = 856.07 * 12 = 10272.84. total_interest = 10272.84 - 10000 = 272.84."}, {"input": {"amount_gbp": 12000, "annual_rate_percent": 0, "tenure_months": 12}, "output": {"monthly_instalment": 1000.0, "total_payment": 12000.0, "total_interest": 0.0}, "note": "With zero annual rate, EMI = 12000 / 12 = 1000.00. total_payment = 1000 * 12 = 12000.00. total_interest = 12000 - 12000 = 0."}], "api_details": "No external API. This is a pure computation using the standard library.", "secrets": [], "side_effects": "none", "http_fixtures": [], "origin": "workflow"}}, "next_steps": ["debt_to_income_assessment"], "description": "Calculates the monthly instalment, total payment, and total interest for the loan in GBP.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step loan_repayment_calculation failed')
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_personal_loan_decision_letter_debt_to_income_assessment(variables: Dict[str, Any]) -> Any:
    """Activity for step: debt_to_income_assessment (tool)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "debt_to_income_assessment", "type": "tool", "tier": "domain", "config": {"tool_name": "debt_to_income_assessment", "tool_version": 1, "arguments": {"existing_monthly_debt_payments": "{{existing_monthly_debt_payments}}", "monthly_gross_income": "{{monthly_gross_income}}", "monthly_instalment": "{{step_loan_repayment_calculation_output.monthly_instalment}}"}, "code_requirement": {"name": "debt_to_income_assessment", "description": "Calculates the debt-to-income ratio as (sum(existing_monthly_debt_payments) + monthly_instalment) / monthly_gross_income * 100, rounded to 2 decimal places. Categorises the ratio as \'low\' if \\u2264 20, \'moderate\' if \\u2264 36, \'high\' if \\u2264 43, otherwise \'very_high\'. Assumes monthly_gross_income > 0 (validated in a prior step).", "purpose": "activity", "kind": "pure", "input_schema": {"type": "object", "properties": {"existing_monthly_debt_payments": {"type": "array", "items": {"type": "number"}}, "monthly_gross_income": {"type": "number"}, "monthly_instalment": {"type": "number"}}, "required": ["existing_monthly_debt_payments", "monthly_gross_income", "monthly_instalment"]}, "output_schema": {"type": "object", "properties": {"dti_ratio": {"type": "number"}, "dti_category": {"type": "string"}}, "required": ["dti_ratio", "dti_category"]}, "examples": [{"input": {"existing_monthly_debt_payments": [200, 300], "monthly_gross_income": 5000, "monthly_instalment": 500}, "output": {"dti_ratio": 20.0, "dti_category": "low"}, "note": "Sum of debts = 200 + 300 + 500 = 1000; 1000 / 5000 * 100 = 20.0; category is \'low\' (\\u2264 20)."}, {"input": {"existing_monthly_debt_payments": [300], "monthly_gross_income": 2000, "monthly_instalment": 400}, "output": {"dti_ratio": 35.0, "dti_category": "moderate"}, "note": "Sum of debts = 300 + 400 = 700; 700 / 2000 * 100 = 35.0; category is \'moderate\' (\\u2264 36)."}, {"input": {"existing_monthly_debt_payments": [1000, 500], "monthly_gross_income": 3000, "monthly_instalment": 800}, "output": {"dti_ratio": 76.67, "dti_category": "very_high"}, "note": "Sum of debts = 1000 + 500 + 800 = 2300; 2300 / 3000 * 100 \\u2248 76.666666... rounded to 2 decimals = 76.67; category is \'very_high\' (> 43)."}], "api_details": "No external API. This is a pure computation using the standard library.", "secrets": [], "side_effects": "none", "http_fixtures": [], "origin": "workflow"}}, "next_steps": ["risk_scoring"], "description": "Calculates the debt-to-income ratio and categorises it after including the new loan.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step debt_to_income_assessment failed')
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_personal_loan_decision_letter_risk_scoring(variables: Dict[str, Any]) -> Any:
    """Activity for step: risk_scoring (tool)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "risk_scoring", "type": "tool", "tier": "use_case", "config": {"tool_name": "risk_scoring", "tool_version": 1, "arguments": {"dti_ratio": "{{step_debt_to_income_assessment_output.dti_ratio}}", "tenure_months": "{{tenure_months}}", "total_interest": "{{step_loan_repayment_calculation_output.total_interest}}", "amount_gbp": "{{step_currency_conversion_output.amount}}"}, "code_requirement": {"name": "risk_scoring", "description": "Computes a risk score (0\\u2013100) and band from debt-to-income ratio, loan tenure, total interest, and GBP amount. Start at 100. Subtract 1.5 points per DTI percentage point above 20 (minimum 0 subtracted). Subtract 10 if tenure_months > 60. Subtract 5 if total_interest > 0.25 * amount_gbp. Clamp the final score to 0\\u2013100 and round to 2 decimals. Band: A if score >= 80, B if >= 60, C if >= 40, otherwise D.", "purpose": "activity", "kind": "pure", "input_schema": {"type": "object", "properties": {"dti_ratio": {"type": "number", "description": "Debt-to-income ratio as a percentage (e.g., 25 for 25%)"}, "tenure_months": {"type": "integer", "description": "Loan tenure in months (6\\u201384)"}, "total_interest": {"type": "number", "description": "Total interest paid over the loan term in GBP, rounded to 2 decimals"}, "amount_gbp": {"type": "number", "description": "Loan principal in GBP, rounded to 2 decimals"}}, "required": ["dti_ratio", "tenure_months", "total_interest", "amount_gbp"]}, "output_schema": {"type": "object", "properties": {"risk_score": {"type": "number", "description": "Risk score from 0 to 100, rounded to 2 decimal places"}, "risk_band": {"type": "string", "description": "Risk band: one of A, B, C, D"}}, "required": ["risk_score", "risk_band"]}, "examples": [{"input": {"dti_ratio": 25.0, "tenure_months": 48, "total_interest": 1000.0, "amount_gbp": 5000.0}, "output": {"risk_score": 92.5, "risk_band": "A"}, "note": "dti_penalty = (25.0 - 20.0) * 1.5 = 7.5; tenure_penalty = 0 (48 \\u2264 60); interest_penalty = 0 (1000 \\u2264 0.25*5000=1250). Score = 100 - 7.5 = 92.5 \\u2192 band A (\\u226580)."}, {"input": {"dti_ratio": 45.0, "tenure_months": 72, "total_interest": 1500.0, "amount_gbp": 5000.0}, "output": {"risk_score": 47.5, "risk_band": "C"}, "note": "dti_penalty = (45.0 - 20.0) * 1.5 = 37.5; tenure_penalty = 10 (72 > 60); interest_penalty = 5 (1500 > 0.25*5000=1250). Score = 100 - 37.5 - 10 - 5 = 47.5 \\u2192 band C (\\u226540)."}, {"input": {"dti_ratio": 80.0, "tenure_months": 84, "total_interest": 3000.0, "amount_gbp": 5000.0}, "output": {"risk_score": 0.0, "risk_band": "D"}, "note": "dti_penalty = (80.0 - 20.0) * 1.5 = 90.0; tenure_penalty = 10 (84 > 60); interest_penalty = 5 (3000 > 1250). Raw score = 100 - 90 - 10 - 5 = -5 \\u2192 clamped to 0.0 \\u2192 band D."}], "api_details": "No external API. This is a pure computation using the standard library.", "secrets": [], "side_effects": "none", "http_fixtures": [], "origin": "workflow"}}, "next_steps": ["underwriting_decision"], "description": "Computes a risk score and band based on the debt-to-income ratio and loan terms.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step risk_scoring failed')
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_personal_loan_decision_letter_underwriting_decision(variables: Dict[str, Any]) -> Any:
    """Activity for step: underwriting_decision (agent)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "underwriting_decision", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_01a0de6c5e987479a6b27b8522909188", "query_template": "You are an underwriter reviewing a personal loan application. The applicant\'s notes (with personal data masked) are: \'{{step_personal_data_masking_output.masked_notes}}\'. The debt-to-income ratio category is \'{{step_debt_to_income_assessment_output.dti_category}}\', and the risk band is \'{{step_risk_scoring_output.risk_band}}\'.\\n\\nDecision rules:\\n- If the risk band is \'D\' or the DTI category is \'very_high\', decline the application.\\n- If the risk band is \'C\', refer the application unless the notes provide strong mitigating reasons.\\n- Otherwise, approve the application.\\n\\nRespond with a JSON object containing two fields: \'decision\' (one of \'approve\', \'refer\', \'decline\') and \'justification\' (1-3 sentences explaining the decision).", "guardrail_policy": "Restrict the agent to read-only access to domain knowledge and enforce PII redaction on all outputs."}, "next_steps": ["decision_letter_generation"], "description": "Reviews the masked notes, DTI category, and risk band to decide approve, refer, or decline with justification.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step underwriting_decision failed')
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_personal_loan_decision_letter_decision_letter_generation(variables: Dict[str, Any]) -> Any:
    """Activity for step: decision_letter_generation (agent)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "decision_letter_generation", "type": "agent", "tier": "use_case", "config": {"agent_id": "ag_01a0de6c5e9970a5ad9fc0c417fff3b3", "query_template": "Draft a decision letter for the applicant \'{{applicant_name}}\'. The loan terms are:\\n- EMI: \\u00a3{{step_loan_repayment_calculation_output.monthly_instalment}}\\n- Total payment: \\u00a3{{step_loan_repayment_calculation_output.total_payment}}\\n- Total interest: \\u00a3{{step_loan_repayment_calculation_output.total_interest}}\\n- GBP amount: \\u00a3{{step_currency_conversion_output.amount}} (converted from {{loan_currency}} at a rate of {{step_currency_conversion_output.rate}} on {{step_currency_conversion_output.date}})\\n\\nThe underwriting decision is \'{{step_underwriting_decision_output.decision}}\' with the justification: \'{{step_underwriting_decision_output.justification}}\'.\\n\\nThe letter must be polite, clear, and formatted for email delivery. Do not mention the risk score or any internal metrics.", "guardrail_policy": "Ensure the output does not include unmasked PII or internal metrics (e.g., risk score)."}, "next_steps": ["output_safety_validation"], "description": "Drafts a decision letter to the applicant with the loan terms and decision justification.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step decision_letter_generation failed')
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_personal_loan_decision_letter_output_safety_validation(variables: Dict[str, Any]) -> Any:
    """Activity for step: output_safety_validation (tool)"""
    step_def = WorkflowStep.model_validate(json.loads('{"id": "output_safety_validation", "type": "tool", "tier": "foundation", "config": {"tool_name": "output_safety_validation", "tool_version": 1, "arguments": {"decision_letter": "{{step_decision_letter_generation_output.decision_letter}}"}, "code_requirement": {"name": "output_safety_validation", "description": "Validates the decision letter for safety, readability, and compliance. Checks: (1) no unmasked email addresses (regex pattern match), (2) no unmasked sequences of 9+ consecutive digits, (3) no mention of \'risk score\' (case-insensitive), (4) presence of all required fields: \'EMI:\', \'total payment:\', \'total interest:\', \'GBP amount:\', \'rate:\', \'decision:\', \'justification:\', (5) no leading/trailing whitespace, (6) no more than one consecutive space. Returns is_safe=true only if no errors are found.", "purpose": "activity", "kind": "pure", "input_schema": {"type": "object", "properties": {"decision_letter": {"type": "string", "description": "The full text of the decision letter to validate."}}, "required": ["decision_letter"]}, "output_schema": {"type": "object", "properties": {"is_safe": {"type": "boolean", "description": "True if the letter passes all safety, readability, and compliance checks; false otherwise."}, "safety_errors": {"type": "array", "items": {"type": "string"}, "description": "List of error messages for each failed check. Order does not matter."}}, "required": ["is_safe", "safety_errors"]}, "examples": [{"input": {"decision_letter": "Dear John, Your EMI: \\u00a3250.00, total payment: \\u00a33000.00, total interest: \\u00a3500.00, GBP amount: \\u00a33000.00, rate: 0.95, decision: approve, justification: Good credit history. [EMAIL] [NUMBER]"}, "output": {"is_safe": true, "safety_errors": []}, "note": "All required fields present, no unmasked PII (emails and long numbers are masked), no risk score mention, and no whitespace issues."}, {"input": {"decision_letter": "Dear john@email.com, EMI: \\u00a3250.00, risk score: 85, decision: approve"}, "output": {"is_safe": false, "safety_errors": ["Unmasked email address found", "Risk score mentioned", "Missing total payment", "Missing total interest", "Missing GBP amount", "Missing rate", "Missing justification"]}, "note": "Fails for unmasked email (john@email.com), risk score mention, and missing five required fields (total payment, total interest, GBP amount, rate, justification)."}, {"input": {"decision_letter": "  Dear John, EMI: \\u00a3250.00, total payment: \\u00a33000.00,  total interest: \\u00a3500.00, GBP amount: \\u00a33000.00, rate: 0.95, decision: approve, justification: Good credit."}, "output": {"is_safe": false, "safety_errors": ["Leading or trailing whitespace", "Excessive whitespace"]}, "note": "Fails for leading space and two consecutive spaces between \'3000.00,\' and \'total\'. All required fields are present and no PII/risk score issues."}, {"input": {"decision_letter": "Dear John, EMI: \\u00a3250.00, total payment: \\u00a33000.00, total interest: \\u00a3500.00, GBP amount: \\u00a33000.00, rate: 0.95, decision: approve, justification: Contact 123456789 for details."}, "output": {"is_safe": false, "safety_errors": ["Unmasked long number found"]}, "note": "Fails for unmasked 9-digit number \'123456789\' in the justification. All other checks pass."}], "api_details": "No external API. This is a pure computation using the standard library.", "secrets": [], "side_effects": "none", "http_fixtures": [], "origin": "workflow"}}, "next_steps": [], "description": "Validates the decision letter for safety, readability, and compliance before delivery.", "parallel_group": null}'))
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or 'Step output_safety_validation failed')
    return result.output

@workflows.workflow.define(
    name='personal_loan_decision_letter',
    workflow_display_name='Personal Loan Decision Letter',
    workflow_description='Assess a personal loan application and generate a decision letter for the applicant.',
    execution_timeout=timedelta(hours=24),
)
class PersonalLoanDecisionLetter:
    """Durable workflow: Assess a personal loan application and generate a decision letter for the applicant."""

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
        """Execute the Personal Loan Decision Letter workflow DAG."""
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
                output = await run_personal_loan_decision_letter_input_safety_validation(variables)
                outputs['input_safety_validation'] = output
                self._last_result = output
                variables['step_input_safety_validation_output'] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = 'application_data_validation'

            elif current_step == 'application_data_validation' or current_step == 'phone_number_normalisation' or current_step == 'personal_data_masking':
                # ── Parallel group: input_safety_validation_fanout ──
                self._progress.append('__parallel_input_safety_validation_fanout:start')
                # Fan-out: execute 3 steps concurrently
                _parallel_results = await asyncio.gather(
                    run_personal_loan_decision_letter_application_data_validation(dict(variables)),
                    run_personal_loan_decision_letter_phone_number_normalisation(dict(variables)),
                    run_personal_loan_decision_letter_personal_data_masking(dict(variables)),
                )
                # Fan-in: merge all parallel outputs
                _parallel_names = ['application_data_validation', 'phone_number_normalisation', 'personal_data_masking']
                for _pname, _presult in zip(_parallel_names, _parallel_results):
                    outputs[_pname] = _presult
                    variables[f"step_{_pname}_output"] = _presult
                    if isinstance(_presult, dict):
                        variables.update(_presult)
                    self._progress.append(_pname)
                self._last_result = _parallel_results[-1]

                current_step = 'currency_conversion'

            elif current_step == 'currency_conversion':
                self._progress.append('currency_conversion')
                output = await run_personal_loan_decision_letter_currency_conversion(variables)
                outputs['currency_conversion'] = output
                self._last_result = output
                variables['step_currency_conversion_output'] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = 'loan_repayment_calculation'

            elif current_step == 'loan_repayment_calculation':
                self._progress.append('loan_repayment_calculation')
                output = await run_personal_loan_decision_letter_loan_repayment_calculation(variables)
                outputs['loan_repayment_calculation'] = output
                self._last_result = output
                variables['step_loan_repayment_calculation_output'] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = 'debt_to_income_assessment'

            elif current_step == 'debt_to_income_assessment':
                self._progress.append('debt_to_income_assessment')
                output = await run_personal_loan_decision_letter_debt_to_income_assessment(variables)
                outputs['debt_to_income_assessment'] = output
                self._last_result = output
                variables['step_debt_to_income_assessment_output'] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = 'risk_scoring'

            elif current_step == 'risk_scoring':
                self._progress.append('risk_scoring')
                output = await run_personal_loan_decision_letter_risk_scoring(variables)
                outputs['risk_scoring'] = output
                self._last_result = output
                variables['step_risk_scoring_output'] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = 'underwriting_decision'

            elif current_step == 'underwriting_decision':
                self._progress.append('underwriting_decision')
                output = await run_personal_loan_decision_letter_underwriting_decision(variables)
                outputs['underwriting_decision'] = output
                self._last_result = output
                variables['step_underwriting_decision_output'] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = 'decision_letter_generation'

            elif current_step == 'decision_letter_generation':
                self._progress.append('decision_letter_generation')
                output = await run_personal_loan_decision_letter_decision_letter_generation(variables)
                outputs['decision_letter_generation'] = output
                self._last_result = output
                variables['step_decision_letter_generation_output'] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = 'output_safety_validation'

            elif current_step == 'output_safety_validation':
                self._progress.append('output_safety_validation')
                output = await run_personal_loan_decision_letter_output_safety_validation(variables)
                outputs['output_safety_validation'] = output
                self._last_result = output
                variables['step_output_safety_validation_output'] = output
                if isinstance(output, dict):
                    variables.update(output)

                current_step = None

            else:
                current_step = None

        return outputs
