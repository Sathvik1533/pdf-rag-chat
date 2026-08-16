"""
In-Memory Sliding-Window Rate Limiter Middleware for Veritas RAG.
Protects /upload, /chat, and telemetry endpoints from abuse, quota exhaustion, and DoS.
"""

import time
from collections import defaultdict
from typing import Dict, List, Tuple
from fastapi import Request, HTTPException, status


class SlidingWindowRateLimiter:
    """
    Thread-safe, sliding-window rate limiter per client IP or Session ID.
    """
    def __init__(self):
        # Maps client_key -> list of timestamp floats
        self._history: Dict[str, List[float]] = defaultdict(list)

    def is_allowed(self, client_key: str, limit: int, window_seconds: int = 60) -> Tuple[bool, int, int]:
        """
        Checks if client request is within rate limit.
        Returns: (allowed: bool, remaining_requests: int, retry_after_seconds: int)
        """
        now = time.time()
        window_start = now - window_seconds

        # Clean old timestamps
        history = [t for t in self._history[client_key] if t > window_start]
        self._history[client_key] = history

        current_count = len(history)
        if current_count >= limit:
            oldest = history[0] if history else now
            retry_after = max(1, int(window_seconds - (now - oldest)))
            return False, 0, retry_after

        # Record this request
        self._history[client_key].append(now)
        remaining = max(0, limit - current_count - 1)
        return True, remaining, 0

    def cleanup_stale_clients(self, max_age_seconds: int = 3600):
        """Purge client records older than max_age_seconds to prevent memory growth."""
        now = time.time()
        stale_keys = []
        for key, timestamps in self._history.items():
            if not timestamps or (now - timestamps[-1] > max_age_seconds):
                stale_keys.append(key)
        for key in stale_keys:
            del self._history[key]


# Global rate limiter instance
rate_limiter = SlidingWindowRateLimiter()


def get_client_identifier(request: Request) -> str:
    """
    Derives unique client identifier from session header, cookie, or IP address.
    """
    # 1. Custom Session Header
    session_id = request.headers.get("X-Session-ID")
    if session_id and len(session_id.strip()) > 4:
        return f"session:{session_id.strip()}"

    # 2. Cookie session
    cookie_session = request.cookies.get("veritas_session_id")
    if cookie_session:
        return f"session:{cookie_session.strip()}"

    # 3. Client IP (with X-Forwarded-For reverse proxy support)
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        client_ip = forwarded.split(",")[0].strip()
    else:
        client_ip = request.client.host if request.client else "127.0.0.1"

    return f"ip:{client_ip}"


def enforce_rate_limit(request: Request, limit: int = 30, window_seconds: int = 60):
    """
    FastAPI dependency helper to enforce rate limit on route handlers.
    Raises HTTP 429 if limit is exceeded.
    """
    client_key = get_client_identifier(request)
    allowed, remaining, retry_after = rate_limiter.is_allowed(client_key, limit, window_seconds)
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded. Maximum {limit} requests per {window_seconds}s. Please retry in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after), "X-RateLimit-Limit": str(limit)}
        )
