import httpx

r = httpx.get('http://localhost:8000/api/workflows', timeout=10)
if r.status_code == 200:
    for wf in r.json():
        print(f"Registering {wf['name']}...")
        try:
            res = httpx.post(f"http://localhost:8000/api/workflows/{wf['name']}/register", timeout=30)
            print(res.status_code, res.text[:50])
        except Exception as e:
            print(f"Failed to register {wf['name']}: {e}")
else:
    print('Failed to get workflows', r.status_code)
