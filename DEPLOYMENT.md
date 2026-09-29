# Deployment

The project runs in two ways from the same code:

| | Local development | Azure VM (production) |
|---|---|---|
| Frontend | `npm run dev` (Vite dev server) | `frontend` container: Node SSR server |
| Backend | `uvicorn app.main:app --reload` in `backend/` | `backend` container |
| Tool service | `docker compose up` in `tool-service/` | `tool-service` container |
| Neo4j | `docker compose up -d neo4j` (repo root) | `neo4j` container |
| Routing `/api`, `/uploads`, `/health` | Vite dev proxy (`frontend-3/vite.config.ts`) | Caddy (`deploy/Caddyfile`) |
| Config | `backend/.env`, `tool-service/.env` | `deploy/.env` |

The frontend always calls relative URLs (`/api/...`). Locally the Vite proxy forwards them to the backend, and in production Caddy does the same, so no frontend code differs between the two. Nothing in the local workflow changed.

## Files

```
deploy/
  docker-compose.yml   full stack: proxy, frontend, backend, tool-service, neo4j
  Caddyfile            reverse proxy; automatic HTTPS when SITE_ADDRESS is a domain
  .env.example         template for deploy/.env (git-ignored)
  azure/
    create-vm.sh       creates the VM and opens ports 80/443 (Azure CLI)
    vm-setup.sh        installs Docker, swap and security updates on the VM
    deploy.sh          generates secrets, then builds and (re)starts the stack
backend/Dockerfile     backend + Mistral Workflows worker (Python 3.12)
frontend-3/Dockerfile  builds with NITRO_PRESET=node-server, runs on Node 22
```

## First deployment

**1. Create the VM.** Run this from Azure Cloud Shell, or from any shell where `az login` has been done:

```bash
RESOURCE_GROUP=mistral-agent-tools-rg LOCATION=centralindia bash deploy/azure/create-vm.sh
```

The default size is `Standard_D4s_v5` (4 vCPU, 16 GiB) running Ubuntu 24.04. You can override it with `VM_SIZE=...`. Don't go below 8 GiB of RAM, because the frontend build and Neo4j both need memory. If you create the VM in the Portal instead, open inbound ports 22, 80 and 443.

**2. Prepare the VM** (run once):

```bash
ssh azureuser@<vm-ip>
git clone <repo-url> mistral-agent-tools && cd mistral-agent-tools
bash deploy/azure/vm-setup.sh
newgrp docker
```

**3. Configure and start:**

```bash
bash deploy/azure/deploy.sh        # creates deploy/.env, then stops at MISTRAL_API_KEY
nano deploy/.env                   # set MISTRAL_API_KEY
bash deploy/azure/deploy.sh        # builds and starts everything
```

On first run, `deploy.sh` fills in `NEO4J_PASSWORD` and `REMOTE_SERVER_SECRET_KEY` with random values and puts the VM's public IP into `PUBLIC_URL` / `CORS_ORIGINS`. Back up `deploy/.env`: if you lose `REMOTE_SERVER_SECRET_KEY`, stored remote-server credentials can no longer be read.

Open `http://<vm-ip>`.

## HTTPS with a domain

1. Point an A record at the VM's public IP.
2. In `deploy/.env`, set:
   ```
   SITE_ADDRESS=agents.example.com
   PUBLIC_URL=https://agents.example.com
   CORS_ORIGINS=https://agents.example.com
   ```
3. Run `bash deploy/azure/deploy.sh`. Caddy gets and renews the Let's Encrypt certificate on its own.

## Updating

```bash
cd mistral-agent-tools && git pull && bash deploy/azure/deploy.sh
```

Data lives in Docker volumes and survives rebuilds: the SQLite DB, uploads, tools, generated documents and the Neo4j graph. Compiled workflows are written to the repo's `mistral_workflows/` directory, the same as in local development.

## Operations

```bash
cd deploy
docker compose ps                      # status and health
docker compose logs -f backend         # also: frontend, tool-service, neo4j, proxy
docker compose restart backend
docker compose down                    # stop (keeps data)
```

- **Neo4j browser.** It is only reachable through an SSH tunnel: `ssh -L 7474:localhost:7474 -L 7687:localhost:7687 azureuser@<vm-ip>`, then open `http://localhost:7474`. The user is `neo4j` and the password is `NEO4J_PASSWORD` from `deploy/.env`.
- **Backups.** Snapshot the VM's OS disk in Azure, or archive the volumes:
  `docker run --rm -v mistral-agent-tools_backend-data:/d -v $PWD:/b alpine tar czf /b/backend-data.tgz -C /d .`
  Do the same for `neo4j-data`, `tool-db`, `tool-data`, `backend-uploads` and `tool-docs`.
- **No Temporal worker.** Set `WITH_MISTRAL_WORKFLOWS=false` and `MISTRAL_WORKER_ENABLED=false` in `deploy/.env` to build a smaller backend that only runs the local DAG engine.

## Security notes

- Only ports 80 and 443 are published. The backend, tool service and Neo4j are reachable only inside the Docker network, and Neo4j is also on the VM's loopback.
- The app has no login of its own. Anyone who can reach the URL can use it and spend your Mistral credits. Restrict access in the NSG (allow only your office/VPN IP ranges on 80/443), or put the VM behind Azure Front Door / Application Gateway with authentication.
