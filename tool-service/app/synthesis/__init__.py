"""
Synthesis — generating verified tools and activities from a specification.

    spec.py            SynthesisSpec v2, Verdict (with fault class), Candidate
    policy.py          allowed/forbidden imports and builtins — prompt AND verifier
    profiles/          tool vs activity: spec rules, tests, prompts, review, runtime
    prompts/           prompt text per purpose, repair, test plan, oracle
    testplan.py        cases paired with expectations (success / envelope / error)
    sandbox.py         launches sandbox_runner.py in a limited subprocess
    sandbox_runner.py  the fixed runner — structured per-case results
    verifiers.py       the verification ladder V1–V6
    layers/            the pipeline layers G1–G10
    pipeline.py        the assembled pipeline
    registry.py        atomic, versioned registration and loading
    jobs.py            asynchronous jobs, in-flight de-duplication, progress

Model calls go through ``app.llm`` by role; see ``app/llm/routes.py``.
"""

from app.synthesis.spec import Candidate, CodeSpec, SynthesisSpec, Verdict

__all__ = ["SynthesisSpec", "CodeSpec", "Candidate", "Verdict"]
