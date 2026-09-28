"""Extrae el nombre, teléfono y correo que un cliente escribe en el chat.

Se usa cuando Sofía pasa a un asesor una conversación de un canal sin teléfono
(chat web o widget): el cliente deja sus datos para que lo contacten.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE = re.compile(r"(?<![\w@])\+?\d[\d\s().-]{5,}\d(?!\w)")
_NAME_INTRO = re.compile(r"\b(?:me llamo|mi nombre es|soy|le habla|habla)\s+", re.IGNORECASE)
_SEGMENTS = re.compile(r"[,;.\n:()]+")
_WORD = re.compile(r"^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'-]+$")
_NOISE = {
    "mi", "mis", "es", "son", "me", "llamo", "nombre", "soy", "y", "o", "el", "la", "al",
    "numero", "número", "telefono", "teléfono", "celular", "cel", "movil", "móvil", "whatsapp",
    "correo", "email", "e-mail", "electronico", "electrónico", "contacto", "datos", "dato",
    "claro", "si", "sí", "ok", "bueno", "listo", "gracias", "por", "favor", "hola", "buenas",
    "perfecto", "dale", "vale", "entendido", "correcto", "genial", "excelente", "bien", "buenos",
    "días", "dias", "tardes", "noches", "señor", "señora", "sr", "sra",
    "aqui", "aquí", "esta", "está", "este", "tengo", "puede", "pueden", "llamarme", "escribirme",
}


@dataclass(frozen=True)
class ContactInfo:
    name: str = ""
    phone: str = ""
    email: str = ""

    @property
    def reachable(self) -> bool:
        return bool(self.phone or self.email)


def extract_contact(text: str) -> ContactInfo:
    text = str(text or "")
    email_match = _EMAIL.search(text)
    email = email_match.group(0).lower() if email_match else ""
    rest = _EMAIL.sub(" ", text)

    phone = ""
    for match in _PHONE.finditer(rest):
        digits = re.sub(r"\D", "", match.group(0))
        if 7 <= len(digits) <= 15:
            phone = ("+" if match.group(0).lstrip().startswith("+") else "") + digits
            break
    rest = _PHONE.sub(" ", rest)

    return ContactInfo(name=_extract_name(rest), phone=phone, email=email)


def _extract_name(text: str) -> str:
    intro = _NAME_INTRO.search(text)
    candidate = text[intro.end():] if intro else text
    for segment in _SEGMENTS.split(candidate):
        words = [w for w in segment.split() if w.lower() not in _NOISE]
        if not words or len(words) > 4 or not all(_WORD.match(w) for w in words):
            continue
        # Sin "me llamo…" solo se acepta algo con forma de nombre propio ("Ana Gómez").
        if not intro and not all(w[0].isupper() for w in words):
            continue
        name = " ".join(words)
        return name.title() if name.islower() else name
    return ""


def contact_display(phone: str, email: str) -> str:
    """Dato que se le repite al cliente al confirmar (teléfono primero)."""
    return phone or email
