from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import urllib.parse
from base64 import b64encode
from types import SimpleNamespace
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from sqlmodel import Session, select

from app.controllers.AgentController import AgentController
from app.controllers.TextAgentController import (
    TextAgentController,
    _send_meta_message,
    _send_twilio_message,
)
from app.controllers.deps.db_session import SessionDep
from app.models.TextAgentWhatsApp import TextAgentWhatsApp
from app.models.UserAgent import UserAgent
from app.models.VoiceMessage import VoiceMessage
from app.models.UserWhatsAppConfig import UserWhatsAppConfig
from app.services.whatsapp_service import has_valid_credentials, send_whatsapp_message
from app.utils.crypto import decrypt_secret

webhooks_router = APIRouter(prefix="/webhooks", tags=["Webhooks"])
logger = logging.getLogger(__name__)

_XML_EMPTY = '<?xml version="1.0"?><Response></Response>'
VOICE_TOOL_TOKEN = os.getenv("VOICE_AGENT_TOOL_TOKEN", "").strip()


def _allow_unsigned_webhooks() -> bool:
    """Solo para desarrollo: acepta webhooks de WhatsApp sin secreto configurado."""
    return os.getenv("WHATSAPP_ALLOW_UNSIGNED_WEBHOOKS", "false").strip().lower() == "true"


def _validate_twilio_signature(auth_token: str, url: str, params: dict[str, str], signature: str) -> bool:
    """HMAC-SHA1 sobre url + sorted(params). Ver docs.twilio.com/docs/usage/security."""
    s = url + "".join(f"{k}{v}" for k, v in sorted(params.items()))
    mac = hmac.new(auth_token.encode(), s.encode(), hashlib.sha1)
    expected = b64encode(mac.digest())
    return hmac.compare_digest(expected, str(signature or "").strip().encode("utf-8"))


def _validate_meta_signature(app_secret: str, raw_body: bytes, signature_header: str) -> bool:
    """HMAC-SHA256 sobre raw_body. Header: 'sha256=<hex>'. Ver developers.facebook.com/docs/graph-api/webhooks/getting-started."""
    if not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    provided = signature_header[7:].strip().lower()
    return hmac.compare_digest(expected.encode("utf-8"), provided.encode("utf-8"))


def _public_request_url(request: Request) -> str:
    """URL pública que firmó Twilio; detrás de proxy/túnel request.url es la interna."""
    base = os.getenv("BACKEND_PUBLIC_URL", "").strip().rstrip("/")
    if not base:
        return str(request.url)
    path = request.url.path
    if base.endswith("/api") and (path == "/api" or path.startswith("/api/")):
        path = path[len("/api"):]
    url = base + path
    if request.url.query:
        url += "?" + request.url.query
    return url


def _verify_meta_request(config: TextAgentWhatsApp, raw_body: bytes, request: Request) -> None:
    """Falla cerrado: sin app_secret o con error al descifrarlo se rechaza la petición."""
    app_secret_enc = str(getattr(config, "app_secret_encrypted", "") or "")
    if not app_secret_enc:
        if _allow_unsigned_webhooks():
            logger.warning(
                "Webhook Meta %s aceptado SIN firma (WHATSAPP_ALLOW_UNSIGNED_WEBHOOKS=true)",
                config.id,
            )
            return
        logger.warning("Webhook Meta %s rechazado: no hay app_secret configurado", config.id)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Webhook sin app_secret configurado",
        )

    try:
        app_secret = decrypt_secret(app_secret_enc)
    except Exception:
        logger.error("No se pudo descifrar el app_secret de Meta (config %s)", config.id)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Firma de Meta inválida",
        )

    sig = request.headers.get("X-Hub-Signature-256", "")
    if not sig or not _validate_meta_signature(app_secret, raw_body, sig):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Firma de Meta inválida",
        )


def _twilio_request_is_authentic(
    config: TextAgentWhatsApp,
    request: Request,
    params: dict[str, str],
) -> bool:
    if not config.auth_token_encrypted:
        if _allow_unsigned_webhooks():
            logger.warning(
                "Webhook Twilio %s aceptado SIN firma (WHATSAPP_ALLOW_UNSIGNED_WEBHOOKS=true)",
                config.id,
            )
            return True
        logger.warning("Webhook Twilio %s rechazado: no hay auth_token configurado", config.id)
        return False

    try:
        auth_token = decrypt_secret(config.auth_token_encrypted)
    except Exception:
        logger.error("No se pudo descifrar el auth_token de Twilio (config %s)", config.id)
        return False

    sig = request.headers.get("X-Twilio-Signature", "")
    if not sig:
        return False

    candidate_urls = dict.fromkeys([_public_request_url(request), str(request.url)])
    return any(
        _validate_twilio_signature(auth_token, url, params, sig) for url in candidate_urls
    )


def _extract_meta_text_messages(body: Any, phone_number_id: str = "") -> list[dict[str, str]]:
    """Todos los mensajes de texto del payload (Meta puede agrupar varios entries/changes)."""
    items: list[dict[str, str]] = []
    if not isinstance(body, dict):
        return items

    for entry in body.get("entry") or []:
        if not isinstance(entry, dict):
            continue
        for change in entry.get("changes") or []:
            if not isinstance(change, dict):
                continue
            value = change.get("value")
            if not isinstance(value, dict):
                continue

            metadata = value.get("metadata")
            target_number_id = (
                str(metadata.get("phone_number_id") or "").strip()
                if isinstance(metadata, dict)
                else ""
            )
            if phone_number_id and target_number_id and target_number_id != phone_number_id:
                logger.info("Webhook Meta para otro phone_number_id (%s) ignorado", target_number_id)
                continue

            for msg in value.get("messages") or []:
                if not isinstance(msg, dict) or msg.get("type") != "text":
                    continue
                text_payload = msg.get("text")
                text = (
                    str(text_payload.get("body") or "").strip()
                    if isinstance(text_payload, dict)
                    else ""
                )
                sender = str(msg.get("from") or "").strip()
                if not text or not sender:
                    continue
                items.append(
                    {"id": str(msg.get("id") or "").strip(), "from": sender, "text": text}
                )
    return items


async def _process_meta_messages(bind: Any, config_id: str, items: list[dict[str, str]]) -> None:
    """Procesa mensajes de Meta fuera del ciclo de la petición, con su propia sesión."""
    for item in items:
        try:
            with Session(bind, expire_on_commit=False) as session:
                reply = await TextAgentController.handle_whatsapp_incoming(
                    config_id,
                    item["from"],
                    item["text"],
                    session,
                    external_id=item.get("id") or None,
                )
                if not reply:
                    continue
                config = session.get(TextAgentWhatsApp, config_id)
                if not config or not config.access_token_encrypted or not config.phone_number_id:
                    continue
                access_token = decrypt_secret(config.access_token_encrypted)
                phone_number_id = config.phone_number_id

            await run_in_threadpool(
                _send_meta_message, access_token, phone_number_id, item["from"], reply
            )
        except Exception:
            logger.exception("Error procesando mensaje de WhatsApp (Meta) %s", item.get("id"))


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

    expected_token = str(config.webhook_verify_token or "")
    if (
        hub_mode == "subscribe"
        and expected_token
        and hmac.compare_digest(
            str(hub_verify_token or "").encode("utf-8"),
            expected_token.encode("utf-8"),
        )
    ):
        return Response(content=hub_challenge, media_type="text/plain")

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Token de verificacion invalido")


@webhooks_router.post("/whatsapp/{config_id}/meta")
async def meta_webhook_message(
    config_id: str,
    request: Request,
    session: SessionDep,
    background_tasks: BackgroundTasks,
):
    config = session.get(TextAgentWhatsApp, config_id)
    if not config or not config.active or config.provider != "meta":
        return {"status": "ignored"}

    raw_body = await request.body()
    _verify_meta_request(config, raw_body, request)

    try:
        body = json.loads(raw_body)
    except Exception:
        return {"status": "ignored"}

    items = _extract_meta_text_messages(body, str(config.phone_number_id or "").strip())
    if not items:
        return {"status": "no_messages"}

    # Se confirma a Meta de inmediato (200) y se procesa en segundo plano; los
    # reintentos de Meta se deduplican por wamid en handle_whatsapp_incoming.
    background_tasks.add_task(_process_meta_messages, session.get_bind(), config_id, items)
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
    try:
        # Twilio firma todos los parámetros, incluidos los vacíos.
        params = dict(urllib.parse.parse_qsl(raw_body.decode("utf-8"), keep_blank_values=True))
    except UnicodeDecodeError:
        return Response(content=_XML_EMPTY, media_type="application/xml", status_code=400)

    if not _twilio_request_is_authentic(config, request, params):
        return Response(content=_XML_EMPTY, media_type="application/xml", status_code=403)

    From = params.get("From", "")
    Body = params.get("Body", "").strip()
    message_sid = str(params.get("MessageSid") or params.get("SmsMessageSid") or "").strip()

    sender = From.replace("whatsapp:", "").strip()

    if not Body:
        return Response(content=_XML_EMPTY, media_type="application/xml")

    try:
        reply = await TextAgentController.handle_whatsapp_incoming(
            config_id, sender, Body, session, external_id=message_sid or None
        )
    except Exception:
        logger.exception("Error procesando mensaje de WhatsApp (Twilio) %s", message_sid)
        reply = ""

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


@webhooks_router.post("/voice/tools/take-message")
async def voice_tool_take_message(request: Request, session: SessionDep):
    """Recibe un recado de voz cuando no se pudo transferir la llamada.

    Guarda el recado y envía WhatsApp al asesor con el resumen.
    """
    _validate_voice_tool_token(request)

    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload invalido",
        )

    agent_id = str(payload.get("agent_id") or "").strip()
    caller_number = str(payload.get("caller_number") or "").strip()
    requested_person = str(payload.get("requested_person") or "").strip()
    message_summary = str(payload.get("message_summary") or "").strip()
    full_transcript = str(payload.get("full_transcript") or "").strip()

    if not agent_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="agent_id es requerido",
        )

    current_user = _tool_runtime_user_for_agent(agent_id, session)

    # Guardar el recado en la base de datos
    voice_message = VoiceMessage(
        user_id=current_user.id,
        voice_agent_id=agent_id,
        caller_number=caller_number,
        requested_person=requested_person,
        message_summary=message_summary,
        full_transcript=full_transcript,
    )
    session.add(voice_message)

    # Buscar configuración de WhatsApp del usuario
    wa_config = session.exec(
        select(UserWhatsAppConfig).where(
            UserWhatsAppConfig.user_id == current_user.id,
            UserWhatsAppConfig.active == True,
        )
    ).first()

    whatsapp_sent = False
    if wa_config and has_valid_credentials(wa_config):
        # Buscar el número de escalamiento del agente
        from app.models.VoiceAgentRuntimeConfig import VoiceAgentRuntimeConfig

        runtime = session.exec(
            select(VoiceAgentRuntimeConfig).where(
                VoiceAgentRuntimeConfig.agent_id == agent_id
            )
        ).first()

        advisor_number = ""
        if runtime and runtime.escalation_phone_number:
            advisor_number = runtime.escalation_phone_number
        elif wa_config.default_sender_number:
            # Fallback: no enviar al mismo número del remitente, sino buscar un contacto
            pass

        # Si no hay número de escalamiento, buscar en contactos
        if not advisor_number:
            from app.models.Contact import Contact
            contact = session.exec(
                select(Contact).where(
                    Contact.user_id == current_user.id,
                    Contact.active == True,
                ).order_by(Contact.created_at)
            ).first()
            if contact and contact.whatsapp:
                advisor_number = contact.whatsapp
            elif contact and contact.phone:
                advisor_number = contact.phone

        if advisor_number:
            try:
                msg_body = (
                    f"📞 *Recado de llamada*\n\n"
                    f"*Llamante:* {caller_number}\n"
                    f"*Buscaba a:* {requested_person or 'No especificado'}\n"
                    f"*Resumen:* {message_summary or 'No proporcionado'}\n\n"
                    f"*Agente:* {agent_id}"
                )
                await run_in_threadpool(
                    send_whatsapp_message,
                    wa_config,
                    to_number=advisor_number,
                    message=msg_body,
                )
                whatsapp_sent = True
                from datetime import datetime
                voice_message.whatsapp_sent = True
                voice_message.whatsapp_sent_at = datetime.utcnow()
            except Exception:
                logger.exception("No se pudo enviar el recado de voz por WhatsApp")

    session.commit()
    return {
        "status": "ok",
        "voice_message_id": voice_message.id,
        "whatsapp_sent": whatsapp_sent,
    }
