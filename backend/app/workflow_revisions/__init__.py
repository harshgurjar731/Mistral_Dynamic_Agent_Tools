"""
Workflow revisions — changing a built workflow by saying what should change.

A workflow, planned or hand-built, is rarely right the first time: a step is
missing, one is redundant, a template asks the wrong question, a check sits in
the wrong place. Rather than send the user back to plan from scratch or into
the visual builder, they can instruct a change in words — or pick an edit on a
step — and review exactly what it would do before anything is saved.

The flow is propose → review → apply:

* A **revision** is a proposal: the instruction, the structured edit
  operations it was interpreted as, the definition those produce, its
  validation and a diff against the definition it was based on. Proposing
  never touches the stored workflow.
* **Applying** saves the proposed definition, provided the workflow has not
  changed since the proposal was made (otherwise the diff the user reviewed
  would be a lie), and records a **version** so it can be undone.
* **Versions** are saved states of the definition, recorded on every change
  made through revisions, the visual builder or a restore. Any of them can be
  restored, which itself records a version — nothing is ever lost.

Modules:

* ``models``      — the ``workflow_revisions`` and ``workflow_versions`` tables
* ``store``       — their persistence
* ``operations``  — the edit operations, applied deterministically (no LLM)
* ``diff``        — what changed between two definitions
* ``suggestions`` — revision prompts derived from validation issues

The interpretation of an instruction is an LLM decision and lives with the
other pipeline layers, in ``app.layers.revision``. The service that ties it
together is ``app.services.workflow_revision_service``.
"""
