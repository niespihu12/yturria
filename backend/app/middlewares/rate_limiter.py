"""
Rate Limiting Middleware para Sofía WEP
Protege contra abuso de API y asegura disponibilidad del servicio
"""
import time
import logging
from collections import defaultdict
from typing import Callable
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)


class RateLimitConfig:
    """Configuración de rate limiting por tipo de endpoint"""
    
    # Límites por IP (requests por ventana)
    GENERAL_LIMIT = 100  # 100 requests por minuto para endpoints generales
    GENERAL_WINDOW = 60  # ventana de 60 segundos
    
    # Límites más estrictos para endpoints de IA (costosos)
    AI_LIMIT = 20  # 20 requests por minuto para endpoints de IA
    AI_WINDOW = 60
    
    # Límites para webhooks (pueden ser más altos por ser server-to-server)
    WEBHOOK_LIMIT = 500
    WEBHOOK_WINDOW = 60
    
    # Límite de burst máximo permitido
    BURST_LIMIT = 10  # Máximo 10 requests simultáneos de la misma IP


class RateLimiter:
    """Implementación de rate limiting con sliding window"""
    
    def __init__(self):
        # Almacena timestamps de requests por IP y endpoint
        self.requests: dict[str, dict[str, list[float]]] = defaultdict(
            lambda: defaultdict(list)
        )
    
    def is_allowed(self, ip: str, endpoint_type: str, limit: int, window: int) -> tuple[bool, int]:
        """
        Verifica si el request está permitido
        
        Returns:
            tuple: (is_allowed, remaining_requests)
        """
        current_time = time.time()
        window_start = current_time - window
        
        # Limpiar requests antiguos fuera de la ventana
        self.requests[ip][endpoint_type] = [
            ts for ts in self.requests[ip][endpoint_type]
            if ts > window_start
        ]
        
        current_count = len(self.requests[ip][endpoint_type])
        remaining = max(0, limit - current_count)
        
        if current_count >= limit:
            return False, 0
        
        # Registrar nuevo request
        self.requests[ip][endpoint_type].append(current_time)
        return True, remaining - 1
    
    def cleanup_old_entries(self, max_age: int = 3600):
        """Limpia entradas antiguas para evitar memory leak"""
        current_time = time.time()
        cutoff = current_time - max_age
        
        ips_to_remove = []
        for ip, endpoints in self.requests.items():
            endpoints_to_remove = []
            for endpoint, timestamps in endpoints.items():
                self.requests[ip][endpoint] = [ts for ts in timestamps if ts > cutoff]
                if not self.requests[ip][endpoint]:
                    endpoints_to_remove.append(endpoint)
            
            for endpoint in endpoints_to_remove:
                del self.requests[ip][endpoint]
            
            if not self.requests[ip]:
                ips_to_remove.append(ip)
        
        for ip in ips_to_remove:
            del self.requests[ip]


# Instancia global del rate limiter
rate_limiter = RateLimiter()


def get_client_ip(request: Request) -> str:
    """Obtiene la IP real del cliente considerando proxies"""
    # X-Forwarded-For puede contener múltiples IPs: client, proxy1, proxy2
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    
    # X-Real-IP para Cloudflare Tunnel
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()
    
    # Fallback a IP directa
    if request.client:
        return request.client.host
    
    return "unknown"


def classify_endpoint(path: str) -> str:
    """Clasifica el tipo de endpoint para aplicar límites apropiados"""
    path_lower = path.lower()
    
    if "/webhooks/" in path_lower:
        return "webhook"
    elif "/sofia/" in path_lower or "/chat/" in path_lower or "/ai/" in path_lower:
        return "ai"
    else:
        return "general"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Middleware de rate limiting para FastAPI"""
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Ignorar health checks
        if request.url.path in ["/health", "/healthz", "/ready", "/readiness"]:
            return await call_next(request)
        
        # Obtener IP del cliente
        client_ip = get_client_ip(request)
        
        # Clasificar endpoint
        endpoint_type = classify_endpoint(request.url.path)
        
        # Obtener configuración según tipo
        if endpoint_type == "webhook":
            limit = RateLimitConfig.WEBHOOK_LIMIT
            window = RateLimitConfig.WEBHOOK_WINDOW
        elif endpoint_type == "ai":
            limit = RateLimitConfig.AI_LIMIT
            window = RateLimitConfig.AI_WINDOW
        else:
            limit = RateLimitConfig.GENERAL_LIMIT
            window = RateLimitConfig.GENERAL_WINDOW
        
        # Verificar rate limit
        is_allowed, remaining = rate_limiter.is_allowed(
            client_ip, endpoint_type, limit, window
        )
        
        if not is_allowed:
            logger.warning(
                f"Rate limit excedido para IP {client_ip} en endpoint {request.url.path}"
            )
            return JSONResponse(
                status_code=429,
                content={
                    "error": "Too Many Requests",
                    "detail": "Has excedido el límite de peticiones permitidas. Por favor intenta de nuevo en unos momentos.",
                    "retry_after": window
                },
                headers={
                    "Retry-After": str(window),
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(int(time.time()) + window)
                }
            )
        
        # Ejecutar request
        response = await call_next(request)
        
        # Agregar headers de rate limiting
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(int(time.time()) + window)
        
        return response


# Limpieza periódica de entradas antiguas (opcional, para producción)
async def cleanup_task():
    """Tarea de fondo para limpiar entradas viejas del rate limiter"""
    while True:
        await asyncio.sleep(300)  # Cada 5 minutos
        rate_limiter.cleanup_old_entries()


import asyncio
