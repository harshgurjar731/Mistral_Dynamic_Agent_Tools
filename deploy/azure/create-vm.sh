#!/usr/bin/env bash
# Create an Ubuntu VM on Azure with ports 22/80/443 open.
# Run from any machine with the Azure CLI logged in (`az login`).
#
#   RESOURCE_GROUP=mistral-rg LOCATION=centralindia bash deploy/azure/create-vm.sh
#
# Every setting below can be overridden with an environment variable.
set -euo pipefail

RESOURCE_GROUP="${RESOURCE_GROUP:-mistral-agent-tools-rg}"
LOCATION="${LOCATION:-centralindia}"
VM_NAME="${VM_NAME:-mistral-agent-tools}"
# 4 vCPU / 16 GiB: Neo4j + two Python services + the frontend build fit comfortably.
VM_SIZE="${VM_SIZE:-Standard_D4s_v5}"
ADMIN_USER="${ADMIN_USER:-azureuser}"
DISK_GB="${DISK_GB:-64}"
IMAGE="${IMAGE:-Canonical:ubuntu-24_04-lts:server:latest}"

az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

az vm create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --image "$IMAGE" \
  --size "$VM_SIZE" \
  --admin-username "$ADMIN_USER" \
  --generate-ssh-keys \
  --os-disk-size-gb "$DISK_GB" \
  --public-ip-sku Standard \
  --output none

az vm open-port --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" --port 80 --priority 1010 --output none
az vm open-port --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" --port 443 --priority 1020 --output none

IP=$(az vm show -d --resource-group "$RESOURCE_GROUP" --name "$VM_NAME" --query publicIps -o tsv)
echo
echo "VM ready: $ADMIN_USER@$IP"
echo "Next:"
echo "  ssh $ADMIN_USER@$IP"
echo "  git clone <your-repo-url> mistral-agent-tools && cd mistral-agent-tools"
echo "  bash deploy/azure/vm-setup.sh && newgrp docker"
echo "  bash deploy/azure/deploy.sh"
