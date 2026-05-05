"""Valida variables de entorno críticas al arranque del servidor.

Falla rápido con mensajes claros si faltan secretos o contienen
valores de ejemplo. Llamar desde el lifespan de FastAPI antes de
levantar rutas.

Bypass: SKIP_STARTUP_CHECK=true  (solo para entornos de tests CI).

Cloudflare Tunnel (opcional):
  Si CLOUDFLARE_TUNNEL_TOKEN está definido, arranca cloudflared como
  subproceso y verifica que el tunnel esté activo antes de marcar el
  servicio como listo. Requiere que 'cloudflared' esté instalado.
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
import time

logger = logging.getLogger(__name__)

# Fragmentos que indican un valor de ejemplo/placeholder.
_PLACEHOLDER_FRAGMENTS: frozenset[str] = frozenset({
    "reemplazar",
    "changeme",
    "change_me",
    "your-key",
    "your_key",
    "xxxx",
    "todo",
    "example",
    "placeholder",
    "insert_",
    "replace_",
    "tu_clave",
    "tu-clave",
    "secret_here",
    "password_here",
    "api_key_here",
})

# Vars que deben estar presentes y no ser placeholders.
# Formato: {VAR: "descripción para el operador"}
_REQUIRED: dict[str, str] = {
    "DATABASE_URL": (
        "URL de conexión a MySQL — "
        "mysql://user:pass@host:3306/db"
    ),
    "JWT_SECRET": (
        "Clave para firmar JWT — genera con: "
        "python -c \"import secrets; print(secrets.token_hex(32))\""
    ),
}

# Vars opcionales que emiten advertencia si faltan.
_OPTIONAL_WARN: dict[str, str] = {
    "OPENAI_API_KEY": (
        "Necesaria para agentes de texto con provider=openai y modo Sofía"
    ),
    "ELEVENLABS_API_KEY": (
        "Necesaria para agentes de voz (ElevenLabs)"
    ),
    "MAIL_PASSWORD": (
        "Necesaria para envío de correo (confirmación, reset de contraseña)"
    ),
}

_JWT_MIN_LENGTH = 32


def _is_placeholder(value: str) -> bool:
    lower = value.lower().strip()
    return any(frag in lower for frag in _PLACEHOLDER_FRAGMENTS)


def _check_jwt_strength(errors: list[str]) -> None:
    jwt = os.getenv("JWT_SECRET", "").strip()
    if not jwt:
        return  # ya lo captura _REQUIRED
    if len(jwt) < _JWT_MIN_LENGTH:
        errors.append(
            f"  • JWT_SECRET demasiado corta ({len(jwt)} chars). "
            f"Mínimo {_JWT_MIN_LENGTH} caracteres."
        )


def validate_startup_secrets() -> None:
    """Valida secretos al arranque. Llama sys.exit(1) si hay errores críticos."""
    if os.getenv("SKIP_STARTUP_CHECK", "").strip().lower() == "true":
        logger.info("startup_check: omitido por SKIP_STARTUP_CHECK=true")
        return

    errors: list[str] = []
    warnings: list[str] = []

    for var, description in _REQUIRED.items():
        value = os.getenv(var, "").strip()
        if not value:
            errors.append(f"  • {var} no está definida.\n    → {description}")
        elif _is_placeholder(value):
            errors.append(
                f"  • {var} contiene un valor de ejemplo — reemplaza con el valor real.\n"
                f"    → {description}"
            )

    _check_jwt_strength(errors)

    for var, description in _OPTIONAL_WARN.items():
        value = os.getenv(var, "").strip()
        if not value:
            warnings.append(f"  • {var} no está definida.\n    → {description}")
        elif _is_placeholder(value):
            warnings.append(
                f"  • {var} parece un valor de ejemplo.\n    → {description}"
            )

    if warnings:
        logger.warning(
            "startup_check: variables opcionales no configuradas —\n%s\n"
            "El servidor arranca pero algunas funciones no estarán disponibles.",
            "\n".join(warnings),
        )

    if errors:
        lines = "\n".join(errors)
        msg = (
            "\n"
            "╔══════════════════════════════════════════════════════════════╗\n"
            "║  FALTAN VARIABLES DE ENTORNO CRÍTICAS — servidor no arranca  ║\n"
            "╚══════════════════════════════════════════════════════════════╝\n"
            f"{lines}\n\n"
            "Copia backend/.env.example → backend/.env y rellena los valores.\n"
            "Ver SECRETS.md para guía de rotación y política de secretos.\n"
        )
        logger.critical(msg)
        sys.exit(1)


# ── Cloudflare Tunnel ──────────────────────────────────────────────────────────

_cf_process: subprocess.Popen | None = None


def start_cloudflare_tunnel() -> None:
    """Arranca cloudflared tunnel si CLOUDFLARE_TUNNEL_TOKEN está definido.

    No bloquea el arranque si cloudflared no está instalado, pero sí
    termina con sys.exit(1) si el token está definido y el proceso falla.
    """
    token = os.getenv("CLOUDFLARE_TUNNEL_TOKEN", "").strip()
    if not token:
        return

    if not shutil.which("cloudflared"):
        logger.error(
            "CLOUDFLARE_TUNNEL_TOKEN está definido pero 'cloudflared' no está instalado. "
            "Instala con: curl -L https://github.com/cloudflare/cloudflared/releases/latest"
            "/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x "
            "/usr/local/bin/cloudflared"
        )
        sys.exit(1)

    global _cf_process
    logger.info("Iniciando Cloudflare Tunnel...")
    _cf_process = subprocess.Popen(
        ["cloudflared", "tunnel", "--no-autoupdate", "run", "--token", token],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )

    # Esperar hasta 15 segundos a que el tunnel se establezca
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if _cf_process.poll() is not None:
            stderr_out = _cf_process.stderr.read().decode(errors="replace")
            logger.error("cloudflared terminó inesperadamente:\n%s", stderr_out)
            sys.exit(1)
        time.sleep(0.5)

    logger.info("Cloudflare Tunnel activo (PID %s)", _cf_process.pid)


def stop_cloudflare_tunnel() -> None:
    """Detiene el proceso cloudflared al apagar el servidor."""
    global _cf_process
    if _cf_process and _cf_process.poll() is None:
        _cf_process.terminate()
        try:
            _cf_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _cf_process.kill()
        logger.info("Cloudflare Tunnel detenido")
    _cf_process = None
