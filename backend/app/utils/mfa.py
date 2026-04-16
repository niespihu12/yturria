from __future__ import annotations

import os
from dotenv import load_dotenv

load_dotenv()

MFA_MAX_ATTEMPTS = int(os.getenv("MFA_MAX_ATTEMPTS", "5"))
MFA_LOCK_MINUTES = int(os.getenv("MFA_LOCK_MINUTES", "10"))


def normalize_mfa_code(code: str) -> str:
    normalized = "".join(character for character in code if character.isdigit())
    if len(normalized) != 6:
        raise ValueError("Ingresa un codigo de 6 digitos")
    return normalized
