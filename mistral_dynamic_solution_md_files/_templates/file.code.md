---
source: {{source}}
---
# {{source}}

<!--
HOW TO FILL THIS IN
- The block above (between the docsync markers) is generated. Never edit it; it is rewritten on every sync.
- Everything below is yours. Replace every _TODO_. Write "None" where a heading does not apply — do not delete headings.
- Write for an engineer who has never seen this code base and must rebuild this file so it behaves identically.
- Explain WHY, not only what: the facts block already lists names; your job is meaning, intent and traps.
- When you finish: {{tool}} review {{source}} --note "first description"
-->

## Purpose
_TODO_ One or two sentences: why this file exists, which feature or layer it belongs to, and what breaks without it.

## Responsibilities
_TODO_ Bullet list of what it does, in behavioural terms ("validates X", "streams Y to the client", "retries Z three times").

## Key elements
<!-- One sub-bullet per class / function / component / route that matters. For each: inputs, outputs,
     side effects, invariants, and the non-obvious parts of its algorithm. Skip trivial helpers. -->
_TODO_

## Control flow
<!-- For anything non-trivial: the order things happen in, including async tasks, background jobs,
     callbacks, React effects or render cycles. A numbered list or a small mermaid diagram. -->
_TODO_

## Data, state and side effects
_TODO_ Database tables read/written (and which columns matter), files on disk, caches, in-memory/global state, queues, background tasks, network calls. "None" if pure.

## Configuration
_TODO_ Environment variables, settings fields, feature flags and constants it depends on — what each one changes and its default. "None" if none.

## Interactions
_TODO_ Who calls this (beyond the import list) and what it calls: HTTP endpoints served or consumed, events, external APIs (name the exact model / endpoint / version, timeouts, retries, rate limits), UI pages that use it.

## Error handling and edge cases
_TODO_ What can fail, how it is detected, what the user or caller sees, what is retried, logged or swallowed.

## Nuances and gotchas
_TODO_ Anything a rebuilder would get wrong: ordering requirements, magic numbers and where they came from, library quirks worked around, performance tricks, backwards-compatibility shims, things that look like bugs but are deliberate.

## How to rebuild this file
_TODO_ Steps, pseudo-code or a skeleton detailed enough to recreate it with identical behaviour. Note anything generated, copied from a vendor, or that must match another file exactly (shared types, prompt text, API contracts).

## Tests
_TODO_ Which tests cover this file (paths), and what behaviour is NOT covered. "None" if untested.

## Change log
<!-- newest first: YYYY-MM-DD · source hash · what changed and why. `docsync review --note` adds lines here. -->
