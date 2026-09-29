"""A Cloudflare browser challenge is reported as such, not as bad credentials."""

import httpx

from app.remote_servers.edge import edge_block

CHALLENGE = "<html><head><title>Just a moment...</title></head><script>window._cf_chl_opt={}</script></html>"


def test_cloudflare_challenge_is_recognised():
    resp = httpx.Response(403, text=CHALLENGE, headers={"server": "cloudflare", "cf-ray": "abc-BOM"})
    assert "Cloudflare bot protection" in edge_block(resp) and "abc-BOM" in edge_block(resp)
    assert edge_block(httpx.Response(403, headers={"cf-mitigated": "challenge"}))


def test_a_real_auth_failure_is_not_mistaken_for_one():
    assert edge_block(httpx.Response(403, json={"detail": "bad api key"})) is None
    assert edge_block(httpx.Response(401, text=CHALLENGE, headers={"server": "cloudflare"})) is None
    assert edge_block(httpx.Response(200, text="ok")) is None
