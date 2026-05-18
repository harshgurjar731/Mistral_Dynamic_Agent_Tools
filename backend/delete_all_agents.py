import asyncio
from app.services import agent_service
from mistralai.client import Mistral
from app.config import settings

async def main():
    client = Mistral(api_key=settings.MISTRAL_API_KEY)
    print('Fetching agents...')
    resp = await agent_service.list_agents(client, page=0, page_size=100)
    agents = resp.get('items', [])
    print(f'Found {len(agents)} agents.')
    
    for idx, agent in enumerate(agents):
        print(f"Deleting {idx+1}/{len(agents)}: {agent['id']} ({agent.get('name', 'Unknown')})")
        try:
            await agent_service.delete_agent(client, agent['id'])
        except Exception as e:
            print(f"Error deleting: {e}")
    
    print('Done!')

if __name__ == "__main__":
    asyncio.run(main())
