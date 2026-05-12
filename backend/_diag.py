"""Check current execution status and worker health."""
import httpx
from app.config import settings

H = {"Authorization": "Bearer " + settings.MISTRAL_API_KEY}

# Check all executions
r = httpx.get("https://api.mistral.ai/v1/workflows/executions", headers=H, timeout=8)
execs = r.json().get("executions", [])

print(f"Total executions: {len(execs)}")
print()
for e in execs[:8]:
    wn = e.get("workflow_name", "?")
    st = e.get("status", "?")
    started = e.get("start_time", "?")[:19]
    ended = e.get("end_time")
    ended = ended[:19] if ended else "-"
    dur = e.get("total_duration_ms", "?")
    result = str(e.get("result", ""))[:100]
    print(f"  {wn[:40]:42s} {st:12s} start={started} end={ended} dur={dur}ms")
    if result and result != "None":
        print(f"    result: {result}")

# Check deployment status
print()
r2 = httpx.get("https://api.mistral.ai/v1/workflows/deployments", headers=H, timeout=8)
for dep in r2.json().get("deployments", []):
    name = dep.get("name", "?")
    active = dep.get("is_active", False)
    updated = dep.get("updated_at", "?")[:19]
    wf_count = len(dep.get("workflows", []))
    print(f"  Deployment: {name} active={active} updated={updated} workflows={wf_count}")
