"""
Remote servers — deployment targets for dynamic tools and workflow packages.

- ``providers``: the catalog of server kinds and the fields each one needs.
- ``secrets``:   at-rest encryption for passwords, keys and tokens.
- ``store``:     row <-> dict conversion, validation, secret merging.
- ``checks``:    connection diagnostics (DNS, TCP, TLS, HTTP, SSH, host facts).
- ``deployers``: pushing a tool or a workflow package to a server.
"""
