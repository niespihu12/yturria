from __future__ import annotations

import json
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from fastapi import HTTPException, UploadFile, status
from sqlalchemy.exc import DataError
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
from app.models.TextMessage import TextMessage
from app.models.TextProviderConfig import TextProviderConfig
from app.utils.crypto import decrypt_secret, encrypt_secret, mask_secret
from app.models.User import User
from app.utils.client_defaults import DEFAULT_TEXT_MODEL, apply_client_text_defaults
from app.utils.roles import is_super_admin_user, role_as_value
from app.services.google_calendar import sync_google_calendar_for_appointment
from app.services.renewal_scheduler import run_due_renewal_reminders
from app.services.sofia_graph import run_sofia
from app.services.sofia_prompts import ADVISOR_NOTIFICATION_TEMPLATE

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
).strip().rstrip("/")
TOOL_CALL_TAG_START = "<tool_call>"
TOOL_CALL_TAG_END = "</tool_call>"

try:
    TOOL_EXECUTION_TIMEOUT_SECONDS = int(
        str(os.getenv("TEXT_TOOL_TIMEOUT_SECONDS", "20")).strip() or "20"
    )
except ValueError:
    TOOL_EXECUTION_TIMEOUT_SECONDS = 20

TOOL_EXECUTION_TIMEOUT_SECONDS = max(3, min(120, TOOL_EXECUTION_TIMEOUT_SECONDS))

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
    """Prepend legal_notice to the first assistant response in a conversation."""
    notice = (legal_notice or "").strip()
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
        return datetime.utcfromtimestamp(int(value))

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

    return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed


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
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="escalation_threshold debe ser un entero",
        )
    if not (1 <= val <= 20):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
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
    if provider == "gemini":
        return "gemini-2.5-flash"
    return "gpt-4.1-mini"


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


def _serialize_tool(tool: TextAgentTool) -> dict[str, Any]:
    try:
        parsed_headers = json.loads(tool.headers_json)
    except (json.JSONDecodeError, TypeError):
        parsed_headers = {}

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
    try:
        sofia_config = json.loads(agent.sofia_config_json or "{}")
    except (json.JSONDecodeError, TypeError):
        sofia_config = {}

    payload = {
        "agent_id": agent.id,
        "name": agent.name,
        "provider": agent.provider,
        "model": agent.model,
        "system_prompt": agent.system_prompt,
        "welcome_message": agent.welcome_message,
        "language": agent.language,
        "temperature": agent.temperature,
        "max_tokens": agent.max_tokens,
        "sofia_mode": agent.sofia_mode,
        "embed_enabled": agent.embed_enabled,
        "sofia_config": sofia_config,
        "sofia_config_json": json.dumps(sofia_config),
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

        lines.append(
            f"- {tool.name}: {tool.description or 'Sin descripcion'} [{tool.http_method} {tool.endpoint_url}]"
        )
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


def _extract_tool_call(content: str) -> tuple[str, dict[str, Any]] | None:
    text = str(content or "")
    payload: dict[str, Any] | None = None

    start = text.find(TOOL_CALL_TAG_START)
    end = text.find(TOOL_CALL_TAG_END, start + len(TOOL_CALL_TAG_START))
    if start != -1 and end != -1 and end > start:
        fragment = text[start + len(TOOL_CALL_TAG_START):end].strip()
        payload = _parse_json_object(fragment)

    if payload is None:
        stripped = text.strip()
        if stripped.startswith("{") and stripped.endswith("}"):
            payload = _parse_json_object(stripped)

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

    try:
        appointment_date = _parse_optional_datetime(arguments.get("appointment_date"))
    except HTTPException:
        appointment_date = None

    if appointment_date is None:
        return {
            "ok": False,
            "status_code": 400,
            "error": "appointment_date es requerido para agendar cita",
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
        timezone=str(arguments.get("timezone") or "America/Bogota").strip()[:64]
        or "America/Bogota",
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
    if not endpoint:
        return {
            "ok": False,
            "status_code": 400,
            "error": "endpoint_url vacío en herramienta",
            "data": None,
            "mapped_text": None,
        }

    parsed = urlparse(endpoint)
    if parsed.scheme not in {"http", "https"}:
        return {
            "ok": False,
            "status_code": 400,
            "error": "Solo se permiten endpoints http/https o internal://",
            "data": None,
            "mapped_text": None,
        }

    hostname = str(parsed.hostname or "").lower().strip()
    allowed_hosts = _allowed_tool_hosts()
    if allowed_hosts and hostname not in allowed_hosts:
        return {
            "ok": False,
            "status_code": 403,
            "error": f"Host no permitido por política: {hostname}",
            "data": None,
            "mapped_text": None,
        }

    try:
        raw_headers = json.loads(tool.headers_json or "{}")
    except (json.JSONDecodeError, TypeError):
        raw_headers = {}

    headers = {str(k): str(v) for k, v in raw_headers.items()} if isinstance(raw_headers, dict) else {}
    method = str(tool.http_method or "POST").strip().upper()
    args = arguments if isinstance(arguments, dict) else {}

    request_kwargs: dict[str, Any] = {"headers": headers}
    if method in {"GET", "DELETE"}:
        request_kwargs["params"] = args
    else:
        request_kwargs["json"] = args

    try:
        with httpx.Client(timeout=TOOL_EXECUTION_TIMEOUT_SECONDS) as client:
            response = client.request(method, endpoint, **request_kwargs)
    except httpx.TimeoutException:
        return {
            "ok": False,
            "status_code": 504,
            "error": "Tiempo de espera agotado al ejecutar la herramienta",
            "data": None,
            "mapped_text": None,
        }
    except httpx.RequestError as exc:
        return {
            "ok": False,
            "status_code": 502,
            "error": f"Error de red ejecutando herramienta: {exc}",
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
    except ZoneInfoNotFoundError:
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

            if requested_utc_datetime and existing.appointment_date != requested_utc_datetime:
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

        combined_text = " ".join(recent_user_messages).lower()
        appointment_keywords = ["agendar", "agenda", "cita", "programar cita", "agend"]
        has_appointment_intent = any(keyword in combined_text for keyword in appointment_keywords)
        if not has_appointment_intent:
            return

        if not contact_phone and not contact_email:
            return

        appointment_date = requested_utc_datetime or _default_appointment_datetime_utc(timezone_name)
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

    with httpx.Client(timeout=60) as client:
        response = client.post(
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
        detail = body.get("error", {}).get("message") if isinstance(body, dict) else None
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=detail or "OpenAI rechazo la solicitud",
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

    with httpx.Client(timeout=60) as client:
        response = client.post(
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
        detail = body.get("error", {}).get("message") if isinstance(body, dict) else None
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=detail or "Gemini rechazo la solicitud",
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
        client.post(
            url,
            auth=(account_sid, auth_token),
            data={"From": from_number, "To": to_number, "Body": body},
        )


def _send_meta_message(
    access_token: str,
    phone_number_id: str,
    to_number: str,
    body: str,
) -> None:
    url = f"https://graph.facebook.com/v18.0/{phone_number_id}/messages"
    with httpx.Client(timeout=30) as client:
        client.post(
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
    async def create_agent(payload: dict, current_user: CurrentUser, session: SessionDep):
        is_super_admin = is_super_admin_user(current_user)

        if not is_super_admin:
            existing_count = len(
                session.exec(
                    select(TextAgent).where(TextAgent.user_id == current_user.id)
                ).all()
            )
            if existing_count >= 1:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Tu plan permite un único agente de texto. "
                        "Edita el existente o contacta al administrador."
                    ),
                )

            payload = apply_client_text_defaults(payload)

        name = str(payload.get("name") or "").strip()
        if not name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El nombre del agente es requerido",
            )

        provider = _normalize_provider(payload.get("provider") or "openai")
        _resolve_provider_api_key(provider, current_user, session)

        temperature = float(payload.get("temperature") or 0.7)
        max_tokens = int(payload.get("max_tokens") or 512)
        now = _utcnow()

        sofia_mode = bool(payload.get("sofia_mode", False))
        _, sofia_config_json = _extract_sofia_config_json(payload, "{}")
        _validate_sofia_config_escalation_threshold(sofia_config_json)

        agent = TextAgent(
            user_id=current_user.id,
            name=name,
            provider=provider,
            model=str(payload.get("model") or _default_model(provider)),
            system_prompt=str(payload.get("system_prompt") or ""),
            welcome_message=str(payload.get("welcome_message") or ""),
            language=str(payload.get("language") or "es"),
            temperature=max(0.0, min(2.0, temperature)),
            max_tokens=max(64, min(8192, max_tokens)),
            sofia_mode=sofia_mode,
            sofia_config_json=sofia_config_json,
            embed_enabled=bool(payload.get("embed_enabled", True)),
            embed_token=secrets.token_urlsafe(24),
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
        """Crea 1 agente de texto Sofía si el cliente no tiene ninguno."""
        existing = session.exec(
            select(TextAgent).where(TextAgent.user_id == current_user.id)
        ).all()
        if existing:
            return {"created": False, "agent_id": existing[0].id}

        display_name = (current_user.name or "").strip() or "Sofía - Yturria"
        payload = apply_client_text_defaults({"name": display_name})

        try:
            _resolve_provider_api_key(payload["provider"], current_user, session)
        except HTTPException:
            return {"created": False, "agent_id": None, "error": "provider_key_missing"}

        now = _utcnow()
        agent = TextAgent(
            user_id=current_user.id,
            name=display_name,
            provider=payload["provider"],
            model=payload["model"],
            system_prompt=str(payload.get("system_prompt") or ""),
            welcome_message=str(payload.get("welcome_message") or ""),
            language=str(payload.get("language") or "es"),
            temperature=0.7,
            max_tokens=512,
            sofia_mode=bool(payload.get("sofia_mode", True)),
            sofia_config_json="{}",
            embed_enabled=True,
            embed_token=secrets.token_urlsafe(24),
            created_at=now,
            updated_at=now,
        )
        session.add(agent)
        try:
            _commit_with_data_error_guard(session)
            session.refresh(agent)
        except HTTPException:
            return {"created": False, "agent_id": None, "error": "db_error"}

        try:
            _ensure_default_appointment_tool(session, agent)
        except HTTPException:
            return {"created": False, "agent_id": None, "error": "db_error"}

        return {"created": True, "agent_id": agent.id}

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
        original_provider = agent.provider
        original_system_prompt = agent.system_prompt
        original_welcome_message = agent.welcome_message
        original_language = agent.language

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

        if "system_prompt" in payload and is_super_admin:
            agent.system_prompt = str(payload.get("system_prompt") or "")

        if "welcome_message" in payload and is_super_admin:
            agent.welcome_message = str(payload.get("welcome_message") or "")

        if "language" in payload and is_super_admin:
            agent.language = str(payload.get("language") or "es")

        if "temperature" in payload:
            value = float(payload.get("temperature") or 0.7)
            agent.temperature = max(0.0, min(2.0, value))

        if "max_tokens" in payload:
            value = int(payload.get("max_tokens") or 512)
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

        if bool(payload.get("regenerate_embed_token", False)):
            agent.embed_token = secrets.token_urlsafe(24)

        _ensure_embed_token(agent)

        if not is_super_admin:
            agent.provider = original_provider
            agent.system_prompt = original_system_prompt
            agent.welcome_message = original_welcome_message
            agent.language = original_language
            agent.model = DEFAULT_TEXT_MODEL
            agent.temperature = 0.7
            agent.max_tokens = 512

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

        user_message = str(payload.get("message") or "").strip()
        if not user_message:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="message es requerido",
            )

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

        history_rows = session.exec(
            select(TextMessage)
            .where(
                TextMessage.conversation_id == conversation.id,
                TextMessage.deleted_at == None,
            )
            .order_by(TextMessage.created_at.asc())
        ).all()

        history = [
            {"role": row.role, "content": row.content}
            for row in history_rows
            if row.role in {"user", "assistant"}
        ]

        rag_context = _retrieve_rag_context(session, agent.id, user_message)

        if agent.sofia_mode:
            sofia_result = await _run_sofia_chat(
                agent, conversation, history, user_message, rag_context, session
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
        extra_blocks = [b for b in [rag_context, tools_desc] if b]
        if extra_blocks:
            system_prompt = system_prompt + "\n\n" + "\n\n".join(extra_blocks)

        owner_user = session.get(User, agent.user_id)
        if not owner_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Propietario del agente no encontrado",
            )

        api_key, _ = _resolve_provider_api_key(agent.provider, owner_user, session)

        assistant_content, token_usage = _dispatch_llm_with_optional_tool_execution(
            agent=agent,
            session=session,
            conversation=conversation,
            tools=tools,
            api_key=api_key,
            system_prompt=system_prompt,
            history=history,
        )

        has_prior_assistant = any(r.role == "assistant" for r in history_rows)
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

        escalations = []
        for conv in rows:
            last_msg = session.exec(
                select(TextMessage)
                .where(
                    TextMessage.conversation_id == conv.id,
                    TextMessage.role == "user",
                    TextMessage.deleted_at == None,
                )
                .order_by(TextMessage.created_at.desc())
            ).first()

            escalations.append({
                "conversation_id": conv.id,
                "title": conv.title,
                "escalation_status": conv.escalation_status,
                "escalation_reason": conv.escalation_reason,
                "escalated_at_unix_secs": _to_unix(conv.escalated_at) if conv.escalated_at else None,
                "last_user_message": last_msg.content[:200] if last_msg else "",
                "created_at_unix_secs": _to_unix(conv.created_at),
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

        now = _utcnow()
        tool = TextAgentTool(
            text_agent_id=text_agent_id,
            name=name,
            description=str(payload.get("description") or ""),
            endpoint_url=endpoint_url,
            http_method=method,
            headers_json=json.dumps(headers),
            body_template=str(payload.get("body_template") or ""),
            parameters_schema_json=json.dumps(parameters_schema),
            response_mapping_json=json.dumps(response_mapping),
            enabled=bool(payload.get("enabled", True)),
            created_at=now,
            updated_at=now,
        )
        session.add(tool)
        session.commit()
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
            tool.headers_json = json.dumps(headers)

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

        tool.updated_at = _utcnow()
        session.add(tool)
        session.commit()
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
        _apply_google_calendar_sync(session, appointment, operation="upsert")

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
        _apply_google_calendar_sync(session, appointment, operation="upsert")

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
        _apply_google_calendar_sync(session, appointment, operation="delete")

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
        raw = await file.read()
        content = raw.decode("utf-8", errors="ignore").strip()
        document_name = (name or "").strip() or file.filename or "Documento archivo"

        now = _utcnow()
        doc = TextKnowledgeBaseDocument(
            user_id=current_user.id,
            name=document_name,
            source_type="file",
            source_value=file.filename or "uploaded-file",
            content=content,
            index_status="indexing",
            chunk_count=0,
            created_at=now,
            updated_at=now,
        )
        session.add(doc)
        session.commit()
        session.refresh(doc)

        try:
            count = _index_document(doc, session)
            doc.chunk_count = count
            doc.index_status = "indexed"
            doc.updated_at = _utcnow()
            session.add(doc)
            session.commit()
            session.refresh(doc)
        except Exception:
            doc.index_status = "failed"
            session.add(doc)
            session.commit()

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

        try:
            count = _index_document(doc, session)
            doc.chunk_count = count
            doc.index_status = "indexed"
            doc.updated_at = _utcnow()
            session.add(doc)
            session.commit()
            session.refresh(doc)
        except Exception:
            doc.index_status = "failed"
            session.add(doc)
            session.commit()

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
        messages = session.exec(
            select(TextMessage)
            .where(
                TextMessage.conversation_id.in_(conversation_ids),
                TextMessage.deleted_at == None,
            )
            .order_by(TextMessage.created_at.asc())
        ).all()

        grouped: dict[str, list[TextMessage]] = {}
        for message in messages:
            grouped.setdefault(message.conversation_id, []).append(message)

        result: list[dict[str, Any]] = []
        for conversation in rows:
            msgs = grouped.get(conversation.id, [])
            last_preview = msgs[-1].content[:140] if msgs else ""
            result.append(
                {
                    "conversation_id": conversation.id,
                    "agent_id": text_agent_id,
                    "status": "done",
                    "channel": getattr(conversation, "channel", "web"),
                    "start_time_unix_secs": _to_unix(conversation.created_at),
                    "updated_at_unix_secs": _to_unix(conversation.updated_at),
                    "message_count": len(msgs),
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
            .order_by(TextMessage.created_at.asc())
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
            "channel": getattr(conversation, "channel", "web"),
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
                        "renewal_status invalido. Usa: none, scheduled, reminder_sent, "
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

        user_message = str(payload.get("message") or "").strip()
        if not user_message:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="message es requerido",
            )

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

        history_rows = session.exec(
            select(TextMessage)
            .where(
                TextMessage.conversation_id == conversation.id,
                TextMessage.deleted_at == None,
            )
            .order_by(TextMessage.created_at.asc())
        ).all()

        history = [
            {"role": row.role, "content": row.content}
            for row in history_rows
            if row.role in {"user", "assistant"}
        ]

        rag_context = _retrieve_rag_context(session, agent.id, user_message)

        if agent.sofia_mode:
            sofia_result = await _run_sofia_chat(
                agent, conversation, history, user_message, rag_context, session
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
        extra_blocks = [b for b in [rag_context, tools_desc] if b]
        if extra_blocks:
            system_prompt = system_prompt + "\n\n" + "\n\n".join(extra_blocks)

        api_key, _ = _resolve_provider_api_key(agent.provider, current_user, session)

        assistant_content, token_usage = _dispatch_llm_with_optional_tool_execution(
            agent=agent,
            session=session,
            conversation=conversation,
            tools=tools,
            api_key=api_key,
            system_prompt=system_prompt,
            history=history,
        )

        has_prior_assistant = any(r.role == "assistant" for r in history_rows)
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
    ) -> str:
        config = session.get(TextAgentWhatsApp, config_id)
        if not config or not config.active:
            return ""

        agent = session.get(TextAgent, config.text_agent_id)
        if not agent:
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
            )
        )
        session.commit()

        history_rows = session.exec(
            select(TextMessage)
            .where(
                TextMessage.conversation_id == conversation.id,
                TextMessage.deleted_at == None,
            )
            .order_by(TextMessage.created_at.asc())
        ).all()

        history = [
            {"role": row.role, "content": row.content}
            for row in history_rows
            if row.role in {"user", "assistant"}
        ]

        rag_context = _retrieve_rag_context(session, agent.id, message_text)

        if agent.sofia_mode:
            try:
                sofia_result = await _run_sofia_chat(
                    agent, conversation, history, message_text, rag_context, session,
                    sender_phone=sender,
                )
                return sofia_result["response"]
            except Exception:
                logger.exception("Sofia graph error")
                return "Lo siento, ocurrió un error. En breve un asesor se comunicará con usted."

        _ensure_default_appointment_tool(session, agent)
        tools = _list_agent_tools(session, agent.id)
        tools_desc = _build_tools_description(tools)

        system_prompt = agent.system_prompt.strip() or "Eres un asistente util y claro."
        extra_blocks = [b for b in [rag_context, tools_desc] if b]
        if extra_blocks:
            system_prompt = system_prompt + "\n\n" + "\n\n".join(extra_blocks)

        env_key = _get_env_provider_key(agent.provider)
        if not env_key:
            return "Lo siento, no puedo responder ahora mismo."

        try:
            assistant_content, token_usage = _dispatch_llm_with_optional_tool_execution(
                agent=agent,
                session=session,
                conversation=conversation,
                tools=tools,
                api_key=env_key,
                system_prompt=system_prompt,
                history=history,
            )
        except Exception:
            return "Lo siento, ocurrio un error al procesar tu mensaje."

        has_prior_assistant = any(r.role == "assistant" for r in history_rows)
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
) -> dict[str, Any]:
    try:
        sofia_config = json.loads(agent.sofia_config_json or "{}")
    except (json.JSONDecodeError, TypeError):
        sofia_config = {}

    user_msg_count = sum(1 for m in history if m["role"] == "user")

    has_open_appointment = bool(
        session.exec(
            select(TextAppointment).where(
                TextAppointment.text_agent_id == agent.id,
                TextAppointment.conversation_id == conversation.id,
                TextAppointment.deleted_at == None,
                TextAppointment.status.in_(["scheduled", "confirmed"]),
            )
        ).first()
    )

    runtime_prompt_override = (
        (agent.system_prompt.strip() or "")
        + "\n\nRegla operativa adicional: si ya capturaste datos y solicitud de cita, "
        + "continúa resolviendo horarios o preferencia de contacto sin repetir la frase de escalación en cada respuesta."
    ).strip()

    sofia_result = await run_sofia(
        user_message=user_message,
        history=history,
        rag_context=rag_context,
        message_count=user_msg_count,
        system_prompt_override=runtime_prompt_override,
        config=sofia_config,
        already_escalated=conversation.escalation_status in {"pending", "in_progress"},
        has_open_appointment=has_open_appointment,
    )

    assistant_content = sofia_result.get("response", "")
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

    _maybe_auto_create_appointment_from_sofia(
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

    if sofia_result.get("should_escalate"):
        conversation.escalation_status = "pending"
        conversation.escalation_reason = sofia_result.get("escalation_reason", "user_request")
        conversation.escalated_at = now

        if sender_phone:
            _notify_advisor_whatsapp(
                agent, session, sender_phone,
                sofia_result.get("escalation_reason", ""),
                user_message,
                conversation.id,
            )

    conversation.updated_at = now
    session.add(conversation)
    session.commit()

    return sofia_result


def _notify_advisor_whatsapp(
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
            _send_meta_message(access_token, wa_config.phone_number_id, advisor_phone, notification)
        elif wa_config.provider == "twilio" and wa_config.account_sid and wa_config.auth_token_encrypted:
            auth_token = decrypt_secret(wa_config.auth_token_encrypted)
            from_number = f"whatsapp:{wa_config.phone_number}"
            to_number = f"whatsapp:{advisor_phone}"
            _send_twilio_message(wa_config.account_sid, auth_token, from_number, to_number, notification)
    except Exception:
        logger.exception("Failed to notify advisor via WhatsApp")
