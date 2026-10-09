# Deployment image for a packaged workflow's worker.
#
# Context is the package's backend/ directory: the backend source plus the
# bundled tool code (app/bundled_tools/), bootstrap_deploy.py and its manifest.
# 3.12+: mistralai-workflows publishes no release for 3.11.
FROM python:3.12-slim
WORKDIR /app

COPY requirements.txt requirements-tools.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-tools.txt \
    && pip install --no-cache-dir mistralai-workflows

COPY . .

ENV WORKFLOWS_DIR=/mistral_workflows
VOLUME ["/mistral_workflows"]

# Agents first (reused by name, so every restart is cheap), then the worker.
CMD ["sh", "-c", "python bootstrap_deploy.py && exec python -m app.services.mistral_worker"]
