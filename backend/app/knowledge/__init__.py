"""
Knowledge — short items filed on the catalog, in two kinds.

* **reference** — industry knowledge: what an industry, domain or subdomain
  involves (regulations, standards, rules, metrics, risks, definitions). Read
  while planning by ``IndustryKnowledgeLayer`` and by tool and activity code
  generation, through ``industry`` / ``industry_pipeline``.
* **guidance** — how to build (agent design, agent types, workflow patterns,
  governance). Read by the build pipelines through ``KnowledgeContextLayer``.

    industry    scoped retrieval, ranking and rendering of industry knowledge
    industry_pipeline   the per-run contract layers and code generation use
    industry_ingest     industry documents and structured packs → items
    reference   the seed-and-CRUD surface kept for older callers
"""
