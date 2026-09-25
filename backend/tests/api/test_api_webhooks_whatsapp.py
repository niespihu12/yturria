"""HTTP: webhooks de WhatsApp (firma, idempotencia, múltiples mensajes, URL pública Twilio)."""
from __future__ import annotations

import hashlib
import hmac
import importlib
import json
import urllib.parse
from base64 import b64encode

import pytest
from sqlmodel import select

import app.controllers.TextAgentController as ctrl
from app.models.TextAgent import TextAgent
from app.models.TextAgentWhatsApp import TextAgentWhatsApp
from app.models.TextMessage import TextMessage
from app.utils.crypto import encrypt_secret

webhooks_module = importlib.import_module("app.routes.webhooks_router")

META_SECRET = "meta-app-secret"
TWILIO_TOKEN = "twilio-auth-token"


@pytest.fixture
def llm_calls(monkeypatch) -> list[dict]:
    calls: list[dict] = []

    def fake_dispatch(**kwargs):
        calls.append(kwargs)
        return "Respuesta automatica", 3

    monkeypatch.setattr(ctrl, "OPENAI_API_KEY", "sk-test-env")
    monkeypatch.setattr(ctrl, "_dispatch_llm_with_optional_tool_execution", fake_dispatch)
    monkeypatch.delenv("WHATSAPP_ALLOW_UNSIGNED_WEBHOOKS", raising=False)
    monkeypatch.delenv("BACKEND_PUBLIC_URL", raising=False)
    return calls


@pytest.fixture
def meta_sends(monkeypatch) -> list[tuple]:
    sends: list[tuple] = []
    monkeypatch.setattr(webhooks_module, "_send_meta_message", lambda *args: sends.append(args))
    return sends


def _seed_config(db, make_user, provider: str, **config_fields) -> TextAgentWhatsApp:
    user = make_user()
    agent = TextAgent(
        user_id=user.id,
        name="Agente WA",
        provider="openai",
        model="gpt-4.1-mini",
        system_prompt="Eres un asistente.",
        sofia_mode=False,
        template_key="custom",
    )
    db.add(agent)
    db.commit()
    config = TextAgentWhatsApp(
        text_agent_id=agent.id,
        provider=provider,
        phone_number="+15550001111",
        webhook_verify_token="verify-token",
        active=True,
        **config_fields,
    )
    db.add(config)
    db.commit()
    return config


def _meta_config(db, make_user, **overrides) -> TextAgentWhatsApp:
    fields = {
        "app_secret_encrypted": encrypt_secret(META_SECRET),
        "access_token_encrypted": encrypt_secret("meta-access-token"),
        "phone_number_id": "PNID-1",
    }
    fields.update(overrides)
    return _seed_config(db, make_user, "meta", **fields)


def _meta_payload(messages_by_entry: list[list[tuple[str, str, str]]]) -> bytes:
    entries = []
    for messages in messages_by_entry:
        entries.append(
            {
                "changes": [
                    {
                        "value": {
                            "metadata": {"phone_number_id": "PNID-1"},
                            "messages": [
                                {"id": wamid, "from": sender, "type": "text", "text": {"body": body}}
                                for wamid, sender, body in messages
                            ],
                        }
                    }
                ]
            }
        )
    return json.dumps({"object": "whatsapp_business_account", "entry": entries}).encode()


def _meta_signature(raw: bytes, secret: str = META_SECRET) -> str:
    return "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


def _post_meta(client, config_id: str, raw: bytes, signature: str | None):
    headers = {"Content-Type": "application/json"}
    if signature is not None:
        headers["X-Hub-Signature-256"] = signature
    return client.post(f"/api/webhooks/whatsapp/{config_id}/meta", content=raw, headers=headers)


# ── Meta: verificación GET ───────────────────────────────────────────────────

def test_meta_verify_token_constant_time_and_non_empty(client, db, make_user):
    config = _meta_config(db, make_user)
    base = f"/api/webhooks/whatsapp/{config.id}/meta"
    ok = client.get(base, params={"hub.mode": "subscribe", "hub.verify_token": "verify-token", "hub.challenge": "42"})
    assert ok.status_code == 200 and ok.text == "42"
    bad = client.get(base, params={"hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "42"})
    assert bad.status_code == 403

    config.webhook_verify_token = ""
    db.add(config)
    db.commit()
    empty = client.get(base, params={"hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "42"})
    assert empty.status_code == 403


# ── Meta: firma (fail closed) ────────────────────────────────────────────────

def test_meta_rejects_missing_or_invalid_signature(client, db, make_user, llm_calls, meta_sends):
    config = _meta_config(db, make_user)
    raw = _meta_payload([[("wamid.1", "573001112233", "hola")]])
    assert _post_meta(client, config.id, raw, None).status_code == 403
    assert _post_meta(client, config.id, raw, _meta_signature(raw, "otro")).status_code == 403
    assert llm_calls == [] and meta_sends == []


def test_meta_rejects_when_app_secret_missing_or_undecryptable(client, db, make_user, llm_calls, monkeypatch):
    raw = _meta_payload([[("wamid.1", "573001112233", "hola")]])

    no_secret = _meta_config(db, make_user, app_secret_encrypted="")
    assert _post_meta(client, no_secret.id, raw, None).status_code == 403

    broken = _meta_config(db, make_user, app_secret_encrypted="no-es-un-token-fernet")
    assert _post_meta(client, broken.id, raw, _meta_signature(raw)).status_code == 403
    assert llm_calls == []

    monkeypatch.setenv("WHATSAPP_ALLOW_UNSIGNED_WEBHOOKS", "true")
    assert _post_meta(client, no_secret.id, raw, None).status_code == 200


# ── Meta: múltiples mensajes e idempotencia ──────────────────────────────────

def test_meta_processes_all_messages_once(client, db, make_user, llm_calls, meta_sends):
    config = _meta_config(db, make_user)
    raw = _meta_payload(
        [
            [("wamid.A", "573001112233", "hola"), ("wamid.B", "573001112233", "¿horarios?")],
            [("wamid.C", "573009998877", "buenas")],
        ]
    )

    first = _post_meta(client, config.id, raw, _meta_signature(raw))
    assert first.status_code == 200
    assert len(llm_calls) == 3
    assert sorted(send[2] for send in meta_sends) == ["573001112233", "573001112233", "573009998877"]

    retry = _post_meta(client, config.id, raw, _meta_signature(raw))
    assert retry.status_code == 200
    assert len(llm_calls) == 3
    assert len(meta_sends) == 3

    stored = db.exec(select(TextMessage).where(TextMessage.role == "user")).all()
    assert sorted(message.external_id for message in stored) == ["wamid.A", "wamid.B", "wamid.C"]


def test_meta_processing_error_still_returns_200(client, db, make_user, llm_calls, monkeypatch):
    config = _meta_config(db, make_user)

    async def exploding(*args, **kwargs):
        raise RuntimeError("fallo inesperado")

    monkeypatch.setattr(ctrl.TextAgentController, "handle_whatsapp_incoming", exploding)
    raw = _meta_payload([[("wamid.X", "573001112233", "hola")]])
    res = _post_meta(client, config.id, raw, _meta_signature(raw))
    assert res.status_code == 200


def test_meta_ignores_messages_for_other_phone_number(client, db, make_user, llm_calls, meta_sends):
    config = _meta_config(db, make_user, phone_number_id="OTRO-PNID")
    raw = _meta_payload([[("wamid.Z", "573001112233", "hola")]])
    res = _post_meta(client, config.id, raw, _meta_signature(raw))
    assert res.status_code == 200
    assert res.json()["status"] == "no_messages"
    assert llm_calls == []


# ── Twilio ───────────────────────────────────────────────────────────────────

def _twilio_signature(url: str, params: dict[str, str], token: str = TWILIO_TOKEN) -> str:
    data = url + "".join(f"{k}{v}" for k, v in sorted(params.items()))
    return b64encode(hmac.new(token.encode(), data.encode(), hashlib.sha1).digest()).decode()


def _twilio_config(db, make_user, **overrides) -> TextAgentWhatsApp:
    fields = {"account_sid": "AC123", "auth_token_encrypted": encrypt_secret(TWILIO_TOKEN)}
    fields.update(overrides)
    return _seed_config(db, make_user, "twilio", **fields)


def _post_twilio(client, config_id: str, params: dict[str, str], signature: str | None):
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    if signature is not None:
        headers["X-Twilio-Signature"] = signature
    return client.post(
        f"/api/webhooks/whatsapp/{config_id}/twilio",
        content=urllib.parse.urlencode(params),
        headers=headers,
    )


def test_twilio_signature_uses_public_url_and_dedupes(client, db, make_user, llm_calls, monkeypatch):
    monkeypatch.setenv("BACKEND_PUBLIC_URL", "https://publico.example.com/api")
    config = _twilio_config(db, make_user)
    params = {
        "From": "whatsapp:+573001112233",
        "Body": "hola",
        "MessageSid": "SM123",
        "ProfileName": "",
    }
    public_url = f"https://publico.example.com/api/webhooks/whatsapp/{config.id}/twilio"

    first = _post_twilio(client, config.id, params, _twilio_signature(public_url, params))
    assert first.status_code == 200
    assert "Respuesta automatica" in first.text

    retry = _post_twilio(client, config.id, params, _twilio_signature(public_url, params))
    assert retry.status_code == 200
    assert "<Message>" not in retry.text
    assert len(llm_calls) == 1


def test_twilio_accepts_internal_url_signature_without_public_env(client, db, make_user, llm_calls):
    config = _twilio_config(db, make_user)
    params = {"From": "whatsapp:+573001112233", "Body": "hola", "MessageSid": "SM999"}
    url = f"http://testserver/api/webhooks/whatsapp/{config.id}/twilio"
    res = _post_twilio(client, config.id, params, _twilio_signature(url, params))
    assert res.status_code == 200
    assert "Respuesta automatica" in res.text


def test_twilio_fails_closed(client, db, make_user, llm_calls, monkeypatch):
    params = {"From": "whatsapp:+573001112233", "Body": "hola", "MessageSid": "SM1"}

    config = _twilio_config(db, make_user)
    url = f"http://testserver/api/webhooks/whatsapp/{config.id}/twilio"
    assert _post_twilio(client, config.id, params, None).status_code == 403
    assert _post_twilio(client, config.id, params, _twilio_signature(url, params, "otro")).status_code == 403

    broken = _twilio_config(db, make_user, auth_token_encrypted="no-es-fernet")
    broken_url = f"http://testserver/api/webhooks/whatsapp/{broken.id}/twilio"
    assert _post_twilio(client, broken.id, params, _twilio_signature(broken_url, params)).status_code == 403

    unsigned = _twilio_config(db, make_user, auth_token_encrypted="")
    assert _post_twilio(client, unsigned.id, params, None).status_code == 403
    assert llm_calls == []

    monkeypatch.setenv("WHATSAPP_ALLOW_UNSIGNED_WEBHOOKS", "true")
    assert _post_twilio(client, unsigned.id, params, None).status_code == 200
