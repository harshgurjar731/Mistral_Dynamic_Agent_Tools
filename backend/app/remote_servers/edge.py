"""
Recognising a request blocked by an edge proxy rather than by the server.

A host behind Cloudflare with bot protection (Bot Fight Mode, "Under Attack",
or a WAF managed-challenge rule) answers a script's request with HTTP 403 and
an HTML "Just a moment..." page that only a browser can pass. The request never
reaches the service, so reporting it as "credentials rejected" sends people to
fix an API key that was never checked.
"""

from __future__ import annotations

from typing import Optional

import httpx

_CHALLENGE_MARKERS = ("_cf_chl_opt", "challenge-platform", "cf-browser-verification",
                      "<title>Just a moment...</title>", "Attention Required! | Cloudflare")

EDGE_BLOCK_ADVICE = (
    "Cloudflare's bot protection answered with a browser challenge, so the request never "
    "reached the service — no credentials were checked. Let the backend through on this "
    "host: add a WAF custom rule that skips bot/challenge checks for the deploy and health "
    "paths (or for the backend's IP), or turn off Bot Fight Mode / Under Attack mode for "
    "it; if the host uses Cloudflare Access, give the backend a service token and send "
    "CF-Access-Client-Id / CF-Access-Client-Secret as custom headers."
)


def edge_block(resp: httpx.Response) -> Optional[str]:
    """A short description when ``resp`` is an edge-proxy challenge, else None."""
    if resp.status_code not in (403, 429, 503):
        return None
    mitigated = resp.headers.get("cf-mitigated", "").lower()
    server = resp.headers.get("server", "").lower()
    try:
        head = resp.text[:6000]
    except Exception:  # noqa: BLE001 — undecodable body: rely on headers
        head = ""
    if mitigated == "challenge" or ("cloudflare" in server and any(m in head for m in _CHALLENGE_MARKERS)):
        ray = resp.headers.get("cf-ray", "")
        return f"HTTP {resp.status_code} — blocked by Cloudflare bot protection" + (f" (ray {ray})" if ray else "")
    return None
