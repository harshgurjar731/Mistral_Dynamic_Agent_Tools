"""
Rules — what agents and workflows must follow, configured on the Rules page.

Two separate families:

* **Agent rules** govern one agent: its configuration when it is created, and
  every message, tool call and answer after that.
* **Workflow rules** govern a whole workflow: its structure when it is saved
  or published, and each step while it runs.

Modules:

* ``catalog``  — the rule types, their forms and where they are enforced
* ``models``   — the tables
* ``store``    — CRUD, selections, effective rules, rule events
* ``engine``   — the checks (pure functions)
* ``apply``    — the creation gate every agent-creation path calls
* ``runtime``  — the rules in force for the running agent / workflow
* ``select``   — the LLM selection shared by both pipelines and "Suggest"
* ``seed``     — the recommended starter set
"""
