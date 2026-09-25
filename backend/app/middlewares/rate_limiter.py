from __future__ import annotations

import asyncio
import logging
import os
import time
from collections import defaultdict, deque

from dotenv import load_dotenv
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.utils.jwt import decode_jwt

load_dotenv()

logger = logging.getLogger(__name__)

def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


# Per IP per minute. Several people behind one office NAT share this budget and
# the SPA polls dashboards, so it must stay well above a single user's traffic.
IP_LIMIT = _env_int("RATE_LIMIT_IP_PER_MINUTE", 300)
IP_WINDOW = 60

# Per authenticated user per hour.
USER_LIMIT = _env_int("RATE_LIMIT_USER_PER_HOUR", 3000)
USER_WINDOW = 3600

# Credential / one-time-code endpoints: 6-digit codes must not be brute-forceable.
AUTH_LIMIT = _env_int("RATE_LIMIT_AUTH_PER_MINUTE", 10)
AUTH_WINDOW = 60
_AUTH_PATHS = frozenset({
    "/api/auth/login",
    "/api/auth/login/mfa",
    "/api/auth/create-account",
    "/api/auth/confirm-account",
    "/api/auth/request-code",
    "/api/auth/forgot-password",
    "/api/auth/validate-token",
})
_AUTH_PREFIXES = ("/api/auth/update-password/",)

# Only honour X-Forwarded-For when a trusted reverse proxy sets it; otherwise any
# client could rotate the header to bypass every limit.
TRUST_FORWARDED_FOR = os.getenv("RATE_LIMIT_TRUST_FORWARDED_FOR", "false").strip().lower() == "true"

# Paths exempt from rate limiting (webhooks from Meta/Twilio, health checks)
_EXEMPT_PREFIXES = ("/api/webhooks/",)

_lock = asyncio.Lock()
_ip_hits: dict[str, deque[float]] = defaultdict(deque)
_user_hits: dict[str, deque[float]] = defaultdict(deque)
_auth_hits: dict[str, deque[float]] = defaultdict(deque)
_last_cleanup = 0.0
_CLEANUP_INTERVAL = 300.0


def _get_ip(request: Request) -> str:
    if TRUST_FORWARDED_FOR:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            # The right-most entry is the one appended by our own proxy.
            return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def _is_auth_path(path: str) -> bool:
    return path in _AUTH_PATHS or path.startswith(_AUTH_PREFIXES)


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
    store: dict[str, deque[float]], key: str, limit: int, window: float, now: float
) -> tuple[bool, int]:
    """Returns (allowed, retry_after_seconds)."""
    hits = store[key]
    cutoff = now - window
    # Remove expired entries
    while hits and hits[0] < cutoff:
        hits.popleft()

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
    auth_cutoff = now - AUTH_WINDOW
    for store, cutoff in ((_ip_hits, ip_cutoff), (_user_hits, user_cutoff), (_auth_hits, auth_cutoff)):
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

            if _is_auth_path(path):
                auth_ok, auth_retry = _sliding_window_check(
                    _auth_hits, ip, AUTH_LIMIT, AUTH_WINDOW, now
                )
                if not auth_ok:
                    logger.warning("rate_limit auth ip=%s path=%s retry_after=%s", ip, path, auth_retry)
                    return JSONResponse(
                        status_code=429,
                        content={"error": "Demasiados intentos. Espera un minuto e intenta de nuevo."},
                        headers={"Retry-After": str(auth_retry)},
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
