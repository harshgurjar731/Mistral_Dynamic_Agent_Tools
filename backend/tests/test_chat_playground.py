"""The playground chat on every model, including the reasoning ones.

Reasoning models (mistral-large-latest / -4, magistral-*, glm-5) send content
as a list of "thinking" and "text" chunks. The stream handler added that list
to a string, failed, and left the reply empty; the next turn sent the empty
reply back and Mistral refused the request: "Assistant message must have
either content or tool_calls, but not none."
"""

import asyncio
from types import SimpleNamespace

from app.services import chat_service as cs


def _thinking(text):
    return SimpleNamespace(type="thinking", thinking=[SimpleNamespace(type="text", text=text)])


def _text(text):
    return SimpleNamespace(type="text", text=text)


def test_content_is_split_into_answer_and_thinking():
    assert cs.split_content("plain") == ("plain", "")
    assert cs.split_content([_thinking("let me see"), _text("Red")]) == ("Red", "let me see")
    assert cs.split_content([{"type": "thinking", "thinking": [{"type": "text", "text": "hm"}]},
                             {"type": "text", "text": "Blue"}]) == ("Blue", "hm")
    assert cs.split_content(None) == ("", "")


def test_history_never_carries_an_empty_assistant_message():
    cleaned = cs.clean_history([
        {"role": "user", "content": "Hi"},
        {"role": "assistant", "content": ""},                       # a reply that failed
        {"role": "user", "content": "Name a colour"},
        {"role": "assistant", "content": [_thinking("..."), _text("Red")]},
        {"role": "user", "content": [{"type": "image_url", "image_url": {"url": "data:x"}}]},
        {"role": "user", "content": "   "},
    ])
    assert cleaned == [
        {"role": "user", "content": "Hi"},
        {"role": "user", "content": "Name a colour"},
        {"role": "assistant", "content": "Red"},                     # its answer only, never its thinking
        {"role": "user", "content": [{"type": "image_url", "image_url": {"url": "data:x"}}]},
    ]
    # An assistant turn that only called tools keeps its calls.
    calls = [{"id": "c1", "type": "function", "function": {"name": "f", "arguments": "{}"}}]
    assert cs.clean_history([{"role": "assistant", "content": None, "tool_calls": calls}]) == [
        {"role": "assistant", "tool_calls": calls}]


def test_greedy_sampling_drops_top_p():
    kwargs = {}
    cs._sampling({"temperature": 0, "top_p": 0.9}, kwargs)
    assert kwargs == {"temperature": 0}
    kwargs = {}
    cs._sampling({"temperature": 0.7, "top_p": 0.9}, kwargs)
    assert kwargs == {"temperature": 0.7, "top_p": 0.9}


def _stream_client(deltas, seen):
    def stream(**kwargs):
        seen.update(kwargs)
        for content, finish in deltas:
            choice = SimpleNamespace(delta=SimpleNamespace(content=content), finish_reason=finish)
            yield SimpleNamespace(data=SimpleNamespace(choices=[choice]))

    return SimpleNamespace(chat=SimpleNamespace(stream=stream))


def _events(client, data):
    async def go():
        return [frame async for frame in cs.stream_chat_completion(client, data)]

    out = []
    for frame in asyncio.run(go()):
        lines = frame.splitlines()
        event = next(l[6:].strip() for l in lines if l.startswith("event:"))
        data_ = "\n".join(l[5:].lstrip() for l in lines if l.startswith("data:"))
        out.append((event, data_))
    return out


def test_a_reasoning_model_streams_its_thinking_and_its_answer():
    seen = {}
    client = _stream_client([([_thinking("primary colours are")], None), ([_text("Red")], "stop")], seen)
    events = _events(client, {"model": "mistral-large-latest", "temperature": 0.7, "top_p": 1.0,
                              "messages": [{"role": "user", "content": "Hi"},
                                           {"role": "assistant", "content": ""},
                                           {"role": "user", "content": "A colour?"}]})
    assert events == [("thinking_chunk", "primary colours are"), ("text_chunk", "Red"), ("done", "{}")]
    assert [m["role"] for m in seen["messages"]] == ["user", "user"], "the empty reply is not sent"


def test_a_stream_with_no_answer_is_an_error_not_an_empty_reply():
    client = _stream_client([([_thinking("still thinking")], "length")], {})
    events = _events(client, {"model": "mistral-large-latest",
                              "messages": [{"role": "user", "content": "Hi"}]})
    assert events[-1][0] == "error" and "token budget" in events[-1][1]

    def boom(**kwargs):
        raise RuntimeError('API error occurred: Status 400. Body: {"object":"error","message":'
                           '"Assistant message must have either content or tool_calls","type":"x"}')

    events = _events(SimpleNamespace(chat=SimpleNamespace(stream=boom)),
                     {"model": "m", "messages": [{"role": "user", "content": "Hi"}]})
    assert events == [("error", "Assistant message must have either content or tool_calls (400)")]
