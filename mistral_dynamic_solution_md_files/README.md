# Replication documentation

This folder holds everything needed to rebuild this project from nothing: what it does, how it is put together, how every file works, and the nuances that are not obvious from the code. It stays accurate because **docsync** notices every code change and flags the descriptions that change affects. It was set up by the **replikit** Claude Code plugin.

Start at [00_INDEX.md](00_INDEX.md).

## Folder layout

```
<docs>/
├── README.md                     how this folder works (this page)
├── 00_INDEX.md                   reading order + live coverage status (generated block)
├── docsync.toml                  which files are documented, how strict checks are
├── 01_overview/                  WHAT is being built
│   ├── 00_detected_stack.md        languages, frameworks, versions, manifests (generated)
│   ├── 01_product_summary.md       purpose, users, scope, which code is live
│   ├── 02_glossary.md              domain terms and code names
│   ├── 03_feature_inventory.md     every feature → page → endpoint → module → how to verify
│   └── 04_user_journeys.md         end-to-end paths, first-run experience
├── 02_architecture/              HOW it fits together
│   ├── 01_system_context.md  02_component_map.md  03_runtime_flows.md
│   ├── 04_data_model.md      05_api_contracts.md  06_design_decisions.md
├── 03_environment/               WHAT a machine needs
│   ├── 01_prerequisites.md  02_dependencies.md  03_configuration.md
│   └── 04_external_services_and_secrets.md
├── 04_build_and_run/             HOW to run it
│   ├── 01_local_setup.md  02_build_and_deploy.md  03_operations.md
├── 05_quality/                   HOW to prove a rebuild matches
│   ├── 01_testing.md  02_acceptance_checklist.md  03_known_issues.md
├── 06_nuances/                   WHAT would otherwise be lost
│   ├── 01_gotchas.md  02_conventions.md  03_ai_models_and_prompts.md (only if an LLM SDK is used)
│   ├── 04_security_and_access.md  05_history.md
├── 07_replication_plan.md        phased rebuild plan with checkpoints
├── files/                        ONE DESCRIPTION PER SOURCE FILE, mirroring the repo tree
│   ├── _DIR.md                     one per folder: sub-folders and files with purpose + status
│   └── <path>.md                   e.g. files/src/app/main.py.md
├── _templates/                   blanks used for new docs (file.code / config / doc / test / asset, directory, section)
└── _tooling/
    ├── docsync.py                  the tool (stdlib Python 3.11+), copied here so CI and the git hook work without the plugin
    ├── manifest.json               cached hashes + import graph (generated - commit it)
    └── stack.json                  detected stack (generated)
```

## Two kinds of document

**Section docs** (`01_` to `07_`) describe the system as a whole. Each lists the files it describes in its front matter:

```yaml
---
kind: section
covers:
  - "src/api/**"
---
```

When any covered file changes after the section was last reviewed, the section is marked **STALE**. A section with an empty `covers:` (glossary, history, design decisions, plan) is never marked stale. It is only TODO until written. `init` dropped the default globs that matched nothing in this repo. Adjust them freely.

**File docs** (`files/<path>.md`) describe one source file each:

| Part | Written by | Contents |
|---|---|---|
| Front matter | docsync | `source`, `kind`, `status`, `source_hash`, `reviewed_hash`, `reviewed_on`, `narrative_hash` |
| Facts block (between `docsync:auto` markers) | docsync, every run | status, size, hash, classes/functions/exports, routes, DB tables, env vars, endpoints called, internal imports, external packages, imported-by |
| Narrative (everything else) | a person or Claude | purpose, responsibilities, key elements, control flow, data and side effects, configuration, interactions, errors, nuances and gotchas, how to rebuild it, tests, change log |

## Status of a description

| Status | Meaning | Becomes current when |
|---|---|---|
| `todo` | never written | every `_TODO_` is filled and `review` is run |
| `stale` | source changed since the last review | narrative updated (or confirmed with `--unchanged`) and reviewed |
| `current` | reviewed against the exact source content now in the repo | - |
| `orphaned` | source file deleted or renamed | doc moved to the new path, or removed with `sync --prune` |

## How descriptions stay in step with the code

1. **Claude Code hook** (from the replikit plugin, active in every repo that has this folder). After every file edit Claude makes, the file's facts block is refreshed at once. If the narrative is now stale or missing, Claude is told to update it and which sections cover the file.
2. **Git pre-commit hook** (installed by `init`). It catches edits made by people or other tools: it runs `sync`, stages the refreshed docs, and blocks the commit if a staged file's description is stale. Files never described only produce a warning.
3. **CI** can run `python <docs>/_tooling/docsync.py check` to fail a build on stale docs.

## Commands

| With the plugin (in Claude Code) | Shell |
|---|---|
| `/replikit:setup` | `python <docs>/_tooling/docsync.py init` (plugin copy only) |
| `/replikit:document [folder]` | write descriptions, then `... review <path> --note "..."` |
| `/replikit:export [spec\|exact]` | `... export --mode exact` |
| `/replikit:rebuild <bundle>` | `... unpack <bundle> --into .` then `... verify <bundle> --root .` |
| - | `... sync [--prune]` · `... status [--all]` · `... check [--staged]` |

## Replicating the project

`export` writes one self-contained Markdown bundle (split into parts above 20 MB):

| Mode | Contains | Rebuild result |
|---|---|---|
| `spec` | every section and file description, repo layout, hash manifest, the tool | Claude rewrites the code from the descriptions: same behaviour, not identical bytes. Only as good as the descriptions. |
| `exact` | the above plus every file verbatim (text as text, binaries base64) | `unpack` recreates every file byte for byte, checked by SHA-256. Claude then sets up the environment and runs the checks. |

Secrets are never put in a bundle. Files whose names or contents look like credentials are listed as *withheld*, and the rebuilder must supply them. Override this per file with `--allow-secret <path>`.

## Rules for writers (people and Claude)

1. Never edit inside the `docsync:auto` markers. It is overwritten.
2. Do not delete headings. Write `None` or `n/a` when one does not apply, so a reader knows it was considered.
3. Write for someone rebuilding the file from scratch: explain intent, ordering, magic values and workarounds, not only names.
4. Never paste secret values. Name the secret and say how to obtain one.
5. Make the first line under `## Purpose` a one-sentence summary. The folder tables show it.
6. When a change affects behaviour described in a section doc, update the section in the same change.
7. Renamed a file? Move its doc to `files/<new path>.md`, then run `sync`.
