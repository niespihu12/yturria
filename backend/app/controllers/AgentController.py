import logging
import os
import re
import json
from datetime import datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from fastapi import HTTPException, Response, UploadFile, status
from sqlmodel import Session, select
from starlette.concurrency import run_in_threadpool

from app.controllers.deps.auth import CurrentUser
from app.controllers.deps.db_session import SessionDep
from app.models.AuditTrailEvent import AuditTrailEvent
from app.models.User import User
from app.models.UserAgent import UserAgent
from app.models.TextAppointment import TextAppointment
from app.models.UserWhatsAppConfig import UserWhatsAppConfig
from app.models.VoiceAgentRuntimeConfig import VoiceAgentRuntimeConfig
from app.models.UserPhoneNumber import UserPhoneNumber
from app.models.UserTool import UserTool
from app.models.UserKnowledgeBaseDocument import UserKnowledgeBaseDocument
from app.models.UserCalendarConnection import UserCalendarConnection
from app.models.Contact import Contact
from app.services.appointment_service import (
    format_appointment_for_humans,
    is_time_slot_available,
    parse_preferred_datetime,
)
from app.services.google_calendar import sync_google_calendar_for_appointment
from app.services.whatsapp_service import (
    build_appointment_confirmation_message,
    build_escalation_message,
    has_valid_credentials,
    normalize_recipient,
    send_whatsapp_message,
)
from app.utils.crypto import encrypt_secret
from app.utils.client_defaults import (
    apply_client_voice_defaults,
    build_client_voice_payload,
    build_contact_catalog_prompt,
    build_client_built_in_tools,
)
from app.utils.text_agent_templates import (
    TEXT_AGENT_DEFAULT_TEMPLATE_KEY,
    VOICE_AGENT_NON_ADMIN_LIMIT,
    get_text_agent_template_definition,
    normalize_text_agent_template_key,
)
from app.utils.roles import is_super_admin_user, role_as_value

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_BASE = "https://api.elevenlabs.io/v1"
E164_PHONE_PATTERN = re.compile(r"^\+[1-9]\d{7,15}$")
logger = logging.getLogger(__name__)

SUPPORTED_APPOINTMENT_STATUSES = {
    "scheduled",
    "confirmed",
    "completed",
    "cancelled",
    "no_show",
}

SUPPORTED_APPOINTMENT_SOURCES = {"manual", "agent", "embed", "phone", "voice"}
SUPPORTED_ESCALATION_CHANNELS = {"phone", "whatsapp"}
# Citas en estos estados liberan la franja: su evento de Google se elimina.
GOOGLE_EVENT_RELEASE_STATUSES = {"cancelled", "no_show"}
DEFAULT_APPOINTMENT_TIMEZONE = "America/Bogota"

EL_LIST_PAGE_SIZE = 100
EL_LIST_MAX_PAGES = 50

VOICE_TOOL_WEBHOOK_PATH = "/webhooks/voice/tools/"
VOICE_TOOL_TOKEN_HEADER = "X-Voice-Tool-Token"
REDACTED_SECRET = "********"

# Cliente final (no super_admin): claves que puede enviar al crear/editar un agente de voz.
# Tools (tool_ids/tools), MCP y ajustes sensibles de plataforma (overrides, auth,
# webhooks...) quedan reservados al super admin. Lo omitido lo conserva ElevenLabs.
NON_ADMIN_AGENT_KEYS = frozenset({"name", "conversation_config", "platform_settings"})
NON_ADMIN_CONVERSATION_CONFIG_KEYS = frozenset(
    {"agent", "tts", "turn", "conversation", "asr", "vad", "language_presets"}
)
NON_ADMIN_PROMPT_KEYS = frozenset(
    {
        "prompt",
        "llm",
        "temperature",
        "max_tokens",
        "knowledge_base",
        "rag",
        "ignore_default_personality",
        "built_in_tools",
        "timezone",
    }
)
NON_ADMIN_PLATFORM_SETTINGS_KEYS = frozenset(
    {"call_recording_enabled", "privacy", "ignore_default_personality"}
)


def _resolve_voice_template_defaults(template_key: Any) -> tuple[str, str, str]:
    normalized_key = normalize_text_agent_template_key(
        template_key,
        fallback=TEXT_AGENT_DEFAULT_TEMPLATE_KEY,
    )
    definition = get_text_agent_template_definition(normalized_key)
    defaults = definition.get("defaults") if isinstance(definition.get("defaults"), dict) else {}

    prompt = str(defaults.get("system_prompt") or "").strip()
    first_message = str(defaults.get("welcome_message") or "").strip()
    language = str(defaults.get("language") or "").strip() or "es"
    return prompt, first_message, language


def _headers(*, json_body: bool = False) -> dict[str, str]:
    if not ELEVENLABS_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ELEVENLABS_API_KEY no configurada en el backend",
        )

    headers = {"xi-api-key": ELEVENLABS_API_KEY}
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers


def _extract_el_error(body: Any, fallback: str = "Error con ElevenLabs") -> str:
    if isinstance(body, dict):
        detail = body.get("detail")
        if isinstance(detail, dict):
            return detail.get("message", str(detail))
        if isinstance(detail, str):
            return detail
        error = body.get("error")
        if isinstance(error, str):
            return error
    return fallback


def _parse_el_response(resp: httpx.Response) -> Any:
    if not resp.content:
        return {}
    try:
        return resp.json()
    except ValueError:
        return {"detail": resp.text}


async def _elevenlabs_request(
    method: str,
    path: str,
    *,
    json: dict | None = None,
    params: dict | None = None,
    data: dict | None = None,
    files: dict | None = None,
) -> Any:
    # Cliente async: una llamada lenta a ElevenLabs no bloquea el event loop.
    headers = _headers(json_body=json is not None and files is None and data is None)
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.request(
            method,
            f"{ELEVENLABS_BASE}{path}",
            headers=headers,
            json=json,
            params=params,
            data=data,
            files=files,
        )

    body = _parse_el_response(resp)
    if not resp.is_success:
        raise HTTPException(
            status_code=resp.status_code,
            detail=_extract_el_error(body, fallback=resp.text or "Error con ElevenLabs"),
        )
    return body


async def _elevenlabs_get(path: str, *, params: dict | None = None) -> Any:
    return await _elevenlabs_request("GET", path, params=params)


async def _elevenlabs_post(path: str, body: dict) -> Any:
    return await _elevenlabs_request("POST", path, json=body)


async def _elevenlabs_patch(path: str, body: dict) -> Any:
    return await _elevenlabs_request("PATCH", path, json=body)


async def _elevenlabs_delete(path: str) -> Any:
    return await _elevenlabs_request("DELETE", path)


async def _elevenlabs_list_all(path: str, key: str) -> list[dict]:
    """Recorre todas las paginas (cursor) de un listado paginado de ElevenLabs."""
    items: list[dict] = []
    params: dict[str, Any] = {"page_size": EL_LIST_PAGE_SIZE}
    for _ in range(EL_LIST_MAX_PAGES):
        data = await _elevenlabs_get(path, params=params)
        if not isinstance(data, dict):
            break
        page = data.get(key)
        if isinstance(page, list):
            items.extend(item for item in page if isinstance(item, dict))
        next_cursor = data.get("next_cursor")
        if not data.get("has_more") or not next_cursor:
            break
        params = {"page_size": EL_LIST_PAGE_SIZE, "cursor": next_cursor}
    return items


def _voice_tool_token() -> str:
    return os.getenv("VOICE_AGENT_TOOL_TOKEN", "").strip()


def _inject_voice_tool_token(tool_config: Any) -> None:
    """Las herramientas webhook que apuntan a /api/webhooks/voice/tools/* reciben el
    token del servidor (el frontend nunca lo conoce)."""
    if not isinstance(tool_config, dict):
        return
    api_schema = tool_config.get("api_schema")
    if not isinstance(api_schema, dict):
        return
    url = str(api_schema.get("url") or "")
    if VOICE_TOOL_WEBHOOK_PATH not in url:
        return

    raw_headers = api_schema.get("request_headers")
    headers = {
        key: value
        for key, value in (raw_headers.items() if isinstance(raw_headers, dict) else [])
        if str(key).lower() != VOICE_TOOL_TOKEN_HEADER.lower()
    }
    token = _voice_tool_token()
    if token:
        headers[VOICE_TOOL_TOKEN_HEADER] = token
    else:
        logger.warning("VOICE_AGENT_TOOL_TOKEN no configurado; la herramienta %s fallara", url)
    api_schema["request_headers"] = headers


def _inject_voice_tool_token_in_agent_payload(payload: dict) -> None:
    conv_cfg = payload.get("conversation_config")
    agent_cfg = conv_cfg.get("agent") if isinstance(conv_cfg, dict) else None
    prompt_cfg = agent_cfg.get("prompt") if isinstance(agent_cfg, dict) else None
    tools = prompt_cfg.get("tools") if isinstance(prompt_cfg, dict) else None
    if isinstance(tools, list):
        for tool in tools:
            _inject_voice_tool_token(tool)


def _redact_voice_tool_token(value: Any) -> Any:
    """Oculta el token de herramientas en las respuestas que devuelven configs de tools."""
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "request_headers" and isinstance(item, dict):
                for header in item:
                    if str(header).lower() == VOICE_TOOL_TOKEN_HEADER.lower():
                        item[header] = REDACTED_SECRET
            else:
                _redact_voice_tool_token(item)
    elif isinstance(value, list):
        for item in value:
            _redact_voice_tool_token(item)
    return value


def _prompt_config(payload: Any) -> dict | None:
    conv_cfg = payload.get("conversation_config") if isinstance(payload, dict) else None
    agent_cfg = conv_cfg.get("agent") if isinstance(conv_cfg, dict) else None
    prompt_cfg = agent_cfg.get("prompt") if isinstance(agent_cfg, dict) else None
    return prompt_cfg if isinstance(prompt_cfg, dict) else None


def _sanitize_non_admin_agent_payload(
    payload: Any, *, extra_keys: frozenset[str] = frozenset()
) -> dict:
    if not isinstance(payload, dict):
        return {}

    allowed_keys = NON_ADMIN_AGENT_KEYS | extra_keys
    sanitized = {key: value for key, value in payload.items() if key in allowed_keys}

    conv_cfg = sanitized.pop("conversation_config", None)
    if isinstance(conv_cfg, dict):
        conv_cfg = {
            key: value
            for key, value in conv_cfg.items()
            if key in NON_ADMIN_CONVERSATION_CONFIG_KEYS
        }
        agent_cfg = conv_cfg.get("agent")
        if isinstance(agent_cfg, dict):
            agent_cfg = dict(agent_cfg)
            prompt_cfg = agent_cfg.get("prompt")
            if isinstance(prompt_cfg, dict):
                agent_cfg["prompt"] = {
                    key: value
                    for key, value in prompt_cfg.items()
                    if key in NON_ADMIN_PROMPT_KEYS
                }
            else:
                agent_cfg.pop("prompt", None)
            conv_cfg["agent"] = agent_cfg
        else:
            conv_cfg.pop("agent", None)
        sanitized["conversation_config"] = conv_cfg

    platform_settings = sanitized.pop("platform_settings", None)
    if isinstance(platform_settings, dict):
        filtered = {
            key: value
            for key, value in platform_settings.items()
            if key in NON_ADMIN_PLATFORM_SETTINGS_KEYS
        }
        if filtered:
            sanitized["platform_settings"] = filtered

    return sanitized


def _extract_knowledge_base_ids(agent_config: Any) -> set[str]:
    prompt_cfg = _prompt_config(agent_config)
    items = prompt_cfg.get("knowledge_base") if prompt_cfg else None
    if not isinstance(items, list):
        return set()
    return {
        str(item.get("id")).strip()
        for item in items
        if isinstance(item, dict) and str(item.get("id") or "").strip()
    }


def _owned_knowledge_base_ids(user_id: str, session: Session) -> set[str]:
    rows = session.exec(
        select(UserKnowledgeBaseDocument).where(UserKnowledgeBaseDocument.user_id == user_id)
    ).all()
    return {row.documentation_id for row in rows}


async def _knowledge_base_ids_attached_to_user_agents(user_id: str, session: Session) -> set[str]:
    """Documentos (incluidos los legacy sin dueño registrado) que usan los agentes del usuario."""
    agent_ids = {
        row.agent_id
        for row in session.exec(select(UserAgent).where(UserAgent.user_id == user_id)).all()
    }
    attached: set[str] = set()
    for agent_id in sorted(agent_ids):
        try:
            agent_config = await _elevenlabs_get(f"/convai/agents/{agent_id}")
        except Exception:
            logger.warning(
                "No se pudo leer el agente %s para resolver su base de conocimiento", agent_id
            )
            continue
        attached |= _extract_knowledge_base_ids(agent_config)
    return attached


async def _require_knowledge_base_access(
    documentation_id: str,
    current_user: CurrentUser,
    session: Session,
    *,
    write: bool,
) -> None:
    """Lectura: documentos propios o usados por los agentes del usuario.
    Escritura (editar/eliminar): solo documentos propios. Super admin: todo."""
    if is_super_admin_user(current_user):
        return

    owner = session.exec(
        select(UserKnowledgeBaseDocument).where(
            UserKnowledgeBaseDocument.documentation_id == documentation_id
        )
    ).first()
    if owner and owner.user_id == current_user.id:
        return

    if not write and documentation_id in await _knowledge_base_ids_attached_to_user_agents(
        current_user.id, session
    ):
        return

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Documento de conocimiento no encontrado o sin permisos",
    )


async def _validate_non_admin_knowledge_base(
    payload: dict,
    current_user: CurrentUser,
    session: Session,
    *,
    agent_id: str | None,
) -> None:
    prompt_cfg = _prompt_config(payload)
    if not prompt_cfg or "knowledge_base" not in prompt_cfg:
        return

    requested = _extract_knowledge_base_ids(payload)
    not_owned = requested - _owned_knowledge_base_ids(current_user.id, session)
    if not_owned and agent_id:
        # Los documentos que el agente ya tenia asociados se pueden conservar.
        current_agent = await _elevenlabs_get(f"/convai/agents/{agent_id}")
        not_owned -= _extract_knowledge_base_ids(current_agent)

    if not_owned:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Documento de conocimiento no encontrado o sin permisos",
        )


def _record_knowledge_base_ownership(
    result: Any, current_user: CurrentUser, session: Session
) -> None:
    documentation_id = result.get("id") if isinstance(result, dict) else None
    if not isinstance(documentation_id, str) or not documentation_id:
        return
    existing = session.exec(
        select(UserKnowledgeBaseDocument).where(
            UserKnowledgeBaseDocument.documentation_id == documentation_id
        )
    ).first()
    if not existing:
        session.add(
            UserKnowledgeBaseDocument(user_id=current_user.id, documentation_id=documentation_id)
        )
        session.commit()


def _normalize_optional_user_id(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


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


def _build_user_lookup(session: Session, user_ids: set[str]) -> dict[str, User]:
    if not user_ids:
        return {}

    users = session.exec(select(User).where(User.id.in_(user_ids))).all()
    return {user.id: user for user in users}


def _require_owned_agent(
    agent_id: str, current_user: CurrentUser, session: Session
) -> UserAgent:
    if is_super_admin_user(current_user):
        row = session.exec(
            select(UserAgent).where(
                UserAgent.agent_id == agent_id,
            )
        ).first()
    else:
        row = session.exec(
            select(UserAgent).where(
                UserAgent.user_id == current_user.id,
                UserAgent.agent_id == agent_id,
            )
        ).first()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agente no encontrado o sin permisos",
        )

    return row


def _require_owned_phone_number(
    phone_number_id: str, current_user: CurrentUser, session: Session
) -> UserPhoneNumber:
    if is_super_admin_user(current_user):
        row = session.exec(
            select(UserPhoneNumber).where(
                UserPhoneNumber.phone_number_id == phone_number_id,
            )
        ).first()
    else:
        row = session.exec(
            select(UserPhoneNumber).where(
                UserPhoneNumber.user_id == current_user.id,
                UserPhoneNumber.phone_number_id == phone_number_id,
            )
        ).first()

    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Numero de telefono no encontrado o sin permisos",
        )

    return row


def _utcnow() -> datetime:
    return datetime.utcnow()


def _to_unix(value: datetime | None) -> int | None:
    if value is None:
        return None
    if value.tzinfo is not None:
        return int(value.astimezone(timezone.utc).timestamp())
    return int(value.replace(tzinfo=timezone.utc).timestamp())


def _utc_naive_from_unix(value: int | float, field_name: str) -> datetime:
    try:
        return datetime.utcfromtimestamp(int(value))
    except (OverflowError, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} fuera de rango",
        ) from exc


def _resolve_timezone(value: Any, fallback: str = DEFAULT_APPOINTMENT_TIMEZONE) -> str:
    name = str(value or "").strip() or fallback
    try:
        if len(name) > 64:
            raise ValueError(name)
        ZoneInfo(name)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="timezone invalido. Usa una zona IANA, por ejemplo America/Bogota",
        ) from exc
    return name


def _parse_optional_datetime(value: Any) -> datetime | None:
    if value is None:
        return None

    if isinstance(value, datetime):
        return value

    if isinstance(value, (int, float)):
        if value <= 0:
            return None
        return _utc_naive_from_unix(value, "appointment_date")

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
            detail="appointment_date debe ser ISO8601 o unix timestamp",
        ) from exc

    # Si trae offset (ej. -05:00), convertir a UTC antes de guardar como naive UTC.
    if parsed.tzinfo:
        return parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


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


async def _apply_google_calendar_sync(
    session: SessionDep,
    appointment: TextAppointment,
    *,
    operation: str = "upsert",
) -> None:
    # Buscar conexion OAuth del usuario (DB en el hilo del request; solo la llamada a
    # Google, que es bloqueante, va al threadpool).
    user_conn = session.exec(
        select(UserCalendarConnection).where(
            UserCalendarConnection.user_id == appointment.user_id,
            UserCalendarConnection.active == True,
            UserCalendarConnection.is_default == True,
        )
    ).first()

    try:
        result = await run_in_threadpool(
            sync_google_calendar_for_appointment,
            appointment,
            operation=operation,
            user_calendar_connection=user_conn,
        )
    except Exception:
        logger.exception("No se pudo sincronizar cita de voz con Google Calendar")
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


def _serialize_global_whatsapp_config(config: UserWhatsAppConfig) -> dict[str, Any]:
    return {
        "id": config.id,
        "provider": config.provider,
        "default_sender_number": config.default_sender_number,
        "active": bool(config.active),
        "message_template_escalation": config.message_template_escalation,
        "message_template_appointment": config.message_template_appointment,
        "has_twilio_auth_token": bool(config.auth_token_encrypted),
        "has_meta_access_token": bool(config.access_token_encrypted),
        "account_sid": config.account_sid,
        "phone_number_id": config.phone_number_id,
        "business_account_id": config.business_account_id,
    }


def _serialize_voice_runtime_config(config: VoiceAgentRuntimeConfig) -> dict[str, Any]:
    return {
        "id": config.id,
        "agent_id": config.agent_id,
        "whatsapp_enabled": bool(config.whatsapp_enabled),
        "default_escalation_channel": config.default_escalation_channel,
        "escalation_phone_number": config.escalation_phone_number,
        "updated_at_unix_secs": _to_unix(config.updated_at),
    }


def _get_or_create_voice_runtime_config(
    session: SessionDep,
    *,
    owner_user_id: str,
    agent_id: str,
) -> VoiceAgentRuntimeConfig:
    config = session.exec(
        select(VoiceAgentRuntimeConfig).where(
            VoiceAgentRuntimeConfig.agent_id == agent_id,
            VoiceAgentRuntimeConfig.user_id == owner_user_id,
        )
    ).first()

    if config:
        return config

    now = _utcnow()
    config = VoiceAgentRuntimeConfig(
        user_id=owner_user_id,
        agent_id=agent_id,
        whatsapp_enabled=False,
        default_escalation_channel="phone",
        escalation_phone_number="",
        created_at=now,
        updated_at=now,
    )
    session.add(config)
    session.flush()
    return config


def _resolve_voice_whatsapp_config(session: SessionDep, user_id: str) -> UserWhatsAppConfig | None:
    return session.exec(
        select(UserWhatsAppConfig).where(UserWhatsAppConfig.user_id == user_id)
    ).first()


async def _is_slot_available(session: SessionDep, **kwargs: Any) -> bool:
    # is_time_slot_available consulta Google Calendar (bloqueante): va al threadpool.
    return await run_in_threadpool(is_time_slot_available, session, **kwargs)


async def _get_authorized_conversation(
    conversation_id: str, current_user: CurrentUser, session: SessionDep
) -> dict:
    data = await _elevenlabs_get(f"/convai/conversations/{conversation_id}")
    agent_id = data.get("agent_id") if isinstance(data, dict) else None
    if not isinstance(agent_id, str) or not agent_id.strip():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conversacion no encontrada o sin permisos",
        )
    _require_owned_agent(agent_id, current_user, session)
    return data


class AgentController:

    @staticmethod
    async def list_agents(
        current_user: CurrentUser,
        session: SessionDep,
        user_id: str | None = None,
    ):
        scoped_user_id = _resolve_user_scope(current_user, user_id)
        is_super_admin = is_super_admin_user(current_user)

        statement = select(UserAgent)
        if scoped_user_id:
            statement = statement.where(UserAgent.user_id == scoped_user_id)
        rows = session.exec(statement).all()

        if not rows:
            return {"agents": []}

        el_agents = await _elevenlabs_list_all("/convai/agents", "agents")

        if not is_super_admin:
            owned_ids = {row.agent_id for row in rows}
            owned_agents = [a for a in el_agents if a.get("agent_id") in owned_ids]
            return {"agents": owned_agents}

        ownership_by_agent: dict[str, UserAgent] = {}
        for row in rows:
            ownership_by_agent.setdefault(row.agent_id, row)

        user_lookup = _build_user_lookup(session, {row.user_id for row in rows})

        # In super-admin mode, only show agents that have local ownership in this platform.
        allowed_agent_ids = {row.agent_id for row in rows}
        normalized_agents: list[dict] = []
        for agent in el_agents:
            if not isinstance(agent, dict):
                continue

            agent_id = agent.get("agent_id")
            if not isinstance(agent_id, str) or not agent_id:
                continue

            if agent_id not in allowed_agent_ids:
                continue

            normalized_agent = dict(agent)
            owner_mapping = ownership_by_agent.get(agent_id)
            if owner_mapping:
                owner_user = user_lookup.get(owner_mapping.user_id)
                access_info = normalized_agent.get("access_info")
                if not isinstance(access_info, dict):
                    access_info = {}

                access_info["owner_user_id"] = owner_mapping.user_id

                if owner_user:
                    access_info["creator_email"] = owner_user.email
                    access_info["creator_name"] = owner_user.name
                    access_info["role"] = role_as_value(owner_user.role)

                normalized_agent["access_info"] = access_info

            normalized_agents.append(normalized_agent)

        return {"agents": normalized_agents}

    @staticmethod
    async def get_agent(agent_id: str, current_user: CurrentUser, session: SessionDep):
        _require_owned_agent(agent_id, current_user, session)
        return _redact_voice_tool_token(await _elevenlabs_get(f"/convai/agents/{agent_id}"))

    @staticmethod
    async def get_signed_url(
        agent_id: str, current_user: CurrentUser, session: SessionDep
    ):
        _require_owned_agent(agent_id, current_user, session)
        data = await _elevenlabs_post(f"/convai/agents/{agent_id}/link", {})
        conversation_token = data.get("token", {}).get("conversation_token", "")
        return {
            "signed_url": (
                f"wss://api.elevenlabs.io/v1/convai/conversation?agent_id={agent_id}"
                f"&token={conversation_token}"
            )
        }

    @staticmethod
    async def create_agent(payload: dict, current_user: CurrentUser, session: SessionDep):
        if not isinstance(payload, dict):
            payload = {}

        is_super_admin = is_super_admin_user(current_user)
        template_prompt, template_first_message, template_language = _resolve_voice_template_defaults(
            payload.get("template_key")
        )

        if not is_super_admin:
            existing_count = len(
                session.exec(
                    select(UserAgent).where(UserAgent.user_id == current_user.id)
                ).all()
            )
            if existing_count >= VOICE_AGENT_NON_ADMIN_LIMIT:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        f"Tu plan permite hasta {VOICE_AGENT_NON_ADMIN_LIMIT} agentes de voz. "
                        "Edita uno existente o contacta al administrador."
                    ),
                )

            user_contacts = session.exec(
                select(Contact).where(
                    Contact.user_id == current_user.id,
                    Contact.active == True,
                ).order_by(Contact.name, Contact.last_name)
            ).all()

            payload = _sanitize_non_admin_agent_payload(
                payload, extra_keys=frozenset({"template_key"})
            )
            await _validate_non_admin_knowledge_base(
                payload, current_user, session, agent_id=None
            )
            payload = apply_client_voice_defaults(
                payload,
                prompt_override=template_prompt,
                first_message_override=template_first_message,
                language_override=template_language,
                contacts=user_contacts,
            )

            # Contexto adicional: catálogo de contactos en el prompt
            contact_catalog = build_contact_catalog_prompt(current_user.id, session)
            if contact_catalog:
                conv_cfg = payload.setdefault("conversation_config", {})
                agent_cfg = conv_cfg.setdefault("agent", {})
                prompt_cfg = agent_cfg.setdefault("prompt", {})
                current_prompt = str(prompt_cfg.get("prompt") or "").strip()
                if current_prompt and "--- DIRECTORIO DE ASESORES ---" not in current_prompt:
                    prompt_cfg["prompt"] = current_prompt + "\n" + contact_catalog
        else:
            conv_cfg = payload.setdefault("conversation_config", {})
            agent_cfg = conv_cfg.setdefault("agent", {})
            prompt_cfg = agent_cfg.setdefault("prompt", {})

            if not str(prompt_cfg.get("prompt") or "").strip() and template_prompt:
                prompt_cfg["prompt"] = template_prompt
            if not str(agent_cfg.get("first_message") or "").strip() and template_first_message:
                agent_cfg["first_message"] = template_first_message
            if not str(agent_cfg.get("language") or "").strip():
                agent_cfg["language"] = template_language

        # Inyectar transfers y catálogo para super_admin también
        if is_super_admin:
            user_contacts = session.exec(
                select(Contact).where(
                    Contact.user_id == current_user.id,
                    Contact.active == True,
                ).order_by(Contact.name, Contact.last_name)
            ).all()
            conv_cfg = payload.setdefault("conversation_config", {})
            agent_cfg = conv_cfg.setdefault("agent", {})
            prompt_cfg = agent_cfg.setdefault("prompt", {})
            prompt_cfg["built_in_tools"] = build_client_built_in_tools(user_contacts)
            _inject_voice_tool_token_in_agent_payload(payload)

            contact_catalog = build_contact_catalog_prompt(current_user.id, session)
            if contact_catalog:
                current_prompt = str(prompt_cfg.get("prompt") or "").strip()
                if current_prompt and "--- DIRECTORIO DE ASESORES ---" not in current_prompt:
                    prompt_cfg["prompt"] = current_prompt + "\n" + contact_catalog

        payload.pop("template_key", None)

        # ElevenLabs requires eleven_turbo_v2_5 for non-English agents.
        # Always set it as default to avoid validation errors.
        conv_cfg: dict = payload.get("conversation_config", {})
        if "tts" not in conv_cfg or not conv_cfg["tts"].get("model_id"):
            conv_cfg.setdefault("tts", {})["model_id"] = "eleven_turbo_v2_5"
        payload["conversation_config"] = conv_cfg

        el_agent = await _elevenlabs_post("/convai/agents/create", payload)
        agent_id: str = el_agent["agent_id"]

        # Store ownership
        mapping = UserAgent(user_id=current_user.id, agent_id=agent_id)
        session.add(mapping)
        session.commit()

        return _redact_voice_tool_token(el_agent)

    @staticmethod
    async def bootstrap_client(current_user: CurrentUser, session: SessionDep) -> dict:
        """Crea 1 agente de voz por defecto para un cliente si no existe.

        Pensado para super_admin + cliente final. No duplica si ya hay un agente.
        Devuelve el agent_id y si se creó o ya existía.
        """
        existing_rows = session.exec(
            select(UserAgent).where(UserAgent.user_id == current_user.id)
        ).all()

        if existing_rows:
            return {"created": False, "agent_id": existing_rows[0].agent_id}

        display_name = (current_user.name or "").strip() or "Sofía - Yturria"
        user_contacts = session.exec(
            select(Contact).where(
                Contact.user_id == current_user.id,
                Contact.active == True,
            ).order_by(Contact.name, Contact.last_name)
        ).all()
        payload = build_client_voice_payload(display_name, contacts=user_contacts)

        # Contexto adicional: catálogo de contactos en el prompt de bootstrap
        contact_catalog = build_contact_catalog_prompt(current_user.id, session)
        if contact_catalog:
            conv_cfg = payload.setdefault("conversation_config", {})
            agent_cfg = conv_cfg.setdefault("agent", {})
            prompt_cfg = agent_cfg.setdefault("prompt", {})
            current_prompt = str(prompt_cfg.get("prompt") or "").strip()
            if current_prompt and "--- DIRECTORIO DE ASESORES ---" not in current_prompt:
                prompt_cfg["prompt"] = current_prompt + "\n" + contact_catalog

        try:
            el_agent = await _elevenlabs_post("/convai/agents/create", payload)
        except HTTPException:
            # ElevenLabs sin credenciales o caído: no bloquear el resto del onboarding.
            return {"created": False, "agent_id": None, "error": "elevenlabs_unavailable"}

        agent_id: str = el_agent.get("agent_id", "")
        if not agent_id:
            return {"created": False, "agent_id": None, "error": "elevenlabs_invalid_response"}

        session.add(UserAgent(user_id=current_user.id, agent_id=agent_id))
        session.commit()
        return {"created": True, "agent_id": agent_id}

    @staticmethod
    async def update_agent(
        agent_id: str, payload: dict, current_user: CurrentUser, session: SessionDep
    ):
        owner = _require_owned_agent(agent_id, current_user, session)

        if not is_super_admin_user(current_user):
            owner_contacts = session.exec(
                select(Contact).where(
                    Contact.user_id == owner.user_id,
                    Contact.active == True,
                ).order_by(Contact.name, Contact.last_name)
            ).all()
            payload = _sanitize_non_admin_agent_payload(payload)
            await _validate_non_admin_knowledge_base(
                payload, current_user, session, agent_id=agent_id
            )
            # partial: un PATCH parcial (p. ej. solo platform_settings) no pisa el prompt.
            payload = apply_client_voice_defaults(payload, contacts=owner_contacts, partial=True)
        else:
            if not isinstance(payload, dict):
                payload = {}
            _inject_voice_tool_token_in_agent_payload(payload)

        # Contexto adicional: catálogo de contactos del dueño del agente
        contact_catalog = build_contact_catalog_prompt(owner.user_id, session)
        if contact_catalog:
            conv_cfg = payload.setdefault("conversation_config", {})
            agent_cfg = conv_cfg.setdefault("agent", {})
            prompt_cfg = agent_cfg.setdefault("prompt", {})
            current_prompt = str(prompt_cfg.get("prompt") or "").strip()
            if current_prompt and "--- DIRECTORIO DE ASESORES ---" not in current_prompt:
                prompt_cfg["prompt"] = current_prompt + "\n" + contact_catalog

        result = await _elevenlabs_patch(f"/convai/agents/{agent_id}", payload)
        return _redact_voice_tool_token(result)

    @staticmethod
    async def get_whatsapp_global_config(current_user: CurrentUser, session: SessionDep):
        config = _resolve_voice_whatsapp_config(session, current_user.id)
        if not config:
            return {"config": None}
        return {"config": _serialize_global_whatsapp_config(config)}

    @staticmethod
    async def upsert_whatsapp_global_config(
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        provider = str(payload.get("provider") or "").strip().lower()
        if provider not in {"twilio", "meta"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="provider debe ser twilio o meta",
            )

        config = _resolve_voice_whatsapp_config(session, current_user.id)
        now = _utcnow()
        if not config:
            config = UserWhatsAppConfig(
                user_id=current_user.id,
                provider=provider,
                created_at=now,
                updated_at=now,
            )

        config.provider = provider
        config.default_sender_number = str(payload.get("default_sender_number") or "").strip()
        config.message_template_escalation = str(
            payload.get("message_template_escalation") or ""
        ).strip()[:1500]
        config.message_template_appointment = str(
            payload.get("message_template_appointment") or ""
        ).strip()[:1500]

        if "active" in payload:
            config.active = bool(payload.get("active"))

        if provider == "twilio":
            if "account_sid" in payload:
                config.account_sid = str(payload.get("account_sid") or "").strip()

            raw_auth_token = str(payload.get("auth_token") or "").strip()
            if raw_auth_token:
                config.auth_token_encrypted = encrypt_secret(raw_auth_token)

            if not config.account_sid or not config.auth_token_encrypted:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Twilio requiere account_sid y auth_token",
                )

        if provider == "meta":
            if "phone_number_id" in payload:
                config.phone_number_id = str(payload.get("phone_number_id") or "").strip()
            if "business_account_id" in payload:
                config.business_account_id = str(
                    payload.get("business_account_id") or ""
                ).strip()

            raw_access_token = str(payload.get("access_token") or "").strip()
            if raw_access_token:
                config.access_token_encrypted = encrypt_secret(raw_access_token)

            if not config.phone_number_id or not config.access_token_encrypted:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Meta requiere phone_number_id y access_token",
                )

        config.updated_at = now
        session.add(config)
        session.commit()
        session.refresh(config)

        return {"config": _serialize_global_whatsapp_config(config)}

    @staticmethod
    async def get_voice_runtime_config(
        agent_id: str,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        owner = _require_owned_agent(agent_id, current_user, session)
        config = _get_or_create_voice_runtime_config(
            session,
            owner_user_id=owner.user_id,
            agent_id=agent_id,
        )
        session.add(config)
        session.commit()
        session.refresh(config)
        return {"config": _serialize_voice_runtime_config(config)}

    @staticmethod
    async def upsert_voice_runtime_config(
        agent_id: str,
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        owner = _require_owned_agent(agent_id, current_user, session)
        config = _get_or_create_voice_runtime_config(
            session,
            owner_user_id=owner.user_id,
            agent_id=agent_id,
        )

        if "whatsapp_enabled" in payload:
            config.whatsapp_enabled = bool(payload.get("whatsapp_enabled"))

        next_channel = str(
            payload.get("default_escalation_channel") or config.default_escalation_channel or "phone"
        ).strip().lower()
        if next_channel not in SUPPORTED_ESCALATION_CHANNELS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="default_escalation_channel debe ser phone o whatsapp",
            )
        config.default_escalation_channel = next_channel

        if "escalation_phone_number" in payload:
            config.escalation_phone_number = str(
                payload.get("escalation_phone_number") or ""
            ).strip()[:40]

        config.updated_at = _utcnow()
        session.add(config)
        session.commit()
        session.refresh(config)

        return {"config": _serialize_voice_runtime_config(config)}

    @staticmethod
    async def escalate_voice_conversation(
        agent_id: str,
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        owner = _require_owned_agent(agent_id, current_user, session)
        runtime_config = _get_or_create_voice_runtime_config(
            session,
            owner_user_id=owner.user_id,
            agent_id=agent_id,
        )

        requested_channel = str(
            payload.get("channel") or runtime_config.default_escalation_channel or "phone"
        ).strip().lower()
        if requested_channel not in SUPPORTED_ESCALATION_CHANNELS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="channel debe ser phone o whatsapp",
            )

        conversation_id = str(payload.get("conversation_id") or "").strip()
        summary = str(payload.get("summary") or "").strip()[:500]
        user_phone = normalize_recipient(str(payload.get("phone_number") or ""))
        agent_name = str(payload.get("agent_name") or "").strip() or "Agente de voz"

        if requested_channel == "phone":
            transfer_phone_number = str(
                payload.get("transfer_phone_number")
                or runtime_config.escalation_phone_number
                or ""
            ).strip()

            _log_audit_event(
                session,
                event_type="voice_escalation_phone",
                actor_user_id=current_user.id,
                subject_user_id=owner.user_id,
                entity_type="voice_agent",
                entity_id=agent_id,
                details={
                    "conversation_id": conversation_id,
                    "channel": "phone",
                    "transfer_phone_number": transfer_phone_number,
                },
            )
            session.commit()

            return {
                "channel": "phone",
                "status": "transfer_required",
                "transfer_phone_number": transfer_phone_number,
                "message": "Transfiere la llamada usando transfer_to_number.",
            }

        if not runtime_config.whatsapp_enabled:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="WhatsApp no esta habilitado para este agente",
            )

        config = _resolve_voice_whatsapp_config(session, owner.user_id)
        if not config or not config.active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="No hay configuracion global de WhatsApp activa",
            )

        if not has_valid_credentials(config):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Configuracion global de WhatsApp incompleta",
            )

        if not user_phone:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="phone_number es requerido para escalacion por WhatsApp",
            )

        message = str(payload.get("message") or "").strip() or build_escalation_message(
            config,
            agent_name=agent_name,
            summary=summary,
        )

        try:
            await run_in_threadpool(
                send_whatsapp_message, config, to_number=user_phone, message=message
            )
        except Exception as exc:
            logger.exception("No se pudo enviar escalacion por WhatsApp")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="No se pudo enviar el mensaje de WhatsApp",
            ) from exc

        _log_audit_event(
            session,
            event_type="voice_escalation_whatsapp",
            actor_user_id=current_user.id,
            subject_user_id=owner.user_id,
            entity_type="voice_agent",
            entity_id=agent_id,
            details={
                "conversation_id": conversation_id,
                "channel": "whatsapp",
                "phone_number": user_phone,
            },
        )
        session.commit()

        return {
            "channel": "whatsapp",
            "status": "sent",
            "conversation_status": "escalated_via_whatsapp",
        }

    @staticmethod
    async def schedule_voice_appointment(
        agent_id: str,
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        owner = _require_owned_agent(agent_id, current_user, session)

        preferred_date = str(payload.get("preferred_date") or "").strip()
        preferred_time = str(payload.get("preferred_time") or "").strip()
        timezone_name = str(payload.get("timezone") or "America/Bogota").strip() or "America/Bogota"

        try:
            appointment_date = parse_preferred_datetime(
                preferred_date,
                preferred_time,
                timezone_name=timezone_name,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            ) from exc

        if not await _is_slot_available(
            session,
            user_id=owner.user_id,
            appointment_date=appointment_date,
            buffer_minutes=0,
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="No hay disponibilidad para la fecha y hora solicitadas",
            )

        contact_name = str(payload.get("contact_name") or "").strip()[:120]
        contact_phone = normalize_recipient(str(payload.get("contact_phone") or ""))[:40]
        contact_email = str(payload.get("contact_email") or "").strip()[:160]

        if not contact_name and not contact_phone and not contact_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Se requiere al menos un dato de contacto",
            )

        now = _utcnow()
        appointment = TextAppointment(
            text_agent_id=None,
            voice_agent_id=agent_id,
            user_id=owner.user_id,
            conversation_id=str(payload.get("conversation_id") or "").strip() or None,
            contact_name=contact_name,
            contact_phone=contact_phone,
            contact_email=contact_email,
            appointment_date=appointment_date,
            timezone=timezone_name[:64],
            status="scheduled",
            source="voice",
            notes=str(payload.get("notes") or "").strip()[:500],
            created_at=now,
            updated_at=now,
        )

        session.add(appointment)
        runtime_config = _get_or_create_voice_runtime_config(
            session,
            owner_user_id=owner.user_id,
            agent_id=agent_id,
        )
        whatsapp_config = _resolve_voice_whatsapp_config(session, owner.user_id)

        # Persistir la cita antes de los efectos externos (evento de Google, WhatsApp).
        # Nota: sin lock/unique en BD, dos requests simultaneos aun pueden reservar la
        # misma franja (race entre is_time_slot_available y el commit).
        session.commit()
        session.refresh(appointment)

        await _apply_google_calendar_sync(session, appointment, operation="upsert")

        confirmation = {
            "channel": "none",
            "sent": False,
        }

        if (
            runtime_config.whatsapp_enabled
            and whatsapp_config
            and whatsapp_config.active
            and has_valid_credentials(whatsapp_config)
            and contact_phone
        ):
            human_date = format_appointment_for_humans(appointment_date, timezone_name)
            confirmation_message = str(payload.get("confirmation_message") or "").strip() or (
                build_appointment_confirmation_message(
                    whatsapp_config,
                    agent_name=str(payload.get("agent_name") or "").strip() or "Agente de voz",
                    appointment_date=human_date,
                    timezone=timezone_name,
                )
            )

            try:
                await run_in_threadpool(
                    send_whatsapp_message,
                    whatsapp_config,
                    to_number=contact_phone,
                    message=confirmation_message,
                )
                confirmation = {
                    "channel": "whatsapp",
                    "sent": True,
                }
            except Exception:
                logger.exception("No se pudo enviar confirmacion de cita por WhatsApp")

        _log_audit_event(
            session,
            event_type="voice_appointment_scheduled",
            actor_user_id=current_user.id,
            subject_user_id=owner.user_id,
            entity_type="voice_agent",
            entity_id=agent_id,
            details={
                "appointment_id": appointment.id,
                "confirmation": confirmation,
            },
        )

        session.commit()
        session.refresh(appointment)

        return {
            "appointment": _serialize_appointment(appointment),
            "confirmation": confirmation,
        }

    @staticmethod
    async def list_voices(_: CurrentUser):
        return await _elevenlabs_get("/voices")

    @staticmethod
    async def get_voice_preview(voice_id: str, _: CurrentUser):
        data = await _elevenlabs_get(f"/voices/{voice_id}")
        return {"preview_url": data.get("preview_url", "")}

    @staticmethod
    async def list_conversations(
        agent_id: str,
        current_user: CurrentUser,
        session: SessionDep,
        cursor: str | None = None,
        page_size: int | None = None,
    ):
        _require_owned_agent(agent_id, current_user, session)
        params: dict[str, Any] = {"agent_id": agent_id}
        if cursor:
            params["cursor"] = cursor
        if page_size is not None:
            params["page_size"] = page_size

        return await _elevenlabs_request(
            "GET", "/convai/conversations", params=params
        )

    @staticmethod
    async def get_conversation_detail(
        conversation_id: str, current_user: CurrentUser, session: SessionDep
    ):
        return await _get_authorized_conversation(conversation_id, current_user, session)

    @staticmethod
    async def get_conversation_audio(
        conversation_id: str, current_user: CurrentUser, session: SessionDep
    ):
        await _get_authorized_conversation(conversation_id, current_user, session)

        headers = _headers()
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.get(
                f"{ELEVENLABS_BASE}/convai/conversations/{conversation_id}/audio",
                headers=headers,
            )

        if not resp.is_success:
            body = _parse_el_response(resp)
            raise HTTPException(
                status_code=resp.status_code,
                detail=_extract_el_error(
                    body,
                    fallback=resp.text or "No se pudo obtener el audio de la conversacion",
                ),
            )

        response_headers: dict[str, str] = {}
        content_disposition = resp.headers.get("content-disposition")
        if content_disposition:
            response_headers["Content-Disposition"] = content_disposition

        media_type = resp.headers.get("content-type") or "audio/mpeg"
        return Response(
            content=resp.content,
            media_type=media_type,
            headers=response_headers,
        )

    @staticmethod
    async def run_conversation_analysis(
        conversation_id: str, current_user: CurrentUser, session: SessionDep
    ):
        await _get_authorized_conversation(conversation_id, current_user, session)
        return await _elevenlabs_post(f"/convai/conversations/{conversation_id}/analysis/run", {})

    @staticmethod
    async def list_appointments(
        agent_id: str,
        current_user: CurrentUser,
        session: SessionDep,
        status_filter: str | None = None,
        from_unix: int | None = None,
        to_unix: int | None = None,
        limit: int = 100,
    ):
        _require_owned_agent(agent_id, current_user, session)

        statement = select(TextAppointment).where(
            TextAppointment.voice_agent_id == agent_id,
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
                TextAppointment.appointment_date >= _utc_naive_from_unix(from_unix, "from_unix")
            )

        if isinstance(to_unix, int) and to_unix > 0:
            statement = statement.where(
                TextAppointment.appointment_date <= _utc_naive_from_unix(to_unix, "to_unix")
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
        agent_id: str,
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        owner_mapping = _require_owned_agent(agent_id, current_user, session)

        appointment_date = _parse_optional_datetime(payload.get("appointment_date"))
        if appointment_date is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="appointment_date es requerido (ISO8601 o unix timestamp)",
            )

        timezone_name = _resolve_timezone(payload.get("timezone"))

        if not await _is_slot_available(
            session,
            user_id=owner_mapping.user_id,
            appointment_date=appointment_date,
            buffer_minutes=0,
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="No hay disponibilidad para la fecha y hora solicitadas",
            )

        contact_name = str(payload.get("contact_name") or "").strip()[:120]
        contact_phone = normalize_recipient(str(payload.get("contact_phone") or ""))[:40]
        contact_email = str(payload.get("contact_email") or "").strip()[:160]

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

        source = str(payload.get("source") or "voice").strip().lower()
        if source not in SUPPORTED_APPOINTMENT_SOURCES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="source invalido para cita",
            )

        now = _utcnow()
        appointment = TextAppointment(
            text_agent_id=None,
            voice_agent_id=agent_id,
            user_id=owner_mapping.user_id,
            conversation_id=str(payload.get("conversation_id") or "").strip() or None,
            contact_name=contact_name,
            contact_phone=contact_phone,
            contact_email=contact_email,
            appointment_date=appointment_date,
            timezone=timezone_name,
            status=normalized_status,
            source=source,
            notes=str(payload.get("notes") or "").strip()[:500],
            created_at=now,
            updated_at=now,
        )

        session.add(appointment)
        runtime_config = _get_or_create_voice_runtime_config(
            session,
            owner_user_id=owner_mapping.user_id,
            agent_id=agent_id,
        )
        whatsapp_config = _resolve_voice_whatsapp_config(session, owner_mapping.user_id)

        # Persistir la cita antes de crear el evento en Google o confirmar por WhatsApp.
        session.commit()
        session.refresh(appointment)

        if appointment.status in GOOGLE_EVENT_RELEASE_STATUSES:
            google_operation = "delete"
        else:
            google_operation = "upsert"
        await _apply_google_calendar_sync(session, appointment, operation=google_operation)

        confirmation_channel = "none"
        if (
            runtime_config.whatsapp_enabled
            and whatsapp_config
            and whatsapp_config.active
            and has_valid_credentials(whatsapp_config)
            and contact_phone
        ):
            human_date = format_appointment_for_humans(appointment_date, appointment.timezone)
            confirmation_message = build_appointment_confirmation_message(
                whatsapp_config,
                agent_name=str(payload.get("agent_name") or "").strip() or "Agente de voz",
                appointment_date=human_date,
                timezone=appointment.timezone,
            )
            try:
                await run_in_threadpool(
                    send_whatsapp_message,
                    whatsapp_config,
                    to_number=contact_phone,
                    message=confirmation_message,
                )
                confirmation_channel = "whatsapp"
            except Exception:
                logger.exception("No se pudo enviar confirmacion de cita por WhatsApp")

        _log_audit_event(
            session,
            event_type="voice_appointment_created",
            actor_user_id=current_user.id,
            subject_user_id=owner_mapping.user_id,
            entity_type="voice_agent",
            entity_id=agent_id,
            details={
                "appointment_id": appointment.id,
                "confirmation_channel": confirmation_channel,
            },
        )

        session.commit()
        session.refresh(appointment)
        return _serialize_appointment(appointment)

    @staticmethod
    async def update_appointment(
        agent_id: str,
        appointment_id: str,
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        _require_owned_agent(agent_id, current_user, session)

        appointment = session.exec(
            select(TextAppointment).where(
                TextAppointment.id == appointment_id,
                TextAppointment.voice_agent_id == agent_id,
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

            if not await _is_slot_available(
                session,
                user_id=appointment.user_id,
                appointment_date=updated_date,
                buffer_minutes=0,
                exclude_appointment_id=appointment.id,
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="No hay disponibilidad para la fecha y hora solicitadas",
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
            appointment.contact_phone = normalize_recipient(
                str(payload.get("contact_phone") or "")
            )[:40]

        if "contact_email" in payload:
            appointment.contact_email = str(payload.get("contact_email") or "").strip()[:160]

        if not appointment.contact_name and not appointment.contact_phone and not appointment.contact_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La cita debe conservar al menos un dato de contacto",
            )

        if "conversation_id" in payload:
            conversation_id = str(payload.get("conversation_id") or "").strip()
            appointment.conversation_id = conversation_id or None

        if "timezone" in payload:
            appointment.timezone = _resolve_timezone(
                payload.get("timezone"), fallback=appointment.timezone
            )

        if "notes" in payload:
            appointment.notes = str(payload.get("notes") or "").strip()[:500]

        appointment.updated_at = _utcnow()
        session.add(appointment)
        session.commit()
        session.refresh(appointment)

        # Cancelada / no_show libera la franja: se borra el evento en vez de actualizarlo.
        if appointment.status in GOOGLE_EVENT_RELEASE_STATUSES:
            google_operation = "delete"
        else:
            google_operation = "upsert"
        await _apply_google_calendar_sync(session, appointment, operation=google_operation)
        session.commit()
        session.refresh(appointment)
        return _serialize_appointment(appointment)

    @staticmethod
    async def delete_appointment(
        agent_id: str,
        appointment_id: str,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        _require_owned_agent(agent_id, current_user, session)

        appointment = session.exec(
            select(TextAppointment).where(
                TextAppointment.id == appointment_id,
                TextAppointment.voice_agent_id == agent_id,
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
        session.commit()
        session.refresh(appointment)

        await _apply_google_calendar_sync(session, appointment, operation="delete")
        session.commit()
        return {"deleted": True}

    @staticmethod
    async def list_knowledge_base_documents(current_user: CurrentUser, session: SessionDep):
        if is_super_admin_user(current_user):
            documents = await _elevenlabs_list_all("/convai/knowledge-base", "documents")
        else:
            # El workspace de ElevenLabs es compartido: solo se exponen los documentos
            # propios y los que usan los agentes del usuario.
            visible_ids = _owned_knowledge_base_ids(current_user.id, session)
            visible_ids |= await _knowledge_base_ids_attached_to_user_agents(
                current_user.id, session
            )
            if not visible_ids:
                return {"documents": [], "has_more": False, "next_cursor": None}
            documents = [
                document
                for document in await _elevenlabs_list_all("/convai/knowledge-base", "documents")
                if document.get("id") in visible_ids
            ]
        return {"documents": documents, "has_more": False, "next_cursor": None}

    @staticmethod
    async def create_knowledge_base_document_from_file(
        file: UploadFile, name: str | None, current_user: CurrentUser, session: SessionDep
    ):
        file_bytes = await file.read()
        files = {
            "file": (
                file.filename or "document",
                file_bytes,
                file.content_type or "application/octet-stream",
            )
        }
        data = {"name": name} if name else None
        result = await _elevenlabs_request(
            "POST",
            "/convai/knowledge-base/file",
            data=data,
            files=files,
        )
        _record_knowledge_base_ownership(result, current_user, session)
        return result

    @staticmethod
    async def create_knowledge_base_document_from_text(
        payload: dict, current_user: CurrentUser, session: SessionDep
    ):
        result = await _elevenlabs_post("/convai/knowledge-base/text", payload)
        _record_knowledge_base_ownership(result, current_user, session)
        return result

    @staticmethod
    async def create_knowledge_base_document_from_url(
        payload: dict, current_user: CurrentUser, session: SessionDep
    ):
        result = await _elevenlabs_post("/convai/knowledge-base/url", payload)
        _record_knowledge_base_ownership(result, current_user, session)
        return result

    @staticmethod
    async def update_knowledge_base_document(
        documentation_id: str, payload: dict, current_user: CurrentUser, session: SessionDep
    ):
        await _require_knowledge_base_access(documentation_id, current_user, session, write=True)
        return await _elevenlabs_patch(f"/convai/knowledge-base/{documentation_id}", payload)

    @staticmethod
    async def delete_knowledge_base_document(
        documentation_id: str, current_user: CurrentUser, session: SessionDep
    ):
        await _require_knowledge_base_access(documentation_id, current_user, session, write=True)
        result = await _elevenlabs_delete(f"/convai/knowledge-base/{documentation_id}")

        ownership = session.exec(
            select(UserKnowledgeBaseDocument).where(
                UserKnowledgeBaseDocument.documentation_id == documentation_id
            )
        ).first()
        if ownership:
            session.delete(ownership)
            session.commit()
        return result

    @staticmethod
    async def get_knowledge_base_rag_indexes(
        documentation_id: str, current_user: CurrentUser, session: SessionDep
    ):
        await _require_knowledge_base_access(documentation_id, current_user, session, write=False)
        return await _elevenlabs_get(f"/convai/knowledge-base/{documentation_id}/rag-index")

    @staticmethod
    async def compute_knowledge_base_rag_index(
        documentation_id: str, payload: dict, current_user: CurrentUser, session: SessionDep
    ):
        await _require_knowledge_base_access(documentation_id, current_user, session, write=False)
        return await _elevenlabs_post(
            f"/convai/knowledge-base/{documentation_id}/rag-index", payload
        )

    @staticmethod
    async def list_tools(current_user: CurrentUser, session: SessionDep):
        is_super_admin = is_super_admin_user(current_user)

        owned_tool_rows = session.exec(
            select(UserTool).where(UserTool.user_id == current_user.id)
        ).all()
        owned_tool_ids = {row.tool_id for row in owned_tool_rows}

        if not is_super_admin and not owned_tool_ids:
            return {"tools": []}

        data = _redact_voice_tool_token(
            await _elevenlabs_get(
                "/convai/tools",
                params={
                    "types": "webhook",
                },
            )
        )

        if isinstance(data, dict):
            tools_raw = data.get("tools", [])
            if not isinstance(tools_raw, list):
                tools_raw = []

            owned_tools = []
            existing_tool_ids: set[str] = set()

            for tool in tools_raw:
                if not isinstance(tool, dict):
                    continue

                tool_id = tool.get("id")
                if not isinstance(tool_id, str) or not tool_id:
                    continue

                existing_tool_ids.add(tool_id)

                tool_config = tool.get("tool_config")
                if not isinstance(tool_config, dict):
                    continue

                tool_type = str(tool_config.get("type") or "").strip().lower()
                if tool_type != "webhook":
                    continue

                if is_super_admin or tool_id in owned_tool_ids:
                    owned_tools.append(tool)

            if not is_super_admin:
                stale_rows = [
                    row for row in owned_tool_rows if row.tool_id not in existing_tool_ids
                ]
                if stale_rows:
                    for row in stale_rows:
                        session.delete(row)
                    session.commit()

            return {
                **data,
                "tools": owned_tools,
            }

        if isinstance(data, list):
            owned_tools = []
            for tool in data:
                if not isinstance(tool, dict):
                    continue

                tool_id = tool.get("id")
                if not isinstance(tool_id, str):
                    continue

                if not is_super_admin and tool_id not in owned_tool_ids:
                    continue

                tool_config = tool.get("tool_config")
                if not isinstance(tool_config, dict):
                    continue

                tool_type = str(tool_config.get("type") or "").strip().lower()
                if tool_type == "webhook":
                    owned_tools.append(tool)

            return {"tools": owned_tools}

        return {"tools": []}

    @staticmethod
    async def create_tool(payload: dict, current_user: CurrentUser, session: SessionDep):
        if not is_super_admin_user(current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "La creación de herramientas webhook está reservada al "
                    "administrador de la plataforma."
                ),
            )

        tool_config = payload.get("tool_config")
        if not isinstance(tool_config, dict):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="tool_config es requerido",
            )
        name = tool_config.get("name", "").strip()
        if not name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="tool_config.name es requerido",
            )
        tool_type = tool_config.get("type", "")
        if tool_type != "webhook":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="tool_config.type debe ser 'webhook'",
            )
        api_schema = tool_config.get("api_schema")
        if not isinstance(api_schema, dict) or not api_schema.get("url", "").strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="api_schema.url es requerido para herramientas webhook",
            )

        _inject_voice_tool_token(tool_config)
        result = await _elevenlabs_post("/convai/tools", payload)

        tool_id = result.get("id")
        if isinstance(tool_id, str) and tool_id:
            existing = session.exec(
                select(UserTool).where(UserTool.tool_id == tool_id)
            ).first()

            if not existing:
                session.add(
                    UserTool(
                        user_id=current_user.id,
                        tool_id=tool_id,
                    )
                )
                session.commit()

        return _redact_voice_tool_token(result)

    @staticmethod
    async def delete_tool(tool_id: str, current_user: CurrentUser, session: SessionDep):
        is_super_admin = is_super_admin_user(current_user)
        if is_super_admin:
            ownership = session.exec(
                select(UserTool).where(
                    UserTool.tool_id == tool_id,
                )
            ).first()
        else:
            ownership = session.exec(
                select(UserTool).where(
                    UserTool.user_id == current_user.id,
                    UserTool.tool_id == tool_id,
                )
            ).first()

        if not ownership and not is_super_admin:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Herramienta no encontrada o sin permisos",
            )

        try:
            await _elevenlabs_delete(f"/convai/tools/{tool_id}")
        except HTTPException as exc:
            if exc.status_code != status.HTTP_404_NOT_FOUND:
                raise

        if ownership:
            session.delete(ownership)
            session.commit()
        return {"deleted": True}

    @staticmethod
    async def get_agent_widget(
        agent_id: str, current_user: CurrentUser, session: SessionDep
    ):
        _require_owned_agent(agent_id, current_user, session)
        return await _elevenlabs_get(f"/convai/agents/{agent_id}/widget")

    @staticmethod
    async def list_phone_numbers(
        current_user: CurrentUser,
        session: SessionDep,
        user_id: str | None = None,
    ):
        scoped_user_id = _resolve_user_scope(current_user, user_id)
        is_super_admin = is_super_admin_user(current_user)

        # Consultar la BD antes que ElevenLabs: sin numeros (ni agentes que puedan
        # auto-adoptar uno) no hay nada que mostrar.
        if is_super_admin:
            number_rows_statement = select(UserPhoneNumber)
            if scoped_user_id:
                number_rows_statement = number_rows_statement.where(
                    UserPhoneNumber.user_id == scoped_user_id
                )
            phone_number_rows = session.exec(number_rows_statement).all()
            if not phone_number_rows:
                return {"phone_numbers": []}
        else:
            owned_numbers_rows = session.exec(
                select(UserPhoneNumber).where(UserPhoneNumber.user_id == current_user.id)
            ).all()
            owned_agents_rows = session.exec(
                select(UserAgent).where(UserAgent.user_id == current_user.id)
            ).all()
            if not owned_numbers_rows and not owned_agents_rows:
                return {"phone_numbers": []}

        el_data = await _elevenlabs_get("/convai/phone-numbers")
        if isinstance(el_data, list):
            all_numbers_raw = el_data
        elif isinstance(el_data, dict):
            candidate = el_data.get("phone_numbers", [])
            all_numbers_raw = candidate if isinstance(candidate, list) else []
        else:
            all_numbers_raw = []

        if is_super_admin:
            owner_by_phone_number = {
                row.phone_number_id: row.user_id for row in phone_number_rows
            }
            owner_lookup = _build_user_lookup(session, set(owner_by_phone_number.values()))

            visible_numbers: list[dict] = []
            for phone_number in all_numbers_raw:
                if not isinstance(phone_number, dict):
                    continue

                phone_number_id = phone_number.get("phone_number_id")
                if not isinstance(phone_number_id, str) or not phone_number_id:
                    continue

                owner_user_id = owner_by_phone_number.get(phone_number_id)
                if not owner_user_id:
                    continue

                owner = owner_lookup.get(owner_user_id)
                owner_info = {
                    "user_id": owner_user_id,
                    "name": owner.name if owner else None,
                    "email": owner.email if owner else None,
                    "role": role_as_value(owner.role) if owner else None,
                }
                normalized_number = dict(phone_number)
                normalized_number["owner_info"] = owner_info
                visible_numbers.append(normalized_number)

            return {"phone_numbers": visible_numbers}

        owned_number_ids = {row.phone_number_id for row in owned_numbers_rows}
        owned_agent_ids = {row.agent_id for row in owned_agents_rows}

        should_commit = False
        visible_numbers: list[dict] = []
        for phone_number in all_numbers_raw:
            if not isinstance(phone_number, dict):
                continue

            phone_number_id = phone_number.get("phone_number_id")
            if not isinstance(phone_number_id, str) or not phone_number_id:
                continue

            if phone_number_id in owned_number_ids:
                visible_numbers.append(phone_number)
                continue

            # Cliente final: no auto-adoptar más de 1 número aunque esté asignado a un agente suyo.
            if len(owned_number_ids) >= 1:
                continue

            assigned_agent = phone_number.get("assigned_agent")
            if not isinstance(assigned_agent, dict):
                continue

            assigned_agent_id = assigned_agent.get("agent_id")
            if isinstance(assigned_agent_id, str) and assigned_agent_id in owned_agent_ids:
                visible_numbers.append(phone_number)
                session.add(
                    UserPhoneNumber(
                        user_id=current_user.id,
                        phone_number_id=phone_number_id,
                    )
                )
                owned_number_ids.add(phone_number_id)
                should_commit = True

        if should_commit:
            session.commit()

        return {"phone_numbers": visible_numbers}

    @staticmethod
    async def create_phone_number(payload: dict, current_user: CurrentUser, session: SessionDep):
        is_super_admin = is_super_admin_user(current_user)

        if not is_super_admin:
            existing_count = len(
                session.exec(
                    select(UserPhoneNumber).where(
                        UserPhoneNumber.user_id == current_user.id
                    )
                ).all()
            )
            if existing_count >= 1:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "Tu plan permite un único número telefónico. "
                        "Edita el existente o contacta al administrador."
                    ),
                )

        agent_id = payload.get("agent_id")
        if isinstance(agent_id, str) and agent_id:
            _require_owned_agent(agent_id, current_user, session)

        result = await _elevenlabs_post("/convai/phone-numbers", payload)
        phone_number_id = result.get("phone_number_id")

        if isinstance(phone_number_id, str) and phone_number_id:
            existing = session.exec(
                select(UserPhoneNumber).where(
                    UserPhoneNumber.phone_number_id == phone_number_id
                )
            ).first()
            if not existing:
                session.add(
                    UserPhoneNumber(
                        user_id=current_user.id,
                        phone_number_id=phone_number_id,
                    )
                )
                session.commit()

        return result

    @staticmethod
    async def update_phone_number(
        phone_number_id: str, payload: dict, current_user: CurrentUser, session: SessionDep
    ):
        _require_owned_phone_number(phone_number_id, current_user, session)
        agent_id = payload.get("agent_id")
        if isinstance(agent_id, str) and agent_id:
            _require_owned_agent(agent_id, current_user, session)
        return await _elevenlabs_patch(f"/convai/phone-numbers/{phone_number_id}", payload)

    @staticmethod
    async def create_twilio_outbound_call(
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        agent_id = str(payload.get("agent_id") or "").strip()
        agent_phone_number_id = str(payload.get("agent_phone_number_id") or "").strip()
        to_number = str(payload.get("to_number") or "").strip()

        if not agent_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="agent_id es requerido",
            )
        if not agent_phone_number_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="agent_phone_number_id es requerido",
            )
        if not to_number:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="to_number es requerido",
            )
        if not E164_PHONE_PATTERN.match(to_number):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="to_number debe estar en formato E.164, por ejemplo +15551234567",
            )

        _require_owned_agent(agent_id, current_user, session)
        _require_owned_phone_number(agent_phone_number_id, current_user, session)

        outbound_payload: dict[str, Any] = {
            "agent_id": agent_id,
            "agent_phone_number_id": agent_phone_number_id,
            "to_number": to_number,
        }

        if "conversation_initiation_client_data" in payload:
            conversation_data = payload.get("conversation_initiation_client_data")
            if conversation_data is not None and not isinstance(conversation_data, dict):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="conversation_initiation_client_data debe ser un objeto",
                )
            if isinstance(conversation_data, dict):
                outbound_payload["conversation_initiation_client_data"] = conversation_data

        if "call_recording_enabled" in payload:
            outbound_payload["call_recording_enabled"] = bool(
                payload.get("call_recording_enabled")
            )

        if "telephony_call_config" in payload:
            telephony_call_config = payload.get("telephony_call_config")
            if telephony_call_config is not None and not isinstance(telephony_call_config, dict):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="telephony_call_config debe ser un objeto",
                )

            if isinstance(telephony_call_config, dict):
                ringing_timeout_secs = telephony_call_config.get("ringing_timeout_secs")
                if ringing_timeout_secs is not None:
                    try:
                        normalized_timeout = int(ringing_timeout_secs)
                    except (TypeError, ValueError) as exc:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail="ringing_timeout_secs debe ser un entero",
                        ) from exc

                    if normalized_timeout < 5 or normalized_timeout > 300:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail="ringing_timeout_secs debe estar entre 5 y 300 segundos",
                        )

                    telephony_call_config["ringing_timeout_secs"] = normalized_timeout

                outbound_payload["telephony_call_config"] = telephony_call_config

        try:
            return await _elevenlabs_post("/convai/twilio/outbound-call", outbound_payload)
        except HTTPException as exc:
            # Some versions expose the same endpoint using an underscore style.
            if exc.status_code == status.HTTP_404_NOT_FOUND:
                return await _elevenlabs_post("/convai/twilio/outbound_call", outbound_payload)
            raise

    @staticmethod
    async def delete_agent(
        agent_id: str, current_user: CurrentUser, session: SessionDep
    ):
        if is_super_admin_user(current_user):
            rows = session.exec(
                select(UserAgent).where(UserAgent.agent_id == agent_id)
            ).all()

            if not rows:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Agente no encontrado o sin permisos",
                )

            await _elevenlabs_delete(f"/convai/agents/{agent_id}")

            for row in rows:
                session.delete(row)

            session.commit()
            return {"deleted": True}

        row = _require_owned_agent(agent_id, current_user, session)

        await _elevenlabs_delete(f"/convai/agents/{agent_id}")

        session.delete(row)
        session.commit()
        return {"deleted": True}
