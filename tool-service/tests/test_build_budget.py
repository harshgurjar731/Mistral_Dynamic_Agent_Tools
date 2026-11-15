"""A failed first attempt always gets its repair, and a failure says what differed.

"Output Safety and Delivery" failed "after 1 attempt(s) (last stage:
example_mismatch)": one slow code-model call used the job's whole time budget,
so no repair ran, and the message showed only the tail of an input dump.
"""

import time

import pytest

from app import llm
from app.synthesis.layers.base import SynthesisContext
from app.synthesis.layers.build import BuildLoopLayer
from app.synthesis.profiles import get_profile
from app.synthesis.verifiers import values_match
from tests.samples import GOOD_GST, WRONG_RATE_GST, gst_spec


def _ctx(deadline_in: float):
    spec = gst_spec()
    profile = get_profile(spec.purpose)
    ctx = SynthesisContext(spec=spec, profile=profile, session_factory=None)
    ctx.plan = profile.build_test_plan(spec, [])
    ctx.deadline = time.monotonic() + deadline_in
    return ctx


def _model(monkeypatch, answers):
    calls = []

    def complete(role, messages):
        calls.append(role)
        return answers[min(len(calls), len(answers)) - 1], "test-model"

    monkeypatch.setattr(llm, "complete", complete)
    return calls


def test_the_first_failure_gets_its_repair_even_past_the_deadline(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "ORACLE_ARBITRATION", False)
    calls = _model(monkeypatch, [WRONG_RATE_GST, GOOD_GST])
    ctx = _ctx(deadline_in=-1)  # the budget is already used up
    out = BuildLoopLayer().process(ctx, lambda c: c)
    assert calls == ["codegen", "repair"]
    assert out.verdict is not None and out.verdict.ok


def test_out_of_time_failure_says_so_and_leads_with_what_differed(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "ORACLE_ARBITRATION", False)
    monkeypatch.setattr(settings, "TOOL_SYNTHESIS_MAX_ATTEMPTS", 4)
    calls = _model(monkeypatch, [WRONG_RATE_GST])
    ctx = _ctx(deadline_in=-1)
    BuildLoopLayer().process(ctx, lambda c: c)
    assert len(calls) == 2, "two attempts, then the time budget stops it"
    message = ctx.result["message"]
    assert "after 2 attempt(s)" in message and "time budget was used up" in message
    assert "Failing: example_" in message
    assert message.index("Failing:") < 200


@pytest.mark.parametrize("expected,actual,ok", [
    ("Dear customer, your claim has been approved today.", "Your claim was approved.", True),
    ("Dear customer, your claim has been approved today.", "", False),
    ("approved", "declined", False),
    ("high risk", "low risk", False),
])
def test_composed_text_is_not_compared_word_for_word(expected, actual, ok):
    assert (values_match(expected, actual) is None) is ok
