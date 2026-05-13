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
async def run_five_day_meal_planner_collect_user_preferences(variables: Dict[str, Any]) -> Any:
    """Activity for step: collect_user_preferences (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "collect_user_preferences", "type": "agent", "config": {"agent_id": "ag_019e1b85f4de710ea5586d5335825b76", "query_template": "You are a nutrition and meal planning assistant. Your task is to gather the following details from the user: their weekly food budget (in their local currency), their dietary preferences or restrictions (e.g., vegetarian, keto, gluten-free, allergies), and the number of people they are feeding. Ask clear, concise questions to obtain this information. Validate the inputs to ensure they are realistic and complete. For example, ensure the budget is a positive number and the household size is at least 1. Once all details are collected, use the 'collect_user_preferences' tool to store the data. Output the collected data in a structured JSON format, ensuring all fields (budget, diet_preferences, household_size) are included. Provide a comprehensive, detailed response."}, "next_steps": ["generate_meal_plan"], "description": "Collects and validates user inputs for weekly food budget, diet preferences, and household size."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step collect_user_preferences failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_five_day_meal_planner_generate_meal_plan(variables: Dict[str, Any]) -> Any:
    """Activity for step: generate_meal_plan (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "generate_meal_plan", "type": "agent", "config": {"agent_id": "ag_019e1b85f61e7495b51bf4f303c2e483", "query_template": "You are a meal planning expert. Using the user's preferences collected in the previous step ({{step_collect_user_preferences_output}}), generate a five-day meal plan that includes breakfast, lunch, dinner, and snacks for each day. Ensure the meals are balanced, varied, and enjoyable while adhering to the user's budget, diet preferences, and household size. The meal plan should include meal names and a list of ingredients for each meal. Use the 'generate_meal_plan' tool to create the plan. Output the meal plan in a structured JSON format, ensuring all meals and ingredients are detailed. Provide a comprehensive, detailed response."}, "next_steps": ["compile_grocery_list"], "description": "Generates a five-day meal plan tailored to the user's budget, diet preferences, and household size."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step generate_meal_plan failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_five_day_meal_planner_compile_grocery_list(variables: Dict[str, Any]) -> Any:
    """Activity for step: compile_grocery_list (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "compile_grocery_list", "type": "agent", "config": {"agent_id": "ag_019e1b85f74a779f879fd5e5b4dfd220", "query_template": "You are a grocery shopping expert. Using the five-day meal plan generated in the previous step ({{step_generate_meal_plan_output}}), compile a single, organized grocery list. Adjust the quantities of each ingredient based on the household size provided by the user. Categorize the items (e.g., produce, dairy, pantry) to make shopping easier. Use the 'create_grocery_list' tool to generate the list. Output the grocery list in a structured JSON format, ensuring all ingredients are listed with their adjusted quantities and categories. Provide a comprehensive, detailed response."}, "next_steps": ["generate_recipes"], "description": "Compiles a consolidated grocery list from the five-day meal plan, adjusting quantities for household size."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step compile_grocery_list failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_five_day_meal_planner_generate_recipes(variables: Dict[str, Any]) -> Any:
    """Activity for step: generate_recipes (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "generate_recipes", "type": "agent", "config": {"agent_id": "ag_019e1b85f980746a8746649309e37be5", "query_template": "You are a culinary expert. Using the five-day meal plan generated earlier ({{step_generate_meal_plan_output}}), create simple, step-by-step recipes for each meal. Include preparation time, cooking time, and serving size for each recipe. Ensure the instructions are clear, beginner-friendly, and detailed. Use the 'generate_recipes' tool to create the recipes. Output the recipes in a structured JSON format, ensuring all steps and details are included. Provide a comprehensive, detailed response."}, "next_steps": ["calculate_nutrition"], "description": "Creates simple, step-by-step recipes for each meal in the five-day plan."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step generate_recipes failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_five_day_meal_planner_calculate_nutrition(variables: Dict[str, Any]) -> Any:
    """Activity for step: calculate_nutrition (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "calculate_nutrition", "type": "agent", "config": {"agent_id": "ag_019e1b85fa997518a1347d02b2ec2060", "query_template": "You are a nutritionist. Using the five-day meal plan ({{step_generate_meal_plan_output}}), calculate the nutritional breakdown for each meal and the entire plan. Include details such as calories, macronutrients (protein, carbohydrates, fats), and key vitamins or minerals. Use the 'calculate_nutrition' tool to generate the nutritional summary. Output the nutritional information in a structured JSON format, ensuring all relevant details are included. Provide a comprehensive, detailed response."}, "next_steps": ["estimate_cost"], "description": "Calculates the nutritional breakdown for each meal and the entire five-day plan."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step calculate_nutrition failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_five_day_meal_planner_estimate_cost(variables: Dict[str, Any]) -> Any:
    """Activity for step: estimate_cost (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "estimate_cost", "type": "agent", "config": {"agent_id": "ag_019e1b85f85d71ec874c8f8013a44a1d", "query_template": "You are a budgeting expert. Using the grocery list compiled earlier ({{step_compile_grocery_list_output}}), fetch current prices for each ingredient. Calculate the total estimated cost of the grocery list and provide a detailed cost breakdown by ingredient. Ensure the total cost aligns with the user's budget. Use the 'fetch_ingredient_prices' and 'calculate_total_cost' tools to complete this task. Output the cost estimate in a structured JSON format, including the total cost and breakdown by ingredient. Provide a comprehensive, detailed response."}, "next_steps": ["compile_document"], "description": "Fetches ingredient prices and calculates the total cost of the grocery list."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step estimate_cost failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_five_day_meal_planner_compile_document(variables: Dict[str, Any]) -> Any:
    """Activity for step: compile_document (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "compile_document", "type": "agent", "config": {"agent_id": "ag_019e1b85fbab73c38733a0629c3e78e9", "query_template": "You are a document creation expert. Compile the following components into a single, well-organized document for the user: the five-day meal plan ({{step_generate_meal_plan_output}}), the grocery list ({{step_compile_grocery_list_output}}), the recipes ({{step_generate_recipes_output}}), the cost estimate ({{step_estimate_cost_output}}), and the nutritional breakdown ({{step_calculate_nutrition_output}}). Use the 'create_document' tool to generate the document in PDF format. Ensure the document is visually appealing, easy to navigate, and includes all relevant details. Provide a comprehensive, detailed response."}, "next_steps": [], "description": "Compiles the meal plan, grocery list, recipes, cost estimate, and nutritional breakdown into a single organized document."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step compile_document failed")
    return result.output

@workflows.workflow.define(
    name="five_day_meal_planner",
    workflow_display_name="Five Day Meal Planner",
    workflow_description="Automates the creation of a five-day meal plan, grocery list, recipes, cost estimate, and nutritional breakdown based on user-provided budget, diet preferences, and household size.",
    execution_timeout=timedelta(hours=24),
)
class FiveDayMealPlanner:
    """Durable workflow: Automates the creation of a five-day meal plan, grocery list, recipes, cost estimate, and nutritional breakdown based on user-provided budget, diet preferences, and household size."""

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
        """Execute the Five Day Meal Planner workflow DAG."""
        # Use workflow.now() for determinism-safe timestamps
        started_at = workflow.now()
        variables = dict(input.variables)
        current_step: Optional[str] = "collect_user_preferences"
        visited: set = set()
        last_output: Any = None

        while current_step and len(visited) < 50:
            if current_step in visited:
                break  # cycle guard
            visited.add(current_step)

            if current_step == "collect_user_preferences":
                self._progress.append("collect_user_preferences")
                output = await run_five_day_meal_planner_collect_user_preferences(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_collect_user_preferences_output"] = output

                current_step = "generate_meal_plan"

            elif current_step == "generate_meal_plan":
                self._progress.append("generate_meal_plan")
                output = await run_five_day_meal_planner_generate_meal_plan(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_generate_meal_plan_output"] = output

                current_step = "compile_grocery_list"

            elif current_step == "compile_grocery_list":
                self._progress.append("compile_grocery_list")
                output = await run_five_day_meal_planner_compile_grocery_list(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_compile_grocery_list_output"] = output

                current_step = "generate_recipes"

            elif current_step == "generate_recipes":
                self._progress.append("generate_recipes")
                output = await run_five_day_meal_planner_generate_recipes(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_generate_recipes_output"] = output

                current_step = "calculate_nutrition"

            elif current_step == "calculate_nutrition":
                self._progress.append("calculate_nutrition")
                output = await run_five_day_meal_planner_calculate_nutrition(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_calculate_nutrition_output"] = output

                current_step = "estimate_cost"

            elif current_step == "estimate_cost":
                self._progress.append("estimate_cost")
                output = await run_five_day_meal_planner_estimate_cost(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_estimate_cost_output"] = output

                current_step = "compile_document"

            elif current_step == "compile_document":
                self._progress.append("compile_document")
                output = await run_five_day_meal_planner_compile_document(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_compile_document_output"] = output

                current_step = None

            else:
                current_step = None

        return last_output
