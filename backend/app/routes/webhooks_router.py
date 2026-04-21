from __future__ import annotations

import hashlib
import hmac
import json
import os
import urllib.parse
from base64 import b64encode
from types import SimpleNamespace

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from sqlmodel import select

from app.controllers.AgentController import AgentController
from app.controllers.TextAgentController import (
    TextAgentController,
    _send_meta_message,
    _send_twilio_message,
)
from app.controllers.deps.db_session import SessionDep
from app.models.TextAgentWhatsApp import TextAgentWhatsApp
from app.models.UserAgent import UserAgent
from app.utils.crypto import decrypt_secret

webhooks_router = APIRouter(prefix="/webhooks", tags=["Webhooks"])

_XML_EMPTY = '<?xml version="1.0"?><Response></Response>'
VOICE_TOOL_TOKEN = os.getenv("VOICE_AGENT_TOOL_TOKEN", "").strip()


def _validate_twilio_signature(auth_token: str, url: str, params: dict[str, str], signature: str) -> bool:
    """HMAC-SHA1 sobre url + sorted(params). Ver docs.twilio.com/docs/usage/security."""
    s = url + "".join(f"{k}{v}" for k, v in sorted(params.items()))
    mac = hmac.new(auth_token.encode(), s.encode(), hashlib.sha1)
    expected = b64encode(mac.digest()).decode()
    return hmac.compare_digest(expected, signature)


def _validate_meta_signature(app_secret: str, raw_body: bytes, signature_header: str) -> bool:
    """HMAC-SHA256 sobre raw_body. Header: 'sha256=<hex>'. Ver developers.facebook.com/docs/graph-api/webhooks/getting-started."""
    if not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header[7:])


def _validate_voice_tool_token(request: Request) -> None:
    if not VOICE_TOOL_TOKEN:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="VOICE_AGENT_TOOL_TOKEN no configurado",
        )

    provided = request.headers.get("X-Voice-Tool-Token", "").strip()
    if not provided or not hmac.compare_digest(provided, VOICE_TOOL_TOKEN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token de herramienta invalido",
        )


def _tool_runtime_user_for_agent(agent_id: str, session: SessionDep) -> SimpleNamespace:
    owner = session.exec(select(UserAgent).where(UserAgent.agent_id == agent_id)).first()
    if not owner:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No se encontro ownership local para ese agente",
        )
    return SimpleNamespace(id=owner.user_id, role="agent")


@webhooks_router.get("/whatsapp/{config_id}/meta")
async def meta_webhook_verify(
    config_id: str,
    session: SessionDep,
    hub_mode: str = Query(alias="hub.mode", default=""),
    hub_verify_token: str = Query(alias="hub.verify_token", default=""),
    hub_challenge: str = Query(alias="hub.challenge", default=""),
):
    config = session.get(TextAgentWhatsApp, config_id)
    if not config:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Config no encontrada")

    if hub_mode == "subscribe" and hub_verify_token == config.webhook_verify_token:
        return Response(content=hub_challenge, media_type="text/plain")

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token de verificacion invalido")


@webhooks_router.post("/whatsapp/{config_id}/meta")
async def meta_webhook_message(
    config_id: str,
    request: Request,
    session: SessionDep,
):
    config = session.get(TextAgentWhatsApp, config_id)
    if not config or not config.active or config.provider != "meta":
        return {"status": "ignored"}

    raw_body = await request.body()

    app_secret_enc = getattr(config, "app_secret_encrypted", "")
    if app_secret_enc:
        sig = request.headers.get("X-Hub-Signature-256", "")
        try:
            app_secret = decrypt_secret(app_secret_enc)
            if not sig or not _validate_meta_signature(app_secret, raw_body, sig):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Firma de Meta inválida",
                )
        except HTTPException:
            raise
        except Exception:
            pass

    try:
        body = json.loads(raw_body)
    except Exception:
        return {"status": "ignored"}

    try:
        entry = body.get("entry", [{}])[0]
        changes = entry.get("changes", [{}])[0]
        value = changes.get("value", {})
        messages = value.get("messages", [])
        if not messages:
            return {"status": "no_messages"}

        msg = messages[0]
        sender = msg.get("from", "")
        msg_type = msg.get("type", "")
        if msg_type != "text":
            return {"status": "non_text"}

        text = msg.get("text", {}).get("body", "").strip()
        if not text:
            return {"status": "empty"}
    except Exception:
        return {"status": "parse_error"}

    reply = await TextAgentController.handle_whatsapp_incoming(config_id, sender, text, session)

    if reply and config.access_token_encrypted and config.phone_number_id:
        try:
            access_token = decrypt_secret(config.access_token_encrypted)
            _send_meta_message(access_token, config.phone_number_id, sender, reply)
        except Exception:
            pass

    return {"status": "ok"}


@webhooks_router.post("/whatsapp/{config_id}/twilio")
async def twilio_webhook_message(
    config_id: str,
    request: Request,
    session: SessionDep,
):
    config = session.get(TextAgentWhatsApp, config_id)
    if not config or not config.active or config.provider != "twilio":
        return Response(content=_XML_EMPTY, media_type="application/xml")

    raw_body = await request.body()

    if config.auth_token_encrypted:
        sig = request.headers.get("X-Twilio-Signature", "")
        try:
            auth_token = decrypt_secret(config.auth_token_encrypted)
            # request.url reflects internal URL; behind a TLS proxy set
            # FORWARDED / X-Forwarded-Proto middleware so this matches Twilio's URL.
            url = str(request.url)
            params = dict(urllib.parse.parse_qsl(raw_body.decode("utf-8")))
            if not sig or not _validate_twilio_signature(auth_token, url, params, sig):
                return Response(content=_XML_EMPTY, media_type="application/xml", status_code=403)
        except Exception:
            pass

    params = dict(urllib.parse.parse_qsl(raw_body.decode("utf-8")))
    From = params.get("From", "")
    Body = params.get("Body", "").strip()

    sender = From.replace("whatsapp:", "").strip()

    if not Body:
        return Response(content=_XML_EMPTY, media_type="application/xml")

    reply = await TextAgentController.handle_whatsapp_incoming(config_id, sender, Body, session)

    if not reply:
        return Response(content=_XML_EMPTY, media_type="application/xml")

    safe_reply = reply.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    twiml = f'<?xml version="1.0"?><Response><Message>{safe_reply}</Message></Response>'
    return Response(content=twiml, media_type="application/xml")


@webhooks_router.post("/voice/tools/send-whatsapp-message")
async def voice_tool_send_whatsapp_message(request: Request, session: SessionDep):
    _validate_voice_tool_token(request)

    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload invalido",
        )

    agent_id = str(payload.get("agent_id") or "").strip()
    if not agent_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="agent_id es requerido",
        )

    current_user = _tool_runtime_user_for_agent(agent_id, session)
    escalation_payload = {
        "channel": "whatsapp",
        "phone_number": payload.get("phone_number"),
        "message": payload.get("message"),
        "summary": payload.get("summary"),
        "conversation_id": payload.get("conversation_id"),
        "agent_name": payload.get("agent_name"),
    }
    return await AgentController.escalate_voice_conversation(
        agent_id,
        escalation_payload,
        current_user,
        session,
    )


@webhooks_router.post("/voice/tools/schedule-appointment")
async def voice_tool_schedule_appointment(request: Request, session: SessionDep):
    _validate_voice_tool_token(request)

    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload invalido",
        )

    agent_id = str(payload.get("agent_id") or "").strip()
    if not agent_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="agent_id es requerido",
        )

    current_user = _tool_runtime_user_for_agent(agent_id, session)
    return await AgentController.schedule_voice_appointment(
        agent_id,
        payload,
        current_user,
        session,
    )
