"""
Cloud provider APIs for provider accounts — list VMs, start one, say who we are.

Plain REST over httpx with the signing done here (AWS SigV4, a GCP
service-account JWT, Azure client credentials, a DigitalOcean token), so
the image needs no cloud SDKs. Blocking — call via ``asyncio.to_thread``.

Every adapter returns instances in one shape:
    {ref, name, state, public_ip, private_ip, location, config}
``ref`` identifies the instance to ``start``; ``config`` holds the server
fields it fills in (host, username, the provider's instance identifiers).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import quote

import httpx

TIMEOUT = 20


class CloudError(RuntimeError):
    pass


def _http(method: str, url: str, **kw) -> httpx.Response:
    try:
        r = httpx.request(method, url, timeout=TIMEOUT, **kw)
    except httpx.HTTPError as e:
        raise CloudError(f"{method} {url.split('?')[0]} failed: {e}") from e
    return r


def _json_error(r: httpx.Response) -> str:
    try:
        body = r.json()
    except ValueError:
        return r.text[:300]
    err = body.get("error") if isinstance(body, dict) else None
    if isinstance(err, dict):
        return err.get("message") or json.dumps(err)[:300]
    return (body.get("message") or body.get("error_description") or err or json.dumps(body))[:300]


def _require(values: dict, *keys: str) -> None:
    missing = [k for k in keys if not str(values.get(k) or "").strip()]
    if missing:
        raise CloudError(f"Missing: {', '.join(missing)}")


def _instance(ref, name, state, public_ip, private_ip, location, config) -> dict:
    if public_ip:
        config = {"host": public_ip, **config}
    return {"ref": str(ref), "name": name, "state": (state or "UNKNOWN").upper(),
            "public_ip": public_ip or "", "private_ip": private_ip or "",
            "location": location or "", "config": config}


# ── AWS EC2 (Query API, SigV4) ───────────────────────────────────────────

def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def _aws_get(creds: dict, service: str, region: str, host: str, params: dict) -> ET.Element:
    now = datetime.now(timezone.utc)
    amz_date, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    query = "&".join(f"{quote(k, safe='-_.~')}={quote(str(v), safe='-_.~')}"
                     for k, v in sorted(params.items()))
    headers = {"host": host, "x-amz-date": amz_date}
    if creds.get("session_token"):
        headers["x-amz-security-token"] = creds["session_token"]
    signed = ";".join(sorted(headers))
    canonical = "\n".join(["GET", "/", query, "".join(f"{k}:{headers[k]}\n" for k in sorted(headers)),
                           signed, hashlib.sha256(b"").hexdigest()])
    scope = f"{day}/{region}/{service}/aws4_request"
    to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])
    key = _sign(_sign(_sign(_sign(("AWS4" + creds["secret_access_key"]).encode(), day), region), service),
                "aws4_request")
    signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
    headers["Authorization"] = (f"AWS4-HMAC-SHA256 Credential={creds['access_key_id']}/{scope}, "
                                f"SignedHeaders={signed}, Signature={signature}")
    r = _http("GET", f"https://{host}/?{query}", headers=headers)
    try:
        root = ET.fromstring(r.content)
    except ET.ParseError as e:
        raise CloudError(f"AWS returned HTTP {r.status_code}: {r.text[:300]}") from e
    for el in root.iter():  # drop namespaces: find() then works with plain tags
        el.tag = el.tag.rsplit("}", 1)[-1]
    if r.status_code >= 400:
        code, msg = root.findtext(".//Code") or r.status_code, root.findtext(".//Message") or ""
        raise CloudError(f"AWS {code}: {msg}")
    return root


class AWS:
    match = ["instance_id"]

    @staticmethod
    def creds(values: dict) -> dict:
        _require(values, "access_key_id", "secret_access_key")
        regions = [r.strip() for r in str(values.get("regions") or "us-east-1").split(",") if r.strip()]
        return {"access_key_id": values["access_key_id"].strip(),
                "secret_access_key": values["secret_access_key"].strip(),
                "session_token": (values.get("session_token") or "").strip(),
                "regions": ",".join(regions)}

    @staticmethod
    def identity(c: dict) -> str:
        root = _aws_get(c, "sts", "us-east-1", "sts.amazonaws.com",
                        {"Action": "GetCallerIdentity", "Version": "2011-06-15"})
        return f"{root.findtext('.//Arn')} (account {root.findtext('.//Account')})"

    @staticmethod
    def instances(c: dict) -> list[dict]:
        out = []
        for region in c["regions"].split(","):
            token = None
            while True:
                params = {"Action": "DescribeInstances", "Version": "2016-11-15", "MaxResults": "200"}
                if token:
                    params["NextToken"] = token
                root = _aws_get(c, "ec2", region, f"ec2.{region}.amazonaws.com", params)
                for item in root.findall("./reservationSet/item/instancesSet/item"):
                    iid = item.findtext("instanceId")
                    name = next((t.findtext("value") for t in item.findall("./tagSet/item")
                                 if t.findtext("key") == "Name"), None) or iid
                    out.append(_instance(f"{region}/{iid}", name, item.findtext("./instanceState/name"),
                                         item.findtext("ipAddress") or item.findtext("dnsName"),
                                         item.findtext("privateIpAddress"), region,
                                         {"region": region, "instance_id": iid}))
                token = root.findtext("nextToken")
                if not token:
                    break
        return out

    @staticmethod
    def start(c: dict, ref: str) -> None:
        region, iid = ref.split("/", 1)
        _aws_get(c, "ec2", region, f"ec2.{region}.amazonaws.com",
                 {"Action": "StartInstances", "Version": "2016-11-15", "InstanceId.1": iid})


# ── Google Compute Engine (service-account JWT) ──────────────────────────

def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


class GCP:
    match = ["instance_name", "zone"]
    API = "https://compute.googleapis.com/compute/v1"

    @staticmethod
    def creds(values: dict) -> dict:
        _require(values, "service_account_json")
        try:
            sa = json.loads(values["service_account_json"])
        except ValueError as e:
            raise CloudError("Service account key is not valid JSON") from e
        for k in ("client_email", "private_key"):
            if not sa.get(k):
                raise CloudError(f"Service account key has no '{k}' — download a JSON key for the account")
        project = (values.get("project_id") or "").strip() or sa.get("project_id")
        if not project:
            raise CloudError("Project ID is required")
        return {"service_account_json": values["service_account_json"], "project_id": project}

    @staticmethod
    def _token(c: dict) -> str:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding

        sa = json.loads(c["service_account_json"])
        token_uri = sa.get("token_uri") or "https://oauth2.googleapis.com/token"
        now = int(time.time())
        head = _b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
        claims = _b64(json.dumps({"iss": sa["client_email"], "aud": token_uri, "iat": now, "exp": now + 3600,
                                  "scope": "https://www.googleapis.com/auth/compute"}).encode())
        key = serialization.load_pem_private_key(sa["private_key"].encode(), password=None)
        sig = key.sign(f"{head}.{claims}".encode(), padding.PKCS1v15(), hashes.SHA256())
        r = _http("POST", token_uri, data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                                           "assertion": f"{head}.{claims}.{_b64(sig)}"})
        if r.status_code >= 400:
            raise CloudError(f"Google sign-in failed: {_json_error(r)}")
        return r.json()["access_token"]

    @classmethod
    def _get(cls, c: dict, path: str, token: str, **params) -> dict:
        r = _http("GET", f"{cls.API}{path}", params=params, headers={"Authorization": f"Bearer {token}"})
        if r.status_code >= 400:
            raise CloudError(f"Google Compute: {_json_error(r)}")
        return r.json()

    @classmethod
    def identity(cls, c: dict) -> str:
        token = cls._token(c)
        cls._get(c, f"/projects/{c['project_id']}", token)
        return f"{json.loads(c['service_account_json'])['client_email']} · project {c['project_id']}"

    @classmethod
    def instances(cls, c: dict) -> list[dict]:
        token, out, page = cls._token(c), [], None
        while True:
            params = {"pageToken": page} if page else {}
            body = cls._get(c, f"/projects/{c['project_id']}/aggregated/instances", token, **params)
            for scope in (body.get("items") or {}).values():
                for vm in scope.get("instances") or []:
                    zone = vm["zone"].rsplit("/", 1)[-1]
                    nic = (vm.get("networkInterfaces") or [{}])[0]
                    nat = next((a.get("natIP") for a in nic.get("accessConfigs") or [] if a.get("natIP")), None)
                    out.append(_instance(f"{zone}/{vm['name']}", vm["name"], vm.get("status"), nat,
                                         nic.get("networkIP"), zone,
                                         {"project_id": c["project_id"], "zone": zone,
                                          "instance_name": vm["name"]}))
            page = body.get("nextPageToken")
            if not page:
                return out

    @classmethod
    def start(cls, c: dict, ref: str) -> None:
        zone, name = ref.split("/", 1)
        r = _http("POST", f"{cls.API}/projects/{c['project_id']}/zones/{zone}/instances/{name}/start",
                  headers={"Authorization": f"Bearer {cls._token(c)}"})
        if r.status_code >= 400:
            raise CloudError(f"Google Compute: {_json_error(r)}")


# ── Azure (service principal, ARM REST) ──────────────────────────────────

class Azure:
    match = ["vm_name", "resource_group"]
    ARM = "https://management.azure.com"

    @staticmethod
    def creds(values: dict) -> dict:
        _require(values, "tenant_id", "client_id", "client_secret", "subscription_id")
        return {k: values[k].strip() for k in ("tenant_id", "client_id", "client_secret", "subscription_id")}

    @staticmethod
    def _token(c: dict) -> str:
        r = _http("POST", f"https://login.microsoftonline.com/{c['tenant_id']}/oauth2/v2.0/token",
                  data={"grant_type": "client_credentials", "client_id": c["client_id"],
                        "client_secret": c["client_secret"], "scope": "https://management.azure.com/.default"})
        if r.status_code >= 400:
            raise CloudError(f"Azure sign-in failed: {_json_error(r)}")
        return r.json()["access_token"]

    @classmethod
    def _list(cls, path: str, token: str, api: str, **params) -> list[dict]:
        url, items = f"{cls.ARM}{path}", []
        query = {"api-version": api, **params}
        while url:
            r = _http("GET", url, params=query, headers={"Authorization": f"Bearer {token}"})
            if r.status_code >= 400:
                raise CloudError(f"Azure: {_json_error(r)}")
            body = r.json()
            items += body.get("value") or []
            url, query = body.get("nextLink"), None  # nextLink carries its own query
        return items

    @classmethod
    def identity(cls, c: dict) -> str:
        token = cls._token(c)
        r = _http("GET", f"{cls.ARM}/subscriptions/{c['subscription_id']}",
                  params={"api-version": "2022-12-01"}, headers={"Authorization": f"Bearer {token}"})
        if r.status_code >= 400:
            raise CloudError(f"Azure: {_json_error(r)}")
        return f"subscription {r.json().get('displayName') or c['subscription_id']}"

    @classmethod
    def instances(cls, c: dict) -> list[dict]:
        token, sub = cls._token(c), f"/subscriptions/{c['subscription_id']}"
        vms = cls._list(f"{sub}/providers/Microsoft.Compute/virtualMachines", token, "2023-09-01")
        try:
            states = {v["id"].lower(): v for v in cls._list(
                f"{sub}/providers/Microsoft.Compute/virtualMachines", token, "2023-09-01", statusOnly="true")}
        except CloudError:
            states = {}
        nics = {n["id"].lower(): n for n in cls._list(
            f"{sub}/providers/Microsoft.Network/networkInterfaces", token, "2023-09-01")}
        pips = {p["id"].lower(): p for p in cls._list(
            f"{sub}/providers/Microsoft.Network/publicIPAddresses", token, "2023-09-01")}

        out = []
        for vm in vms:
            props = vm.get("properties") or {}
            statuses = (((states.get(vm["id"].lower()) or {}).get("properties") or {})
                        .get("instanceView") or {}).get("statuses") or []
            power = next((s["code"].split("/", 1)[1] for s in statuses
                          if s.get("code", "").startswith("PowerState/")), "unknown")
            public_ip = private_ip = None
            for ref in (props.get("networkProfile") or {}).get("networkInterfaces") or []:
                nic = nics.get(ref["id"].lower()) or {}
                for ipc in (nic.get("properties") or {}).get("ipConfigurations") or []:
                    ip_props = ipc.get("properties") or {}
                    private_ip = private_ip or ip_props.get("privateIPAddress")
                    pip_id = ((ip_props.get("publicIPAddress") or {}).get("id") or "").lower()
                    public_ip = public_ip or ((pips.get(pip_id) or {}).get("properties") or {}).get("ipAddress")
            group = vm["id"].split("/resourceGroups/", 1)[1].split("/", 1)[0]
            config = {"resource_group": group, "vm_name": vm["name"]}
            admin = (props.get("osProfile") or {}).get("adminUsername")
            if admin:
                config["username"] = admin
            out.append(_instance(vm["id"], vm["name"], power, public_ip, private_ip, vm.get("location"), config))
        return out

    @classmethod
    def start(cls, c: dict, ref: str) -> None:
        r = _http("POST", f"{cls.ARM}{ref}/start", params={"api-version": "2023-09-01"},
                  headers={"Authorization": f"Bearer {cls._token(c)}"})
        if r.status_code >= 400:
            raise CloudError(f"Azure: {_json_error(r)}")


# ── DigitalOcean (API token) ─────────────────────────────────────────────

class DigitalOcean:
    match = ["droplet_id"]
    API = "https://api.digitalocean.com/v2"

    @staticmethod
    def creds(values: dict) -> dict:
        _require(values, "token")
        return {"token": values["token"].strip()}

    @classmethod
    def _call(cls, c: dict, method: str, url: str, **kw) -> dict:
        r = _http(method, url if url.startswith("http") else f"{cls.API}{url}",
                  headers={"Authorization": f"Bearer {c['token']}"}, **kw)
        if r.status_code >= 400:
            raise CloudError(f"DigitalOcean: {_json_error(r)}")
        return r.json() if r.content else {}

    @classmethod
    def identity(cls, c: dict) -> str:
        return cls._call(c, "GET", "/account")["account"].get("email") or "DigitalOcean account"

    @classmethod
    def instances(cls, c: dict) -> list[dict]:
        out, url = [], "/droplets?per_page=200"
        while url:
            body = cls._call(c, "GET", url)
            for d in body.get("droplets") or []:
                v4 = (d.get("networks") or {}).get("v4") or []
                ip = lambda kind: next((n["ip_address"] for n in v4 if n.get("type") == kind), None)  # noqa: E731
                out.append(_instance(d["id"], d["name"], d.get("status"), ip("public"), ip("private"),
                                     (d.get("region") or {}).get("slug"), {"droplet_id": str(d["id"])}))
            url = ((body.get("links") or {}).get("pages") or {}).get("next")
        return out

    @classmethod
    def start(cls, c: dict, ref: str) -> None:
        cls._call(c, "POST", f"/droplets/{ref}/actions", json={"type": "power_on"})


ADAPTERS = {"aws_ec2": AWS, "gcp_compute": GCP, "azure_vm": Azure, "digitalocean": DigitalOcean}
