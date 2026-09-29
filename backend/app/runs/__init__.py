"""
Background runs — long creation pipelines decoupled from the HTTP request.

Planning a workflow, designing an agent and synthesising a tool each take from
tens of seconds to several minutes. Streaming them straight down the request
that started them tied their lifetime to that connection: navigating away
aborted the fetch, and the server cancelled the pipeline half-way through,
sometimes after it had already created agents or activities.

A run here is owned by the process, not the connection:

* ``manager`` starts the pipeline as a task, keeps every event it emits in
  memory, and fans each one out to whoever is currently watching.
* ``store`` writes the same events, in batches, to SQLite — so a client that
  arrives later, or after the live copy has been dropped, can replay them.
* ``runners`` adapts each existing pipeline to a run without changing it.

Only an explicit cancel stops a run.
"""
