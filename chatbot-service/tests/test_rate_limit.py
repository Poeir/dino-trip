from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from src.core.rate_limit import RateLimitMiddleware, SlidingWindowLimiter


# --- SlidingWindowLimiter -------------------------------------------------

def test_allows_up_to_limit_then_blocks():
    limiter = SlidingWindowLimiter([(60, 3)])
    assert [limiter.check("a", now=t) for t in (0, 1, 2)] == [None, None, None]
    retry = limiter.check("a", now=3)
    assert retry is not None and 56 < retry <= 57  # oldest hit (t=0) leaves the window at 60


def test_window_slides_so_old_hits_stop_counting():
    limiter = SlidingWindowLimiter([(60, 2)])
    limiter.check("a", now=0)
    limiter.check("a", now=1)
    assert limiter.check("a", now=2) is not None
    assert limiter.check("a", now=61) is None  # the t=0 hit has aged out


def test_blocked_requests_do_not_extend_the_block():
    limiter = SlidingWindowLimiter([(60, 1)])
    limiter.check("a", now=0)
    for t in (10, 20, 30):
        assert limiter.check("a", now=t) is not None
    assert limiter.check("a", now=61) is None


def test_every_window_must_be_satisfied():
    limiter = SlidingWindowLimiter([(60, 100), (3600, 3)])  # loose per-minute, tight per-hour
    for t in (0, 100, 200):
        assert limiter.check("a", now=t) is None
    assert limiter.check("a", now=300) is not None


def test_clients_are_counted_separately():
    limiter = SlidingWindowLimiter([(60, 1)])
    assert limiter.check("a", now=0) is None
    assert limiter.check("a", now=1) is not None
    assert limiter.check("b", now=1) is None


def test_stale_clients_are_purged():
    limiter = SlidingWindowLimiter([(60, 5)])
    limiter.check("gone", now=0)
    limiter._purge(now=1000)
    assert "gone" not in limiter._hits


# --- RateLimitMiddleware (through a real ASGI app) ------------------------

def make_client(chat_limit=2):
    app = FastAPI()

    @app.post("/chat/")
    def chat():
        return {"ok": True}

    @app.get("/chat/")
    def chat_get():
        return {"ok": True}

    @app.post("/other")
    def other():
        return {"ok": True}

    # Same order as src/main.py: rate limit first, CORS outermost.
    app.add_middleware(RateLimitMiddleware, limits={"/chat/": SlidingWindowLimiter([(60, chat_limit)])})
    app.add_middleware(CORSMiddleware, allow_origins=["https://site.example"], allow_methods=["*"], allow_headers=["*"])
    return TestClient(app)


def test_post_over_limit_gets_429_with_retry_after():
    client = make_client(chat_limit=2)
    assert client.post("/chat/").status_code == 200
    assert client.post("/chat/").status_code == 200
    res = client.post("/chat/")
    assert res.status_code == 429
    assert int(res.headers["retry-after"]) >= 1
    assert "detail" in res.json()


def test_429_still_carries_cors_headers():
    client = make_client(chat_limit=1)
    headers = {"Origin": "https://site.example"}
    client.post("/chat/", headers=headers)
    res = client.post("/chat/", headers=headers)
    assert res.status_code == 429
    assert res.headers["access-control-allow-origin"] == "https://site.example"


def test_get_and_other_paths_are_not_limited():
    client = make_client(chat_limit=1)
    for _ in range(5):
        assert client.get("/chat/").status_code == 200
        assert client.post("/other").status_code == 200


def test_clients_identified_by_forwarded_for_header():
    client = make_client(chat_limit=1)
    assert client.post("/chat/", headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 200
    assert client.post("/chat/", headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 429
    # A different real client behind the same proxy is unaffected.
    assert client.post("/chat/", headers={"X-Forwarded-For": "2.2.2.2"}).status_code == 200
