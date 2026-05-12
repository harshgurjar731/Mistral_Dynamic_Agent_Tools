import httpx
from app.config import settings

def main():
    H = {'Authorization': 'Bearer ' + settings.MISTRAL_API_KEY}
    r = httpx.get('https://api.mistral.ai/v1/workflows/executions?limit=5', headers=H)
    for e in r.json().get('executions', []):
        if e['workflow_name'] == 'trip_planning_workflow':
            print(f"ID: {e['execution_id']}")
            # try to get events or more details
            r2 = httpx.get(f"https://api.mistral.ai/v1/workflows/executions/{e['execution_id']}/tasks", headers=H)
            if r2.status_code == 200:
                print('Tasks:', r2.json())
            else:
                print('Tasks endpoint failed:', r2.status_code, r2.text)
            
            # also get the execution details
            r3 = httpx.get(f"https://api.mistral.ai/v1/workflows/executions/{e['execution_id']}", headers=H)
            if r3.status_code == 200:
                print('Execution:', r3.json())
            break

if __name__ == '__main__':
    main()
