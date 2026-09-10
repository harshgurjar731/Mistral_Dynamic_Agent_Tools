"""
Synthesis — generating a verified tool from a schema.

Replaces the single 200-line ``synthesize_tool`` function whose six stages
shared a dozen locals and whose two retry loops reached back across three of
them.

    spec.py        typed carriers: CodeSpec, Candidate, Verdict
    model.py       the model call — choice, timeouts, retries
    testdata.py    plausible inputs built from the tool's own schema
    verifiers.py   static analysis and sandbox execution
    pipeline.py    the generate / verify / repair loop
    registry.py    persistence and registration

``app.services.synthesis_service`` remains the public entry point and is now a
thin adapter over this package.
"""

from app.synthesis.pipeline import SynthesisFailed, synthesise
from app.synthesis.spec import Candidate, CodeSpec, Verdict

__all__ = ["synthesise", "SynthesisFailed", "CodeSpec", "Candidate", "Verdict"]
