from __future__ import annotations

import json
import os
from datetime import timedelta
from typing import Any

from app.models.TextAppointment import TextAppointment


def _is_google_calendar_enabled() -> bool:
    value = str(os.getenv("GOOGLE_CALENDAR_ENABLED", "")).strip().lower()
    return value in {"1", "true", "yes", "on"}


def _load_service_account_info() -> dict[str, Any] | None:
    raw_json = str(os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "")).strip()
    if raw_json:
        try:
            parsed = json.loads(raw_json)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return None

    file_path = str(os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "")).strip()
    if not file_path:
        return None

    try:
        with open(file_path, "r", encoding="utf-8") as file_handle:
            parsed = json.load(file_handle)
            return parsed if isinstance(parsed, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _build_event_payload(appointment: TextAppointment) -> dict[str, Any]:
    start_at = appointment.appointment_date
    end_at = start_at + timedelta(minutes=45)

    contact_target = (
        appointment.contact_name
        or appointment.contact_phone
        or appointment.contact_email
        or "Cliente"
    )

    source_bits: list[str] = []
    if appointment.text_agent_id:
        source_bits.append(f"text_agent_id={appointment.text_agent_id}")
    if appointment.voice_agent_id:
        source_bits.append(f"voice_agent_id={appointment.voice_agent_id}")
    if appointment.conversation_id:
        source_bits.append(f"conversation_id={appointment.conversation_id}")

    description_parts = [
        f"Canal: {appointment.source}",
        f"Telefono: {appointment.contact_phone or 'N/A'}",
        f"Email: {appointment.contact_email or 'N/A'}",
        f"Notas: {appointment.notes or 'Sin notas'}",
    ]

    if source_bits:
        description_parts.append("Metadatos: " + ", ".join(source_bits))

    return {
        "summary": f"Cita Yturria - {contact_target}",
        "description": "\n".join(description_parts),
        "start": {
            "dateTime": start_at.isoformat(),
            "timeZone": appointment.timezone or "America/Bogota",
        },
        "end": {
            "dateTime": end_at.isoformat(),
            "timeZone": appointment.timezone or "America/Bogota",
        },
    }


def sync_google_calendar_for_appointment(
    appointment: TextAppointment,
    *,
    operation: str = "upsert",
) -> dict[str, str]:
    calendar_id = str(os.getenv("GOOGLE_CALENDAR_ID", "primary")).strip() or "primary"

    if not _is_google_calendar_enabled():
        return {
            "status": "not_configured",
            "event_id": appointment.google_event_id or "",
            "calendar_id": calendar_id,
            "error": "",
        }

    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
    except Exception:
        return {
            "status": "error",
            "event_id": appointment.google_event_id or "",
            "calendar_id": calendar_id,
            "error": "Dependencias de Google Calendar no instaladas",
        }

    credentials_info = _load_service_account_info()
    if not credentials_info:
        return {
            "status": "not_configured",
            "event_id": appointment.google_event_id or "",
            "calendar_id": calendar_id,
            "error": "Credenciales de Google Calendar no configuradas",
        }

    normalized_operation = operation if operation in {"upsert", "delete"} else "upsert"

    try:
        credentials = service_account.Credentials.from_service_account_info(
            credentials_info,
            scopes=["https://www.googleapis.com/auth/calendar"],
        )
        calendar_service = build(
            "calendar",
            "v3",
            credentials=credentials,
            cache_discovery=False,
        )
        events_api = calendar_service.events()

        if normalized_operation == "delete":
            if appointment.google_event_id:
                events_api.delete(
                    calendarId=calendar_id,
                    eventId=appointment.google_event_id,
                ).execute()
            return {
                "status": "synced",
                "event_id": "",
                "calendar_id": calendar_id,
                "error": "",
            }

        event_payload = _build_event_payload(appointment)
        if appointment.google_event_id:
            event = events_api.update(
                calendarId=calendar_id,
                eventId=appointment.google_event_id,
                body=event_payload,
            ).execute()
        else:
            event = events_api.insert(
                calendarId=calendar_id,
                body=event_payload,
            ).execute()

        event_id = str(event.get("id") or appointment.google_event_id or "")
        return {
            "status": "synced",
            "event_id": event_id,
            "calendar_id": calendar_id,
            "error": "",
        }
    except Exception as exc:
        return {
            "status": "error",
            "event_id": appointment.google_event_id or "",
            "calendar_id": calendar_id,
            "error": str(exc)[:250],
        }
