"""Contactos: validacion E.164 y sincronizacion de transfers de voz."""
from __future__ import annotations

import logging

from app.models.UserAgent import UserAgent


def test_contact_phone_is_normalized(client, make_user, headers_for):
    user = make_user("contactos@example.com")
    res = client.post(
        "/api/contacts",
        json={"name": "Ana", "phone": "+52 55 1234-5678", "whatsapp": "+52 (55) 1234 5678"},
        headers=headers_for(user),
    )
    assert res.status_code == 200, res.text
    assert res.json()["phone"] == "+525512345678"
    assert res.json()["whatsapp"] == "+525512345678"


def test_invalid_contact_phone_returns_400(client, make_user, headers_for):
    user = make_user("contactos@example.com")
    headers = headers_for(user)

    res = client.post("/api/contacts", json={"name": "Ana", "phone": "5512345678"}, headers=headers)
    assert res.status_code == 400
    assert "E.164" in res.json()["error"]

    created = client.post("/api/contacts", json={"name": "Ana"}, headers=headers)
    assert created.status_code == 200, created.text
    res = client.put(
        f"/api/contacts/{created.json()['id']}", json={"phone": "abc"}, headers=headers
    )
    assert res.status_code == 400


def test_sync_failure_is_logged(client, db, make_user, headers_for, monkeypatch, caplog):
    user = make_user("sync@example.com")
    db.add(UserAgent(user_id=user.id, agent_id="agentSync"))
    db.commit()

    def _boom(path, **kwargs):
        raise RuntimeError("ElevenLabs caido")

    monkeypatch.setattr("app.routes.contacts_router.elevenlabs_get", _boom)
    with caplog.at_level(logging.ERROR, logger="app.routes.contacts_router"):
        res = client.post(
            "/api/contacts", json={"name": "Ana", "phone": "+525512345678"}, headers=headers_for(user)
        )

    assert res.status_code == 200, res.text
    assert any("agentSync" in record.getMessage() for record in caplog.records)
