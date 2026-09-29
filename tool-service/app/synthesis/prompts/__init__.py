"""
Synthesis prompts, split by purpose.

    common.py    sections both profiles share, imports rendered from policy.py
    tool.py      agent tools — tolerant input, self-explanatory output
    activity.py  workflow activities — exact contract, deterministic
    repair.py    targeted repair and fresh-restart messages
    testplan.py  realistic test inputs
    oracle.py    blind recomputation of an example's expected output
"""
