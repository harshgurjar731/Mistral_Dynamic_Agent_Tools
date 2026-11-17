"""Files reach every model in a form it takes — measured per model, converted when it cannot.

Live on 2026-11-17: documents (PDF, Word) work on every chat model; images only
on models with `vision`. Only Voxtral (`audio`) listens: other models are handed
Mistral's transcript, so a recording without speech (footsteps on gravel)
reached them as nothing and they answered "I don't see any audio file". The
Conversations API (agent chat) takes no audio at all.
"""

import asyncio
from types import SimpleNamespace

import pytest

from app.services import attachments as A
from app.services import chat_service as cs


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(A, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(A, "_REFUSED", {})
    monkeypatch.setattr(A, "_converted", {})
    cards = {"seeing-model": {"capabilities": {"vision": True}},
             "hearing-model": {"capabilities": {"vision": True, "audio": True}},
             "blind-model": {"capabilities": {"vision": False, "function_calling": True}}}
    monkeypatch.setattr(A, "_card", lambda model: cards.get(model))


def test_kinds_come_from_the_extension():
    assert A.kind_of("call.MP3") == A.AUDIO and A.kind_of("scan.jpeg") == A.IMAGE
    assert A.kind_of("brief.docx") == A.DOCUMENT and A.kind_of("data.csv") == A.TEXT
    assert A.kind_of("noext", "audio/ogg") == A.AUDIO
    assert A.kind_of("tool.exe", "application/x-msdownload") is None


def test_uploads_are_stored_and_ids_cannot_reach_other_paths():
    saved = A.save("notes.txt", b"hello")
    assert saved["kind"] == A.TEXT and A.load(saved["upload_id"]) == b"hello"
    for bad in ("../app/config.py", "x.txt", "", "20261117_120000_zzzzzzzz.txt"):
        with pytest.raises(A.AttachmentError):
            A.load(bad)
    with pytest.raises(A.AttachmentError, match="not a supported file"):
        A.save("tool.exe", b"MZ")
    with pytest.raises(A.AttachmentError, match="empty"):
        A.save("a.png", b"")


def test_what_each_model_and_api_takes():
    assert A.support("hearing-model") == {"image": "native", "audio": "native", "document": "native", "text": "native"}
    # Only a model that listens gets the recording itself; the rest get its words.
    assert A.support("seeing-model")["audio"] == "text"
    assert A.support("blind-model")["image"] == "text"
    # Agent chat (Conversations API) cannot take audio.
    assert A.support("hearing-model", "conversations")["audio"] == "text"
    # A model refusing a kind at run time is remembered.
    kinds = A.refused_kinds(RuntimeError('Status 400. {"message":"Audio input is not enabled for this model"}'))
    assert kinds == {"audio"}
    A.remember_refusal("hearing-model", kinds)
    assert A.support("hearing-model")["audio"] == "text"
    assert A.refused_kinds(RuntimeError("timed out")) == set()


class _Client:
    """Stands in for Mistral's OCR, transcription, and a model that listens."""

    def __init__(self, transcript="The parcel reference is P902."):
        self.calls = []
        self.transcript = transcript
        self.ocr = SimpleNamespace(process=self._ocr)
        self.audio = SimpleNamespace(transcriptions=SimpleNamespace(complete=self._asr))
        self.chat = SimpleNamespace(complete=self._listen)

    def _ocr(self, model, document):
        self.calls.append(("ocr", document["type"]))
        return SimpleNamespace(pages=[SimpleNamespace(markdown="Booking ref BK-3307")])

    def _asr(self, model, file):
        self.calls.append(("asr", file["file_name"]))
        return SimpleNamespace(text=self.transcript)

    def _listen(self, model, messages, **kw):
        self.calls.append(("listen", model))
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(
            content="Footsteps on gravel and birdsong."))])


def _resolve(client, files, model, api="chat"):
    chunks = [{"type": "text", "text": "Q"}] + [{"type": "attachment", **A.save(n, b)} for n, b in files]
    return asyncio.run(A.resolve_content(client, chunks, model, api))


def test_files_go_as_they_are_when_the_model_takes_them():
    client = _Client()
    out = _resolve(client, [("a.png", b"\x89PNG"), ("r.mp3", b"ID3"), ("i.pdf", b"%PDF"), ("s.csv", b"a,b")],
                   "hearing-model")
    assert [c["type"] for c in out] == ["text", "image_url", "text", "input_audio", "document_url", "text"]
    assert out[1]["image_url"].startswith("data:image/png;base64,")
    assert out[2]["text"].startswith("[Attached audio file: \"r.mp3\""), "the recording is named for the model"
    assert out[4]["document_name"] == "i.pdf" and "a,b" in out[5]["text"]
    assert ("ocr", "image_url") not in client.calls and ("ocr", "document_url") not in client.calls


def test_and_as_their_text_when_it_cannot():
    client = _Client()
    out = _resolve(client, [("ticket.png", b"\x89PNG"), ("call.mp3", b"ID3")], "blind-model", "conversations")
    # Text only: sent as one string, which every model and API takes.
    assert isinstance(out, str)
    assert "Booking ref BK-3307" in out and "P902" in out and "Transcript" in out
    assert client.calls == [("ocr", "image_url"), ("asr", "call.mp3")]


def test_a_model_that_does_not_listen_gets_the_words_or_what_the_recording_sounds_like():
    speech = _resolve(_Client(), [("call.mp3", b"ID3")], "seeing-model")
    assert "Transcript" in speech and "P902" in speech
    # Footsteps on gravel: no speech. The model is told so, and what it sounds like.
    client = _Client(transcript="")
    sounds = _resolve(client, [("gravel.mp3", b"ID3")], "seeing-model")
    assert "no speech" in sounds and "Footsteps on gravel" in sounds
    assert ("listen", A.LISTEN_MODEL) in client.calls


def test_a_refused_kind_is_sent_again_as_text():
    client = _Client()
    saved = A.save("call.mp3", b"ID3")
    seen = []

    def stream(**kwargs):
        content = kwargs["messages"][0]["content"]
        seen.append(content)
        if isinstance(content, list) and any(c.get("type") == "input_audio" for c in content):
            raise RuntimeError('Status 400. {"message":"Audio input is not enabled for this model"}')
        yield SimpleNamespace(data=SimpleNamespace(choices=[SimpleNamespace(
            delta=SimpleNamespace(content="P902"), finish_reason="stop")]))

    client.chat = SimpleNamespace(stream=stream, complete=client._listen)

    async def go():
        return [f async for f in cs.stream_chat_completion(client, {
            "model": "hearing-model",
            "messages": [{"role": "user", "content": [{"type": "text", "text": "Ref?"},
                                                       {"type": "attachment", **saved}]}]})]

    frames = asyncio.run(go())
    assert any("event: text_chunk" in f and "P902" in f for f in frames)
    assert any("event: status" in f and "audio" in f for f in frames)
    assert isinstance(seen[1], str) and "P902" in seen[1], "second try carries the transcript"
    assert A.support("hearing-model")["audio"] == "text", "and the model is remembered"


def test_a_workflow_step_gets_the_images_and_recordings_it_reads():
    from app.workflow_inputs import documents

    image = A.save("damage.jpg", b"\xff\xd8")
    pdf_ref = {"$document": {"library_id": "L", "document_id": "d1", "name": "claim.pdf", "mime": "application/pdf",
                             "upload_id": A.save("claim.pdf", b"%PDF")["upload_id"]}}
    img_ref = {"$document": {"library_id": "L", "document_id": "d2", "name": "damage.jpg", "mime": "image/jpeg",
                             "upload_id": image["upload_id"]}}
    variables = {"claim_form": pdf_ref, "photo": img_ref, "other_photo": img_ref}
    step = SimpleNamespace(config={"query_template": "Assess {{photo}} against {{claim_form}}."})
    native = documents.native_attachments(step, variables)
    # The photo the step reads — not the PDF (its text is in the prompt), not an input it does not read.
    assert [a["upload_id"] for a in native] == [image["upload_id"]]
    assert documents.native_attachments(SimpleNamespace(config={"query_template": "No inputs."}), variables) == []
