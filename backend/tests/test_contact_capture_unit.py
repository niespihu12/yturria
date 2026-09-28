"""Extracción de los datos de contacto que un cliente escribe en el chat."""
from __future__ import annotations

import pytest

from app.services.contact_capture import extract_contact


@pytest.mark.parametrize(
    "text, name, phone, email",
    [
        ("Ana Gómez, 300 123 4567", "Ana Gómez", "3001234567", ""),
        ("me llamo carlos y mi celular es 310-555-1234", "Carlos", "3105551234", ""),
        ("Mi nombre es Laura Ríos, correo laura.rios@correo.com", "Laura Ríos", "", "laura.rios@correo.com"),
        ("Claro, mi correo es Pedro@Empresa.CO", "", "", "pedro@empresa.co"),
        ("+57 315 222 3344", "", "+573152223344", ""),
        ("Soy Jorge Pérez. Tel: (601) 745 3000 y jorge@mail.com", "Jorge Pérez", "6017453000", "jorge@mail.com"),
        ("Quiero que me llamen al 3001234567", "", "3001234567", ""),
        ("Perfecto, Sandra López 3207654321", "Sandra López", "3207654321", ""),
    ],
)
def test_extract_contact(text, name, phone, email):
    contact = extract_contact(text)
    assert (contact.name, contact.phone, contact.email) == (name, phone, email)
    assert contact.reachable


@pytest.mark.parametrize(
    "text",
    ["¿Qué cubre el seguro de hogar?", "No quiero dar mis datos", "Mi póliza 123", "Nací en 1985"],
)
def test_text_without_contact_is_not_reachable(text):
    assert not extract_contact(text).reachable
