from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any, Mapping

import httpx

from app.models.UserWhatsAppConfig import UserWhatsAppConfig
from app.utils.crypto import decrypt_secret

SUPPORTED_WA_PROVIDERS = {"twilio", "meta"}

DEFAULT_ESCALATION_TEMPLATE = (
    "Hola, soy el asistente virtual de {agent_name}. "
    "Tu solicitud fue escalada y un asesor humano te contactara pronto. "
    "Resumen: {summary}"
)

DEFAULT_APPOINTMENT_TEMPLATE = (
    "Tu cita con {agent_name} fue agendada para {appointment_date} ({timezone})."
)


def normalize_recipient(phone_number: str) -> str:
    return str(phone_number or "").replace("whatsapp:", "").strip()


def _format_twilio_whatsapp_number(phone_number: str) -> str:
    normalized = normalize_recipient(phone_number)
    if not normalized:
        return ""
    if normalized.startswith("whatsapp:"):
        return normalized
    return f"whatsapp:{normalized}"


def render_template(template: str, context: Mapping[str, Any]) -> str:
    safe_context = defaultdict(str, {k: "" if v is None else str(v) for k, v in context.items()})
    return str(template or "").format_map(safe_context).strip()


def has_valid_credentials(config: UserWhatsAppConfig) -> bool:
    provider = str(config.provider or "").strip().lower()
    if provider == "twilio":
        return bool(
            str(config.account_sid or "").strip()
            and str(config.auth_token_encrypted or "").strip()
            and str(config.default_sender_number or "").strip()
        )

    if provider == "meta":
        return bool(
            str(config.access_token_encrypted or "").strip()
            and str(config.phone_number_id or "").strip()
        )

    return False


def build_escalation_message(
    config: UserWhatsAppConfig,
    *,
    agent_name: str,
    summary: str,
) -> str:
    template = str(config.message_template_escalation or "").strip() or DEFAULT_ESCALATION_TEMPLATE
    return render_template(
        template,
        {
            "agent_name": agent_name,
            "summary": summary,
            "timestamp": datetime.utcnow().isoformat(timespec="seconds"),
        },
    )


def build_appointment_confirmation_message(
    config: UserWhatsAppConfig,
    *,
    agent_name: str,
    appointment_date: str,
    timezone: str,
) -> str:
    template = str(config.message_template_appointment or "").strip() or DEFAULT_APPOINTMENT_TEMPLATE
    return render_template(
        template,
        {
            "agent_name": agent_name,
            "appointment_date": appointment_date,
            "timezone": timezone,
            "timestamp": datetime.utcnow().isoformat(timespec="seconds"),
        },
    )


def send_whatsapp_message(
    config: UserWhatsAppConfig,
    *,
    to_number: str,
    message: str,
) -> None:
    provider = str(config.provider or "").strip().lower()
    body = str(message or "").strip()

    if provider not in SUPPORTED_WA_PROVIDERS:
        raise RuntimeError("Proveedor de WhatsApp no soportado")

    if not body:
        raise RuntimeError("El mensaje de WhatsApp esta vacio")

    recipient = normalize_recipient(to_number)
    if not recipient:
        raise RuntimeError("Numero destino requerido para WhatsApp")

    if provider == "twilio":
        if not has_valid_credentials(config):
            raise RuntimeError("Credenciales de Twilio incompletas para WhatsApp")

        account_sid = str(config.account_sid or "").strip()
        auth_token = decrypt_secret(config.auth_token_encrypted)
        from_number = _format_twilio_whatsapp_number(config.default_sender_number)
        to_number_fmt = _format_twilio_whatsapp_number(recipient)
        url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"

        with httpx.Client(timeout=30) as client:
            response = client.post(
                url,
                auth=(account_sid, auth_token),
                data={"From": from_number, "To": to_number_fmt, "Body": body},
            )

        if not response.is_success:
            raise RuntimeError(f"Twilio rechazo el envio: {response.text}")
        return

    if not has_valid_credentials(config):
        raise RuntimeError("Credenciales de Meta incompletas para WhatsApp")

    access_token = decrypt_secret(config.access_token_encrypted)
    phone_number_id = str(config.phone_number_id or "").strip()

    url = f"https://graph.facebook.com/v18.0/{phone_number_id}/messages"
    with httpx.Client(timeout=30) as client:
        response = client.post(
            url,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            json={
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": recipient,
                "type": "text",
                "text": {"body": body},
            },
        )

    if not response.is_success:
        raise RuntimeError(f"Meta rechazo el envio: {response.text}")
