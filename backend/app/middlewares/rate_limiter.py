from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.utils.jwt import decode_jwt

logger = logging.getLogger(__name__)

# 100 requests per 60 seconds per IP
IP_LIMIT = 100
IP_WINDOW = 60

# 1000 requests per 3600 seconds per user
USER_LIMIT = 1000
USER_WINDOW = 3600

# Paths exempt from rate limiting (webhooks from Meta/Twilio, health checks)
_EXEMPT_PREFIXES = ("/api/webhooks/",)

_lock = asyncio.Lock()
_ip_hits: dict[str, list[float]] = defaultdict(list)
_user_hits: dict[str, list[float]] = defaultdict(list)
_last_cleanup = 0.0
_CLEANUP_INTERVAL = 300.0


def _get_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _extract_user_id(request: Request) -> str | None:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return None
    try:
        payload = decode_jwt(auth[7:])
        return str(payload.get("sub") or payload.get("user_id") or payload.get("id"))
    except Exception:
        return None


def _sliding_window_check(
    store: dict[str, list[float]], key: str, limit: int, window: float, now: float
) -> tuple[bool, int]:
    """Returns (allowed, retry_after_seconds)."""
    hits = store[key]
    cutoff = now - window
    # Remove expired entries
    while hits and hits[0] < cutoff:
        hits.pop(0)

    if len(hits) >= limit:
        retry_after = int(hits[0] + window - now) + 1
        return False, retry_after

    hits.append(now)
    return True, 0


async def _cleanup_expired(now: float) -> None:
    global _last_cleanup
    if now - _last_cleanup < _CLEANUP_INTERVAL:
        return
    _last_cleanup = now
    ip_cutoff = now - IP_WINDOW
    user_cutoff = now - USER_WINDOW
    for store, cutoff in ((_ip_hits, ip_cutoff), (_user_hits, user_cutoff)):
        stale = [k for k, v in store.items() if not v or v[-1] < cutoff]
        for k in stale:
            del store[k]


class RateLimiterMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)

        path = request.url.path
        if any(path.startswith(p) for p in _EXEMPT_PREFIXES):
            return await call_next(request)

        now = time.monotonic()
        ip = _get_ip(request)
        user_id = _extract_user_id(request)

        async with _lock:
            await _cleanup_expired(now)

            ip_ok, ip_retry = _sliding_window_check(_ip_hits, ip, IP_LIMIT, IP_WINDOW, now)
            if not ip_ok:
                logger.warning("rate_limit ip=%s path=%s retry_after=%s", ip, path, ip_retry)
                return JSONResponse(
                    status_code=429,
                    content={"error": "Demasiadas solicitudes. Intente de nuevo más tarde."},
                    headers={"Retry-After": str(ip_retry)},
                )

            if user_id:
                user_ok, user_retry = _sliding_window_check(
                    _user_hits, user_id, USER_LIMIT, USER_WINDOW, now
                )
                if not user_ok:
                    logger.warning(
                        "rate_limit user=%s ip=%s path=%s retry_after=%s",
                        user_id, ip, path, user_retry,
                    )
                    return JSONResponse(
                        status_code=429,
                        content={"error": "Límite de solicitudes por hora alcanzado."},
                        headers={"Retry-After": str(user_retry)},
                    )

        return await call_next(request)
