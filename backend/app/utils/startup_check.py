"""Valida variables de entorno críticas al arranque del servidor.

Falla rápido con mensajes claros si faltan secretos o contienen
valores de ejemplo. Llamar desde el lifespan de FastAPI antes de
levantar rutas.

Bypass: SKIP_STARTUP_CHECK=true  (solo para entornos de tests CI).
"""
from __future__ import annotations

import logging
import os
import sys

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
