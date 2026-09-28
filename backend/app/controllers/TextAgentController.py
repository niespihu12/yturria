from __future__ import annotations

import io
import ipaddress
import json
import logging
import os
import re
import secrets
import socket
from datetime import datetime, timedelta, timezone
from html import escape
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from fastapi import HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func
from sqlalchemy.exc import DataError, IntegrityError
from sqlmodel import delete, select

from app.controllers.deps.auth import CurrentUser
from app.controllers.deps.db_session import SessionDep
from app.models.AuditTrailEvent import AuditTrailEvent
from app.models.TextAgent import TextAgent
from app.models.TextAppointment import TextAppointment
from app.models.TextAgentKnowledgeBase import TextAgentKnowledgeBase
from app.models.TextAgentTool import TextAgentTool
from app.models.TextAgentWhatsApp import TextAgentWhatsApp
from app.models.TextConversation import TextConversation
from app.models.TextKnowledgeBaseChunk import TextKnowledgeBaseChunk
from app.models.TextKnowledgeBaseDocument import TextKnowledgeBaseDocument
from app.models.TextMessage import TextMessage, message_order
from app.models.TextProviderConfig import TextProviderConfig
from app.models.UserCalendarConnection import UserCalendarConnection
from app.utils.crypto import decrypt_secret, encrypt_secret, mask_secret
from app.models.User import User
from app.utils.client_defaults import TENANT
from app.utils.text_agent_templates import (
    TEXT_AGENT_DEFAULT_TEMPLATE_KEY,
    TEXT_AGENT_NON_ADMIN_LIMIT,
    apply_text_agent_template_defaults,
    default_text_model_for_provider,
    get_text_agent_template_definition,
    is_text_agent_template_key_supported,
    list_text_agent_templates,
    normalize_text_agent_template_key,
)
from app.utils.roles import is_super_admin_user, role_as_value
from app.services.google_calendar import sync_google_calendar_for_appointment
from app.services.appointment_service import is_time_slot_available
from app.services.renewal_scheduler import run_due_renewal_reminders
from app.services.sofia_graph import run_sofia
from app.services.sofia_prompts import ADVISOR_NOTIFICATION_TEMPLATE
from app.services.sofia_config import get_contact_confirmation_message, get_contact_request_message
from app.services.contact_capture import ContactInfo, contact_display, extract_contact
from app.config.email import send_email_async

logger = logging.getLogger(__name__)

SUPPORTED_PROVIDERS = {"openai", "gemini"}
SUPPORTED_TOOL_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}
SUPPORTED_USAGE_MODES = {"auto", "prompt"}
SUPPORTED_WA_PROVIDERS = {"meta", "twilio"}
SUPPORTED_APPOINTMENT_STATUSES = {
    "scheduled",
    "confirmed",
    "completed",
    "cancelled",
    "no_show",
}
SUPPORTED_APPOINTMENT_SOURCES = {"manual", "agent", "embed", "phone", "voice"}
DEFAULT_APPOINTMENT_TIMEZONE = "America/Bogota"

_WEEKDAY_INDEX = {
    "lunes": 0,
    "martes": 1,
    "miercoles": 2,
    "jueves": 3,
    "viernes": 4,
    "sabado": 5,
    "domingo": 6,
}

TEXT_AGENTS_REQUIRE_USER_KEYS = (
    os.getenv("TEXT_AGENTS_REQUIRE_USER_KEYS", "false").strip().lower() == "true"
)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
FRONTEND_PUBLIC_URL = (
    os.getenv("FRONTEND_PUBLIC_URL")
    or os.getenv("FRONTEND_URL")
    or "http://localhost:5173"
).split(",")[0].strip().rstrip("/")
TOOL_CALL_TAG_START = "<tool_call>"
TOOL_CALL_TAG_END = "</tool_call>"

try:
    TOOL_EXECUTION_TIMEOUT_SECONDS = int(
        str(os.getenv("TEXT_TOOL_TIMEOUT_SECONDS", "20")).strip() or "20"
    )
except ValueError:
    TOOL_EXECUTION_TIMEOUT_SECONDS = 20

TOOL_EXECUTION_TIMEOUT_SECONDS = max(3, min(120, TOOL_EXECUTION_TIMEOUT_SECONDS))

try:
    HISTORY_MESSAGE_LIMIT = int(str(os.getenv("TEXT_AGENT_HISTORY_LIMIT", "30")).strip() or "30")
except ValueError:
    HISTORY_MESSAGE_LIMIT = 30
HISTORY_MESSAGE_LIMIT = max(2, min(200, HISTORY_MESSAGE_LIMIT))

MAX_CHAT_MESSAGE_CHARS = 4000
MAX_TOOL_FIELD_CHARS = 255
KB_MAX_FILE_BYTES = 5 * 1024 * 1024
KB_TEXT_EXTENSIONS = {".txt", ".md", ".csv", ".json", ".html", ".htm", ".xml"}
KB_ALLOWED_EXTENSIONS = KB_TEXT_EXTENSIONS | {".pdf"}
ACTIVE_APPOINTMENT_STATUSES = ("scheduled", "confirmed")
_SENSITIVE_HEADER_RE = re.compile(
    r"auth|token|key|secret|cookie|passw|session|signature|credential",
    re.IGNORECASE,
)

_CHUNK_SIZE = 500
_CHUNK_OVERLAP = 80
_RAG_TOP_K = 5


# ─── Helpers ────────────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.utcnow()


def _maybe_prepend_legal_notice(
    content: str,
    legal_notice: str,
    has_prior_assistant: bool,
) -> str:
    """Prepend the effective legal notice to the first assistant response.

    Effective notice = agent-level legal_notice if set, else TENANT.legal_notice fallback.
    Idempotent: no-ops on any turn after the first assistant message.
    """
    notice = (legal_notice or "").strip() or TENANT.legal_notice.strip()
    if not notice or has_prior_assistant:
        return content
    return f"{notice}\n\n{content}"


def _to_unix(value: datetime | None) -> int | None:
    if value is None:
        return None
    if value.tzinfo is not None:
        return int(value.astimezone(timezone.utc).timestamp())
    return int(value.replace(tzinfo=timezone.utc).timestamp())


def _parse_optional_datetime(value: Any) -> datetime | None:
    if value is None:
        return None

    if isinstance(value, datetime):
        return value

    if isinstance(value, (int, float)):
        if value <= 0:
            return None
        try:
            return datetime.utcfromtimestamp(int(value))
        except (OverflowError, OSError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Fecha invalida: unix timestamp fuera de rango",
            ) from exc

    raw = str(value).strip()
    if not raw:
        return None

    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"

    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="renewal_date debe ser ISO8601 o unix timestamp",
        ) from exc

    # Si trae offset (ej. -05:00), convertir a UTC antes de guardar como naive UTC.
    if parsed.tzinfo:
        return parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _parse_number_field(
    payload: dict[str, Any],
    key: str,
    *,
    default: float,
    cast: type = float,
) -> float:
    raw = payload.get(key)
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return cast(default)
    if isinstance(raw, bool):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{key} debe ser numerico",
        )
    try:
        value = float(raw)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{key} debe ser numerico",
        ) from exc
    if value != value or value in (float("inf"), float("-inf")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{key} debe ser numerico",
        )
    return cast(value)


def _validate_chat_message(payload: dict[str, Any]) -> str:
    user_message = str(payload.get("message") or "").strip()
    if not user_message:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="message es requerido",
        )
    if len(user_message) > MAX_CHAT_MESSAGE_CHARS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"El mensaje excede el maximo de {MAX_CHAT_MESSAGE_CHARS} caracteres",
        )
    return user_message


def _load_recent_history(session: SessionDep, conversation_id: str) -> list[dict[str, str]]:
    """Ultimos HISTORY_MESSAGE_LIMIT mensajes (user/assistant) en orden cronologico."""
    rows = session.exec(
        select(TextMessage)
        .where(
            TextMessage.conversation_id == conversation_id,
            TextMessage.deleted_at == None,
            TextMessage.role.in_(["user", "assistant"]),
        )
        .order_by(*message_order(newest_first=True))
        .limit(HISTORY_MESSAGE_LIMIT)
    ).all()
    return [{"role": row.role, "content": row.content} for row in reversed(rows)]


def _has_prior_assistant_message(session: SessionDep, conversation_id: str) -> bool:
    return (
        session.exec(
            select(TextMessage.id).where(
                TextMessage.conversation_id == conversation_id,
                TextMessage.deleted_at == None,
                TextMessage.role == "assistant",
            ).limit(1)
        ).first()
        is not None
    )


def _count_user_messages(session: SessionDep, conversation_id: str) -> int:
    return int(
        session.exec(
            select(func.count(TextMessage.id)).where(
                TextMessage.conversation_id == conversation_id,
                TextMessage.deleted_at == None,
                TextMessage.role == "user",
            )
        ).one()
        or 0
    )


def _latest_messages_by_conversation(
    session: SessionDep,
    conversation_ids: list[str],
    *,
    role: str | None = None,
) -> dict[str, TextMessage]:
    """Ultimo mensaje (no borrado) de cada conversacion con una sola consulta agregada."""
    if not conversation_ids:
        return {}

    filters = [
        TextMessage.conversation_id.in_(conversation_ids),
        TextMessage.deleted_at == None,
    ]
    if role:
        filters.append(TextMessage.role == role)

    latest = (
        select(
            TextMessage.conversation_id.label("conversation_id"),
            func.max(TextMessage.created_at).label("max_created_at"),
        )
        .where(*filters)
        .group_by(TextMessage.conversation_id)
        .subquery()
    )
    rows = session.exec(
        select(TextMessage)
        .join(
            latest,
            (TextMessage.conversation_id == latest.c.conversation_id)
            & (TextMessage.created_at == latest.c.max_created_at),
        )
        .where(*filters)
    ).all()
    return {row.conversation_id: row for row in rows}


def _normalize_sofia_config_json_value(raw_value: Any) -> str:
    if isinstance(raw_value, dict):
        parsed = raw_value
    elif isinstance(raw_value, str):
        raw_text = raw_value.strip()
        if not raw_text:
            return "{}"
        try:
            parsed = json.loads(raw_text)
        except (TypeError, ValueError):
            return "{}"
    else:
        return "{}"

    if not isinstance(parsed, dict):
        return "{}"

    try:
        return json.dumps(parsed)
    except (TypeError, ValueError):
        return "{}"


def _validate_sofia_config_escalation_threshold(sofia_config_json: str) -> None:
    try:
        cfg = json.loads(sofia_config_json or "{}")
    except (json.JSONDecodeError, TypeError):
        return
    if not isinstance(cfg, dict):
        return
    if "escalation_threshold" not in cfg:
        return
    val = cfg["escalation_threshold"]
    try:
        val = int(val)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="escalation_threshold debe ser un entero",
        )
    if not (1 <= val <= 20):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="escalation_threshold debe estar entre 1 y 20",
        )


def _extract_sofia_config_json(payload: dict[str, Any], fallback: str = "{}") -> tuple[bool, str]:
    if "sofia_config" in payload:
        return True, _normalize_sofia_config_json_value(payload.get("sofia_config"))

    if "sofia_config_json" in payload:
        return True, _normalize_sofia_config_json_value(payload.get("sofia_config_json"))

    return False, fallback


def _log_audit_event(
    session: SessionDep,
    *,
    event_type: str,
    actor_user_id: str | None,
    subject_user_id: str | None,
    entity_type: str,
    entity_id: str,
    details: dict[str, Any] | None = None,
) -> None:
    session.add(
        AuditTrailEvent(
            event_type=event_type,
            actor_user_id=actor_user_id,
            subject_user_id=subject_user_id,
            entity_type=entity_type,
            entity_id=entity_id,
            details_json=json.dumps(details or {}),
        )
    )


def _normalize_provider(value: Any) -> str:
    provider = str(value or "").strip().lower()
    if provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Proveedor no soportado. Usa openai o gemini",
        )
    return provider


def _default_model(provider: str) -> str:
    return default_text_model_for_provider(provider)


def _resolve_template_key(value: Any, *, fallback: str = TEXT_AGENT_DEFAULT_TEMPLATE_KEY) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return fallback
    if not is_text_agent_template_key_supported(raw):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Plantilla no soportada",
        )
    return normalize_text_agent_template_key(raw, fallback=fallback)


def _commit_with_data_error_guard(session: SessionDep) -> None:
    try:
        session.commit()
    except DataError as exc:
        session.rollback()
        message = str(exc).lower()

        if "system_prompt" in message or "welcome_message" in message:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "El contenido del prompt excede el limite actual de la columna en base de datos. "
                    "Reinicia el backend para aplicar la migracion de columnas LONGTEXT e intenta de nuevo."
                ),
            ) from exc

        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fue posible guardar el registro por un limite de longitud en base de datos.",
        ) from exc


def _apply_google_calendar_sync(
    session: SessionDep,
    appointment: TextAppointment,
    *,
    operation: str = "upsert",
) -> None:
    try:
        result = sync_google_calendar_for_appointment(appointment, operation=operation)
    except Exception:
        logger.exception("Fallo inesperado al sincronizar Google Calendar")
        appointment.google_sync_status = "error"
        appointment.google_sync_error = "Error inesperado al sincronizar Google Calendar"
        appointment.updated_at = _utcnow()
        session.add(appointment)
        return

    appointment.google_sync_status = str(result.get("status") or "error")[:50]
    appointment.google_event_id = str(result.get("event_id") or "")[:255]
    appointment.google_calendar_id = str(result.get("calendar_id") or "")[:255]
    appointment.google_sync_error = str(result.get("error") or "")[:500]
    appointment.updated_at = _utcnow()
    session.add(appointment)


def _normalize_optional_user_id(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _normalize_session_id(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return secrets.token_hex(8)
    filtered = "".join(char for char in raw if char.isalnum() or char in {"-", "_"})
    return filtered[:64] or secrets.token_hex(8)


def _build_embed_iframe_url(text_agent_id: str, embed_token: str) -> str:
    return f"{FRONTEND_PUBLIC_URL}/embed/text-agent/{text_agent_id}?token={embed_token}"


def _build_embed_iframe_snippet(iframe_url: str) -> str:
    return "\n".join(
        [
            "<iframe",
            f'  src="{iframe_url}"',
            '  title="Chat asistente"',
            '  width="100%"',
            '  height="720"',
            '  style="border:0;border-radius:16px;"',
            "></iframe>",
        ]
    )


def _build_embed_script_snippet(iframe_url: str) -> str:
    return "\n".join(
        [
            '<div id="yturria-text-agent-embed"></div>',
            "<script>",
            '  const root = document.getElementById("yturria-text-agent-embed");',
            "  if (root) {",
            "    root.innerHTML = `",
            (
                f'      <iframe src="{iframe_url}" title="Chat asistente" width="100%" '
                'height="720" style="border:0;border-radius:16px;"></iframe>'
            ),
            "    `;",
            "  }",
            "</script>",
        ]
    )


def _ensure_embed_token(agent: TextAgent) -> bool:
    if str(agent.embed_token or "").strip():
        return False
    agent.embed_token = secrets.token_urlsafe(24)
    return True


def _resolve_user_scope(current_user: CurrentUser, requested_user_id: str | None) -> str | None:
    normalized_requested = _normalize_optional_user_id(requested_user_id)

    if not is_super_admin_user(current_user):
        if normalized_requested and normalized_requested != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permisos para consultar recursos de otro usuario",
            )
        return current_user.id

    return normalized_requested


def _build_user_lookup(session: SessionDep, user_ids: set[str]) -> dict[str, User]:
    if not user_ids:
        return {}

    users = session.exec(select(User).where(User.id.in_(user_ids))).all()
    return {user.id: user for user in users}


def _require_owned_text_agent(
    text_agent_id: str,
    current_user: CurrentUser,
    session: SessionDep,
) -> TextAgent:
    row = session.get(TextAgent, text_agent_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agente de texto no encontrado o sin permisos",
        )

    if row.user_id != current_user.id and not is_super_admin_user(current_user):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agente de texto no encontrado o sin permisos",
        )
    return row


def _require_public_embed_agent(
    text_agent_id: str,
    embed_token: str,
    session: SessionDep,
) -> TextAgent:
    token = str(embed_token or "").strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de integración requerido",
        )

    agent = session.get(TextAgent, text_agent_id)
    if not agent or not agent.embed_enabled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Integración no disponible para este agente",
        )

    expected = str(agent.embed_token or "")
    if not expected or not secrets.compare_digest(expected, token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de integración inválido",
        )

    return agent


def _require_owned_document(
    document_id: str,
    current_user: CurrentUser,
    session: SessionDep,
) -> TextKnowledgeBaseDocument:
    row = session.get(TextKnowledgeBaseDocument, document_id)
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Documento no encontrado o sin permisos",
        )

    if row.user_id != current_user.id and not is_super_admin_user(current_user):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Documento no encontrado o sin permisos",
        )
    return row


def _get_env_provider_key(provider: str) -> str:
    if provider == "openai":
        return OPENAI_API_KEY
    if provider == "gemini":
        return GEMINI_API_KEY
    return ""


def _resolve_provider_api_key(
    provider: str,
    current_user: CurrentUser,
    session: SessionDep,
) -> tuple[str, str]:
    env_key = _get_env_provider_key(provider)
    if env_key and not TEXT_AGENTS_REQUIRE_USER_KEYS:
        return env_key, "env"

    config = session.exec(
        select(TextProviderConfig).where(
            TextProviderConfig.user_id == current_user.id,
            TextProviderConfig.provider == provider,
        )
    ).first()
    if config:
        return decrypt_secret(config.api_key_encrypted), "user"

    if env_key:
        return env_key, "env"

    if TEXT_AGENTS_REQUIRE_USER_KEYS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Debes configurar una API key para {provider} antes de usar este proveedor",
        )

    env_var_name = "OPENAI_API_KEY" if provider == "openai" else "GEMINI_API_KEY"
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            f"No hay API key disponible para {provider}. "
            f"Configura {env_var_name} en el backend o habilita llaves por usuario"
        ),
    )


def _serialize_provider_config(config: TextProviderConfig | None, provider: str) -> dict[str, Any]:
    env_key = _get_env_provider_key(provider)
    if env_key and not TEXT_AGENTS_REQUIRE_USER_KEYS:
        return {
            "provider": provider,
            "has_api_key": True,
            "api_key_masked": mask_secret(env_key),
            "updated_at_unix_secs": None,
            "source": "env",
            "editable": False,
        }

    if not config:
        return {
            "provider": provider,
            "has_api_key": False,
            "api_key_masked": "",
            "updated_at_unix_secs": None,
            "source": "none",
            "editable": TEXT_AGENTS_REQUIRE_USER_KEYS,
        }

    try:
        masked = mask_secret(decrypt_secret(config.api_key_encrypted))
    except ValueError:
        masked = "configurada"

    return {
        "provider": config.provider,
        "has_api_key": True,
        "api_key_masked": masked,
        "updated_at_unix_secs": _to_unix(config.updated_at),
        "source": "user",
        "editable": True,
    }


def _mask_header_value(name: str, value: Any) -> str:
    text_value = str(value if value is not None else "")
    if _SENSITIVE_HEADER_RE.search(str(name or "")):
        return mask_secret(text_value)
    return text_value


def _load_tool_headers(tool: TextAgentTool) -> dict[str, str]:
    try:
        parsed = json.loads(tool.headers_json or "{}")
    except (json.JSONDecodeError, TypeError):
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {str(k): str(v) for k, v in parsed.items()}


def _merge_masked_headers(
    incoming: dict[str, Any],
    existing: dict[str, str],
) -> dict[str, str]:
    """Si el cliente reenvia un header enmascarado, conserva el valor real guardado."""
    merged: dict[str, str] = {}
    for key, value in incoming.items():
        name = str(key)
        text_value = str(value if value is not None else "")
        previous = existing.get(name)
        if (
            previous is not None
            and _SENSITIVE_HEADER_RE.search(name)
            and text_value == mask_secret(previous)
        ):
            merged[name] = previous
        else:
            merged[name] = text_value
    return merged


def _serialize_tool(tool: TextAgentTool) -> dict[str, Any]:
    parsed_headers = {
        name: _mask_header_value(name, value)
        for name, value in _load_tool_headers(tool).items()
    }

    try:
        parameters_schema = json.loads(tool.parameters_schema_json or "{}")
    except (json.JSONDecodeError, TypeError):
        parameters_schema = {}

    try:
        response_mapping = json.loads(tool.response_mapping_json or "{}")
    except (json.JSONDecodeError, TypeError):
        response_mapping = {}

    return {
        "id": tool.id,
        "name": tool.name,
        "description": tool.description,
        "endpoint_url": tool.endpoint_url,
        "http_method": tool.http_method,
        "headers": parsed_headers,
        "body_template": tool.body_template,
        "parameters_schema": parameters_schema,
        "response_mapping": response_mapping,
        "enabled": tool.enabled,
        "created_at_unix_secs": _to_unix(tool.created_at),
        "updated_at_unix_secs": _to_unix(tool.updated_at),
    }


def _serialize_appointment(appointment: TextAppointment) -> dict[str, Any]:
    return {
        "id": appointment.id,
        "text_agent_id": appointment.text_agent_id,
        "voice_agent_id": appointment.voice_agent_id,
        "conversation_id": appointment.conversation_id,
        "contact_name": appointment.contact_name,
        "contact_phone": appointment.contact_phone,
        "contact_email": appointment.contact_email,
        "appointment_date_unix_secs": _to_unix(appointment.appointment_date),
        "timezone": appointment.timezone,
        "status": appointment.status,
        "source": appointment.source,
        "notes": appointment.notes,
        "google_event_id": appointment.google_event_id,
        "google_calendar_id": appointment.google_calendar_id,
        "google_sync_status": appointment.google_sync_status,
        "google_sync_error": appointment.google_sync_error,
        "created_at_unix_secs": _to_unix(appointment.created_at),
        "updated_at_unix_secs": _to_unix(appointment.updated_at),
    }


def _serialize_document(
    doc: TextKnowledgeBaseDocument,
    owner: User | None = None,
) -> dict[str, Any]:
    payload = {
        "id": doc.id,
        "name": doc.name,
        "source_type": doc.source_type,
        "source_value": doc.source_value,
        "content_preview": doc.content[:240],
        "index_status": getattr(doc, "index_status", "indexed"),
        "chunk_count": getattr(doc, "chunk_count", 0),
        "created_at_unix_secs": _to_unix(doc.created_at),
        "updated_at_unix_secs": _to_unix(doc.updated_at),
    }

    if owner:
        payload["owner_user_id"] = owner.id
        payload["owner_name"] = owner.name
        payload["owner_email"] = owner.email
        payload["owner_role"] = role_as_value(owner.role)

    return payload


def _serialize_text_agent(
    agent: TextAgent,
    owner: User | None = None,
) -> dict[str, Any]:
    fallback_template_key = "sofia" if getattr(agent, "sofia_mode", False) else "custom"
    template_key = normalize_text_agent_template_key(
        getattr(agent, "template_key", ""),
        fallback=fallback_template_key,
    )
    template_definition = get_text_agent_template_definition(template_key)

    try:
        sofia_config = json.loads(agent.sofia_config_json or "{}")
    except (json.JSONDecodeError, TypeError):
        sofia_config = {}

    payload = {
        "agent_id": agent.id,
        "name": agent.name,
        "provider": agent.provider,
        "model": agent.model,
        "template_key": template_definition["key"],
        "template_label": template_definition["label"],
        "template_summary": template_definition["summary"],
        "template_description": template_definition["description"],
        "template_highlights": list(template_definition["highlights"]),
        "template_capabilities": dict(template_definition["capabilities"]),
        "system_prompt": agent.system_prompt,
        "welcome_message": agent.welcome_message,
        "language": agent.language,
        "temperature": agent.temperature,
        "max_tokens": agent.max_tokens,
        "sofia_mode": agent.sofia_mode,
        "embed_enabled": agent.embed_enabled,
        "sofia_config": sofia_config,
        "sofia_config_json": json.dumps(sofia_config),
        "legal_notice": agent.legal_notice or "",
        "created_at_unix_secs": _to_unix(agent.created_at),
        "updated_at_unix_secs": _to_unix(agent.updated_at),
    }

    if owner:
        payload["owner_user_id"] = owner.id
        payload["owner_name"] = owner.name
        payload["owner_email"] = owner.email
        payload["owner_role"] = role_as_value(owner.role)

    return payload


def _serialize_whatsapp(config: TextAgentWhatsApp) -> dict[str, Any]:
    has_credentials = False
    if config.provider == "twilio":
        has_credentials = bool(config.account_sid and config.auth_token_encrypted)
    elif config.provider == "meta":
        has_credentials = bool(config.access_token_encrypted and config.phone_number_id)

    return {
        "id": config.id,
        "text_agent_id": config.text_agent_id,
        "provider": config.provider,
        "phone_number": config.phone_number,
        "account_sid": config.account_sid,
        "phone_number_id": config.phone_number_id,
        "business_account_id": config.business_account_id,
        "webhook_verify_token": config.webhook_verify_token,
        "has_credentials": has_credentials,
        "has_app_secret": bool(getattr(config, "app_secret_encrypted", "")),
        "active": config.active,
        "created_at_unix_secs": _to_unix(config.created_at),
        "updated_at_unix_secs": _to_unix(config.updated_at),
    }


def _list_agent_tools(session: SessionDep, text_agent_id: str) -> list[TextAgentTool]:
    return session.exec(
        select(TextAgentTool)
        .where(TextAgentTool.text_agent_id == text_agent_id)
        .order_by(TextAgentTool.created_at.asc())
    ).all()


def _ensure_default_appointment_tool(session: SessionDep, agent: TextAgent) -> None:
    existing = session.exec(
        select(TextAgentTool).where(
            TextAgentTool.text_agent_id == agent.id,
            TextAgentTool.endpoint_url == "internal://appointments.create",
        )
    ).first()
    if existing:
        return

    now = _utcnow()
    tool = TextAgentTool(
        text_agent_id=agent.id,
        name="agendar_cita",
        description=(
            "Agenda citas comerciales para el cliente. "
            "Requiere appointment_date y al menos un dato de contacto."
        ),
        endpoint_url="internal://appointments.create",
        http_method="POST",
        headers_json="{}",
        body_template="",
        parameters_schema_json=json.dumps(
            {
                "type": "object",
                "properties": {
                    "appointment_date": {
                        "type": "string",
                        "description": "Fecha y hora ISO8601 de la cita",
                    },
                    "contact_name": {
                        "type": "string",
                        "description": "Nombre completo del contacto",
                    },
                    "contact_phone": {
                        "type": "string",
                        "description": "Telefono del contacto",
                    },
                    "contact_email": {
                        "type": "string",
                        "description": "Correo del contacto",
                    },
                    "timezone": {
                        "type": "string",
                        "description": "Zona horaria IANA, ej. America/Bogota",
                    },
                    "notes": {
                        "type": "string",
                        "description": "Notas relevantes para el asesor",
                    },
                },
                "required": ["appointment_date"],
            }
        ),
        response_mapping_json=json.dumps(
            {
                "display_template": (
                    "Cita agendada para {{appointment_date_unix_secs}} "
                    "(estado: {{status}})."
                )
            }
        ),
        enabled=True,
        created_at=now,
        updated_at=now,
    )
    session.add(tool)
    _commit_with_data_error_guard(session)


def _list_agent_knowledge_base(
    session: SessionDep,
    text_agent_id: str,
) -> list[dict[str, Any]]:
    links = session.exec(
        select(TextAgentKnowledgeBase).where(
            TextAgentKnowledgeBase.text_agent_id == text_agent_id
        )
    ).all()

    if not links:
        return []

    doc_ids = [link.document_id for link in links]
    docs = session.exec(
        select(TextKnowledgeBaseDocument).where(TextKnowledgeBaseDocument.id.in_(doc_ids))
    ).all()
    docs_map = {doc.id: doc for doc in docs}

    response: list[dict[str, Any]] = []
    for link in links:
        doc = docs_map.get(link.document_id)
        if not doc:
            continue
        payload = _serialize_document(doc)
        payload["usage_mode"] = link.usage_mode
        response.append(payload)
    return response


# ─── RAG ────────────────────────────────────────────────────────────────────

def _chunk_text(text: str) -> list[str]:
    text = text.strip()
    if not text:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + _CHUNK_SIZE, len(text))
        if end < len(text):
            for sep in ["\n\n", ".\n", ". ", "\n"]:
                pos = text.rfind(sep, start + 80, end)
                if pos > start + 40:
                    end = pos + len(sep)
                    break
        chunk = text[start:end].strip()
        if chunk and len(chunk) > 20:
            chunks.append(chunk)
        if end >= len(text):
            break
        start = end - _CHUNK_OVERLAP
    return chunks


def _index_document(
    doc: TextKnowledgeBaseDocument,
    session: SessionDep,
) -> int:
    session.exec(
        delete(TextKnowledgeBaseChunk).where(
            TextKnowledgeBaseChunk.document_id == doc.id
        )
    )

    chunks = _chunk_text(doc.content)
    now = _utcnow()
    for i, chunk_text in enumerate(chunks):
        session.add(
            TextKnowledgeBaseChunk(
                document_id=doc.id,
                chunk_index=i,
                content=chunk_text,
                created_at=now,
            )
        )
    return len(chunks)


def _reindex_document_safely(doc: TextKnowledgeBaseDocument, session: SessionDep) -> None:
    doc_id = doc.id
    try:
        count = _index_document(doc, session)
        doc.chunk_count = count
        doc.index_status = "indexed"
        doc.updated_at = _utcnow()
        session.add(doc)
        session.commit()
        session.refresh(doc)
    except Exception:
        # Tras un flush fallido la sesión queda inválida: rollback antes de tocar `doc`.
        session.rollback()
        logger.exception("No se pudo indexar el documento %s", doc_id)
        doc.index_status = "failed"
        doc.updated_at = _utcnow()
        session.add(doc)
        session.commit()
        session.refresh(doc)


def _decode_text_file(raw: bytes) -> str | None:
    """Decodifica un archivo de texto; None si parece binario."""
    if b"\x00" in raw:
        return None
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(encoding).strip()
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1").strip()


def _read_pdf_pages_text(raw: bytes) -> list[str]:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(raw))
    if reader.is_encrypted:
        try:
            decrypted = reader.decrypt("")
        except Exception:
            decrypted = 0
        if not decrypted:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El PDF esta protegido con contraseña. Sube una version sin proteccion.",
            )
    return [page.extract_text() or "" for page in reader.pages]


def _extract_pdf_text(raw: bytes) -> str:
    """Texto de un PDF; 400 si esta cifrado, dañado o no tiene texto (p. ej. escaneado)."""
    try:
        pages = _read_pdf_pages_text(raw)
    except HTTPException:
        raise
    except Exception as exc:
        logger.info("PDF ilegible en base de conocimiento", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pudo leer el PDF. Verifica que el archivo no este dañado.",
        ) from exc

    text_content = "\n\n".join(
        page.replace("\x00", "").strip() for page in pages if page and page.strip()
    ).strip()
    if not text_content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "El PDF no contiene texto extraible (puede ser un documento escaneado). "
                "Sube un PDF con texto seleccionable o un archivo de texto."
            ),
        )
    return text_content


def _score_chunk(query_terms: set[str], chunk_content: str) -> float:
    words = chunk_content.lower().split()
    word_set = set(words)
    overlap = query_terms & word_set
    if not overlap:
        return 0.0
    precision = len(overlap) / max(len(query_terms), 1)
    tf_bonus = sum(words.count(t) for t in overlap) * 0.05
    return precision + tf_bonus


def _retrieve_rag_context(
    session: SessionDep,
    agent_id: str,
    query: str,
) -> str:
    links = session.exec(
        select(TextAgentKnowledgeBase).where(
            TextAgentKnowledgeBase.text_agent_id == agent_id
        )
    ).all()
    if not links:
        return ""

    doc_ids = [link.document_id for link in links]

    chunks = session.exec(
        select(TextKnowledgeBaseChunk).where(
            TextKnowledgeBaseChunk.document_id.in_(doc_ids)
        )
    ).all()

    if not chunks:
        docs = session.exec(
            select(TextKnowledgeBaseDocument).where(
                TextKnowledgeBaseDocument.id.in_(doc_ids)
            )
        ).all()
        if not docs:
            return ""
        parts = [doc.content[:2000] for doc in docs if doc.content.strip()]
        combined = "\n\n".join(parts[:3])
        return f"Contexto de base de conocimiento:\n{combined}" if combined else ""

    query_terms = set(query.lower().split())
    scored = sorted(
        [(c, _score_chunk(query_terms, c.content)) for c in chunks],
        key=lambda x: x[1],
        reverse=True,
    )

    top = scored[:_RAG_TOP_K]
    if all(s == 0.0 for _, s in top):
        top = scored[:3]

    lines = [c.content.strip() for c, _ in top if c.content.strip()]
    if not lines:
        return ""

    return "Contexto de base de conocimiento:\n" + "\n\n---\n\n".join(lines)


_SPANISH_WEEKDAYS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]
_SPANISH_MONTHS = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
]


def _build_datetime_context_block(timezone_name: str = DEFAULT_APPOINTMENT_TIMEZONE) -> str:
    """Bloque con la fecha/hora actual para que el modelo no invente fechas."""
    local_now = _utc_naive_to_local_naive(_utcnow(), timezone_name)
    fecha = (
        f"{_SPANISH_WEEKDAYS[local_now.weekday()]} {local_now.day} de "
        f"{_SPANISH_MONTHS[local_now.month - 1]} de {local_now.year}"
    )
    return (
        f"Fecha y hora actual: {fecha}, {local_now.strftime('%H:%M')} (zona horaria {timezone_name}).\n"
        f"El ano en curso es {local_now.year}. Cuando el cliente diga 'hoy', 'manana', 'el lunes', etc., "
        "calcula la fecha SIEMPRE a partir de esta fecha actual y usa el ano en curso. "
        "Las citas son a futuro: nunca uses fechas de anos anteriores ni fechas que ya pasaron."
    )


def _build_tools_description(tools: list[TextAgentTool]) -> str:
    active = [t for t in tools if t.enabled]
    if not active:
        return ""
    lines = [
        "Herramientas disponibles (usa su nombre cuando el usuario las necesite):",
        (
            "Cuando necesites ejecutar una herramienta responde SOLO con "
            f"{TOOL_CALL_TAG_START}{{\"tool\":\"nombre\",\"arguments\":{{}}}}{TOOL_CALL_TAG_END}"
        ),
        "No agregues texto fuera del bloque <tool_call> cuando vayas a ejecutar herramienta.",
    ]
    for tool in active:
        try:
            schema = json.loads(tool.parameters_schema_json or "{}")
        except (json.JSONDecodeError, TypeError):
            schema = {}

        compact_schema = json.dumps(schema, ensure_ascii=False)
        if len(compact_schema) > 480:
            compact_schema = compact_schema[:480] + "..."

        lines.append(f"- {tool.name}: {tool.description or 'Sin descripcion'}")
        if compact_schema and compact_schema != "{}":
            lines.append(f"  parametros_schema: {compact_schema}")
    return "\n".join(lines)


def _json_preview(value: Any, limit: int = 1600) -> str:
    try:
        raw = json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        raw = str(value)

    return raw if len(raw) <= limit else (raw[:limit] + "...")


def _parse_json_object(raw: str) -> dict[str, Any] | None:
    text = str(raw or "").strip()
    if not text:
        return None

    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text, flags=re.IGNORECASE).strip()
        text = re.sub(r"```$", "", text).strip()

    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None

    return data if isinstance(data, dict) else None


def _find_first_json_object(text: str) -> str | None:
    """Devuelve el primer objeto JSON balanceado {...} dentro del texto.

    Ignora llaves dentro de cadenas. Tolera texto antes/despues del objeto.
    """
    depth = 0
    start_idx = -1
    in_string = False
    escape = False
    for i, ch in enumerate(text):
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            if depth == 0:
                start_idx = i
            depth += 1
        elif ch == "}" and depth > 0:
            depth -= 1
            if depth == 0 and start_idx != -1:
                return text[start_idx : i + 1]
    return None


def _extract_tool_call(content: str) -> tuple[str, dict[str, Any]] | None:
    text = str(content or "")
    payload: dict[str, Any] | None = None

    # 1) Bloque <tool_call>...</tool_call> (con o sin etiqueta de cierre).
    start = text.find(TOOL_CALL_TAG_START)
    if start != -1:
        end = text.find(TOOL_CALL_TAG_END, start + len(TOOL_CALL_TAG_START))
        fragment = (
            text[start + len(TOOL_CALL_TAG_START):end]
            if end != -1
            else text[start + len(TOOL_CALL_TAG_START):]
        ).strip()
        payload = _parse_json_object(fragment)
        if payload is None:
            obj = _find_first_json_object(fragment)
            if obj:
                payload = _parse_json_object(obj)

    # 2) JSON puro (toda la respuesta es el objeto).
    if payload is None:
        stripped = text.strip()
        if stripped.startswith("{") and stripped.endswith("}"):
            payload = _parse_json_object(stripped)

    # 3) JSON embebido en cualquier parte (el modelo agrego texto antes/despues).
    if payload is None:
        obj = _find_first_json_object(text)
        if obj:
            candidate = _parse_json_object(obj)
            if isinstance(candidate, dict) and (candidate.get("tool") or candidate.get("tool_name")):
                payload = candidate

    if not payload:
        return None

    tool_name = str(payload.get("tool") or payload.get("tool_name") or "").strip()
    if not tool_name:
        return None

    arguments = payload.get("arguments")
    if not isinstance(arguments, dict):
        arguments = {}

    return tool_name, arguments


def _get_nested_value(payload: Any, path: str) -> Any:
    current = payload
    for segment in [p for p in str(path).split(".") if p]:
        if isinstance(current, dict):
            current = current.get(segment)
            continue
        if isinstance(current, list) and segment.isdigit():
            index = int(segment)
            if 0 <= index < len(current):
                current = current[index]
                continue
        return None
    return current


def _render_template(template: str, payload: Any) -> str:
    pattern = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")

    def repl(match: re.Match[str]) -> str:
        key = match.group(1).strip()
        value = _get_nested_value(payload, key)
        if value is None:
            return ""
        if isinstance(value, (dict, list)):
            return _json_preview(value, limit=220)
        return str(value)

    return pattern.sub(repl, template)


def _apply_response_mapping(tool: TextAgentTool, response_payload: Any) -> str | None:
    try:
        mapping = json.loads(tool.response_mapping_json or "{}")
    except (json.JSONDecodeError, TypeError):
        mapping = {}

    if not isinstance(mapping, dict) or not mapping:
        return None

    result_path = str(mapping.get("result_path") or "").strip()
    display_template = str(mapping.get("display_template") or "").strip()

    target = response_payload
    if result_path:
        target = _get_nested_value(response_payload, result_path)

    if display_template:
        rendered = _render_template(display_template, target if target is not None else response_payload)
        rendered = rendered.strip()
        return rendered or None

    if target is None:
        return None
    if isinstance(target, (dict, list)):
        return _json_preview(target)
    return str(target)


def _allowed_tool_hosts() -> set[str]:
    raw = str(os.getenv("TEXT_AGENT_TOOLS_ALLOWED_HOSTS", "")).strip()
    if not raw:
        return set()
    return {item.strip().lower() for item in raw.split(",") if item.strip()}


def _resolve_host_ips(hostname: str, port: int | None) -> list[str]:
    infos = socket.getaddrinfo(hostname, port or 443, proto=socket.IPPROTO_TCP)
    return sorted({str(info[4][0]) for info in infos})


def _is_public_ip(raw_ip: str) -> bool:
    try:
        ip = ipaddress.ip_address(str(raw_ip).split("%", 1)[0])
    except ValueError:
        return False
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        ip = mapped
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    ):
        return False
    return ip.is_global


def _check_tool_endpoint(endpoint_url: str) -> tuple[str | None, int, str | None]:
    """Valida un endpoint contra SSRF. Devuelve (error, status_code, ip_a_fijar).

    ip_a_fijar es la IP pública ya validada cuando el host es un nombre DNS: la
    petición debe conectarse a esa IP para evitar DNS rebinding.
    """
    endpoint = str(endpoint_url or "").strip()
    if not endpoint:
        return "endpoint_url vacío en herramienta", 400, None

    if urlparse(endpoint).scheme.lower() == "internal":
        return None, 200, None

    try:
        url = httpx.URL(endpoint)
    except (httpx.InvalidURL, TypeError, ValueError):
        return "endpoint_url invalido", 400, None

    if url.scheme.lower() not in {"http", "https"}:
        return "Solo se permiten endpoints http/https o internal://", 400, None

    hostname = str(url.host or "").strip().lower().rstrip(".")
    if not hostname:
        return "endpoint_url no tiene un host valido", 400, None

    allowed_hosts = _allowed_tool_hosts()
    if allowed_hosts:
        # Con lista blanca configurada, el administrador decide qué hosts son confiables.
        if hostname not in allowed_hosts:
            return f"Host no permitido por política: {hostname}", 403, None
        return None, 200, None

    pinned_ip: str | None = None
    try:
        ipaddress.ip_address(hostname.strip("[]"))
        resolved_ips = [hostname.strip("[]")]
    except ValueError:
        try:
            resolved_ips = _resolve_host_ips(hostname, url.port)
        except (OSError, UnicodeError, ValueError):
            return f"No se pudo resolver el host del endpoint: {hostname}", 400, None
        pinned_ip = resolved_ips[0] if resolved_ips else None

    if not resolved_ips or not all(_is_public_ip(ip) for ip in resolved_ips):
        return "El endpoint apunta a una red interna o reservada y no esta permitido", 400, None

    return None, 200, pinned_ip


def _validate_tool_endpoint(endpoint_url: str) -> tuple[str | None, int]:
    """Valida un endpoint de herramienta contra SSRF. Devuelve (error, status_code)."""
    error, status_code, _ = _check_tool_endpoint(endpoint_url)
    return error, status_code


def _pin_request_to_ip(endpoint: str, pinned_ip: str) -> tuple[str, dict[str, str], dict[str, Any]]:
    """Reescribe la URL para conectar a la IP validada conservando Host y SNI/TLS del dominio."""
    url = httpx.URL(endpoint)
    host_header = url.host if url.port is None else f"{url.host}:{url.port}"
    extensions: dict[str, Any] = {}
    if url.scheme.lower() == "https":
        # El certificado se sigue verificando contra el dominio original.
        extensions["sni_hostname"] = url.host
    return str(url.copy_with(host=pinned_ip)), {"Host": host_header}, extensions


def _validate_tool_field_lengths(**fields: str) -> None:
    for field_name, value in fields.items():
        if len(str(value or "")) > MAX_TOOL_FIELD_CHARS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{field_name} excede el maximo de {MAX_TOOL_FIELD_CHARS} caracteres",
            )


def _require_safe_tool_endpoint(endpoint_url: str) -> None:
    error, _ = _validate_tool_endpoint(endpoint_url)
    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)


def _execute_internal_tool(
    tool: TextAgentTool,
    arguments: dict[str, Any],
    *,
    session: SessionDep,
    agent: TextAgent,
    conversation: TextConversation,
) -> dict[str, Any]:
    parsed = urlparse(tool.endpoint_url.strip())
    action = str(parsed.netloc or parsed.path.lstrip("/") or "").strip().lower()

    if action != "appointments.create":
        return {
            "ok": False,
            "status_code": 400,
            "error": f"Acción interna no soportada: {action or '(vacía)'}",
            "data": None,
            "mapped_text": None,
        }

    timezone_name = (
        str(arguments.get("timezone") or DEFAULT_APPOINTMENT_TIMEZONE).strip()[:64]
        or DEFAULT_APPOINTMENT_TIMEZONE
    )
    if _resolve_zoneinfo(timezone_name) is None:
        return {
            "ok": False,
            "status_code": 400,
            "error": (
                f"Zona horaria invalida: {timezone_name}. "
                f"Usa un nombre IANA, por ejemplo {DEFAULT_APPOINTMENT_TIMEZONE}."
            ),
            "data": None,
            "mapped_text": None,
        }

    try:
        appointment_date = _parse_tool_appointment_datetime(
            arguments.get("appointment_date"),
            timezone_name,
        )
    except HTTPException:
        appointment_date = None

    if appointment_date is None:
        return {
            "ok": False,
            "status_code": 400,
            "error": "appointment_date es requerido para agendar cita (formato ISO8601)",
            "data": None,
            "mapped_text": None,
        }

    if appointment_date < _utcnow():
        return {
            "ok": False,
            "status_code": 400,
            "error": (
                "La fecha calculada quedo en el pasado. Confirma la fecha con el cliente "
                "usando el ano y dia actuales, y vuelve a intentar."
            ),
            "data": None,
            "mapped_text": None,
        }

    contact_name = str(arguments.get("contact_name") or "").strip()
    contact_phone = str(arguments.get("contact_phone") or "").strip()
    contact_email = str(arguments.get("contact_email") or "").strip()
    if not contact_name and not contact_phone and not contact_email:
        return {
            "ok": False,
            "status_code": 400,
            "error": "Se necesita al menos un dato de contacto para la cita",
            "data": None,
            "mapped_text": None,
        }

    if not is_time_slot_available(
        session,
        user_id=agent.user_id,
        appointment_date=appointment_date,
        buffer_minutes=0,
    ):
        return {
            "ok": False,
            "status_code": 409,
            "error": (
                "Ese horario no esta disponible: ya hay una cita o un evento en la agenda. "
                "Ofrece al cliente otra fecha u hora."
            ),
            "data": None,
            "mapped_text": None,
        }

    next_status = str(arguments.get("status") or "scheduled").strip().lower()
    if next_status not in SUPPORTED_APPOINTMENT_STATUSES:
        next_status = "scheduled"

    now = _utcnow()
    appointment = TextAppointment(
        text_agent_id=agent.id,
        user_id=agent.user_id,
        conversation_id=str(arguments.get("conversation_id") or "").strip() or conversation.id,
        contact_name=contact_name,
        contact_phone=contact_phone,
        contact_email=contact_email,
        appointment_date=appointment_date,
        timezone=timezone_name,
        status=next_status,
        source="agent",
        notes=str(arguments.get("notes") or "").strip()[:500],
        created_at=now,
        updated_at=now,
    )
    session.add(appointment)
    _apply_google_calendar_sync(session, appointment, operation="upsert")

    _log_audit_event(
        session,
        event_type="appointment_created_via_tool",
        actor_user_id=agent.user_id,
        subject_user_id=conversation.user_id,
        entity_type="text_appointment",
        entity_id=appointment.id,
        details={
            "tool": tool.name,
            "text_agent_id": agent.id,
            "conversation_id": conversation.id,
            "appointment_date_unix_secs": _to_unix(appointment.appointment_date),
        },
    )

    try:
        _commit_with_data_error_guard(session)
    except HTTPException as exc:
        return {
            "ok": False,
            "status_code": exc.status_code,
            "error": str(exc.detail),
            "data": None,
            "mapped_text": None,
        }

    session.refresh(appointment)
    data = _serialize_appointment(appointment)
    mapped_text = _apply_response_mapping(tool, data)

    return {
        "ok": True,
        "status_code": 200,
        "error": None,
        "data": data,
        "mapped_text": mapped_text,
    }


def _execute_external_http_tool(
    tool: TextAgentTool,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    endpoint = str(tool.endpoint_url or "").strip()
    if urlparse(endpoint).scheme.lower() == "internal":
        return {
            "ok": False,
            "status_code": 400,
            "error": "Solo se permiten endpoints http/https o internal://",
            "data": None,
            "mapped_text": None,
        }

    # Se revalida justo antes de ejecutar (el DNS pudo cambiar desde que se guardó).
    endpoint_error, endpoint_status, pinned_ip = _check_tool_endpoint(endpoint)
    if endpoint_error:
        return {
            "ok": False,
            "status_code": endpoint_status,
            "error": endpoint_error,
            "data": None,
            "mapped_text": None,
        }

    headers = _load_tool_headers(tool)
    method = str(tool.http_method or "POST").strip().upper()
    args = arguments if isinstance(arguments, dict) else {}

    request_url = endpoint
    request_kwargs: dict[str, Any] = {"headers": headers}
    if pinned_ip:
        request_url, pinned_headers, extensions = _pin_request_to_ip(endpoint, pinned_ip)
        request_kwargs["headers"] = {**headers, **pinned_headers}
        if extensions:
            request_kwargs["extensions"] = extensions
    if method in {"GET", "DELETE"}:
        request_kwargs["params"] = args
    else:
        request_kwargs["json"] = args

    try:
        # Sin seguir redirecciones: un 3xx podría apuntar a un host interno.
        with httpx.Client(timeout=TOOL_EXECUTION_TIMEOUT_SECONDS, follow_redirects=False) as client:
            response = client.request(method, request_url, **request_kwargs)
    except httpx.TimeoutException:
        return {
            "ok": False,
            "status_code": 504,
            "error": "Tiempo de espera agotado al ejecutar la herramienta",
            "data": None,
            "mapped_text": None,
        }
    except httpx.HTTPError:
        logger.warning("Error de red ejecutando herramienta %s", tool.name, exc_info=True)
        return {
            "ok": False,
            "status_code": 502,
            "error": "Error de red ejecutando la herramienta",
            "data": None,
            "mapped_text": None,
        }

    try:
        payload: Any = response.json()
    except ValueError:
        payload = response.text

    mapped_text = _apply_response_mapping(tool, payload)

    error_text = None
    if not response.is_success:
        if isinstance(payload, dict):
            error_text = str(payload.get("detail") or payload.get("error") or "") or None
        if error_text is None and isinstance(payload, str):
            error_text = payload[:320]
        if error_text is None:
            error_text = f"La herramienta devolvió HTTP {response.status_code}"

    return {
        "ok": response.is_success,
        "status_code": int(response.status_code),
        "error": error_text,
        "data": payload,
        "mapped_text": mapped_text,
    }


def _execute_tool(
    tool: TextAgentTool,
    arguments: dict[str, Any],
    *,
    session: SessionDep,
    agent: TextAgent,
    conversation: TextConversation,
) -> dict[str, Any]:
    parsed = urlparse(str(tool.endpoint_url or "").strip())
    if parsed.scheme == "internal":
        return _execute_internal_tool(
            tool,
            arguments,
            session=session,
            agent=agent,
            conversation=conversation,
        )

    return _execute_external_http_tool(tool, arguments)


def _dispatch_llm_with_optional_tool_execution(
    *,
    agent: TextAgent,
    session: SessionDep,
    conversation: TextConversation,
    tools: list[TextAgentTool],
    api_key: str,
    system_prompt: str,
    history: list[dict[str, str]],
) -> tuple[str, int | None]:
    first_content, first_tokens = _dispatch_llm(
        provider=agent.provider,
        api_key=api_key,
        model=agent.model,
        system_prompt=system_prompt,
        history=history,
        temperature=agent.temperature,
        max_tokens=agent.max_tokens,
    )

    active_tools = [tool for tool in tools if tool.enabled]
    if not active_tools:
        return first_content, first_tokens

    extracted = _extract_tool_call(first_content)
    if not extracted:
        return first_content, first_tokens

    requested_tool_name, arguments = extracted
    tool = next(
        (
            item
            for item in active_tools
            if str(item.name).strip().lower() == requested_tool_name.strip().lower()
        ),
        None,
    )

    if tool is None:
        tool_result = {
            "ok": False,
            "status_code": 404,
            "error": f"Herramienta no encontrada: {requested_tool_name}",
            "data": None,
            "mapped_text": None,
        }
    else:
        tool_result = _execute_tool(
            tool,
            arguments,
            session=session,
            agent=agent,
            conversation=conversation,
        )

    mapped_text = str(tool_result.get("mapped_text") or "").strip()
    if mapped_text:
        tool_summary = mapped_text
    elif tool_result.get("ok"):
        tool_summary = _json_preview(tool_result.get("data"))
    else:
        tool_summary = str(tool_result.get("error") or "No fue posible ejecutar la herramienta")

    followup_history = history + [
        {
            "role": "assistant",
            "content": f"Resultado de herramienta {requested_tool_name}: {tool_summary}",
        },
        {
            "role": "user",
            "content": (
                "Con el resultado de la herramienta, responde al usuario en español, "
                "de forma clara y breve. No uses etiquetas <tool_call>."
            ),
        },
    ]

    followup_system_prompt = (
        system_prompt
        + "\n\nYa se ejecutó una herramienta. "
        + "Si hubo error, explica que faltó o qué dato necesita el usuario para continuar."
    )

    try:
        second_content, second_tokens = _dispatch_llm(
            provider=agent.provider,
            api_key=api_key,
            model=agent.model,
            system_prompt=followup_system_prompt,
            history=followup_history,
            temperature=agent.temperature,
            max_tokens=agent.max_tokens,
        )
    except HTTPException:
        fallback = tool_summary
        if not tool_result.get("ok"):
            fallback = (
                f"No pude completar la herramienta solicitada ({requested_tool_name}). "
                f"Detalle: {tool_summary}"
            )
        return fallback, first_tokens

    if _extract_tool_call(second_content):
        second_content = tool_summary

    if first_tokens is None and second_tokens is None:
        return second_content, None

    total_tokens = int(first_tokens or 0) + int(second_tokens or 0)
    return second_content, total_tokens


def _extract_phone_candidate(value: str) -> str:
    raw = str(value or "")
    match = re.search(r"(\+?\d[\d\s\-()]{7,}\d)", raw)
    if not match:
        return ""

    phone = re.sub(r"[^\d+]", "", match.group(1)).strip()
    if phone.startswith("00"):
        phone = "+" + phone[2:]
    return phone[:40]


def _extract_email_candidate(value: str) -> str:
    raw = str(value or "")
    match = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", raw)
    return str(match.group(0)).strip()[:160] if match else ""


def _extract_name_candidate(value: str, *, contact_phone: str = "", contact_email: str = "") -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""

    if "," in raw:
        first_chunk = raw.split(",", 1)[0].strip()
        if first_chunk:
            raw = first_chunk

    has_intro = bool(re.search(r"\b(mi nombre es|soy|me llamo)\b", raw, flags=re.IGNORECASE))
    has_contact_in_message = bool(contact_phone or contact_email)
    if not has_intro and not has_contact_in_message:
        return ""

    name = raw
    if contact_phone:
        name = name.replace(contact_phone, " ")
    if contact_email:
        name = name.replace(contact_email, " ")

    name = re.sub(r"\b(mi nombre es|soy|me llamo)\b", " ", name, flags=re.IGNORECASE)
    name = re.sub(r"\b(y|and)\b", " ", name, flags=re.IGNORECASE)
    name = re.sub(r"[^A-Za-zÁÉÍÓÚáéíóúÑñ\s]", " ", name)
    name = re.split(
        r"\b(que|qué|cuando|cuándo|hora|horario|disponible|disponibles|llamada|whatsapp)\b",
        name,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    name = re.sub(r"\s+", " ", name).strip()
    return name[:120]


def _resolve_zoneinfo(timezone_name: str) -> ZoneInfo | None:
    normalized = str(timezone_name or "").strip() or "UTC"
    try:
        return ZoneInfo(normalized)
    except (ZoneInfoNotFoundError, ValueError, TypeError, OSError):
        return None


def _parse_tool_appointment_datetime(value: Any, timezone_name: str) -> datetime | None:
    """Fecha de una herramienta del LLM a UTC naive.

    El LLM razona en hora local: un ISO sin offset se interpreta en `timezone_name`.
    ISO con offset y unix timestamps ya son absolutos.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return _parse_optional_datetime(value)

    if isinstance(value, datetime):
        parsed = value
    else:
        raw = str(value).strip()
        if not raw:
            return None
        if raw[-1] in {"Z", "z"}:
            raw = raw[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError:
            return None

    try:
        if parsed.tzinfo is not None:
            return parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return _local_naive_to_utc_naive(parsed, timezone_name)
    except (OverflowError, ValueError):
        return None


def _utc_naive_to_local_naive(value: datetime, timezone_name: str) -> datetime:
    zone = _resolve_zoneinfo(timezone_name)
    if zone is None:
        return value

    return value.replace(tzinfo=timezone.utc).astimezone(zone).replace(tzinfo=None)


def _local_naive_to_utc_naive(value: datetime, timezone_name: str) -> datetime:
    zone = _resolve_zoneinfo(timezone_name)
    if zone is None:
        return value

    return value.replace(tzinfo=zone).astimezone(timezone.utc).replace(tzinfo=None)


def _parse_hour_minute_from_text(value: str) -> tuple[int, int] | None:
    raw = str(value or "")

    contextual_match = re.search(
        r"\b(?:a\s*las?|a\s*la|sobre\s*las?)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?\b",
        raw,
        flags=re.IGNORECASE,
    )
    generic_match = re.search(
        r"\b(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?\b",
        raw,
        flags=re.IGNORECASE,
    )
    match = contextual_match or generic_match
    if not match:
        return None

    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    if hour > 23 or minute > 59:
        return None

    meridian = re.sub(r"[\s\.]", "", str(match.group(3) or "").lower())
    if not meridian:
        trailing_text = raw[match.end(): match.end() + 40]
        trailing_normalized = (
            str(trailing_text).lower()
            .replace("á", "a")
            .replace("é", "e")
            .replace("í", "i")
            .replace("ó", "o")
            .replace("ú", "u")
        )

        if re.search(r"\b(de|en)\s+la\s+(tarde|noche)\b|\bdel?\s+mediodia\b", trailing_normalized):
            meridian = "pm"
        elif re.search(r"\b(de|en)\s+la\s+(manana|madrugada)\b", trailing_normalized):
            meridian = "am"

    if meridian == "pm" and hour < 12:
        hour += 12
    if meridian == "am" and hour == 12:
        hour = 0

    if hour > 23:
        return None

    return hour, minute


def _extract_requested_local_datetime_from_message(
    message: str,
    *,
    base_local_dt: datetime,
) -> datetime | None:
    raw = str(message or "").strip()
    if not raw:
        return None

    time_parts = _parse_hour_minute_from_text(raw)
    if time_parts is None:
        return None

    hour, minute = time_parts
    lowered = raw.lower()

    explicit_date_match = re.search(r"\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b", lowered)
    if explicit_date_match:
        day = int(explicit_date_match.group(1))
        month = int(explicit_date_match.group(2))
        year_raw = explicit_date_match.group(3)
        year = int(year_raw) if year_raw else base_local_dt.year
        if year < 100:
            year += 2000

        try:
            candidate = datetime(year, month, day, hour, minute)
        except ValueError:
            return None

        if not year_raw and candidate < base_local_dt:
            try:
                candidate = datetime(year + 1, month, day, hour, minute)
            except ValueError:
                pass

        return candidate

    if re.search(r"\bpasado\s+(manana|mañana)\b", lowered):
        target = (base_local_dt + timedelta(days=2)).date()
        return datetime(target.year, target.month, target.day, hour, minute)

    if re.search(r"\b(manana|mañana)\b", lowered):
        target = (base_local_dt + timedelta(days=1)).date()
        return datetime(target.year, target.month, target.day, hour, minute)

    if re.search(r"\bhoy\b", lowered):
        target = base_local_dt.date()
        return datetime(target.year, target.month, target.day, hour, minute)

    weekday_match = re.search(
        r"\b(?:(proximo|próximo|este)\s+)?(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b",
        lowered,
    )
    if weekday_match:
        qualifier = str(weekday_match.group(1) or "").strip().lower()
        weekday_text = str(weekday_match.group(2) or "").strip().lower()
        normalized_weekday = (
            weekday_text.replace("á", "a")
            .replace("é", "e")
            .replace("í", "i")
            .replace("ó", "o")
            .replace("ú", "u")
        )
        target_weekday = _WEEKDAY_INDEX.get(normalized_weekday)
        if target_weekday is None:
            return None

        delta = (target_weekday - base_local_dt.weekday()) % 7
        if delta == 0:
            if qualifier in {"proximo", "próximo"}:
                delta = 7
            elif (hour, minute) <= (base_local_dt.hour, base_local_dt.minute):
                delta = 7

        target = (base_local_dt + timedelta(days=delta)).date()
        return datetime(target.year, target.month, target.day, hour, minute)

    return None


def _extract_requested_local_datetime_from_messages(
    messages: list[str],
    *,
    base_local_dt: datetime | None = None,
) -> datetime | None:
    base = base_local_dt or _utc_naive_to_local_naive(_utcnow(), DEFAULT_APPOINTMENT_TIMEZONE)
    for message in reversed(messages):
        candidate = _extract_requested_local_datetime_from_message(
            str(message or ""),
            base_local_dt=base,
        )
        if candidate is not None:
            return candidate
    return None


def _default_appointment_datetime_utc(timezone_name: str) -> datetime:
    local_now = _utc_naive_to_local_naive(_utcnow(), timezone_name)
    candidate = local_now.replace(hour=10, minute=0, second=0, microsecond=0)
    if candidate <= local_now:
        candidate += timedelta(days=1)

    while candidate.weekday() == 6:
        candidate += timedelta(days=1)

    return _local_naive_to_utc_naive(candidate, timezone_name)


_SCHEDULING_REQUEST_RE = re.compile(
    r"\b(agendar|ag[eé]nd(?:ame|eme|emos|elo|ela|ala|e)|programar|reservar|apartar)\b"
    r"|\bagenda\s+(?:una|mi|la)\s+cita\b"
    r"|\b(quiero|quisiera|deseo|necesito|solicito|me\s+gustar[ií]a|podemos|podr[ií]a)\b"
    r"[^.?!]{0,40}\bcita\b",
    re.IGNORECASE,
)
_SCHEDULING_NEGATION_RE = re.compile(
    r"\bno\s+(?:quiero|quisiera|deseo|necesito|me\s+interesa|gracias)\b"
    r"|\bcancel\w*|\banul\w*"
    r"|^\s*no\s*[.!]*\s*$",
    re.IGNORECASE,
)


def _has_explicit_scheduling_intent(user_messages: list[str]) -> bool:
    """Requiere una solicitud afirmativa de cita; una negativa en el ultimo mensaje la anula."""
    if not user_messages:
        return False
    if _SCHEDULING_NEGATION_RE.search(str(user_messages[-1] or "")):
        return False
    return any(
        _SCHEDULING_REQUEST_RE.search(text) and not _SCHEDULING_NEGATION_RE.search(text)
        for text in (str(item or "") for item in user_messages)
    )


def _maybe_auto_create_appointment_from_sofia(
    *,
    agent: TextAgent,
    conversation: TextConversation,
    history: list[dict[str, str]],
    user_message: str,
    session: SessionDep,
    sender_phone: str = "",
) -> None:
    try:
        timezone_name = DEFAULT_APPOINTMENT_TIMEZONE

        recent_user_messages = [
            str(item.get("content") or "")
            for item in history
            if str(item.get("role") or "") == "user"
        ][-4:]
        recent_user_messages.append(str(user_message or ""))

        latest_user_text = str(user_message or "")
        if _SCHEDULING_NEGATION_RE.search(latest_user_text):
            return

        contact_phone = (
            _extract_phone_candidate(latest_user_text)
            or _extract_phone_candidate(" ".join(recent_user_messages))
            or str(sender_phone or "").strip()[:40]
        )
        contact_email = _extract_email_candidate(latest_user_text) or _extract_email_candidate(
            " ".join(recent_user_messages)
        )

        contact_name = _extract_name_candidate(
            latest_user_text,
            contact_phone=contact_phone,
            contact_email=contact_email,
        )
        if not contact_name:
            for text_value in reversed(recent_user_messages):
                contact_name = _extract_name_candidate(
                    text_value,
                    contact_phone=contact_phone,
                    contact_email=contact_email,
                )
                if contact_name:
                    break

        now = _utcnow()
        requested_local_datetime = _extract_requested_local_datetime_from_messages(
            recent_user_messages,
            base_local_dt=_utc_naive_to_local_naive(now, timezone_name),
        )
        requested_utc_datetime = (
            _local_naive_to_utc_naive(requested_local_datetime, timezone_name)
            if requested_local_datetime is not None
            else None
        )

        existing = session.exec(
            select(TextAppointment).where(
                TextAppointment.text_agent_id == agent.id,
                TextAppointment.conversation_id == conversation.id,
                TextAppointment.deleted_at == None,
                TextAppointment.status.in_(ACTIVE_APPOINTMENT_STATUSES),
            )
        ).first()
        if existing:
            updated_existing = False

            if contact_name and not str(existing.contact_name or "").strip():
                existing.contact_name = contact_name[:120]
                updated_existing = True

            if contact_phone and not str(existing.contact_phone or "").strip():
                existing.contact_phone = contact_phone[:40]
                updated_existing = True

            if contact_email and not str(existing.contact_email or "").strip():
                existing.contact_email = contact_email[:160]
                updated_existing = True

            if (
                requested_utc_datetime
                and existing.appointment_date != requested_utc_datetime
                and requested_utc_datetime > now
                and is_time_slot_available(
                    session,
                    user_id=agent.user_id,
                    appointment_date=requested_utc_datetime,
                    buffer_minutes=0,
                    exclude_appointment_id=existing.id,
                )
            ):
                existing.appointment_date = requested_utc_datetime
                existing.timezone = timezone_name
                if "pendiente de confirmación" in str(existing.notes or ""):
                    existing.notes = (
                        "Cita solicitada durante conversación con Sofía. "
                        "Fecha y hora confirmada por el cliente."
                    )
                updated_existing = True

            if updated_existing:
                existing.updated_at = now
                session.add(existing)
                _apply_google_calendar_sync(session, existing, operation="upsert")

                _log_audit_event(
                    session,
                    event_type="appointment_updated_auto_sofia",
                    actor_user_id=agent.user_id,
                    subject_user_id=conversation.user_id,
                    entity_type="text_appointment",
                    entity_id=existing.id,
                    details={
                        "text_agent_id": agent.id,
                        "conversation_id": conversation.id,
                        "appointment_date_unix_secs": _to_unix(existing.appointment_date),
                    },
                )
            return

        if not _has_explicit_scheduling_intent(recent_user_messages):
            return

        if not contact_phone and not contact_email:
            return

        appointment_date = requested_utc_datetime or _default_appointment_datetime_utc(timezone_name)

        # No agendar automaticamente sobre un horario ya ocupado (citas o Google Calendar).
        if not is_time_slot_available(
            session,
            user_id=agent.user_id,
            appointment_date=appointment_date,
            buffer_minutes=0,
        ):
            return

        appointment = TextAppointment(
            text_agent_id=agent.id,
            user_id=agent.user_id,
            conversation_id=conversation.id,
            contact_name=contact_name,
            contact_phone=contact_phone,
            contact_email=contact_email,
            appointment_date=appointment_date,
            timezone=timezone_name,
            status="scheduled",
            source="agent",
            notes=(
                (
                    "Cita solicitada durante conversación con Sofía. "
                    "Fecha y hora confirmada por el cliente."
                )
                if requested_utc_datetime
                else (
                    "Cita solicitada durante conversación con Sofía. "
                    "Fecha y hora exacta pendiente de confirmación con el cliente."
                )
            ),
            created_at=now,
            updated_at=now,
        )
        session.add(appointment)
        _apply_google_calendar_sync(session, appointment, operation="upsert")

        _log_audit_event(
            session,
            event_type="appointment_created_auto_sofia",
            actor_user_id=agent.user_id,
            subject_user_id=conversation.user_id,
            entity_type="text_appointment",
            entity_id=appointment.id,
            details={
                "text_agent_id": agent.id,
                "conversation_id": conversation.id,
                "contact_phone": contact_phone,
                "contact_email": contact_email,
            },
        )
    except Exception:
        logger.exception("No se pudo crear cita automática en flujo Sofía")


# ─── LLM calls ──────────────────────────────────────────────────────────────

def _post_to_llm_provider(provider_label: str, url: str, **kwargs: Any) -> httpx.Response:
    try:
        with httpx.Client(timeout=60) as client:
            return client.post(url, **kwargs)
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"{provider_label} no respondio a tiempo. Intenta de nuevo.",
        ) from exc
    except httpx.HTTPError as exc:
        logger.warning("Error de red llamando a %s", provider_label, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"No fue posible conectar con {provider_label}",
        ) from exc


def _provider_error_message(body: Any) -> str | None:
    if not isinstance(body, dict):
        return None
    error = body.get("error")
    if isinstance(error, dict):
        message = error.get("message")
        return str(message) if message else None
    if isinstance(error, str) and error.strip():
        return error.strip()
    return None


def _call_openai(
    api_key: str,
    model: str,
    system_prompt: str,
    history: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
) -> tuple[str, int | None]:
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": system_prompt}, *history],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    response = _post_to_llm_provider(
        "OpenAI",
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
    )

    try:
        body = response.json()
    except ValueError:
        body = {"detail": response.text}

    if not response.is_success:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=_provider_error_message(body) or "OpenAI rechazo la solicitud",
        )

    choices = body.get("choices") if isinstance(body, dict) else None
    if not isinstance(choices, list) or not choices:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="OpenAI no devolvio una respuesta valida",
        )

    message = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
    content = message.get("content") if isinstance(message, dict) else None

    if not isinstance(content, str) or not content.strip():
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="OpenAI devolvio una respuesta vacia",
        )

    usage = body.get("usage") if isinstance(body, dict) else None
    total_tokens = usage.get("total_tokens") if isinstance(usage, dict) else None

    return content.strip(), total_tokens if isinstance(total_tokens, int) else None


def _call_gemini(
    api_key: str,
    model: str,
    system_prompt: str,
    history: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
) -> tuple[str, int | None]:
    contents: list[dict[str, Any]] = []
    for item in history:
        role = "user" if item["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": item["content"]}]})

    payload = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": contents,
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        },
    }

    response = _post_to_llm_provider(
        "Gemini",
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        params={"key": api_key},
        headers={"Content-Type": "application/json"},
        json=payload,
    )

    try:
        body = response.json()
    except ValueError:
        body = {"detail": response.text}

    if not response.is_success:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=_provider_error_message(body) or "Gemini rechazo la solicitud",
        )

    candidates = body.get("candidates") if isinstance(body, dict) else None
    if not isinstance(candidates, list) or not candidates:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Gemini no devolvio una respuesta valida",
        )

    content_payload = candidates[0].get("content", {}) if isinstance(candidates[0], dict) else {}
    parts = content_payload.get("parts") if isinstance(content_payload, dict) else None
    if not isinstance(parts, list) or not parts:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Gemini devolvio una respuesta vacia",
        )

    first_part = parts[0] if isinstance(parts[0], dict) else {}
    content = first_part.get("text") if isinstance(first_part, dict) else None
    if not isinstance(content, str) or not content.strip():
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Gemini devolvio una respuesta vacia",
        )

    usage = body.get("usageMetadata") if isinstance(body, dict) else None
    total_tokens = usage.get("totalTokenCount") if isinstance(usage, dict) else None

    return content.strip(), total_tokens if isinstance(total_tokens, int) else None


def _dispatch_llm(
    provider: str,
    api_key: str,
    model: str,
    system_prompt: str,
    history: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
) -> tuple[str, int | None]:
    if provider == "openai":
        return _call_openai(api_key, model, system_prompt, history, temperature, max_tokens)
    return _call_gemini(api_key, model, system_prompt, history, temperature, max_tokens)


# ─── WhatsApp sending ────────────────────────────────────────────────────────

def _send_twilio_message(
    account_sid: str,
    auth_token: str,
    from_number: str,
    to_number: str,
    body: str,
) -> None:
    url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
    with httpx.Client(timeout=30) as client:
        response = client.post(
            url,
            auth=(account_sid, auth_token),
            data={"From": from_number, "To": to_number, "Body": body},
        )
    if not response.is_success:
        logger.warning("Twilio rechazo el envio de WhatsApp (HTTP %s)", response.status_code)


def _send_meta_message(
    access_token: str,
    phone_number_id: str,
    to_number: str,
    body: str,
) -> None:
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
                "to": to_number,
                "type": "text",
                "text": {"body": body},
            },
        )
    if not response.is_success:
        logger.warning("Meta rechazo el envio de WhatsApp (HTTP %s)", response.status_code)


# ─── Controller ──────────────────────────────────────────────────────────────

class TextAgentController:

    # ── Provider configs ──────────────────────────────────────────────────

    @staticmethod
    async def list_provider_configs(current_user: CurrentUser, session: SessionDep):
        rows = session.exec(
            select(TextProviderConfig).where(TextProviderConfig.user_id == current_user.id)
        ).all()
        config_map = {row.provider: row for row in rows}

        providers = [
            _serialize_provider_config(config_map.get("openai"), "openai"),
            _serialize_provider_config(config_map.get("gemini"), "gemini"),
        ]
        return {
            "providers": providers,
            "requires_user_keys": TEXT_AGENTS_REQUIRE_USER_KEYS,
        }

    @staticmethod
    async def upsert_provider_config(
        provider: str,
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        if not TEXT_AGENTS_REQUIRE_USER_KEYS:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "La plataforma usa llaves globales en el servidor. "
                    "Esta accion esta deshabilitada para usuarios"
                ),
            )

        normalized_provider = _normalize_provider(provider)
        api_key = str(payload.get("api_key") or "").strip()
        if not api_key:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="api_key es requerida",
            )

        row = session.exec(
            select(TextProviderConfig).where(
                TextProviderConfig.user_id == current_user.id,
                TextProviderConfig.provider == normalized_provider,
            )
        ).first()

        encrypted = encrypt_secret(api_key)
        now = _utcnow()
        if row:
            row.api_key_encrypted = encrypted
            row.updated_at = now
            session.add(row)
        else:
            row = TextProviderConfig(
                user_id=current_user.id,
                provider=normalized_provider,
                api_key_encrypted=encrypted,
                created_at=now,
                updated_at=now,
            )
            session.add(row)

        session.commit()
        session.refresh(row)
        return _serialize_provider_config(row, normalized_provider)

    @staticmethod
    async def delete_provider_config(
        provider: str,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        if not TEXT_AGENTS_REQUIRE_USER_KEYS:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "La plataforma usa llaves globales en el servidor. "
                    "Esta accion esta deshabilitada para usuarios"
                ),
            )

        normalized_provider = _normalize_provider(provider)
        row = session.exec(
            select(TextProviderConfig).where(
                TextProviderConfig.user_id == current_user.id,
                TextProviderConfig.provider == normalized_provider,
            )
        ).first()

        if row:
            session.delete(row)
            session.commit()

        return {"deleted": True}

    # ── Agents ───────────────────────────────────────────────────────────

    @staticmethod
    async def list_agents(
        current_user: CurrentUser,
        session: SessionDep,
        user_id: str | None = None,
    ):
        scoped_user_id = _resolve_user_scope(current_user, user_id)

        statement = select(TextAgent)
        if scoped_user_id:
            statement = statement.where(TextAgent.user_id == scoped_user_id)

        rows = session.exec(statement.order_by(TextAgent.updated_at.desc())).all()

        if is_super_admin_user(current_user):
            user_lookup = _build_user_lookup(session, {row.user_id for row in rows})
            return {
                "agents": [
                    _serialize_text_agent(agent, user_lookup.get(agent.user_id))
                    for agent in rows
                ]
            }

        return {"agents": [_serialize_text_agent(agent) for agent in rows]}

    @staticmethod
    async def list_templates():
        templates = []
        for template in list_text_agent_templates():
            templates.append(
                {
                    "key": template["key"],
                    "label": template["label"],
                    "summary": template["summary"],
                    "description": template["description"],
                    "highlights": list(template["highlights"]),
                    "recommended": bool(template["recommended"]),
                    "capabilities": dict(template["capabilities"]),
                }
            )
        return {
            "templates": templates,
            "client_agent_limit": TEXT_AGENT_NON_ADMIN_LIMIT,
        }

    @staticmethod
    async def create_agent(payload: dict, current_user: CurrentUser, session: SessionDep):
        is_super_admin = is_super_admin_user(current_user)
        template_key = _resolve_template_key(
            payload.get("template_key"),
            fallback=TEXT_AGENT_DEFAULT_TEMPLATE_KEY,
        )

        if not is_super_admin:
            existing_count = len(
                session.exec(
                    select(TextAgent).where(TextAgent.user_id == current_user.id)
                ).all()
            )
            if existing_count >= TEXT_AGENT_NON_ADMIN_LIMIT:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Tu plan permite hasta 3 agentes de texto. "
                        "Edita el existente o contacta al administrador."
                    ),
                )

        payload = apply_text_agent_template_defaults(payload, template_key)

        name = str(payload.get("name") or "").strip()
        if not name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El nombre del agente es requerido",
            )

        provider = _normalize_provider(payload.get("provider") or "openai")
        _resolve_provider_api_key(provider, current_user, session)

        temperature = _parse_number_field(payload, "temperature", default=0.7)
        max_tokens = _parse_number_field(payload, "max_tokens", default=512, cast=int)
        now = _utcnow()

        sofia_mode = bool(payload.get("sofia_mode", False))
        _, sofia_config_json = _extract_sofia_config_json(payload, "{}")
        _validate_sofia_config_escalation_threshold(sofia_config_json)

        agent = TextAgent(
            user_id=current_user.id,
            name=name,
            provider=provider,
            model=str(payload.get("model") or _default_model(provider)),
            template_key=template_key,
            system_prompt=str(payload.get("system_prompt") or ""),
            welcome_message=str(payload.get("welcome_message") or ""),
            language=str(payload.get("language") or "es"),
            temperature=max(0.0, min(2.0, temperature)),
            max_tokens=max(64, min(8192, max_tokens)),
            sofia_mode=sofia_mode,
            sofia_config_json=sofia_config_json,
            embed_enabled=bool(payload.get("embed_enabled", True)),
            embed_token=secrets.token_urlsafe(24),
            legal_notice=str(payload.get("legal_notice") or ""),
            created_at=now,
            updated_at=now,
        )
        session.add(agent)
        _commit_with_data_error_guard(session)
        session.refresh(agent)
        _ensure_default_appointment_tool(session, agent)

        return _serialize_text_agent(agent)

    @staticmethod
    async def bootstrap_client(current_user: CurrentUser, session: SessionDep) -> dict:
        """El agente de texto se crea manualmente desde el picker de plantillas."""
        existing = session.exec(
            select(TextAgent).where(TextAgent.user_id == current_user.id)
        ).all()
        if existing:
            return {"created": False, "agent_id": existing[0].id}

        return {"created": False, "agent_id": None, "skipped": "template_picker"}

    @staticmethod
    async def get_agent(text_agent_id: str, current_user: CurrentUser, session: SessionDep):
        agent = _require_owned_text_agent(text_agent_id, current_user, session)
        _ensure_default_appointment_tool(session, agent)
        owner = None
        if is_super_admin_user(current_user):
            owner = session.get(User, agent.user_id)

        payload = _serialize_text_agent(agent, owner)
        payload["tools"] = [_serialize_tool(tool) for tool in _list_agent_tools(session, agent.id)]
        payload["knowledge_base"] = _list_agent_knowledge_base(session, agent.id)
        return payload

    @staticmethod
    async def update_agent(
        text_agent_id: str,
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        agent = _require_owned_text_agent(text_agent_id, current_user, session)
        is_super_admin = is_super_admin_user(current_user)
        template_capabilities = get_text_agent_template_definition(agent.template_key)["capabilities"]
        original_provider = agent.provider
        original_system_prompt = agent.system_prompt
        original_welcome_message = agent.welcome_message
        original_language = agent.language
        original_model = agent.model
        original_temperature = agent.temperature
        original_max_tokens = agent.max_tokens
        original_sofia_mode = agent.sofia_mode
        original_sofia_config_json = agent.sofia_config_json

        if "name" in payload:
            name = str(payload.get("name") or "").strip()
            if not name:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="El nombre del agente es requerido",
                )
            agent.name = name

        if "model" in payload:
            agent.model = str(payload.get("model") or "").strip() or _default_model(agent.provider)

        if "system_prompt" in payload and (
            is_super_admin or template_capabilities.get("allow_prompt_edit", False)
        ):
            agent.system_prompt = str(payload.get("system_prompt") or "")

        if "welcome_message" in payload and (
            is_super_admin or template_capabilities.get("allow_welcome_edit", False)
        ):
            agent.welcome_message = str(payload.get("welcome_message") or "")

        if "language" in payload and (
            is_super_admin or template_capabilities.get("allow_prompt_edit", False)
        ):
            agent.language = str(payload.get("language") or "es")

        if "temperature" in payload:
            value = _parse_number_field(payload, "temperature", default=0.7)
            agent.temperature = max(0.0, min(2.0, value))

        if "max_tokens" in payload:
            value = _parse_number_field(payload, "max_tokens", default=512, cast=int)
            agent.max_tokens = max(64, min(8192, value))

        if "sofia_mode" in payload:
            agent.sofia_mode = bool(payload.get("sofia_mode", False))

        sofia_config_defined, next_sofia_config_json = _extract_sofia_config_json(
            payload,
            fallback=agent.sofia_config_json,
        )
        if sofia_config_defined:
            _validate_sofia_config_escalation_threshold(next_sofia_config_json)
            agent.sofia_config_json = next_sofia_config_json

        if "embed_enabled" in payload:
            agent.embed_enabled = bool(payload.get("embed_enabled"))

        if "embed_primary_color" in payload:
            color = str(payload["embed_primary_color"] or "#271173").strip()
            agent.embed_primary_color = color if color.startswith("#") else "#271173"

        if "embed_position" in payload:
            pos = str(payload["embed_position"] or "bottom-right").strip()
            agent.embed_position = pos if pos in ("bottom-right", "bottom-left") else "bottom-right"

        if "embed_logo_url" in payload:
            agent.embed_logo_url = str(payload["embed_logo_url"] or "").strip()

        if bool(payload.get("regenerate_embed_token", False)):
            agent.embed_token = secrets.token_urlsafe(24)

        _ensure_embed_token(agent)

        # Todos los usuarios pueden editar el aviso legal de su agente.
        if "legal_notice" in payload:
            agent.legal_notice = str(payload.get("legal_notice") or "")

        if not is_super_admin:
            agent.provider = original_provider
            if not template_capabilities.get("allow_prompt_edit", False):
                agent.system_prompt = original_system_prompt
                agent.language = original_language
            if not template_capabilities.get("allow_welcome_edit", False):
                agent.welcome_message = original_welcome_message
            if not template_capabilities.get("allow_model_edit", False):
                agent.model = original_model
            if not template_capabilities.get("allow_runtime_tuning", False):
                agent.temperature = original_temperature
                agent.max_tokens = original_max_tokens
            if not template_capabilities.get("show_sofia_tab", False):
                agent.sofia_mode = original_sofia_mode
                agent.sofia_config_json = original_sofia_config_json

        agent.updated_at = _utcnow()
        session.add(agent)
        _commit_with_data_error_guard(session)
        session.refresh(agent)
        _ensure_default_appointment_tool(session, agent)

        response = _serialize_text_agent(agent)
        response["tools"] = [_serialize_tool(tool) for tool in _list_agent_tools(session, agent.id)]
        response["knowledge_base"] = _list_agent_knowledge_base(session, agent.id)
        return response

    @staticmethod
    async def get_embed_config(
        text_agent_id: str,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        agent = _require_owned_text_agent(text_agent_id, current_user, session)

        changed = _ensure_embed_token(agent)
        if changed:
            agent.updated_at = _utcnow()
            session.add(agent)
            session.commit()
            session.refresh(agent)

        iframe_url = _build_embed_iframe_url(agent.id, agent.embed_token)
        iframe_snippet = _build_embed_iframe_snippet(iframe_url)
        script_snippet = _build_embed_script_snippet(iframe_url)

        return {
            "agent_id": agent.id,
            "agent_name": agent.name,
            "embed_enabled": agent.embed_enabled,
            "embed_primary_color": getattr(agent, "embed_primary_color", "#271173"),
            "embed_position": getattr(agent, "embed_position", "bottom-right"),
            "embed_logo_url": getattr(agent, "embed_logo_url", ""),
            "iframe_url": iframe_url,
            "iframe_snippet": iframe_snippet,
            "script_snippet": script_snippet,
            "public_chat_endpoint": f"/api/text-agents/public/{agent.id}/chat",
        }

    @staticmethod
    async def get_public_embed_info(
        text_agent_id: str,
        token: str,
        session: SessionDep,
    ):
        agent = _require_public_embed_agent(text_agent_id, token, session)
        return {
            "agent_id": agent.id,
            "name": agent.name,
            "welcome_message": agent.welcome_message,
            "language": agent.language,
        }

    @staticmethod
    async def public_embed_chat(
        text_agent_id: str,
        payload: dict,
        session: SessionDep,
    ):
        token = str(payload.get("token") or "").strip()
        agent = _require_public_embed_agent(text_agent_id, token, session)

        user_message = _validate_chat_message(payload)

        session_id = _normalize_session_id(payload.get("session_id"))
        conversation_id = str(payload.get("conversation_id") or "").strip()

        if conversation_id:
            conversation = session.get(TextConversation, conversation_id)
            if (
                not conversation
                or conversation.deleted_at is not None
                or conversation.text_agent_id != agent.id
                or not str(conversation.title or "").startswith("embed:")
            ):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Conversacion no encontrada",
                )
        else:
            now = _utcnow()
            conversation = TextConversation(
                text_agent_id=agent.id,
                user_id=agent.user_id,
                title=f"embed:{session_id}",
                channel="embed",
                created_at=now,
                updated_at=now,
            )
            session.add(conversation)
            session.commit()
            session.refresh(conversation)

        session.add(
            TextMessage(
                conversation_id=conversation.id,
                role="user",
                content=user_message,
                provider=agent.provider,
                model=agent.model,
            )
        )
        session.commit()

        history = _load_recent_history(session, conversation.id)
        has_prior_assistant = _has_prior_assistant_message(session, conversation.id)

        rag_context = _retrieve_rag_context(session, agent.id, user_message)

        if agent.sofia_mode:
            sofia_result = await _run_sofia_chat(
                agent, conversation, history, user_message, rag_context, session,
                api_key=_resolve_sofia_api_key(agent, session),
                user_message_count=_count_user_messages(session, conversation.id),
                has_prior_assistant=has_prior_assistant,
            )
            return {
                "conversation_id": conversation.id,
                "session_id": session_id,
                "response": sofia_result["response"],
                "provider": agent.provider,
                "model": agent.model,
                "token_usage": None,
                "escalated": sofia_result.get("should_escalate", False),
                "intent": sofia_result.get("intent", ""),
            }

        _ensure_default_appointment_tool(session, agent)
        tools = _list_agent_tools(session, agent.id)
        tools_desc = _build_tools_description(tools)

        system_prompt = agent.system_prompt.strip() or "Eres un asistente util y claro."
        extra_blocks = [b for b in [_build_datetime_context_block(), rag_context, tools_desc] if b]
        if extra_blocks:
            system_prompt = system_prompt + "\n\n" + "\n\n".join(extra_blocks)

        owner_user = session.get(User, agent.user_id)
        if not owner_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Propietario del agente no encontrado",
            )

        api_key, _ = _resolve_provider_api_key(agent.provider, owner_user, session)

        assistant_content, token_usage = await run_in_threadpool(
            _dispatch_llm_with_optional_tool_execution,
            agent=agent,
            session=session,
            conversation=conversation,
            tools=tools,
            api_key=api_key,
            system_prompt=system_prompt,
            history=history,
        )

        assistant_content = _maybe_prepend_legal_notice(
            assistant_content, agent.legal_notice, has_prior_assistant
        )

        session.add(
            TextMessage(
                conversation_id=conversation.id,
                role="assistant",
                content=assistant_content,
                provider=agent.provider,
                model=agent.model,
                token_usage=token_usage,
            )
        )

        conversation.updated_at = _utcnow()
        session.add(conversation)
        session.commit()

        return {
            "conversation_id": conversation.id,
            "session_id": session_id,
            "response": assistant_content,
            "provider": agent.provider,
            "model": agent.model,
            "token_usage": token_usage,
        }

    # ── Escalation management ─────────────────────────────────────────────────

    @staticmethod
    async def list_escalations(
        text_agent_id: str,
        current_user: CurrentUser,
        session: SessionDep,
        status_filter: str | None = None,
    ):
        """List conversations that have been escalated for this agent."""
        agent = _require_owned_text_agent(text_agent_id, current_user, session)

        query = (
            select(TextConversation)
            .where(
                TextConversation.text_agent_id == agent.id,
                TextConversation.escalation_status != "none",
                TextConversation.deleted_at == None,
            )
            .order_by(TextConversation.escalated_at.desc())
        )

        if status_filter and status_filter in {"pending", "in_progress", "resolved"}:
            query = query.where(TextConversation.escalation_status == status_filter)

        rows = session.exec(query).all()
        last_user_messages = _latest_messages_by_conversation(
            session, [conv.id for conv in rows], role="user"
        )

        escalations = []
        for conv in rows:
            last_msg = last_user_messages.get(conv.id)

            escalations.append({
                "conversation_id": conv.id,
                "title": conv.title,
                "channel": conv.channel,
                "escalation_status": conv.escalation_status,
                "escalation_reason": conv.escalation_reason,
                "escalated_at_unix_secs": _to_unix(conv.escalated_at) if conv.escalated_at else None,
                "last_user_message": last_msg.content[:200] if last_msg else "",
                "created_at_unix_secs": _to_unix(conv.created_at),
                "contact_name": conv.contact_name,
                "contact_phone": conv.contact_phone,
                "contact_email": conv.contact_email,
            })

        return {"escalations": escalations}

    @staticmethod
    async def update_escalation(
        text_agent_id: str,
        conversation_id: str,
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        """Update the status of an escalated conversation."""
        agent = _require_owned_text_agent(text_agent_id, current_user, session)

        conversation = session.get(TextConversation, conversation_id)
        if (
            not conversation
            or conversation.deleted_at is not None
            or conversation.text_agent_id != agent.id
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversación escalada no encontrada",
            )

        new_status = str(payload.get("status") or "").strip().lower()
        if new_status not in {"pending", "in_progress", "resolved"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Status inválido. Usa: pending, in_progress, resolved",
            )

        conversation.escalation_status = new_status
        conversation.updated_at = _utcnow()
        session.add(conversation)
        session.commit()
        session.refresh(conversation)

        return {
            "conversation_id": conversation.id,
            "escalation_status": conversation.escalation_status,
            "escalation_reason": conversation.escalation_reason,
            "escalated_at_unix_secs": _to_unix(conversation.escalated_at) if conversation.escalated_at else None,
            "updated": True,
        }

    @staticmethod
    async def delete_agent(text_agent_id: str, current_user: CurrentUser, session: SessionDep):
        agent = _require_owned_text_agent(text_agent_id, current_user, session)

        session.exec(delete(TextAppointment).where(TextAppointment.text_agent_id == agent.id))
        session.exec(delete(TextAgentTool).where(TextAgentTool.text_agent_id == agent.id))
        session.exec(
            delete(TextAgentKnowledgeBase).where(TextAgentKnowledgeBase.text_agent_id == agent.id)
        )
        session.exec(delete(TextAgentWhatsApp).where(TextAgentWhatsApp.text_agent_id == agent.id))

        conversations = session.exec(
            select(TextConversation).where(TextConversation.text_agent_id == agent.id)
        ).all()

        conversation_ids = [c.id for c in conversations]
        if conversation_ids:
            session.exec(
                delete(TextMessage).where(TextMessage.conversation_id.in_(conversation_ids))
            )

        session.exec(delete(TextConversation).where(TextConversation.text_agent_id == agent.id))
        session.exec(delete(TextAgent).where(TextAgent.id == agent.id))
        session.commit()
        return {"deleted": True}

    # ── Tools ─────────────────────────────────────────────────────────────

    @staticmethod
    async def list_tools(text_agent_id: str, current_user: CurrentUser, session: SessionDep):
        _require_owned_text_agent(text_agent_id, current_user, session)
        tools = _list_agent_tools(session, text_agent_id)
        return {"tools": [_serialize_tool(tool) for tool in tools]}

    @staticmethod
    async def create_tool(
        text_agent_id: str,
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        _require_owned_text_agent(text_agent_id, current_user, session)

        name = str(payload.get("name") or "").strip()
        endpoint_url = str(payload.get("endpoint_url") or "").strip()
        method = str(payload.get("http_method") or "POST").strip().upper()

        if not name or not endpoint_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="name y endpoint_url son requeridos",
            )

        if method not in SUPPORTED_TOOL_METHODS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="http_method no soportado",
            )

        headers = payload.get("headers") or {}
        if not isinstance(headers, dict):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="headers debe ser un objeto",
            )

        parameters_schema = payload.get("parameters_schema") or {}
        if not isinstance(parameters_schema, dict):
            try:
                parameters_schema = json.loads(str(parameters_schema))
            except (json.JSONDecodeError, TypeError):
                parameters_schema = {}

        response_mapping = payload.get("response_mapping") or {}
        if not isinstance(response_mapping, dict):
            try:
                response_mapping = json.loads(str(response_mapping))
            except (json.JSONDecodeError, TypeError):
                response_mapping = {}

        _require_safe_tool_endpoint(endpoint_url)

        description = str(payload.get("description") or "")
        headers_json = json.dumps({str(k): str(v) for k, v in headers.items()})
        body_template = str(payload.get("body_template") or "")
        _validate_tool_field_lengths(
            name=name,
            description=description,
            endpoint_url=endpoint_url,
            headers=headers_json,
            body_template=body_template,
        )

        now = _utcnow()
        tool = TextAgentTool(
            text_agent_id=text_agent_id,
            name=name,
            description=description,
            endpoint_url=endpoint_url,
            http_method=method,
            headers_json=headers_json,
            body_template=body_template,
            parameters_schema_json=json.dumps(parameters_schema),
            response_mapping_json=json.dumps(response_mapping),
            enabled=bool(payload.get("enabled", True)),
            created_at=now,
            updated_at=now,
        )
        session.add(tool)
        _commit_with_data_error_guard(session)
        session.refresh(tool)

        return _serialize_tool(tool)

    @staticmethod
    async def update_tool(
        text_agent_id: str,
        tool_id: str,
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        _require_owned_text_agent(text_agent_id, current_user, session)

        tool = session.exec(
            select(TextAgentTool).where(
                TextAgentTool.id == tool_id,
                TextAgentTool.text_agent_id == text_agent_id,
            )
        ).first()

        if not tool:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Herramienta no encontrada",
            )

        if "name" in payload:
            tool.name = str(payload.get("name") or "").strip() or tool.name

        if "description" in payload:
            tool.description = str(payload.get("description") or "")

        if "endpoint_url" in payload:
            endpoint_url = str(payload.get("endpoint_url") or "").strip()
            if not endpoint_url:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="endpoint_url no puede estar vacio",
                )
            if endpoint_url != tool.endpoint_url:
                _require_safe_tool_endpoint(endpoint_url)
            tool.endpoint_url = endpoint_url

        if "http_method" in payload:
            method = str(payload.get("http_method") or "POST").strip().upper()
            if method not in SUPPORTED_TOOL_METHODS:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="http_method no soportado",
                )
            tool.http_method = method

        if "headers" in payload:
            headers = payload.get("headers")
            if not isinstance(headers, dict):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="headers debe ser un objeto",
                )
            tool.headers_json = json.dumps(_merge_masked_headers(headers, _load_tool_headers(tool)))

        if "body_template" in payload:
            tool.body_template = str(payload.get("body_template") or "")

        if "parameters_schema" in payload:
            ps = payload.get("parameters_schema") or {}
            if isinstance(ps, str):
                try:
                    ps = json.loads(ps)
                except (json.JSONDecodeError, TypeError):
                    ps = {}
            tool.parameters_schema_json = json.dumps(ps if isinstance(ps, dict) else {})

        if "response_mapping" in payload:
            rm = payload.get("response_mapping") or {}
            if isinstance(rm, str):
                try:
                    rm = json.loads(rm)
                except (json.JSONDecodeError, TypeError):
                    rm = {}
            tool.response_mapping_json = json.dumps(rm if isinstance(rm, dict) else {})

        if "enabled" in payload:
            tool.enabled = bool(payload.get("enabled"))

        current_values = {
            "name": tool.name,
            "description": tool.description,
            "endpoint_url": tool.endpoint_url,
            "headers": tool.headers_json,
            "body_template": tool.body_template,
        }
        _validate_tool_field_lengths(
            **{field: value for field, value in current_values.items() if field in payload}
        )

        tool.updated_at = _utcnow()
        session.add(tool)
        _commit_with_data_error_guard(session)
        session.refresh(tool)

        return _serialize_tool(tool)

    @staticmethod
    async def delete_tool(
        text_agent_id: str,
        tool_id: str,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        _require_owned_text_agent(text_agent_id, current_user, session)

        tool = session.exec(
            select(TextAgentTool).where(
                TextAgentTool.id == tool_id,
                TextAgentTool.text_agent_id == text_agent_id,
            )
        ).first()

        if not tool:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Herramienta no encontrada",
            )

        session.delete(tool)
        session.commit()
        return {"deleted": True}

    # ── Appointments ───────────────────────────────────────────────────────

    @staticmethod
    async def list_appointments(
        text_agent_id: str,
        current_user: CurrentUser,
        session: SessionDep,
        status_filter: str | None = None,
        from_unix: int | None = None,
        to_unix: int | None = None,
        limit: int = 100,
    ):
        _require_owned_text_agent(text_agent_id, current_user, session)

        statement = select(TextAppointment).where(
            TextAppointment.text_agent_id == text_agent_id,
            TextAppointment.deleted_at == None,
        )

        if status_filter is not None:
            normalized_status = str(status_filter).strip().lower()
            if normalized_status not in SUPPORTED_APPOINTMENT_STATUSES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        "status invalido. Usa: scheduled, confirmed, completed, "
                        "cancelled o no_show"
                    ),
                )
            statement = statement.where(TextAppointment.status == normalized_status)

        if isinstance(from_unix, int) and from_unix > 0:
            statement = statement.where(
                TextAppointment.appointment_date >= datetime.utcfromtimestamp(from_unix)
            )

        if isinstance(to_unix, int) and to_unix > 0:
            statement = statement.where(
                TextAppointment.appointment_date <= datetime.utcfromtimestamp(to_unix)
            )

        safe_limit = max(1, min(int(limit or 100), 200))
        rows = session.exec(
            statement
            .order_by(TextAppointment.appointment_date.asc(), TextAppointment.created_at.desc())
            .limit(safe_limit)
        ).all()

        return {"appointments": [_serialize_appointment(row) for row in rows]}

    @staticmethod
    async def create_appointment(
        text_agent_id: str,
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        agent = _require_owned_text_agent(text_agent_id, current_user, session)

        appointment_date = _parse_optional_datetime(payload.get("appointment_date"))
        if appointment_date is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="appointment_date es requerido (ISO8601 o unix timestamp)",
            )

        contact_name = str(payload.get("contact_name") or "").strip()
        contact_phone = str(payload.get("contact_phone") or "").strip()
        contact_email = str(payload.get("contact_email") or "").strip()

        if not contact_name and not contact_phone and not contact_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Debes registrar al menos contact_name, contact_phone o contact_email",
            )

        normalized_status = str(payload.get("status") or "scheduled").strip().lower()
        if normalized_status not in SUPPORTED_APPOINTMENT_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="status invalido para cita",
            )

        source = str(payload.get("source") or "manual").strip().lower()
        if source not in SUPPORTED_APPOINTMENT_SOURCES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="source invalido para cita",
            )

        now = _utcnow()
        appointment = TextAppointment(
            text_agent_id=agent.id,
            user_id=agent.user_id,
            conversation_id=str(payload.get("conversation_id") or "").strip() or None,
            contact_name=contact_name,
            contact_phone=contact_phone,
            contact_email=contact_email,
            appointment_date=appointment_date,
            timezone=str(payload.get("timezone") or "America/Bogota").strip()[:64]
            or "America/Bogota",
            status=normalized_status,
            source=source,
            notes=str(payload.get("notes") or "").strip()[:500],
            created_at=now,
            updated_at=now,
        )
        session.add(appointment)
        await run_in_threadpool(_apply_google_calendar_sync, session, appointment, operation="upsert")

        _log_audit_event(
            session,
            event_type="appointment_created",
            actor_user_id=current_user.id,
            subject_user_id=agent.user_id,
            entity_type="text_appointment",
            entity_id=appointment.id,
            details={
                "text_agent_id": agent.id,
                "appointment_date_unix_secs": _to_unix(appointment.appointment_date),
                "status": appointment.status,
            },
        )

        _commit_with_data_error_guard(session)
        session.refresh(appointment)
        return _serialize_appointment(appointment)

    @staticmethod
    async def update_appointment(
        text_agent_id: str,
        appointment_id: str,
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        agent = _require_owned_text_agent(text_agent_id, current_user, session)

        appointment = session.exec(
            select(TextAppointment).where(
                TextAppointment.id == appointment_id,
                TextAppointment.text_agent_id == text_agent_id,
                TextAppointment.deleted_at == None,
            )
        ).first()

        if not appointment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Cita no encontrada",
            )

        if "appointment_date" in payload:
            updated_date = _parse_optional_datetime(payload.get("appointment_date"))
            if updated_date is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="appointment_date no puede ser null",
                )
            appointment.appointment_date = updated_date

        if "status" in payload:
            next_status = str(payload.get("status") or "").strip().lower()
            if next_status not in SUPPORTED_APPOINTMENT_STATUSES:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="status invalido para cita",
                )
            appointment.status = next_status

        if "contact_name" in payload:
            appointment.contact_name = str(payload.get("contact_name") or "").strip()[:120]

        if "contact_phone" in payload:
            appointment.contact_phone = str(payload.get("contact_phone") or "").strip()[:40]

        if "contact_email" in payload:
            appointment.contact_email = str(payload.get("contact_email") or "").strip()[:160]

        if "conversation_id" in payload:
            conversation_id = str(payload.get("conversation_id") or "").strip()
            appointment.conversation_id = conversation_id or None

        if "timezone" in payload:
            appointment.timezone = (
                str(payload.get("timezone") or "").strip()[:64] or appointment.timezone
            )

        if "notes" in payload:
            appointment.notes = str(payload.get("notes") or "").strip()[:500]

        appointment.updated_at = _utcnow()
        session.add(appointment)
        await run_in_threadpool(_apply_google_calendar_sync, session, appointment, operation="upsert")

        _log_audit_event(
            session,
            event_type="appointment_updated",
            actor_user_id=current_user.id,
            subject_user_id=agent.user_id,
            entity_type="text_appointment",
            entity_id=appointment.id,
            details={
                "text_agent_id": agent.id,
                "appointment_date_unix_secs": _to_unix(appointment.appointment_date),
                "status": appointment.status,
            },
        )

        _commit_with_data_error_guard(session)
        session.refresh(appointment)
        return _serialize_appointment(appointment)

    @staticmethod
    async def delete_appointment(
        text_agent_id: str,
        appointment_id: str,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        agent = _require_owned_text_agent(text_agent_id, current_user, session)

        appointment = session.exec(
            select(TextAppointment).where(
                TextAppointment.id == appointment_id,
                TextAppointment.text_agent_id == text_agent_id,
                TextAppointment.deleted_at == None,
            )
        ).first()

        if not appointment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Cita no encontrada",
            )

        now = _utcnow()
        appointment.deleted_at = now
        appointment.updated_at = now
        if appointment.status != "completed":
            appointment.status = "cancelled"
        session.add(appointment)
        await run_in_threadpool(_apply_google_calendar_sync, session, appointment, operation="delete")

        _log_audit_event(
            session,
            event_type="appointment_deleted",
            actor_user_id=current_user.id,
            subject_user_id=agent.user_id,
            entity_type="text_appointment",
            entity_id=appointment.id,
            details={"text_agent_id": agent.id},
        )

        _commit_with_data_error_guard(session)
        return {"deleted": True}

    # ── Knowledge base ────────────────────────────────────────────────────

    @staticmethod
    async def list_knowledge_base_documents(
        current_user: CurrentUser,
        session: SessionDep,
        user_id: str | None = None,
    ):
        scoped_user_id = _resolve_user_scope(current_user, user_id)

        statement = select(TextKnowledgeBaseDocument)
        if scoped_user_id:
            statement = statement.where(TextKnowledgeBaseDocument.user_id == scoped_user_id)

        rows = session.exec(statement.order_by(TextKnowledgeBaseDocument.updated_at.desc())).all()

        if is_super_admin_user(current_user):
            user_lookup = _build_user_lookup(session, {row.user_id for row in rows})
            return {
                "documents": [
                    _serialize_document(doc, user_lookup.get(doc.user_id))
                    for doc in rows
                ]
            }

        return {"documents": [_serialize_document(doc) for doc in rows]}

    @staticmethod
    async def create_knowledge_base_document_from_file(
        file: UploadFile,
        name: str | None,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        filename = str(file.filename or "").strip()
        extension = os.path.splitext(filename)[1].lower()
        if extension not in KB_ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Formato de archivo no soportado. Sube un PDF o un archivo de texto: "
                    + ", ".join(sorted(KB_ALLOWED_EXTENSIONS))
                    + ". Los documentos de Word deben exportarse a PDF o texto antes de subirlos."
                ),
            )

        raw = await file.read(KB_MAX_FILE_BYTES + 1)
        if len(raw) > KB_MAX_FILE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"El archivo excede el maximo de {KB_MAX_FILE_BYTES // (1024 * 1024)} MB",
            )
        if extension == ".pdf":
            # La extraccion de PDF es CPU intensiva: fuera del event loop.
            content = await run_in_threadpool(_extract_pdf_text, raw)
        else:
            content = _decode_text_file(raw)
        if content is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El archivo no parece ser de texto plano",
            )
        if not content:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El archivo esta vacio",
            )

        document_name = ((name or "").strip() or filename or "Documento archivo")[:255]

        now = _utcnow()
        doc = TextKnowledgeBaseDocument(
            user_id=current_user.id,
            name=document_name,
            source_type="file",
            source_value=(filename or "uploaded-file")[:255],
            content=content,
            index_status="indexing",
            chunk_count=0,
            created_at=now,
            updated_at=now,
        )
        session.add(doc)
        _commit_with_data_error_guard(session)
        session.refresh(doc)

        _reindex_document_safely(doc, session)
        return _serialize_document(doc)

    @staticmethod
    async def reindex_document(
        document_id: str,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        doc = _require_owned_document(document_id, current_user, session)

        doc.index_status = "indexing"
        session.add(doc)
        session.commit()

        _reindex_document_safely(doc, session)
        return _serialize_document(doc)

    @staticmethod
    async def delete_knowledge_base_document(
        document_id: str,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        doc = _require_owned_document(document_id, current_user, session)

        session.exec(
            delete(TextKnowledgeBaseChunk).where(
                TextKnowledgeBaseChunk.document_id == document_id
            )
        )

        for link in session.exec(
            select(TextAgentKnowledgeBase).where(
                TextAgentKnowledgeBase.document_id == document_id
            )
        ).all():
            session.delete(link)

        session.delete(doc)
        session.commit()
        return {"deleted": True}

    @staticmethod
    async def list_agent_knowledge_base(
        text_agent_id: str,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        _require_owned_text_agent(text_agent_id, current_user, session)
        return {"documents": _list_agent_knowledge_base(session, text_agent_id)}

    @staticmethod
    async def attach_knowledge_base_document(
        text_agent_id: str,
        document_id: str,
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        _require_owned_text_agent(text_agent_id, current_user, session)
        _require_owned_document(document_id, current_user, session)

        usage_mode = str(payload.get("usage_mode") or "auto").strip().lower()
        if usage_mode not in SUPPORTED_USAGE_MODES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="usage_mode no soportado. Usa auto o prompt",
            )

        row = session.exec(
            select(TextAgentKnowledgeBase).where(
                TextAgentKnowledgeBase.text_agent_id == text_agent_id,
                TextAgentKnowledgeBase.document_id == document_id,
            )
        ).first()

        if row:
            row.usage_mode = usage_mode
            session.add(row)
        else:
            session.add(
                TextAgentKnowledgeBase(
                    text_agent_id=text_agent_id,
                    document_id=document_id,
                    usage_mode=usage_mode,
                )
            )

        session.commit()
        return {"attached": True}

    @staticmethod
    async def detach_knowledge_base_document(
        text_agent_id: str,
        document_id: str,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        _require_owned_text_agent(text_agent_id, current_user, session)

        row = session.exec(
            select(TextAgentKnowledgeBase).where(
                TextAgentKnowledgeBase.text_agent_id == text_agent_id,
                TextAgentKnowledgeBase.document_id == document_id,
            )
        ).first()

        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Documento no asociado al agente",
            )

        session.delete(row)
        session.commit()
        return {"detached": True}

    # ── WhatsApp ──────────────────────────────────────────────────────────

    @staticmethod
    async def get_whatsapp_config(
        text_agent_id: str,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        _require_owned_text_agent(text_agent_id, current_user, session)
        config = session.exec(
            select(TextAgentWhatsApp).where(
                TextAgentWhatsApp.text_agent_id == text_agent_id
            )
        ).first()

        if not config:
            return {"config": None}

        return {"config": _serialize_whatsapp(config)}

    @staticmethod
    async def upsert_whatsapp_config(
        text_agent_id: str,
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        _require_owned_text_agent(text_agent_id, current_user, session)

        provider = str(payload.get("provider") or "").strip().lower()
        if provider not in SUPPORTED_WA_PROVIDERS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Proveedor WhatsApp no soportado. Usa meta o twilio",
            )

        config = session.exec(
            select(TextAgentWhatsApp).where(
                TextAgentWhatsApp.text_agent_id == text_agent_id
            )
        ).first()

        now = _utcnow()
        if not config:
            config = TextAgentWhatsApp(
                text_agent_id=text_agent_id,
                provider=provider,
                webhook_verify_token=secrets.token_urlsafe(24),
                created_at=now,
                updated_at=now,
            )

        config.provider = provider
        config.phone_number = str(payload.get("phone_number") or "").strip()

        if provider == "twilio":
            config.account_sid = str(payload.get("account_sid") or "").strip()
            raw_auth = str(payload.get("auth_token") or "").strip()
            if raw_auth:
                config.auth_token_encrypted = encrypt_secret(raw_auth)
        elif provider == "meta":
            raw_token = str(payload.get("access_token") or "").strip()
            if raw_token:
                config.access_token_encrypted = encrypt_secret(raw_token)
            raw_secret = str(payload.get("app_secret") or "").strip()
            if raw_secret:
                config.app_secret_encrypted = encrypt_secret(raw_secret)
            config.phone_number_id = str(payload.get("phone_number_id") or "").strip()
            config.business_account_id = str(payload.get("business_account_id") or "").strip()

        if "active" in payload:
            config.active = bool(payload.get("active"))

        if not config.webhook_verify_token:
            config.webhook_verify_token = secrets.token_urlsafe(24)

        config.updated_at = now
        session.add(config)
        session.commit()
        session.refresh(config)

        return {"config": _serialize_whatsapp(config)}

    @staticmethod
    async def delete_whatsapp_config(
        text_agent_id: str,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        _require_owned_text_agent(text_agent_id, current_user, session)

        config = session.exec(
            select(TextAgentWhatsApp).where(
                TextAgentWhatsApp.text_agent_id == text_agent_id
            )
        ).first()

        if config:
            session.delete(config)
            session.commit()

        return {"deleted": True}

    # ── Conversations ─────────────────────────────────────────────────────

    @staticmethod
    async def list_conversations(
        text_agent_id: str,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        _require_owned_text_agent(text_agent_id, current_user, session)

        rows = session.exec(
            select(TextConversation)
            .where(
                TextConversation.text_agent_id == text_agent_id,
                TextConversation.deleted_at == None,
            )
            .order_by(TextConversation.updated_at.desc())
        ).all()

        if not rows:
            return {"conversations": []}

        conversation_ids = [row.id for row in rows]
        message_counts = {
            conversation_id: int(count or 0)
            for conversation_id, count in session.exec(
                select(TextMessage.conversation_id, func.count(TextMessage.id))
                .where(
                    TextMessage.conversation_id.in_(conversation_ids),
                    TextMessage.deleted_at == None,
                )
                .group_by(TextMessage.conversation_id)
            ).all()
        }
        last_messages = _latest_messages_by_conversation(session, conversation_ids)

        result: list[dict[str, Any]] = []
        for conversation in rows:
            last_message = last_messages.get(conversation.id)
            last_preview = last_message.content[:140] if last_message else ""
            result.append(
                {
                    "conversation_id": conversation.id,
                    "agent_id": text_agent_id,
                    "status": "done",
                    "channel": conversation.channel,
                    "start_time_unix_secs": _to_unix(conversation.created_at),
                    "updated_at_unix_secs": _to_unix(conversation.updated_at),
                    "message_count": message_counts.get(conversation.id, 0),
                    "last_message_preview": last_preview,
                    "escalation_status": conversation.escalation_status,
                    "escalation_reason": conversation.escalation_reason,
                    "escalated_at_unix_secs": _to_unix(conversation.escalated_at),
                    "renewal_date_unix_secs": _to_unix(conversation.renewal_date)
                    if conversation.renewal_date
                    else None,
                    "renewal_status": conversation.renewal_status,
                    "renewal_note": conversation.renewal_note,
                    "renewal_reminder_sent_at_unix_secs": _to_unix(
                        conversation.renewal_reminder_sent_at
                    )
                    if conversation.renewal_reminder_sent_at
                    else None,
                }
            )

        return {"conversations": result}

    @staticmethod
    async def get_conversation_detail(
        conversation_id: str,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        conversation = session.get(TextConversation, conversation_id)
        if not conversation or conversation.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversacion no encontrada",
            )

        agent = _require_owned_text_agent(conversation.text_agent_id, current_user, session)

        messages = session.exec(
            select(TextMessage)
            .where(
                TextMessage.conversation_id == conversation.id,
                TextMessage.deleted_at == None,
            )
            .order_by(*message_order())
        ).all()

        transcript = [
            {
                "role": message.role,
                "message": message.content,
                "time_in_call_secs": None,
            }
            for message in messages
        ]

        latest_assistant = next(
            (message.content for message in reversed(messages) if message.role == "assistant"),
            "",
        )

        return {
            "conversation_id": conversation.id,
            "agent_id": agent.id,
            "status": "done",
            "channel": conversation.channel,
            "contact_name": conversation.contact_name,
            "contact_phone": conversation.contact_phone,
            "contact_email": conversation.contact_email,
            "transcript": transcript,
            "metadata": {
                "start_time_unix_secs": _to_unix(conversation.created_at),
                "message_count": len(messages),
                "renewal_date_unix_secs": _to_unix(conversation.renewal_date)
                if conversation.renewal_date
                else None,
                "renewal_status": conversation.renewal_status,
                "renewal_note": conversation.renewal_note,
                "renewal_reminder_sent_at_unix_secs": _to_unix(
                    conversation.renewal_reminder_sent_at
                )
                if conversation.renewal_reminder_sent_at
                else None,
            },
            "analysis": {
                "transcript_summary": latest_assistant[:400],
                "call_successful": "yes" if latest_assistant else "unknown",
            },
        }

    @staticmethod
    async def list_upcoming_renewals(
        current_user: CurrentUser,
        session: SessionDep,
        days: int = 30,
        user_id: str | None = None,
    ):
        scoped_user_id = _resolve_user_scope(current_user, user_id)
        lookahead_days = max(1, min(int(days or 30), 365))

        now = _utcnow()
        horizon = now + timedelta(days=lookahead_days)

        query = select(TextConversation).where(
            TextConversation.deleted_at == None,
            TextConversation.renewal_date != None,
            TextConversation.renewal_date >= now,
            TextConversation.renewal_date <= horizon,
        )

        if scoped_user_id:
            query = query.where(TextConversation.user_id == scoped_user_id)

        rows = session.exec(query.order_by(TextConversation.renewal_date.asc())).all()

        if not rows:
            return {"renewals": []}

        agent_ids = {row.text_agent_id for row in rows}
        agents = session.exec(select(TextAgent).where(TextAgent.id.in_(agent_ids))).all()
        agent_name_by_id = {agent.id: agent.name for agent in agents}

        renewals: list[dict[str, Any]] = []
        for row in rows:
            if not row.renewal_date:
                continue

            days_until = max(0, (row.renewal_date.date() - now.date()).days)
            renewals.append(
                {
                    "conversation_id": row.id,
                    "agent_id": row.text_agent_id,
                    "agent_name": agent_name_by_id.get(row.text_agent_id, row.text_agent_id),
                    "title": row.title,
                    "renewal_date_unix_secs": _to_unix(row.renewal_date),
                    "renewal_status": row.renewal_status,
                    "renewal_note": row.renewal_note,
                    "renewal_reminder_sent_at_unix_secs": _to_unix(row.renewal_reminder_sent_at)
                    if row.renewal_reminder_sent_at
                    else None,
                    "days_until_renewal": days_until,
                }
            )

        return {"renewals": renewals}

    @staticmethod
    async def update_conversation_renewal(
        text_agent_id: str,
        conversation_id: str,
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        _require_owned_text_agent(text_agent_id, current_user, session)

        conversation = session.get(TextConversation, conversation_id)
        if (
            not conversation
            or conversation.deleted_at is not None
            or conversation.text_agent_id != text_agent_id
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversacion no encontrada",
            )

        if "renewal_date" in payload:
            conversation.renewal_date = _parse_optional_datetime(payload.get("renewal_date"))

        if "renewal_status" in payload:
            next_status = str(payload.get("renewal_status") or "").strip().lower()
            allowed_statuses = {
                "none",
                "scheduled",
                "reminder_due",
                "reminder_sent",
                "contacted",
                "renewed",
                "expired",
                "cancelled",
            }
            if next_status not in allowed_statuses:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        "renewal_status invalido. Usa: none, scheduled, reminder_due, reminder_sent, "
                        "contacted, renewed, expired o cancelled"
                    ),
                )
            conversation.renewal_status = next_status

        if "renewal_note" in payload:
            conversation.renewal_note = str(payload.get("renewal_note") or "").strip()[:255]

        if bool(payload.get("clear_reminder", False)):
            conversation.renewal_reminder_sent_at = None

        conversation.updated_at = _utcnow()
        session.add(conversation)

        _log_audit_event(
            session,
            event_type="renewal_updated",
            actor_user_id=current_user.id,
            subject_user_id=conversation.user_id,
            entity_type="text_conversation",
            entity_id=conversation.id,
            details={
                "renewal_date_unix_secs": _to_unix(conversation.renewal_date)
                if conversation.renewal_date
                else None,
                "renewal_status": conversation.renewal_status,
            },
        )

        session.commit()
        session.refresh(conversation)

        return {
            "conversation_id": conversation.id,
            "renewal_date_unix_secs": _to_unix(conversation.renewal_date)
            if conversation.renewal_date
            else None,
            "renewal_status": conversation.renewal_status,
            "renewal_note": conversation.renewal_note,
            "renewal_reminder_sent_at_unix_secs": _to_unix(conversation.renewal_reminder_sent_at)
            if conversation.renewal_reminder_sent_at
            else None,
            "updated": True,
        }

    @staticmethod
    async def run_renewal_reminders(
        current_user: CurrentUser,
        session: SessionDep,
        days_ahead: int = 7,
    ):
        if not is_super_admin_user(current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Solo super_admin puede ejecutar recordatorios manuales",
            )

        processed = run_due_renewal_reminders(
            session,
            days_ahead=max(1, min(int(days_ahead or 7), 60)),
        )
        return {"processed": processed}

    # ── Chat ──────────────────────────────────────────────────────────────

    @staticmethod
    async def chat(
        text_agent_id: str,
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        agent = _require_owned_text_agent(text_agent_id, current_user, session)

        user_message = _validate_chat_message(payload)

        conversation_id = str(payload.get("conversation_id") or "").strip()
        if conversation_id:
            conversation = session.get(TextConversation, conversation_id)
            if (
                not conversation
                or conversation.deleted_at is not None
                or conversation.text_agent_id != agent.id
                or conversation.user_id != current_user.id
            ):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Conversacion no encontrada o sin permisos",
                )
        else:
            now = _utcnow()
            conversation = TextConversation(
                text_agent_id=agent.id,
                user_id=current_user.id,
                title=user_message[:80],
                channel="web",
                created_at=now,
                updated_at=now,
            )
            session.add(conversation)
            session.commit()
            session.refresh(conversation)

        session.add(
            TextMessage(
                conversation_id=conversation.id,
                role="user",
                content=user_message,
                provider=agent.provider,
                model=agent.model,
            )
        )
        session.commit()

        history = _load_recent_history(session, conversation.id)
        has_prior_assistant = _has_prior_assistant_message(session, conversation.id)

        rag_context = _retrieve_rag_context(session, agent.id, user_message)

        if agent.sofia_mode:
            sofia_result = await _run_sofia_chat(
                agent, conversation, history, user_message, rag_context, session,
                api_key=_resolve_sofia_api_key(agent, session),
                user_message_count=_count_user_messages(session, conversation.id),
                has_prior_assistant=has_prior_assistant,
            )
            return {
                "conversation_id": conversation.id,
                "response": sofia_result["response"],
                "provider": agent.provider,
                "model": agent.model,
                "token_usage": None,
                "escalated": sofia_result.get("should_escalate", False),
                "intent": sofia_result.get("intent", ""),
            }

        _ensure_default_appointment_tool(session, agent)
        tools = _list_agent_tools(session, agent.id)
        tools_desc = _build_tools_description(tools)

        system_prompt = agent.system_prompt.strip() or "Eres un asistente util y claro."
        extra_blocks = [b for b in [_build_datetime_context_block(), rag_context, tools_desc] if b]
        if extra_blocks:
            system_prompt = system_prompt + "\n\n" + "\n\n".join(extra_blocks)

        api_key, _ = _resolve_provider_api_key(agent.provider, current_user, session)

        assistant_content, token_usage = await run_in_threadpool(
            _dispatch_llm_with_optional_tool_execution,
            agent=agent,
            session=session,
            conversation=conversation,
            tools=tools,
            api_key=api_key,
            system_prompt=system_prompt,
            history=history,
        )

        assistant_content = _maybe_prepend_legal_notice(
            assistant_content, agent.legal_notice, has_prior_assistant
        )

        session.add(
            TextMessage(
                conversation_id=conversation.id,
                role="assistant",
                content=assistant_content,
                provider=agent.provider,
                model=agent.model,
                token_usage=token_usage,
            )
        )

        conversation.updated_at = _utcnow()
        session.add(conversation)
        session.commit()

        return {
            "conversation_id": conversation.id,
            "response": assistant_content,
            "provider": agent.provider,
            "model": agent.model,
            "token_usage": token_usage,
        }

    # ── WhatsApp webhook ──────────────────────────────────────────────────

    @staticmethod
    async def handle_whatsapp_incoming(
        config_id: str,
        sender: str,
        message_text: str,
        session: SessionDep,
        external_id: str | None = None,
    ) -> str:
        config = session.get(TextAgentWhatsApp, config_id)
        if not config or not config.active:
            return ""

        agent = session.get(TextAgent, config.text_agent_id)
        if not agent:
            return ""

        message_text = str(message_text or "").strip()[:MAX_CHAT_MESSAGE_CHARS]
        if not message_text:
            return ""

        # Meta/Twilio reintentan entregas: el id del proveedor evita respuestas duplicadas.
        normalized_external_id = str(external_id or "").strip()[:255] or None
        if normalized_external_id and session.exec(
            select(TextMessage.id).where(TextMessage.external_id == normalized_external_id)
        ).first():
            logger.info("Mensaje de WhatsApp duplicado ignorado: %s", normalized_external_id)
            return ""

        wa_title = f"whatsapp:{sender}"
        conversation = session.exec(
            select(TextConversation).where(
                TextConversation.text_agent_id == agent.id,
                TextConversation.title == wa_title,
                TextConversation.deleted_at == None,
            )
        ).first()

        if not conversation:
            now = _utcnow()
            conversation = TextConversation(
                text_agent_id=agent.id,
                user_id=agent.user_id,
                title=wa_title,
                channel="whatsapp",
                created_at=now,
                updated_at=now,
            )
            session.add(conversation)
            session.commit()
            session.refresh(conversation)

        session.add(
            TextMessage(
                conversation_id=conversation.id,
                role="user",
                content=message_text,
                provider=agent.provider,
                model=agent.model,
                external_id=normalized_external_id,
            )
        )
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            logger.info("Mensaje de WhatsApp duplicado ignorado: %s", normalized_external_id)
            return ""

        history = _load_recent_history(session, conversation.id)
        has_prior_assistant = _has_prior_assistant_message(session, conversation.id)

        rag_context = _retrieve_rag_context(session, agent.id, message_text)

        if agent.sofia_mode:
            try:
                sofia_result = await _run_sofia_chat(
                    agent, conversation, history, message_text, rag_context, session,
                    sender_phone=sender,
                    api_key=_resolve_sofia_api_key(agent, session),
                    user_message_count=_count_user_messages(session, conversation.id),
                    has_prior_assistant=has_prior_assistant,
                )
                return sofia_result["response"]
            except Exception:
                logger.exception("Sofia graph error")
                session.rollback()
                return "Lo siento, ocurrió un error. En breve un asesor se comunicará con usted."

        _ensure_default_appointment_tool(session, agent)
        tools = _list_agent_tools(session, agent.id)
        tools_desc = _build_tools_description(tools)

        system_prompt = agent.system_prompt.strip() or "Eres un asistente util y claro."
        extra_blocks = [b for b in [_build_datetime_context_block(), rag_context, tools_desc] if b]
        if extra_blocks:
            system_prompt = system_prompt + "\n\n" + "\n\n".join(extra_blocks)

        owner_user = session.get(User, agent.user_id)
        try:
            if not owner_user:
                raise ValueError("Propietario del agente no encontrado")
            api_key, _ = _resolve_provider_api_key(agent.provider, owner_user, session)
        except (HTTPException, ValueError):
            logger.warning("Agente %s sin API key disponible para WhatsApp", agent.id)
            return "Lo siento, no puedo responder ahora mismo."

        try:
            assistant_content, token_usage = await run_in_threadpool(
                _dispatch_llm_with_optional_tool_execution,
                agent=agent,
                session=session,
                conversation=conversation,
                tools=tools,
                api_key=api_key,
                system_prompt=system_prompt,
                history=history,
            )
        except Exception:
            logger.exception("Error generando respuesta de WhatsApp")
            session.rollback()
            return "Lo siento, ocurrio un error al procesar tu mensaje."

        assistant_content = _maybe_prepend_legal_notice(
            assistant_content, agent.legal_notice, has_prior_assistant
        )

        session.add(
            TextMessage(
                conversation_id=conversation.id,
                role="assistant",
                content=assistant_content,
                provider=agent.provider,
                model=agent.model,
                token_usage=token_usage,
            )
        )
        conversation.updated_at = _utcnow()
        session.add(conversation)
        session.commit()

        return assistant_content


# ── Sofia helpers ────────────────────────────────────────────────────────────

async def _run_sofia_chat(
    agent: TextAgent,
    conversation: TextConversation,
    history: list[dict[str, str]],
    user_message: str,
    rag_context: str,
    session: SessionDep,
    sender_phone: str = "",
    *,
    api_key: str | None = None,
    user_message_count: int | None = None,
    has_prior_assistant: bool | None = None,
) -> dict[str, Any]:
    try:
        sofia_config = json.loads(agent.sofia_config_json or "{}")
    except (json.JSONDecodeError, TypeError):
        sofia_config = {}
    if not isinstance(sofia_config, dict):
        sofia_config = {}

    # Fuente de verdad única: legal_notice del agente (con fallback de tenant).
    # Se inyecta en el config para que el grafo lo use en el system prompt.
    effective_legal_notice = (agent.legal_notice or "").strip() or TENANT.legal_notice.strip()
    if effective_legal_notice:
        sofia_config["legal_notice"] = effective_legal_notice

    language = str(sofia_config.get("language") or agent.language or "es").strip().lower()
    # Web y widget no traen teléfono: tras pedirle los datos al cliente, se guardan al llegar.
    web_channel = not sender_phone
    if web_channel and conversation.contact_requested and not _has_contact(conversation):
        contact = extract_contact(user_message)
        if contact.reachable:
            return _save_captured_contact(agent, conversation, contact, language, session)

    if user_message_count is None:
        user_message_count = sum(1 for m in history if m["role"] == "user")

    previous_escalation_status = str(conversation.escalation_status or "none").strip().lower()
    already_escalated = previous_escalation_status in {"pending", "in_progress"}

    has_open_appointment = bool(
        session.exec(
            select(TextAppointment).where(
                TextAppointment.text_agent_id == agent.id,
                TextAppointment.conversation_id == conversation.id,
                TextAppointment.deleted_at == None,
                TextAppointment.status.in_(ACTIVE_APPOINTMENT_STATUSES),
            )
        ).first()
    )

    runtime_prompt_override = (
        (agent.system_prompt.strip() or "")
        + "\n\nRegla operativa adicional: si ya capturaste datos y solicitud de cita, "
        + "continúa resolviendo horarios o preferencia de contacto sin repetir la frase de escalación en cada respuesta."
    ).strip()

    try:
        sofia_result = await run_sofia(
            user_message=user_message,
            history=history,
            rag_context=rag_context,
            message_count=user_message_count,
            system_prompt_override=runtime_prompt_override,
            config=sofia_config,
            already_escalated=already_escalated,
            has_open_appointment=has_open_appointment,
            uncertainty_count=int(getattr(conversation, "sofia_uncertainty_count", 0) or 0),
            allow_threshold_escalation=previous_escalation_status in {"", "none"},
            api_key=api_key,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Sofia no pudo generar una respuesta")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="El asistente no esta disponible en este momento. Intenta de nuevo.",
        ) from exc

    if sofia_result.get("should_escalate") and web_channel and not _has_contact(conversation):
        # Sin un teléfono o correo nadie podría contactarlo: se le piden antes de pasar al asesor.
        conversation.contact_requested = True
        sofia_result = {**sofia_result, "response": get_contact_request_message(language)}

    assistant_content = sofia_result.get("response", "")
    if has_prior_assistant is None:
        has_prior_assistant = any(m["role"] == "assistant" for m in history)
    assistant_content = _maybe_prepend_legal_notice(
        assistant_content, agent.legal_notice, has_prior_assistant
    )
    sofia_result = {**sofia_result, "response": assistant_content}
    now = _utcnow()

    session.add(
        TextMessage(
            conversation_id=conversation.id,
            role="assistant",
            content=assistant_content,
            provider=agent.provider,
            model=agent.model,
        )
    )

    await run_in_threadpool(
        _maybe_auto_create_appointment_from_sofia,
        agent=agent,
        conversation=conversation,
        history=history,
        user_message=user_message,
        session=session,
        sender_phone=sender_phone,
    )

    detected_intent = str(sofia_result.get("intent") or "").strip().lower()
    if detected_intent == "renovacion" and conversation.renewal_date is None:
        conversation.renewal_date = now + timedelta(days=30)
        conversation.renewal_status = "scheduled"
        conversation.renewal_note = "Renovación detectada por Sofía. Revisión sugerida en 30 días."

        _log_audit_event(
            session,
            event_type="renewal_auto_scheduled",
            actor_user_id=agent.user_id,
            subject_user_id=conversation.user_id,
            entity_type="text_conversation",
            entity_id=conversation.id,
            details={
                "intent": detected_intent,
                "renewal_date_unix_secs": _to_unix(conversation.renewal_date),
            },
        )

    notify_advisor = False
    if sofia_result.get("should_escalate"):
        # Solo la transición a "pending" cuenta como escalación nueva (y notifica al asesor).
        if not already_escalated:
            conversation.escalation_status = "pending"
            conversation.escalation_reason = sofia_result.get("escalation_reason", "user_request")
            conversation.escalated_at = now
            notify_advisor = bool(sender_phone)
        conversation.sofia_uncertainty_count = 0
    else:
        conversation.sofia_uncertainty_count = int(sofia_result.get("uncertainty_count") or 0)

    conversation.updated_at = now
    session.add(conversation)
    session.commit()

    if notify_advisor:
        await _notify_advisor_whatsapp(
            agent, session, sender_phone,
            sofia_result.get("escalation_reason", ""),
            user_message,
            conversation.id,
        )
        _notify_owner_of_escalation(agent, conversation, session, customer_phone=sender_phone)

    return sofia_result


def _has_contact(conversation: TextConversation) -> bool:
    return bool((conversation.contact_phone or "").strip() or (conversation.contact_email or "").strip())


def _save_captured_contact(
    agent: TextAgent,
    conversation: TextConversation,
    contact: ContactInfo,
    language: str,
    session: SessionDep,
) -> dict[str, Any]:
    now = _utcnow()
    conversation.contact_name = contact.name[:255]
    conversation.contact_phone = contact.phone[:50]
    conversation.contact_email = contact.email[:255]
    conversation.contact_requested = False
    if conversation.escalation_status in {"", "none", "resolved"}:
        conversation.escalation_status = "pending"
        conversation.escalation_reason = conversation.escalation_reason or "user_request"
        conversation.escalated_at = now

    response = get_contact_confirmation_message(
        language, contact.name, contact_display(contact.phone, contact.email)
    )
    session.add(
        TextMessage(
            conversation_id=conversation.id,
            role="assistant",
            content=response,
            provider=agent.provider,
            model=agent.model,
        )
    )
    conversation.updated_at = now
    session.add(conversation)
    session.commit()

    _notify_owner_of_escalation(agent, conversation, session)
    return {
        "response": response,
        "should_escalate": True,
        "escalation_reason": conversation.escalation_reason,
        "intent": "contacto",
    }


_ESCALATION_CHANNEL_LABELS = {"whatsapp": "de WhatsApp", "web": "del chat web", "embed": "del sitio web"}
_ESCALATION_REASON_LABELS = {
    "user_request": "Pidió hablar con una persona",
    "active_claim": "Reclamación en curso",
    "uncertainty_detected": "Sofía no estaba segura de la respuesta",
    "auto_threshold": "Conversación larga sin resolver",
    "specific_policy": "Consulta sobre su póliza",
}


def _notify_owner_of_escalation(
    agent: TextAgent,
    conversation: TextConversation,
    session: SessionDep,
    *,
    customer_phone: str = "",
) -> None:
    """Avisa por correo al dueño del agente que un cliente espera a un asesor."""
    owner = session.get(User, agent.user_id)
    owner_email = str(getattr(owner, "email", "") or "").strip()
    if not owner_email:
        return

    recent = session.exec(
        select(TextMessage)
        .where(TextMessage.conversation_id == conversation.id, TextMessage.deleted_at == None)
        .order_by(*message_order(newest_first=True))
        .limit(8)
    ).all()
    transcript = [
        ("Cliente" if message.role == "user" else "Sofía", message.content)
        for message in reversed(recent)
        if message.role in {"user", "assistant"}
    ]
    details = [
        (label, value)
        for label, value in (
            ("Nombre", conversation.contact_name),
            ("Teléfono", customer_phone or conversation.contact_phone),
            ("Correo", conversation.contact_email),
        )
        if value
    ]
    channel = _ESCALATION_CHANNEL_LABELS.get(conversation.channel, "de otro canal")
    reason = _ESCALATION_REASON_LABELS.get(conversation.escalation_reason, "Necesita a una persona del equipo")
    link = f"{FRONTEND_PUBLIC_URL}/escalamientos?conversacion={conversation.id}&agente={agent.id}"
    subject = f"{agent.name}: un cliente espera a un asesor"

    text_lines = [f"Un cliente {channel} pidió hablar con un asesor ({reason}).", ""]
    text_lines += [f"{label}: {value}" for label, value in details] or ["El cliente no dejó datos de contacto."]
    text_lines += ["", "Últimos mensajes:"] + [f"{who}: {what}" for who, what in transcript]
    text_lines += ["", f"Ver la conversación: {link}"]

    detail_html = "".join(f"<li><b>{escape(label)}:</b> {escape(value)}</li>" for label, value in details)
    transcript_html = "".join(f"<p><b>{escape(who)}:</b> {escape(what)}</p>" for who, what in transcript)
    html = (
        f"<p>Un cliente {escape(channel)} pidió hablar con un asesor ({escape(reason)}).</p>"
        + (f"<ul>{detail_html}</ul>" if detail_html else "<p>El cliente no dejó datos de contacto.</p>")
        + f"<p><b>Últimos mensajes</b></p>{transcript_html}"
        + f'<p><a href="{escape(link)}">Ver la conversación en la consola</a></p>'
    )
    try:
        send_email_async(to_email=owner_email, subject=subject, text="\n".join(text_lines), html=html)
    except Exception:
        logger.exception("No se pudo encolar el aviso de escalación para %s", owner_email)


def _resolve_sofia_api_key(agent: TextAgent, session: SessionDep) -> str | None:
    """API key de OpenAI del dueño del agente para Sofía; None usa la del entorno."""
    owner = session.get(User, agent.user_id)
    if not owner:
        return None
    try:
        api_key, _ = _resolve_provider_api_key("openai", owner, session)
    except (HTTPException, ValueError):
        return None
    return api_key or None


async def _notify_advisor_whatsapp(
    agent: TextAgent,
    session: SessionDep,
    sender_phone: str,
    reason: str,
    summary: str,
    conversation_id: str,
) -> None:
    try:
        sofia_config = json.loads(agent.sofia_config_json or "{}")
    except (json.JSONDecodeError, TypeError):
        sofia_config = {}

    advisor_phone = sofia_config.get("advisor_phone", "")
    if not advisor_phone:
        return

    wa_config = session.exec(
        select(TextAgentWhatsApp).where(
            TextAgentWhatsApp.text_agent_id == agent.id,
            TextAgentWhatsApp.active == True,
        )
    ).first()

    if not wa_config:
        return

    notification = ADVISOR_NOTIFICATION_TEMPLATE.format(
        agent_name=agent.name,
        conversation_id=conversation_id,
        sender_phone=sender_phone,
        reason=reason,
        summary=summary[:200],
    )

    try:
        if wa_config.provider == "meta" and wa_config.access_token_encrypted and wa_config.phone_number_id:
            access_token = decrypt_secret(wa_config.access_token_encrypted)
            await run_in_threadpool(
                _send_meta_message,
                access_token,
                wa_config.phone_number_id,
                advisor_phone,
                notification,
            )
        elif wa_config.provider == "twilio" and wa_config.account_sid and wa_config.auth_token_encrypted:
            auth_token = decrypt_secret(wa_config.auth_token_encrypted)
            from_number = f"whatsapp:{wa_config.phone_number}"
            to_number = f"whatsapp:{advisor_phone}"
            await run_in_threadpool(
                _send_twilio_message,
                wa_config.account_sid,
                auth_token,
                from_number,
                to_number,
                notification,
            )
    except Exception:
        logger.exception("Failed to notify advisor via WhatsApp")
