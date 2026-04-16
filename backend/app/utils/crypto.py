from __future__ import annotations

import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken


def _resolve_cipher_key() -> bytes:
    raw = os.getenv("TEXT_AGENTS_SECRET_KEY", "").strip()
    if raw:
        try:
            Fernet(raw.encode("utf-8"))
            return raw.encode("utf-8")
        except Exception:
            digest = hashlib.sha256(raw.encode("utf-8")).digest()
            return base64.urlsafe_b64encode(digest)

    fallback = os.getenv("JWT_SECRET", "change-me")
    digest = hashlib.sha256(fallback.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def _cipher() -> Fernet:
    return Fernet(_resolve_cipher_key())


def encrypt_secret(value: str) -> str:
    token = _cipher().encrypt(value.encode("utf-8"))
    return token.decode("utf-8")


def decrypt_secret(value: str) -> str:
    try:
        raw = _cipher().decrypt(value.encode("utf-8"))
    except InvalidToken as exc:
        raise ValueError("No se pudo descifrar la llave configurada") from exc
    return raw.decode("utf-8")


def mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}{'*' * (len(value) - 8)}{value[-4:]}"
