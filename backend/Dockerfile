# Production image for the FastAPI backend (API + Mistral Workflows worker).
#
# Used by deploy/docker-compose.yml. Local development does not need it — run
# `uvicorn app.main:app --reload` from backend/ as before.
#
# The layout mirrors the repository: code lives in /srv/backend and compiled
# workflows in /srv/mistral_workflows, because both the worker and the compiled
# workflow modules locate each other through ../ relative paths.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Temporal-based Mistral Workflows worker. Set to false to build a smaller
# image that only runs the local DAG engine (then MISTRAL_WORKER_ENABLED=false).
ARG WITH_MISTRAL_WORKFLOWS=true

# NVIDIA Brev servers (app/remote_servers/brev.py): the backend runs the Brev
# CLI to resolve SSH access and mint the short-lived certificates Brev
# requires, and `ssh -G` to read Brev's SSH config. Log the CLI in once inside
# the container (`docker compose exec backend brev login --token ...`); the
# login lives in the brev-home volume. Set to false to leave the CLI out.
ARG WITH_BREV_CLI=true

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-client \
    && if [ "$WITH_BREV_CLI" = "true" ]; then \
         apt-get install -y --no-install-recommends curl ca-certificates \
         && curl -fsSL https://raw.githubusercontent.com/brevdev/brev-cli/main/bin/install-latest.sh -o /tmp/install-brev.sh \
         && BREV_INSTALL_DIR=/usr/local/bin bash /tmp/install-brev.sh \
         && rm /tmp/install-brev.sh; \
       fi \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/backend

COPY requirements.txt .
RUN pip install -r requirements.txt cryptography \
    && if [ "$WITH_MISTRAL_WORKFLOWS" = "true" ]; then \
         pip install -r requirements.txt mistralai-workflows; \
       fi

COPY . .

RUN mkdir -p /srv/data /srv/backend/uploads /srv/mistral_workflows \
    && useradd --create-home --uid 10001 app \
    && mkdir -p /home/app/.brev /home/app/.ssh \
    && chmod 700 /home/app/.ssh \
    && chown -R app:app /srv /home/app

USER app

ENV DATABASE_URL=sqlite:////srv/data/sql_app.db \
    MISTRAL_WORKFLOWS_DIR=../mistral_workflows

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

# One worker on purpose: background runs and the workflow worker supervisor
# live in-process, so multiple uvicorn workers would each start their own.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
