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
async def run_manali_trip_planner_allocate_budget(variables: Dict[str, Any]) -> Any:
    """Activity for step: allocate_budget (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "allocate_budget", "type": "agent", "config": {"agent_id": "ag_019e1af8a2217676b634d0c34ddb8198", "query_template": "Allocate the total budget of {total_budget} INR for a {trip_duration}-day trip to Manali from {departure_date} to {return_date}. Use default percentages: 40% travel, 30% accommodation, 20% activities, 10% miscellaneous."}, "next_steps": ["plan_travel"], "description": "Allocates the total budget across travel, accommodation, activities, and miscellaneous expenses."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step allocate_budget failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_manali_trip_planner_plan_travel(variables: Dict[str, Any]) -> Any:
    """Activity for step: plan_travel (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "plan_travel", "type": "agent", "config": {"agent_id": "ag_019e1af89c3972928d73bb7071f1fe53", "query_template": "Find the best travel options from {origin} to Manali for departure on {departure_date} and return on {return_date}. Allocated budget for travel is {travel_budget} INR. Consider flights, trains, and buses. Select the most cost-effective and convenient option."}, "next_steps": ["plan_accommodation"], "description": "Searches and selects the best travel options (flights, trains, buses) within the allocated budget."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step plan_travel failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_manali_trip_planner_plan_accommodation(variables: Dict[str, Any]) -> Any:
    """Activity for step: plan_accommodation (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "plan_accommodation", "type": "agent", "config": {"agent_id": "ag_019e1af89d66771d872187162fa7ae6e", "query_template": "Find the best accommodation options in Manali from {check_in_date} to {check_out_date} with a budget of {accommodation_budget} INR. Consider hotels, hostels, and homestays. Select the best option based on price, reviews, and amenities."}, "next_steps": ["plan_activities"], "description": "Searches and selects the best accommodation options (hotels, hostels, homestays) within the allocated budget."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step plan_accommodation failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_manali_trip_planner_plan_activities(variables: Dict[str, Any]) -> Any:
    """Activity for step: plan_activities (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "plan_activities", "type": "agent", "config": {"agent_id": "ag_019e1af89fff768db328256da5233594", "query_template": "Find popular activities or attractions in Manali within a budget of {activities_budget} INR. Consider interests like adventure, nature, and culture. Select the best activities based on user interests, price, and reviews."}, "next_steps": ["generate_itinerary"], "description": "Searches and selects activities or attractions to visit during the trip within the allocated budget."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step plan_activities failed")
    return result.output

@workflows.activity(
    start_to_close_timeout=timedelta(seconds=300),
    retry_policy_max_attempts=3,
)
async def run_manali_trip_planner_generate_itinerary(variables: Dict[str, Any]) -> Any:
    """Activity for step: generate_itinerary (StepType.AGENT)"""
    step_def = WorkflowStep.model_validate({"id": "generate_itinerary", "type": "agent", "config": {"agent_id": "ag_019e1af8a1247488a5a9193cd7bbe2ed", "query_template": "Generate a detailed day-by-day itinerary for a {trip_duration}-day trip to Manali. Include the following details: travel details ({travel_details}), accommodation details ({accommodation_details}), and activities ({activities_details}). Ensure the itinerary is realistic and balances activities with rest."}, "next_steps": [], "description": "Generates a detailed day-by-day itinerary for the trip based on travel, accommodation, and activity details."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error or "Step generate_itinerary failed")
    return result.output

@workflows.workflow.define(
    name="manali_trip_planner",
    workflow_display_name="Manali Trip Planner",
    workflow_description="Automates trip planning to Manali within a specified budget, including travel, accommodation, activities, and packing recommendations.",
    execution_timeout=timedelta(hours=24),
)
class ManaliTripPlanner:
    """Durable workflow: Automates trip planning to Manali within a specified budget, including travel, accommodation, activities, and packing recommendations."""

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
        """Execute the Manali Trip Planner workflow DAG."""
        # Use workflow.now() for determinism-safe timestamps
        started_at = workflow.now()
        variables = dict(input.variables)
        current_step: Optional[str] = "allocate_budget"
        visited: set = set()
        last_output: Any = None

        while current_step and len(visited) < 50:
            if current_step in visited:
                break  # cycle guard
            visited.add(current_step)

            if current_step == "allocate_budget":
                self._progress.append("allocate_budget")
                output = await run_manali_trip_planner_allocate_budget(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_allocate_budget_output"] = output

                current_step = "plan_travel"

            elif current_step == "plan_travel":
                self._progress.append("plan_travel")
                output = await run_manali_trip_planner_plan_travel(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_plan_travel_output"] = output

                current_step = "plan_accommodation"

            elif current_step == "plan_accommodation":
                self._progress.append("plan_accommodation")
                output = await run_manali_trip_planner_plan_accommodation(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_plan_accommodation_output"] = output

                current_step = "plan_activities"

            elif current_step == "plan_activities":
                self._progress.append("plan_activities")
                output = await run_manali_trip_planner_plan_activities(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_plan_activities_output"] = output

                current_step = "generate_itinerary"

            elif current_step == "generate_itinerary":
                self._progress.append("generate_itinerary")
                output = await run_manali_trip_planner_generate_itinerary(variables)
                last_output = output
                self._last_result = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_generate_itinerary_output"] = output

                current_step = None

            else:
                current_step = None

        return last_output
