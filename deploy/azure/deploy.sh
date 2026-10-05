#!/usr/bin/env bash
# Build and (re)start the production stack on the VM. Run from the repo root
# after every `git pull`. Containers restart automatically on reboot.
#
#   bash deploy/azure/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."          # -> deploy/
ENV_FILE=.env

if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
  echo "Created deploy/$ENV_FILE from the template."
fi

set_if_empty() {  # key value
  if grep -qE "^$1=\s*$" "$ENV_FILE"; then
    sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"
    echo "Generated $1"
  fi
}

set_if_empty NEO4J_PASSWORD "$(openssl rand -hex 16)"
# A Fernet key is 32 random bytes, url-safe base64 encoded.
set_if_empty REMOTE_SERVER_SECRET_KEY "$(openssl rand -base64 32 | tr '+/' '-_')"

IP=$(curl -fs --max-time 3 -H Metadata:true \
  "http://169.254.169.254/metadata/instance/network/interface/0/ipv4/ipAddress/0/publicIpAddress?api-version=2021-02-01&format=text" || true)
if [ -n "$IP" ]; then
  sed -i "s|<vm-public-ip>|$IP|g" "$ENV_FILE"
fi

if ! grep -qE "^MISTRAL_API_KEY=.+" "$ENV_FILE"; then
  echo "MISTRAL_API_KEY is empty — edit deploy/$ENV_FILE and run this script again."
  exit 1
fi

# The backend container runs as a non-root user (uid 10001) and writes compiled
# workflows into the repo's mistral_workflows/ directory. Open up only what we
# own (the directory, files from git): files the container compiled belong to
# its user, who can already write them, and we are not allowed to chmod them.
mkdir -p ../mistral_workflows
find ../mistral_workflows -user "$(id -u)" -exec chmod a+rwX {} +

docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null

echo
docker compose ps
echo
echo "Deployed. Open: $(grep -E '^PUBLIC_URL=' "$ENV_FILE" | cut -d= -f2-)"
echo "Logs: cd deploy && docker compose logs -f backend"
