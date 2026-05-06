FROM python:3.11-slim
WORKDIR /app

# Install service dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install sandbox-safe libraries separately
COPY sandbox_requirements.txt .
RUN pip install --no-cache-dir -r sandbox_requirements.txt

# Install ruff for static analysis
RUN pip install --no-cache-dir ruff

# Non-root user for sandbox subprocess isolation
RUN useradd -m sandboxuser

COPY . .

# Create dynamic_tools directory
RUN mkdir -p dynamic_tools && chown sandboxuser:sandboxuser dynamic_tools

EXPOSE 9000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9000"]
