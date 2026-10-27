"""
Build prerequisites — what a build needs from its user, settled before it starts.

A workflow or agent that discovers only once it is built that it needed an API
key nobody has, a company-specific service URL, or a business rule only the
user knows, is a wasted build. So before anything is built:

1. **Analyse** (one decision): which credentials, service URLs, account
   settings and facts the work needs from the user (``analysis``).
2. **Match** each against the vault, using a certain match automatically
   (``resolve``).
3. **Ask** about the rest (``ask``): for each item the user picks a vault
   entry (or adds one, which stores it encrypted), types a fact, or says to
   proceed without that service — and what to do instead. Or they stop the
   build before anything is created.
4. **Apply**: every later decision and every specification sees what was
   settled (``guidance``) — the exact vault names the code must read, the
   services it must not use, the facts it can rely on.

The code pipeline checks again after a specification is written
(``CredentialCheckLayer``, R4b), for a credential the first pass missed.

Values never travel through this package: an answer names a vault entry, and
the code receives the value only when it runs.

    models     PrereqItem and the settled list
    analysis   the decision prompt and its parsing
    resolve    vault matching and automatic resolution
    ask        the question, and validating its answer
    guidance   what later prompts and specifications are told
    layer      BuildPrerequisitesLayer, for both pipelines
"""
