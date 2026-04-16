from __future__ import annotations

from fastapi import APIRouter, Form, HTTPException, Query, Request, Response, status
from sqlmodel import select

from app.controllers.TextAgentController import (
    TextAgentController,
    _send_meta_message,
    _send_twilio_message,
)
from app.controllers.deps.db_session import SessionDep
from app.models.TextAgentWhatsApp import TextAgentWhatsApp
from app.utils.crypto import decrypt_secret

webhooks_router = APIRouter(prefix="/webhooks", tags=["Webhooks"])


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

    try:
        body = await request.json()
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
    session: SessionDep,
    Body: str = Form(default=""),
    From: str = Form(default=""),
):
    config = session.get(TextAgentWhatsApp, config_id)
    if not config or not config.active or config.provider != "twilio":
        return Response(
            content='<?xml version="1.0"?><Response></Response>',
            media_type="application/xml",
        )

    sender = From.replace("whatsapp:", "").strip()
    text = Body.strip()

    if not text:
        return Response(
            content='<?xml version="1.0"?><Response></Response>',
            media_type="application/xml",
        )

    reply = await TextAgentController.handle_whatsapp_incoming(config_id, sender, text, session)

    if not reply:
        return Response(
            content='<?xml version="1.0"?><Response></Response>',
            media_type="application/xml",
        )

    safe_reply = reply.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    twiml = f'<?xml version="1.0"?><Response><Message>{safe_reply}</Message></Response>'
    return Response(content=twiml, media_type="application/xml")
