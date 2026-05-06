import os
import sys
import json
from typing import Dict, Any
from pydantic import BaseModel
import mistralai.workflows as workflows

# Ensure backend is in python path to import step runners
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../"))
if backend_dir not in sys.path:
    sys.path.append(backend_dir)

from app.services.workflow_engine.step_runners import run_step
from app.services.workflow_engine.models import WorkflowStep, StepType

class DynamicInput(BaseModel):
    variables: Dict[str, Any] = {}

@workflows.activity()
async def run_fetch_weather(variables: Dict[str, Any]) -> Any:
    step_def = WorkflowStep.model_validate({"id": "fetch_weather", "type": "agent", "config": {"agent_id": "ag_019dde0a89397324911a8ae84cb813e4", "query_template": "Fetch the current weather forecast for {location}."}, "next_steps": ["fetch_traffic"], "description": "Fetches the current weather forecast for New York City."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error)
    return result.output

@workflows.activity()
async def run_fetch_traffic(variables: Dict[str, Any]) -> Any:
    step_def = WorkflowStep.model_validate({"id": "fetch_traffic", "type": "agent", "config": {"agent_id": "ag_019dde0a8a5a75809ec7558de4d6b8bf", "query_template": "Fetch the current traffic conditions for the {highway} highway."}, "next_steps": ["generate_advisory"], "description": "Fetches the current traffic conditions for the I-95 highway."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error)
    return result.output

@workflows.activity()
async def run_generate_advisory(variables: Dict[str, Any]) -> Any:
    step_def = WorkflowStep.model_validate({"id": "generate_advisory", "type": "agent", "config": {"agent_id": "ag_019dde0a8b8c73149e7f5e01d4aaa0ef", "query_template": "Write a travel advisory paragraph based on the following weather data: {weather_data} and traffic data: {traffic_data}."}, "next_steps": ["save_advisory"], "description": "Generates a travel advisory paragraph based on weather and traffic data."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error)
    return result.output

@workflows.activity()
async def run_save_advisory(variables: Dict[str, Any]) -> Any:
    step_def = WorkflowStep.model_validate({"id": "save_advisory", "type": "agent", "config": {"agent_id": "ag_019dde0a8cd17519983d370de504fd9e", "query_template": "Convert the following text to uppercase and save it to a file: {advisory_text}"}, "next_steps": [], "description": "Converts the travel advisory to uppercase and saves it to a file."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error)
    return result.output

@workflows.workflow.define(
    name="trip_planning_workflow",
    workflow_display_name="Trip Planning Workflow",
)
class TripPlanningWorkflow:
    @workflows.workflow.entrypoint
    async def run(self, input: DynamicInput) -> Any:
        variables = input.variables.copy()
        current_step = "fetch_weather"
        visited = set()
        last_output = None

        while current_step and len(visited) < 50:
            visited.add(current_step)

            if current_step == "fetch_weather":
                output = await run_fetch_weather(variables)
                last_output = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_fetch_weather_output"] = output

                current_step = "fetch_traffic"
            elif current_step == "fetch_traffic":
                output = await run_fetch_traffic(variables)
                last_output = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_fetch_traffic_output"] = output

                current_step = "generate_advisory"
            elif current_step == "generate_advisory":
                output = await run_generate_advisory(variables)
                last_output = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_generate_advisory_output"] = output

                current_step = "save_advisory"
            elif current_step == "save_advisory":
                output = await run_save_advisory(variables)
                last_output = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_save_advisory_output"] = output

                current_step = None
            else:
                current_step = None

        return last_output
