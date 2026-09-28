"""HTTP: al escalar un chat web/widget, Sofía pide los datos de contacto y avisa al dueño."""
from __future__ import annotations

import pytest

import app.controllers.TextAgentController as ctrl
from app.models.TextAgent import TextAgent
from app.models.TextConversation import TextConversation


@pytest.fixture(autouse=True)
def _server_openai_key(monkeypatch):
    monkeypatch.setattr(ctrl, "OPENAI_API_KEY", "sk-test-env")


def _sofia_agent(client, db, make_user, headers_for):
    owner = make_user(email="asesora@aseguradora.co")
    res = client.post(
        "/api/text-agents",
        json={"name": "Sofía web", "template_key": "custom", "system_prompt": "Eres Sofía.", "sofia_mode": True},
        headers=headers_for(owner),
    )
    assert res.status_code == 200, res.text
    agent_id = res.json()["agent_id"]
    return owner, agent_id, db.get(TextAgent, agent_id).embed_token


def _public_chat(client, agent_id, token, message, conversation_id=None):
    body = {"token": token, "message": message}
    if conversation_id:
        body["conversation_id"] = conversation_id
    res = client.post(f"/api/text-agents/public/{agent_id}/chat", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def test_web_escalation_asks_for_contact_then_notifies_owner(client, db, make_user, headers_for, sent_emails):
    owner, agent_id, token = _sofia_agent(client, db, make_user, headers_for)

    first = _public_chat(client, agent_id, token, "Quiero hablar con un asesor")
    assert first["escalated"] is True
    assert "teléfono o correo" in first["response"]
    conversation = db.get(TextConversation, first["conversation_id"])
    db.refresh(conversation)
    assert conversation.contact_requested is True
    assert conversation.escalation_status == "pending"
    assert sent_emails == []

    second = _public_chat(client, agent_id, token, "Ana Gómez, 300 123 4567", first["conversation_id"])
    assert second["response"] == "Gracias, Ana Gómez. Un asesor se comunicará con usted al 3001234567 lo antes posible."
    db.refresh(conversation)
    assert (conversation.contact_name, conversation.contact_phone) == ("Ana Gómez", "3001234567")
    assert conversation.contact_requested is False

    assert len(sent_emails) == 1
    email = sent_emails[0]
    assert email["to_email"] == owner.email
    assert "Ana Gómez" in email["text"] and "3001234567" in email["text"]
    assert f"/escalamientos?conversacion={conversation.id}&agente={agent_id}" in email["text"]
    assert f"/escalamientos?conversacion={conversation.id}&amp;agente={agent_id}" in email["html"]
    assert email["text"].startswith("Un cliente del sitio web pidió hablar con un asesor")

    escalations = client.get(f"/api/text-agents/{agent_id}/escalations", headers=headers_for(owner)).json()
    row = escalations["escalations"][0]
    assert (row["contact_name"], row["contact_phone"], row["contact_email"]) == ("Ana Gómez", "3001234567", "")


def test_message_without_contact_keeps_asking_later(client, db, make_user, headers_for, sent_emails):
    _, agent_id, token = _sofia_agent(client, db, make_user, headers_for)
    first = _public_chat(client, agent_id, token, "Quiero hablar con un asesor")

    reply = _public_chat(client, agent_id, token, "¿Qué cubre el seguro de hogar?", first["conversation_id"])
    assert reply["response"] == "Respuesta de prueba de Sofía."
    conversation = db.get(TextConversation, first["conversation_id"])
    db.refresh(conversation)
    assert conversation.contact_requested is True
    assert sent_emails == []

    done = _public_chat(client, agent_id, token, "mi correo es cliente@correo.com", first["conversation_id"])
    assert "cliente@correo.com" in done["response"]
    assert len(sent_emails) == 1


def test_whatsapp_escalation_notifies_owner_with_phone(db, make_user, sent_emails):
    owner = make_user(email="dueno@aseguradora.co")
    agent = TextAgent(user_id=owner.id, name="Sofía WhatsApp", provider="openai", model="gpt-4.1-mini")
    db.add(agent)
    db.commit()
    conversation = TextConversation(
        text_agent_id=agent.id, user_id=owner.id, title="whatsapp:+573001112233",
        channel="whatsapp", escalation_status="pending", escalation_reason="active_claim",
    )
    db.add(conversation)
    db.commit()

    ctrl._notify_owner_of_escalation(agent, conversation, db, customer_phone="+573001112233")

    assert len(sent_emails) == 1
    assert sent_emails[0]["to_email"] == owner.email
    assert "+573001112233" in sent_emails[0]["text"]
    assert "Reclamación en curso" in sent_emails[0]["text"]
