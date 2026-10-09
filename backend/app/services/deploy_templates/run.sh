#!/usr/bin/env sh
# Run this workflow's worker without Docker (needs Python 3.12+).
#
#   sh run.sh
#
# Creates .env from the template on first use, installs into ./.venv, creates
# the workflow's agents, then starts the worker in the foreground.
set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.template .env
  echo "Created .env — set MISTRAL_API_KEY in it, then run: sh run.sh"
  exit 1
fi
set -a; . ./.env; set +a

[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q --disable-pip-version-check \
  -r backend/requirements.txt -r backend/requirements-tools.txt mistralai-workflows

cd backend
../.venv/bin/python bootstrap_deploy.py
WORKFLOWS_DIR="$(cd ../mistral_workflows && pwd)" exec ../.venv/bin/python -m app.services.mistral_worker
