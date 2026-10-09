"""
Provider catalog — every kind of server a user can add, and what it needs.

The frontend renders its add/edit form from this catalog, so a new provider
is one entry here (plus a transport in checks/deployers if it is not HTTP or
SSH). Cloud VM providers are all SSH underneath; they differ in defaults and
in the hints that help the user find the right values in their console.
"""

from __future__ import annotations

PURPOSES = {
    "tool": {
        "label": "Tool deployment",
        "description": "Receives dynamic tool source code (e.g. a remote MCP server's /submit-code endpoint).",
    },
    "workflow": {
        "label": "Workflow deployment",
        "description": "Receives a workflow deployment package, unpacks it and optionally starts it.",
    },
}

# Post-deploy actions a workflow deployment can run on an SSH server.
WORKFLOW_ACTIONS = {
    "full": "Complete: upload, start the worker & wait until it polls",
    "upload_only": "Upload & extract only",
    "bootstrap": "Upload, extract & create the agents (no worker)",
    "bootstrap_compose": "Upload & start the worker (don't wait)",
    "custom": "Upload, extract & run a custom command",
}

# Sets up the package's connectors, agents and knowledge (backend/bootstrap_deploy.py)
# in a one-off worker container — it needs the backend code and the databases the
# compose file starts. The worker does the same on every start.
BOOTSTRAP_COMMAND = (
    'DC="docker compose"; docker compose version >/dev/null 2>&1 || DC="docker-compose";'
    " $DC -f docker-compose.deploy.yml build backend"
    " && $DC -f docker-compose.deploy.yml run --rm backend python bootstrap_deploy.py"
)

_DC = 'DC="docker compose"; docker compose version >/dev/null 2>&1 || DC="docker-compose"; '
_COMPOSE = _DC + "$DC -f docker-compose.deploy.yml "

# One-click console commands on SSH servers. "workflow" presets run inside a
# deployed workflow's directory, "server" ones in the deploy directory.
# long_running ones keep streaming until stopped.
COMMAND_PRESETS = {
    "worker_status": {"label": "Worker status", "scope": "workflow", "command": _COMPOSE + "ps"},
    "start_worker": {"label": "Start worker", "scope": "workflow",
                     "command": _COMPOSE + "up -d --build backend && $DC -f docker-compose.deploy.yml ps"},
    "restart_worker": {"label": "Restart worker", "scope": "workflow", "command": _COMPOSE + "restart backend"},
    "stop_worker": {"label": "Stop worker", "scope": "workflow", "command": _COMPOSE + "stop backend"},
    "worker_logs": {"label": "Worker logs", "scope": "workflow", "command": _COMPOSE + "logs --tail 200 backend"},
    "follow_logs": {"label": "Follow logs", "scope": "workflow", "long_running": True,
                    "command": _COMPOSE + "logs -f --tail 50 backend"},
    "bootstrap": {"label": "Run bootstrap", "scope": "workflow", "command": BOOTSTRAP_COMMAND},
    # Names only — values (API keys) never reach the log.
    "env_keys": {"label": "Show .env keys", "scope": "workflow",
                 "command": "grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' .env | sed 's/=$//'"},
    "host_info": {"label": "Host info", "scope": "server",
                  "command": "uname -srm; uptime; df -h ~ | tail -1; free -h | head -2; "
                             "docker ps --format 'table {{.Names}}\\t{{.Status}}' 2>&1"},
    "list_deployments": {"label": "List deployments", "scope": "server", "command": "ls -la"},
}


def _f(key, label, type_="text", *, required=False, secret=False, default=None,
       placeholder="", help_="", options=None, show_if=None, group="connection"):
    field = {
        "key": key, "label": label, "type": type_, "required": required, "secret": secret,
        "placeholder": placeholder, "help": help_, "group": group,
    }
    if default is not None:
        field["default"] = default
    if options:
        field["options"] = [{"value": v, "label": l} for v, l in options]
    if show_if:
        field["show_if"] = show_if
    return field


def _ssh_fields(*, username_default: str, host_help: str, extra: list | None = None) -> list:
    return [
        _f("host", "Host / public IP", required=True, placeholder="203.0.113.10 or vm.example.com", help_=host_help),
        _f("port", "SSH port", "number", default=22),
        _f("username", "Username", required=True, default=username_default),
        _f("auth_method", "Authentication", "select", default="private_key",
           options=[("private_key", "Private key"), ("password", "Password")]),
        _f("private_key", "Private key (PEM / OpenSSH)", "textarea", secret=True,
           placeholder="-----BEGIN OPENSSH PRIVATE KEY-----", show_if={"auth_method": "private_key"},
           help_="Paste the full key file contents. Stored encrypted, never shown again."),
        _f("passphrase", "Key passphrase", "password", secret=True, show_if={"auth_method": "private_key"}),
        _f("password", "Password", "password", secret=True, show_if={"auth_method": "password"}),
        *(extra or []),
        *_ssh_deploy_fields(),
    ]


def _ssh_deploy_fields() -> list:
    return [
        _f("deploy_path", "Deploy directory", default="~/workflow-deployments", group="deployment",
           help_="Each workflow is unpacked into <deploy directory>/<workflow name>."),
        _f("post_deploy_command", "Default custom command", "textarea", group="deployment",
           placeholder="docker compose -f docker-compose.deploy.yml up -d --build backend",
           help_="Runs inside the workflow directory when the 'custom command' action is chosen."),
        _f("env_vars", "Environment variables", "textarea", secret=True, group="deployment",
           placeholder="MISTRAL_API_KEY=...\nTOOL_SERVICE_URL=http://localhost:9000",
           help_="KEY=VALUE per line, merged into the workflow's .env on every deploy. Stored encrypted."),
    ]


_HTTP_AUTH_FIELDS = [
    _f("auth_type", "Authentication", "select", default="none",
       options=[("none", "None"), ("bearer", "Bearer token"), ("header", "Custom header"), ("basic", "Basic auth")]),
    _f("auth_token", "Token", "password", secret=True, show_if={"auth_type": ["bearer", "header"]}),
    _f("auth_header", "Header name", default="X-API-Key", show_if={"auth_type": "header"}),
    _f("basic_username", "Username", show_if={"auth_type": "basic"}),
    _f("basic_password", "Password", "password", secret=True, show_if={"auth_type": "basic"}),
    _f("verify_tls", "Verify TLS certificate", "select", default="true",
       options=[("true", "Yes"), ("false", "No (self-signed)")]),
]


PROVIDERS: list[dict] = [
    {
        "id": "mcp_code_endpoint",
        "label": "Remote MCP code endpoint",
        "transport": "http",
        "purposes": ["tool"],
        "icon": "code",
        "description": "An HTTP endpoint that accepts POST {name, description, code} and installs the tool.",
        "fields": [
            _f("url", "Endpoint URL", required=True, placeholder="https://mcp.example.com/submit-code",
               help_="The full URL tool code is POSTed to. Health is probed at <origin>/health."),
            _f("health_path", "Health path", default="/health"),
            *_HTTP_AUTH_FIELDS,
        ],
    },
    {
        "id": "ssh",
        "label": "Linux VM / bare metal (SSH)",
        "transport": "ssh",
        "purposes": ["workflow"],
        "icon": "terminal",
        "description": "Any Linux host reachable over SSH — on-prem, a VPS, or any cloud VM.",
        "fields": _ssh_fields(username_default="ubuntu", host_help="DNS name or IP address reachable from this backend."),
    },
    {
        "id": "aws_ec2",
        "label": "AWS EC2 instance",
        "transport": "ssh",
        "purposes": ["workflow"],
        "icon": "cloud",
        "description": "An EC2 instance, deployed to over SSH with its key pair.",
        "fields": _ssh_fields(
            username_default="ubuntu",
            host_help="The instance's Public IPv4 / DNS (EC2 console → Instances). Security group must allow port 22 from this backend.",
            extra=[
                _f("region", "Region", placeholder="us-east-1", group="provider"),
                _f("instance_id", "Instance ID", placeholder="i-0abc123...", group="provider"),
            ],
        ),
        "hints": [
            "Default user: 'ubuntu' for Ubuntu AMIs, 'ec2-user' for Amazon Linux, 'admin' for Debian.",
            "Private key: the .pem file of the key pair chosen at launch.",
        ],
    },
    {
        "id": "gcp_compute",
        "label": "Google Compute Engine VM",
        "transport": "ssh",
        "purposes": ["workflow"],
        "icon": "cloud",
        "description": "A GCE VM, deployed to over SSH with a project or instance SSH key.",
        "fields": _ssh_fields(
            username_default="",
            host_help="External IP from Compute Engine → VM instances. Firewall must allow tcp:22 from this backend.",
            extra=[
                _f("project_id", "Project ID", placeholder="my-project", group="provider"),
                _f("zone", "Zone", placeholder="us-central1-a", group="provider"),
                _f("instance_name", "Instance name", group="provider"),
            ],
        ),
        "hints": [
            "Username is the one attached to the SSH key in the VM's metadata (the part before '@' in the public key comment).",
        ],
    },
    {
        "id": "azure_vm",
        "label": "Azure Virtual Machine",
        "transport": "ssh",
        "purposes": ["workflow"],
        "icon": "cloud",
        "description": "An Azure VM, deployed to over SSH.",
        "fields": _ssh_fields(
            username_default="azureuser",
            host_help="Public IP address from the VM's Overview blade. NSG must allow inbound 22 from this backend.",
            extra=[
                _f("resource_group", "Resource group", group="provider"),
                _f("vm_name", "VM name", group="provider"),
            ],
        ),
    },
    {
        "id": "digitalocean",
        "label": "DigitalOcean Droplet",
        "transport": "ssh",
        "purposes": ["workflow"],
        "icon": "cloud",
        "description": "A Droplet, deployed to over SSH.",
        "fields": _ssh_fields(
            username_default="root",
            host_help="The Droplet's ipv4 address.",
            extra=[_f("droplet_id", "Droplet ID", group="provider")],
        ),
    },
    {
        "id": "brev",
        "label": "NVIDIA Brev instance",
        "transport": "ssh",
        "purposes": ["workflow"],
        "icon": "cloud",
        # Connection details are filled in by provisioning, not by the user.
        "provisioned": True,
        "description": "A running Brev instance. Adding it resolves SSH access with the Brev CLI, "
                       "installs python3-venv and Docker, and checks the connection.",
        "fields": [
            _f("instance_name", "Instance name", required=True, group="provider", placeholder="wf-worker",
               help_="As listed by `brev ls`. The instance must already be RUNNING."),
            _f("brev_token", "Brev token", "password", secret=True, group="provider",
               help_="Optional — for `brev login --token` when the backend host's CLI is not logged in."),
            _f("public_host", "Public IP override", group="provider", placeholder="203.0.113.10",
               help_="Brev's SSH config points at a private 100.x address that only the Brev CLI's "
                     "network reaches. Expose TCP port 22 in the instance's Access tab and enter the "
                     "public IP here; provisioning then uses it instead."),
            _f("public_port", "Public SSH port", "number", group="provider",
               help_="The public port mapped to 22, if not 22."),
            _f("host", "Host / public IP", help_="Filled in by provisioning from `brev refresh`."),
            _f("port", "SSH port", "number", default=22),
            _f("username", "Username", default="ubuntu"),
            _f("private_key", "Private key (PEM / OpenSSH)", "textarea", secret=True,
               help_="Filled in by provisioning from the Brev CLI's key. Stored encrypted."),
            # Set by provisioning from Brev's ssh_config; when present, every
            # connection mints a short-lived certificate instead of using the key.
            _f("brev_env", "Brev environment ID", group="provider",
               help_="Filled in by provisioning. SSH logins then use short-lived Brev certificates."),
            _f("brev_port_id", "Brev port ID", group="provider", help_="Filled in by provisioning."),
            _f("brev_linux_user", "Brev Linux user", group="provider", help_="Filled in by provisioning."),
            *_ssh_deploy_fields(),
        ],
        "hints": [
            "The Brev CLI must be installed and logged in on the machine running this backend "
            "(inside WSL on Windows).",
            "Adding the server provisions it; use Re-provision on its page after the instance "
            "restarts with a new IP.",
        ],
    },
    {
        "id": "http_deploy",
        "label": "HTTP deploy endpoint",
        "transport": "http",
        "purposes": ["workflow"],
        "icon": "webhook",
        "description": "A service (PaaS hook, CI trigger, custom agent) that accepts the package as a multipart upload.",
        "fields": [
            _f("url", "Upload URL", required=True, placeholder="https://deploy.example.com/packages",
               help_="Receives multipart/form-data: file (zip), workflow_name, manifest (JSON), env (JSON)."),
            _f("health_path", "Health path", default="/health"),
            *_HTTP_AUTH_FIELDS,
            _f("env_vars", "Environment variables", "textarea", secret=True, group="deployment",
               placeholder="MISTRAL_API_KEY=...",
               help_="KEY=VALUE per line, sent in the 'env' form field. Stored encrypted."),
        ],
    },
]

PROVIDERS_BY_ID = {p["id"]: p for p in PROVIDERS}


def catalog() -> dict:
    return {"purposes": PURPOSES, "providers": PROVIDERS, "workflow_actions": WORKFLOW_ACTIONS,
            "command_presets": COMMAND_PRESETS}


def get_provider(provider_id: str) -> dict | None:
    return PROVIDERS_BY_ID.get(provider_id)


def secret_keys(provider_id: str) -> set[str]:
    p = PROVIDERS_BY_ID.get(provider_id) or {}
    return {f["key"] for f in p.get("fields", []) if f.get("secret")}
