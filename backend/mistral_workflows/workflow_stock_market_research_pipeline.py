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
async def run_get_ticker_symbol(variables: Dict[str, Any]) -> Any:
    step_def = WorkflowStep.model_validate({"id": "get_ticker_symbol", "type": "transform", "config": {"mappings": {"ticker": "{user_input.ticker}"}}, "next_steps": ["fetch_stock_price"], "description": "Collects the ticker symbol from the user input."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error)
    return result.output

@workflows.activity()
async def run_fetch_stock_price(variables: Dict[str, Any]) -> Any:
    step_def = WorkflowStep.model_validate({"id": "fetch_stock_price", "type": "agent", "config": {"agent_id": "ag_019df1914819704da3080efa3a22d0a4", "query_template": "Fetch the current stock price for the ticker symbol: {ticker}."}, "next_steps": ["fetch_company_news"], "description": "Fetches the current stock price for the given ticker symbol."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error)
    return result.output

@workflows.activity()
async def run_fetch_company_news(variables: Dict[str, Any]) -> Any:
    step_def = WorkflowStep.model_validate({"id": "fetch_company_news", "type": "agent", "config": {"agent_id": "ag_019df191494a75ad969056b7abde4110", "query_template": "Fetch the latest 3 news articles for the ticker symbol: {ticker}."}, "next_steps": ["analyze_stock_data"], "description": "Fetches the latest 3 news articles for the given company ticker symbol."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error)
    return result.output

@workflows.activity()
async def run_analyze_stock_data(variables: Dict[str, Any]) -> Any:
    step_def = WorkflowStep.model_validate({"id": "analyze_stock_data", "type": "agent", "config": {"agent_id": "ag_019df1914a577157b69c8457961afc93", "query_template": "Analyze the following stock data and news articles for {ticker}:\nStock Price: {fetch_stock_price.output}\nNews Articles: {fetch_company_news.output}\nProvide a recommendation of 'Buy', 'Hold', or 'Sell' with a concise justification."}, "next_steps": [], "description": "Analyzes the stock price and news articles to generate a buy/hold/sell recommendation."})
    result = await run_step(step_def, variables)
    if result.status == "failed":
        raise Exception(result.error)
    return result.output

@workflows.workflow.define(
    name="stock_market_research_pipeline",
    workflow_display_name="Stock Market Research Pipeline",
)
class StockMarketResearchPipeline:
    @workflows.workflow.entrypoint
    async def run(self, input: DynamicInput) -> Any:
        variables = input.variables.copy()
        current_step = "get_ticker_symbol"
        visited = set()
        last_output = None

        while current_step and len(visited) < 50:
            visited.add(current_step)

            if current_step == "get_ticker_symbol":
                output = await run_get_ticker_symbol(variables)
                last_output = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_get_ticker_symbol_output"] = output

                current_step = "fetch_stock_price"
            elif current_step == "fetch_stock_price":
                output = await run_fetch_stock_price(variables)
                last_output = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_fetch_stock_price_output"] = output

                current_step = "fetch_company_news"
            elif current_step == "fetch_company_news":
                output = await run_fetch_company_news(variables)
                last_output = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_fetch_company_news_output"] = output

                current_step = "analyze_stock_data"
            elif current_step == "analyze_stock_data":
                output = await run_analyze_stock_data(variables)
                last_output = output
                if isinstance(output, dict):
                    variables.update(output)
                else:
                    variables["step_analyze_stock_data_output"] = output

                current_step = None
            else:
                current_step = None

        return last_output
