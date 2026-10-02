"""Per-client rate limiting for the public chatbot endpoints.

This service has no auth of its own and every /chat/ or /trip/llm call spends
LLM quota, so without a limit anyone who finds the URL can burn it. In-memory
and per process -- fine for the single uvicorn worker this runs as.

Pure ASGI (not BaseHTTPMiddleware) so SSE streaming responses pass through
untouched.
"""
import json
import threading
import time
from collections import deque


class SlidingWindowLimiter:
    """`rules` is a list of (window_seconds, max_requests); a request is
    allowed only if it fits every window."""

    def __init__(self, rules):
        self.rules = rules
        self._longest = max(window for window, _ in rules)
        self._hits = {}  # key -> deque of request timestamps
        self._lock = threading.Lock()
        self._calls = 0

    def check(self, key, now=None):
        """Returns None if allowed (and records the hit), otherwise the
        number of seconds until the client may try again."""
        now = time.monotonic() if now is None else now
        with self._lock:
            self._calls += 1
            if self._calls % 1000 == 0:
                self._purge(now)

            hits = self._hits.setdefault(key, deque())
            while hits and hits[0] <= now - self._longest:
                hits.popleft()

            retry_after = 0.0
            for window, limit in self.rules:
                in_window = [t for t in hits if t > now - window]
                if len(in_window) >= limit:
                    retry_after = max(retry_after, in_window[0] + window - now)
            if retry_after > 0:
                return retry_after

            hits.append(now)
            return None

    def _purge(self, now):
        # Drop clients that haven't been seen for longer than any window, so
        # the dict can't grow without bound.
        stale = [k for k, h in self._hits.items() if not h or h[-1] <= now - self._longest]
        for k in stale:
            del self._hits[k]


def _client_ip(scope):
    # Caddy overwrites X-Forwarded-For with the real connecting address and the
    # chatbot isn't published outside the Docker network, so the first entry is
    # trustworthy here. Run directly (local dev) there's no header and we fall
    # back to the socket peer.
    for name, value in scope.get("headers", []):
        if name == b"x-forwarded-for":
            first = value.decode("latin-1").split(",")[0].strip()
            if first:
                return first
    client = scope.get("client")
    return client[0] if client else "unknown"


class RateLimitMiddleware:
    """`limits` maps a path prefix to a SlidingWindowLimiter; only POSTs under
    a listed prefix are counted (preflights and GETs are free)."""

    def __init__(self, app, limits, message="ส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง"):
        self.app = app
        self.limits = limits
        self.message = message

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["method"] == "POST":
            path = scope["path"]
            for prefix, limiter in self.limits.items():
                if path.startswith(prefix):
                    retry_after = limiter.check((prefix, _client_ip(scope)))
                    if retry_after is not None:
                        await self._reject(send, retry_after)
                        return
                    break
        await self.app(scope, receive, send)

    async def _reject(self, send, retry_after):
        body = json.dumps({"detail": self.message}, ensure_ascii=False).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": 429,
            "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"retry-after", str(max(1, int(retry_after) + 1)).encode()),
                (b"content-length", str(len(body)).encode()),
            ],
        })
        await send({"type": "http.response.body", "body": body})
