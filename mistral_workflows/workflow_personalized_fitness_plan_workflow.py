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
async def run_personalized_fitness_plan_workflow_collect_fitness_data(variables: Dict[str, Any]) -> Any:
    """Activity for step: collect_fitness_data (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "collect_fitness_data", "type": "agent", "config": {"agent_id": "ag_019e202422797657a633e3235d45d331", "query_template": "You are a fitness assessment expert. Your task is to gather detailed information from the user about their fitness goals, current fitness level, and daily time availability. Begin by asking the user to specify their primary fitness goal (e.g., weight loss, muscle gain, endurance, general fitness). Next, inquire about their current fitness level (e.g., beginner, intermediate, advanced) and any specific limitations or preferences. Finally, ask how much time they can dedicate to workouts each day. Use the 'collect_user_fitness_data' tool to present a structured questionnaire and validate the responses for completeness and consistency. Ensure the user provides clear and actionable inputs. After collecting the data, summarize it in a structured format and confirm it with the user. Provide a comprehensive, detailed response."}, "next_steps": ["design_workout_plan"], "description": "Gathers the user's fitness goals, current fitness level, and daily time availability using a structured questionnaire."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step collect_fitness_data failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_personalized_fitness_plan_workflow_design_workout_plan(variables: Dict[str, Any]) -> Any:
    """Activity for step: design_workout_plan (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "design_workout_plan", "type": "agent", "config": {"agent_id": "ag_019e20242396775aa27a1fe33a932409", "query_template": "You are a certified personal trainer. Your task is to generate a four-week workout plan using the user's fitness data collected in the previous step. Reference the following data: {{step_collect_fitness_data_output}}. Ensure the plan is realistic, progressive, and aligned with the user's capabilities. The plan should include specific exercises, sets, reps, and rest periods for each day of the week. Use the 'generate_workout_plan' tool to create the plan. Output the plan in a structured format, including clear instructions for each workout session. Provide a comprehensive, detailed response."}, "next_steps": ["create_diet_guide"], "description": "Creates a customized four-week workout plan tailored to the user's fitness goal, current level, and time availability."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step design_workout_plan failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_personalized_fitness_plan_workflow_create_diet_guide(variables: Dict[str, Any]) -> Any:
    """Activity for step: create_diet_guide (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "create_diet_guide", "type": "agent", "config": {"agent_id": "ag_019e202424ac72e5ba88dcc0b2a318a3", "query_template": "You are a registered dietitian specializing in nutrition for fitness. Your task is to generate a practical diet guide based on the user's fitness goal and workout plan. Reference the following data: fitness goals and workout plan from {{step_collect_fitness_data_output}} and {{step_design_workout_plan_output}}. Consider common dietary preferences and restrictions (e.g., vegetarian, vegan, gluten-free). The guide should include meal plans, portion sizes, and nutritional advice tailored to support the user's fitness objectives. Use the 'generate_diet_guide' tool to create the guide. Output the guide in a clear, actionable format, including daily meal suggestions and hydration tips. Provide a comprehensive, detailed response."}, "next_steps": ["set_weekly_milestones"], "description": "Generates a practical diet guide aligned with the user's fitness goal and workout plan, considering dietary preferences and restrictions."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step create_diet_guide failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_personalized_fitness_plan_workflow_set_weekly_milestones(variables: Dict[str, Any]) -> Any:
    """Activity for step: set_weekly_milestones (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "set_weekly_milestones", "type": "agent", "config": {"agent_id": "ag_019e202426b57452ac7a3f7cb1b94344", "query_template": "You are a fitness coach focused on goal tracking and motivation. Your task is to set clear, measurable weekly milestones based on the user's workout plan and fitness goal. Reference the following data: fitness goals from {{step_collect_fitness_data_output}} and workout plan from {{step_design_workout_plan_output}}. Ensure the milestones are realistic, motivating, and aligned with the user's progress. Use the 'set_weekly_milestones' tool to define these milestones. Output the milestones in a structured format, including specific targets for each week (e.g., weight lifted, distance run, body measurements). Provide a comprehensive, detailed response."}, "next_steps": ["provide_consistency_tips"], "description": "Sets clear, measurable weekly milestones based on the user's workout plan and fitness goal to track progress and maintain motivation."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step set_weekly_milestones failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_personalized_fitness_plan_workflow_provide_consistency_tips(variables: Dict[str, Any]) -> Any:
    """Activity for step: provide_consistency_tips (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "provide_consistency_tips", "type": "agent", "config": {"agent_id": "ag_019e202427c07743acb9e87fa623bea1", "query_template": "You are a fitness mentor with expertise in habit formation and injury prevention. Your task is to generate actionable tips for staying consistent with the fitness plan and preventing injuries. Reference the following data: user's fitness level and time availability from {{step_collect_fitness_data_output}}, workout plan from {{step_design_workout_plan_output}}, and milestones from {{step_set_weekly_milestones_output}}. Focus on practical advice tailored to the user's specific situation. Use the 'generate_consistency_tips' tool to create the tips. Output the tips in a clear, concise list, including strategies for motivation, time management, and injury prevention. Provide a comprehensive, detailed response."}, "next_steps": ["compile_fitness_plan"], "description": "Provides actionable tips for staying consistent with the fitness plan and preventing injuries, tailored to the user's fitness level and time availability."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step provide_consistency_tips failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_personalized_fitness_plan_workflow_compile_fitness_plan(variables: Dict[str, Any]) -> Any:
    """Activity for step: compile_fitness_plan (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "compile_fitness_plan", "type": "agent", "config": {"agent_id": "ag_019e202427c07743acb9e87fa623bea1", "query_template": "You are a fitness program coordinator. Your task is to compile all components of the fitness plan into a single, structured document. Reference the following data: fitness goals and user details from {{step_collect_fitness_data_output}}, workout plan from {{step_design_workout_plan_output}}, diet guide from {{step_create_diet_guide_output}}, milestones from {{step_set_weekly_milestones_output}}, and consistency tips from {{step_provide_consistency_tips_output}}. Use the 'compile_fitness_plan_document' tool to create the document. Ensure the document is well-organized, visually appealing, and easy to follow. Include sections for the workout plan, diet guide, weekly milestones, and consistency tips. Provide a comprehensive, detailed response that synthesizes all previous outputs into a cohesive final plan."}, "next_steps": [], "description": "Compiles all components of the fitness plan into a single, structured, and visually appealing document."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step compile_fitness_plan failed")
    return result.output

@workflows.workflow.define(
    name="personalized_fitness_plan_workflow",
    workflow_display_name="Personalized Fitness Plan Workflow",
    workflow_description="Automates the creation of a personalized four-week fitness plan, including workout routines, diet guidance, weekly milestones, and consistency tips based on the user's fitness goals, current level, and time availability.",
    execution_timeout=timedelta(hours=24),
)
class PersonalizedFitnessPlanWorkflow:
    """Durable workflow: Automates the creation of a personalized four-week fitness plan, including workout routines, diet guidance, weekly milestones, and consistency tips based on the user's fitness goals, current level, and time availability."""

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
        """Execute the Personalized Fitness Plan Workflow workflow DAG."""
        # Use workflow.now() for determinism-safe timestamps
        started_at = workflow.now()
        variables = dict(input.variables)
        current_step: Optional[str] = "collect_fitness_data"
        visited: set = set()
        last_output: Any = None

        while current_step and len(visited) < 50:
            if current_step in visited:
                break  # cycle guard
            visited.add(current_step)

            if current_step == "collect_fitness_data":
                self._progress.append("collect_fitness_data")
                output = await run_personalized_fitness_plan_workflow_collect_fitness_data(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_collect_fitness_data_output"] = output

                current_step = "design_workout_plan"

            elif current_step == "design_workout_plan":
                self._progress.append("design_workout_plan")
                output = await run_personalized_fitness_plan_workflow_design_workout_plan(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_design_workout_plan_output"] = output

                current_step = "create_diet_guide"

            elif current_step == "create_diet_guide":
                self._progress.append("create_diet_guide")
                output = await run_personalized_fitness_plan_workflow_create_diet_guide(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_create_diet_guide_output"] = output

                current_step = "set_weekly_milestones"

            elif current_step == "set_weekly_milestones":
                self._progress.append("set_weekly_milestones")
                output = await run_personalized_fitness_plan_workflow_set_weekly_milestones(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_set_weekly_milestones_output"] = output

                current_step = "provide_consistency_tips"

            elif current_step == "provide_consistency_tips":
                self._progress.append("provide_consistency_tips")
                output = await run_personalized_fitness_plan_workflow_provide_consistency_tips(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_provide_consistency_tips_output"] = output

                current_step = "compile_fitness_plan"

            elif current_step == "compile_fitness_plan":
                self._progress.append("compile_fitness_plan")
                output = await run_personalized_fitness_plan_workflow_compile_fitness_plan(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_compile_fitness_plan_output"] = output

                current_step = None

            else:
                current_step = None

        return last_output
