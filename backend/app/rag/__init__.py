"""
Graph RAG — documents in, a knowledge graph out, both retrieved at query time.

The industry-knowledge feature (``app.ontology.knowledge``) answers "what does
this industry involve" from a corpus we wrote by hand. This package answers
"what do *these documents* say" from a corpus the user uploads, and it keeps two
retrieval paths over the same upload:

* the **document library** — Mistral's own semantic search over the file, via
  the built-in ``document_library`` tool, unchanged by anything here;
* the **knowledge graph** — entities and relations extracted from the same
  text, stored in Neo4j and retrieved by matching entities in the query.

The split matters because the two fail differently. Library search is strong on
"what does the contract say about termination" and weak on "which suppliers are
connected to this one and how", which is a traversal, not a similarity match.

Nothing extracted reaches the graph without a human approving it. Extraction
produces a *draft*; the draft is edited in the UI; only ``commit`` writes nodes.
"""
