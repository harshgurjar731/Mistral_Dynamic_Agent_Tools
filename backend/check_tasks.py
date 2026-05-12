import httpx
from app.config import settings

def main():
    H = {'Authorization': 'Bearer ' + settings.MISTRAL_API_KEY}
    r = httpx.get('https://api.mistral.ai/v1/workflows/executions?limit=5', headers=H)
    execs = r.json().get('executions', [])
    if execs:
        ex = execs[0]
        print(f"Execution: {ex['execution_id']} Status: {ex['status']}")
        events = httpx.get(f"https://api.mistral.ai/v1/workflows/executions/{ex['execution_id']}/tasks", headers=H)
        if events.status_code == 200:
            print('Tasks:', events.json())
        else:
            print('Tasks endpoint failed:', events.status_code, events.text)

if __name__ == '__main__':
    main()
