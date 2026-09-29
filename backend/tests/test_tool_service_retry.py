"""The Tool Service client rides out a restart instead of failing the workflow step."""

import asyncio

import httpx
import pytest

from app.services import tool_resolver as tr


def _resolver(handler):
    resolver = tr.ToolResolver(base_url="http://tool-service.test")
    resolver._client = httpx.AsyncClient(base_url="http://tool-service.test",
                                         transport=httpx.MockTransport(handler))
    return resolver


@pytest.fixture(autouse=True)
def fast_sleep(monkeypatch):
    slept = []

    async def no_wait(seconds):
        slept.append(seconds)

    monkeypatch.setattr(tr.asyncio, "sleep", no_wait)
    return slept


def test_execute_waits_for_a_restarting_service(fast_sleep):
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if len(calls) < 3:
            raise httpx.ConnectError("connection refused", request=request)
        return httpx.Response(200, json={"result": {"status": "success", "data": 1},
                                         "tool_name": "apply_gst", "version": 1})

    result = asyncio.run(_resolver(handler).execute_tool("apply_gst", {"subtotal": 1}, version=1))
    assert result["result"]["data"] == 1
    assert len(calls) == 3 and fast_sleep == [1.0, 2.0]


def test_an_execution_that_reached_the_service_is_never_resent():
    calls = []

    def handler(request):
        calls.append(1)
        raise httpx.ReadError("connection reset mid-response", request=request)

    result = asyncio.run(_resolver(handler).execute_tool("send_email", {}))
    assert "error" in result and len(calls) == 1


def test_gives_up_after_the_wait_budget(monkeypatch):
    monkeypatch.setattr(tr.settings, "TOOL_SERVICE_WAIT_SECONDS", 3.0)

    def handler(request):
        raise httpx.ConnectError("connection refused", request=request)

    result = asyncio.run(_resolver(handler).execute_tool("apply_gst", {}))
    assert "unreachable" in result["error"] and "waited 3s" in result["error"]


def test_reads_retry_gateway_errors_but_writes_do_not():
    reads, writes = [], []

    def handler(request):
        bucket = reads if request.method == "GET" else writes
        bucket.append(1)
        if len(bucket) == 1:
            return httpx.Response(503, text="starting")
        return httpx.Response(200, json={"tools": [{"name": "x"}], "status": "approved"})

    resolver = _resolver(handler)
    assert asyncio.run(resolver.list_tools()) == [{"name": "x"}] and len(reads) == 2
    asyncio.run(resolver.approve_tool(1))
    assert len(writes) == 1
