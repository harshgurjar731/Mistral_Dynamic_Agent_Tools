"""
Running the synchronous Mistral SDK from async code.

The shared client built in ``dependencies.py`` is the *synchronous* ``Mistral``
class. Calling it directly from an ``async def`` blocks the event loop for the
whole request — and these are LLM calls, so "the whole request" is routinely
tens of seconds. While one is in flight the process serves nothing: no health
check, no SSE frame, no second user. That failure mode reads as a hung server
rather than a slow call, which is what makes it worth a helper rather than a
convention.

``asyncio.to_thread`` covers ordinary calls and is used inline at those sites.
Streaming needs more care, which is what lives here: the initial call blocks
until the response head arrives, and *each* iteration then blocks until the
next chunk. Offloading only the first part would still stall the loop once per
token.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncIterator, Callable, Iterable, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Distinguishes "generator finished" from a legitimate ``None`` chunk. Raising
# StopIteration out of a thread into a coroutine is not viable — it is
# swallowed and surfaces as a confusing RuntimeError — so exhaustion is
# signalled by identity instead.
_EXHAUSTED = object()


async def iter_sync_stream(open_stream: Callable[[], Iterable[T]]) -> AsyncIterator[T]:
    """Consume a synchronous SDK stream without blocking the event loop.

    ``open_stream`` is called in a worker thread (it blocks until the response
    head arrives), and every subsequent chunk is pulled in a worker thread too.

    The stream is closed on the way out — including when the consumer stops
    early, which is the normal case when a client disconnects mid-response.
    """
    stream = await asyncio.to_thread(open_stream)

    iterator = iter(stream)
    try:
        while True:
            chunk = await asyncio.to_thread(next, iterator, _EXHAUSTED)
            if chunk is _EXHAUSTED:
                return
            yield chunk
    finally:
        # EventStream holds an open HTTP response; abandoning it leaks the
        # connection until GC. __exit__ is the SDK's documented close path.
        closer = getattr(stream, "__exit__", None)
        if closer is not None:
            try:
                await asyncio.to_thread(closer, None, None, None)
            except Exception as e:
                logger.debug("Closing SDK stream failed: %s", e)


async def call(fn: Callable[..., T], /, *args: Any, **kwargs: Any) -> T:
    """Run one blocking SDK call in a worker thread.

    A thin alias for ``asyncio.to_thread`` that names the intent at the call
    site. Prefer it where the reason for offloading is not otherwise obvious.
    """
    return await asyncio.to_thread(fn, *args, **kwargs)
