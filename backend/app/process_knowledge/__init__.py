"""
Process knowledge — business-process documents that ground agent and workflow
design.

    templates   the JSON Schema documents must follow (built-in + uploaded)
    validation  the one checker every ingestion point calls
    store       documents, versions and usage
    resolver    which documents a build uses (uploaded, or matched by scope)
    context     those documents shaped into a view per pipeline layer
    pipeline    the contract layers go through — a no-op when the feature is off
    ai          fix a document, or draft one from prose (never saves)

Processes and subprocesses are concepts in the ontology's ``process`` scheme,
each linked to its domain; see ``app.ontology.store.link_concepts``.
"""
