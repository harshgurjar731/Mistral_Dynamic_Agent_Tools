"""
Sandbox runner — executed as a separate process, never imported by the service.

Replaces the harness that used to be string-appended to the candidate's source.
That harness reported failure as a traceback on stderr, and the service then
guessed from the traceback's text whether the fault was the code's or its own —
a guess that classed every module-level error (an unavailable import, a typo at
top level) as a harness failure and abandoned synthesis instead of repairing.

Here the runner *knows* which phase failed and says so, as JSON:

    {"phase": "import", "ok": false, "error": "...", "traceback": "..."}
    {"phase": "cases",  "ok": true,  "results": [{...}, ...]}

Anything else — no marker line at all — means the runner itself broke, and
only that is the harness's fault.

Protocol: one JSON object on stdin (see ``_main``); the result is printed on a
single stdout line prefixed with ``MARKER``. Output the tool prints is captured
per case so it cannot corrupt the protocol. Progress (``@@case <id>``) goes to
stderr so a timeout can be attributed to the case that hung.

Standard library only: this file runs with nothing from the service on its path.
"""

import copy
import importlib.util
import io
import json
import sys
import traceback
import types
from contextlib import redirect_stdout

MARKER = "@@SANDBOX_RESULT@@"


# ── Resource limits and network ───────────────────────────────────────────


def _apply_limits(memory_mb, cpu_seconds):
    try:
        import resource  # POSIX only
    except ImportError:
        return
    try:
        if memory_mb:
            limit = int(memory_mb) * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
        if cpu_seconds:
            resource.setrlimit(resource.RLIMIT_CPU, (int(cpu_seconds), int(cpu_seconds) + 1))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    except (ValueError, OSError):
        pass


def _block_network():
    import socket

    def _refuse(*_a, **_k):
        raise OSError("network access is disabled in the sandbox for pure code")

    class _NoSocket(socket.socket):
        def __init__(self, *a, **k):
            _refuse()

    socket.socket = _NoSocket
    socket.create_connection = _refuse
    socket.getaddrinfo = _refuse


# ── requests stub ─────────────────────────────────────────────────────────


def _install_requests_stub(fixtures):
    """A ``requests`` look-alike that answers from fixtures, or refuses.

    Without fixtures every call raises ``ConnectionError`` — which still
    exercises the error paths an HTTP tool is required to have, and keeps
    verification independent of third-party uptime and of network access.
    """
    queue = list(fixtures or [])

    class RequestException(IOError):
        pass

    class ConnectionError_(RequestException):
        pass

    class HTTPError(RequestException):
        pass

    class Timeout(RequestException):
        pass

    class TooManyRedirects(RequestException):
        pass

    ConnectTimeout = type("ConnectTimeout", (ConnectionError_, Timeout), {})
    ReadTimeout = type("ReadTimeout", (Timeout,), {})
    JSONDecodeError = type("JSONDecodeError", (RequestException, ValueError), {})

    class Response:
        def __init__(self, fixture):
            self.status_code = int(fixture.get("status", 200))
            body = fixture.get("json")
            self._json = body
            self.text = fixture.get("text") if "text" in fixture else json.dumps(body)
            self.content = (self.text or "").encode()
            ctype = "application/json" if "json" in fixture else "text/plain"
            self.headers = {"Content-Type": ctype, **(fixture.get("headers") or {})}
            self.ok = self.status_code < 400
            self.url = fixture.get("url", "")
            self.reason = fixture.get("reason", "")

        def json(self, **_k):
            if self._json is None:
                raise JSONDecodeError("No JSON body in fixture")
            return copy.deepcopy(self._json)

        def raise_for_status(self):
            if not self.ok:
                raise HTTPError(f"{self.status_code} Error")

    def request(method, url, *a, **k):
        if not queue:
            raise ConnectionError_(
                f"sandbox: no network — {method.upper()} {url} was not sent"
            )
        fixture = queue.pop(0)
        queue.append(fixture)  # cycle, so repeated calls keep answering
        return Response({k: v for k, v in fixture.items() if k != "for_input"})

    module = types.ModuleType("requests")
    exceptions = types.ModuleType("requests.exceptions")
    for name, value in {
        "RequestException": RequestException, "ConnectionError": ConnectionError_,
        "HTTPError": HTTPError, "Timeout": Timeout, "ConnectTimeout": ConnectTimeout,
        "ReadTimeout": ReadTimeout, "TooManyRedirects": TooManyRedirects,
        "JSONDecodeError": JSONDecodeError,
    }.items():
        setattr(exceptions, name, value)
        setattr(module, name, value)
    module.exceptions = exceptions
    module.Response = Response
    module.request = request
    for verb in ("get", "post", "put", "patch", "delete", "head", "options"):
        setattr(module, verb, (lambda v: lambda url, *a, **k: request(v, url, *a, **k))(verb))

    class Session:
        def __init__(self):
            self.headers = {}

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def close(self):
            pass

        def request(self, method, url, *a, **k):
            return request(method, url, *a, **k)

    for verb in ("get", "post", "put", "patch", "delete", "head", "options"):
        setattr(Session, verb, (lambda v: lambda self, url, *a, **k: request(v, url, *a, **k))(verb))
    module.Session = Session
    module.session = Session

    sys.modules["requests"] = module
    sys.modules["requests.exceptions"] = exceptions


# ── Execution ─────────────────────────────────────────────────────────────


def _emit(payload):
    sys.__stdout__.write(MARKER + json.dumps(payload, default=repr) + "\n")
    sys.__stdout__.flush()


def _dumps_or_none(value):
    try:
        return json.dumps(value, sort_keys=True), None
    except (TypeError, ValueError) as e:
        return None, str(e)


def _call(run, kwargs):
    captured = io.StringIO()
    try:
        with redirect_stdout(captured):
            result = run(**copy.deepcopy(kwargs))
        return {"raised": False, "result": result, "stdout": captured.getvalue()[-2000:]}
    except BaseException as e:  # noqa: BLE001 — SystemExit included on purpose
        return {
            "raised": True,
            "exception": f"{type(e).__name__}: {e}",
            "traceback": traceback.format_exc()[-6000:],
            "stdout": captured.getvalue()[-2000:],
        }


def _main():
    request = json.loads(sys.stdin.read())
    _apply_limits(request.get("memory_mb"), request.get("cpu_seconds"))
    if request.get("block_network"):
        _block_network()
    if request.get("http_stub"):
        _install_requests_stub(request.get("fixtures"))

    module_path = request["module_path"]
    try:
        spec = importlib.util.spec_from_file_location("candidate", module_path)
        module = importlib.util.module_from_spec(spec)
        with redirect_stdout(io.StringIO()):
            spec.loader.exec_module(module)
    except BaseException as e:  # noqa: BLE001
        _emit({
            "phase": "import", "ok": False,
            "error": f"{type(e).__name__}: {e}",
            "traceback": traceback.format_exc()[-6000:],
        })
        return

    run = getattr(module, "run", None)
    if not callable(run):
        _emit({"phase": "import", "ok": False,
               "error": "The module has no callable named `run`.", "traceback": ""})
        return

    secrets = request.get("secrets")
    results = []
    for case in request.get("cases", []):
        sys.stderr.write(f"@@case {case['id']}\n")
        sys.stderr.flush()
        kwargs = dict(case.get("kwargs") or {})
        if secrets:
            kwargs["_secrets"] = secrets
        outcome = _call(run, kwargs)
        entry = {"id": case["id"], "raised": outcome["raised"], "stdout": outcome["stdout"]}
        if outcome["raised"]:
            entry["exception"] = outcome["exception"]
            entry["traceback"] = outcome["traceback"]
        else:
            dumped, error = _dumps_or_none(outcome["result"])
            entry["serialisable"] = error is None
            entry["serialise_error"] = error
            entry["result"] = json.loads(dumped) if dumped is not None else repr(outcome["result"])[:2000]
            if case.get("repeat") and dumped is not None:
                again = _call(run, kwargs)
                if again["raised"]:
                    entry["repeat_equal"] = False
                    entry["repeat_detail"] = "raised on the second identical call: " + again["exception"]
                else:
                    second, _ = _dumps_or_none(again["result"])
                    entry["repeat_equal"] = second == dumped
                    if second != dumped:
                        entry["repeat_detail"] = (
                            "a second identical call returned a different result: "
                            + (second or repr(again["result"]))[:600]
                        )
        results.append(entry)

    _emit({"phase": "cases", "ok": True, "results": results})


if __name__ == "__main__":
    try:
        _main()
    except BaseException as e:  # noqa: BLE001 — a runner bug, reported as ours
        _emit({"phase": "runner", "ok": False, "error": f"{type(e).__name__}: {e}",
               "traceback": traceback.format_exc()[-6000:]})
