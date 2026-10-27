"""
Vault — encrypted storage for the credentials, service URLs and settings that
tools, activities and connectors need to reach third-party services.

Configured on Settings → Vault. A value is written once and never sent back to
the browser (a non-sensitive value such as a base URL may be shown; a sensitive
one only when revealing is switched on). Generated code never sees the vault:
it lists the names it needs (``secrets`` in its specification) and receives the
values as ``kwargs["_secrets"]`` at the moment it runs.

    crypto    at-rest encryption (Fernet, rotatable master keys)
    models    secrets, their previous versions, and the audit log
    store     CRUD, resolution for a consumer, matching, key rotation
    redact    scrub resolved values out of anything shown or stored
    guard     the optional admin token for writes and reveals
"""
