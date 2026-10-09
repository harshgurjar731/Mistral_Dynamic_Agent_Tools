# Deployment image for a packaged workflow's backend + worker.
#
# Context is the package root (docker-compose.deploy.yml builds with
# `context: ./backend`), so this Dockerfile only sees the bundled backend/
# tree — the same layout as the source repo's backend/ directory.
# 3.12+: mistralai-workflows publishes no release for 3.11.
FROM python:3.12-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir mistralai-workflows

COPY . .

ENV MISTRAL_WORKFLOWS_DIR=/mistral_workflows
VOLUME ["/mistral_workflows"]

CMD ["python", "-m", "app.services.mistral_worker"]
