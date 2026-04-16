from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any

import httpx
from fastapi import HTTPException, UploadFile, status
from sqlmodel import delete, select

from app.controllers.deps.auth import CurrentUser
from app.controllers.deps.db_session import SessionDep
from app.models.TextAgent import TextAgent
from app.models.TextAgentKnowledgeBase import TextAgentKnowledgeBase
from app.models.TextAgentTool import TextAgentTool
from app.models.TextConversation import TextConversation
from app.models.TextKnowledgeBaseDocument import TextKnowledgeBaseDocument
from app.models.TextMessage import TextMessage
from app.models.TextProviderConfig import TextProviderConfig
from app.utils.crypto import decrypt_secret, encrypt_secret, mask_secret

SUPPORTED_PROVIDERS = {"openai", "gemini"}
SUPPORTED_TOOL_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}
SUPPORTED_USAGE_MODES = {"auto", "prompt"}

TEXT_AGENTS_REQUIRE_USER_KEYS = (
    os.getenv("TEXT_AGENTS_REQUIRE_USER_KEYS", "false").strip().lower() == "true"
)
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "").strip()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()


def _utcnow() -> datetime:
    return datetime.utcnow()


def _to_unix(value: datetime) -> int:
    return int(value.timestamp())


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


def _require_owned_text_agent(
    text_agent_id: str,
    current_user: CurrentUser,
    session: SessionDep,
) -> TextAgent:
    row = session.get(TextAgent, text_agent_id)
    if not row or row.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agente de texto no encontrado o sin permisos",
        )
    return row


def _require_owned_document(
    document_id: str,
    current_user: CurrentUser,
    session: SessionDep,
) -> TextKnowledgeBaseDocument:
    row = session.get(TextKnowledgeBaseDocument, document_id)
    if not row or row.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Documento no encontrado o sin permisos",
        )
    return row


def _require_provider_config(
    provider: str,
    current_user: CurrentUser,
    session: SessionDep,
) -> TextProviderConfig:
    config = session.exec(
        select(TextProviderConfig).where(
            TextProviderConfig.user_id == current_user.id,
            TextProviderConfig.provider == provider,
        )
    ).first()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Debes configurar una API key para {provider} antes de usar este proveedor",
        )

    return config


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
    except json.JSONDecodeError:
        parsed_headers = {}

    return {
        "id": tool.id,
        "name": tool.name,
        "description": tool.description,
        "endpoint_url": tool.endpoint_url,
        "http_method": tool.http_method,
        "headers": parsed_headers,
        "body_template": tool.body_template,
        "enabled": tool.enabled,
        "created_at_unix_secs": _to_unix(tool.created_at),
        "updated_at_unix_secs": _to_unix(tool.updated_at),
    }


def _serialize_document(doc: TextKnowledgeBaseDocument) -> dict[str, Any]:
    return {
        "id": doc.id,
        "name": doc.name,
        "source_type": doc.source_type,
        "source_value": doc.source_value,
        "content_preview": doc.content[:240],
        "created_at_unix_secs": _to_unix(doc.created_at),
        "updated_at_unix_secs": _to_unix(doc.updated_at),
    }


def _serialize_text_agent(agent: TextAgent) -> dict[str, Any]:
    return {
        "agent_id": agent.id,
        "name": agent.name,
        "provider": agent.provider,
        "model": agent.model,
        "system_prompt": agent.system_prompt,
        "welcome_message": agent.welcome_message,
        "language": agent.language,
        "temperature": agent.temperature,
        "max_tokens": agent.max_tokens,
        "created_at_unix_secs": _to_unix(agent.created_at),
        "updated_at_unix_secs": _to_unix(agent.updated_at),
    }


def _list_agent_tools(session: SessionDep, text_agent_id: str) -> list[TextAgentTool]:
    return session.exec(
        select(TextAgentTool)
        .where(TextAgentTool.text_agent_id == text_agent_id)
        .order_by(TextAgentTool.created_at.asc())
    ).all()


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


def _build_context_block(
    knowledge_base: list[dict[str, Any]],
    tools: list[TextAgentTool],
) -> str:
    blocks: list[str] = []

    if knowledge_base:
        kb_lines = ["Contexto de base de conocimiento:"]
        for item in knowledge_base[:6]:
            preview = str(item.get("content_preview") or "").strip()
            if not preview:
                continue
            kb_lines.append(f"- {item.get('name', 'documento')}: {preview}")
        if len(kb_lines) > 1:
            blocks.append("\n".join(kb_lines))

    active_tools = [tool for tool in tools if tool.enabled]
    if active_tools:
        tool_lines = ["Herramientas disponibles (describe cuando deberian ejecutarse):"]
        for tool in active_tools:
            method = tool.http_method
            tool_lines.append(
                f"- {tool.name}: {tool.description or 'Sin descripcion'} [{method} {tool.endpoint_url}]"
            )
        blocks.append("\n".join(tool_lines))

    return "\n\n".join(blocks)


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


class TextAgentController:
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

    @staticmethod
    async def list_agents(current_user: CurrentUser, session: SessionDep):
        rows = session.exec(
            select(TextAgent)
            .where(TextAgent.user_id == current_user.id)
            .order_by(TextAgent.updated_at.desc())
        ).all()
        return {"agents": [_serialize_text_agent(agent) for agent in rows]}

    @staticmethod
    async def create_agent(payload: dict, current_user: CurrentUser, session: SessionDep):
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
            created_at=now,
            updated_at=now,
        )
        session.add(agent)
        session.commit()
        session.refresh(agent)

        return _serialize_text_agent(agent)

    @staticmethod
    async def get_agent(text_agent_id: str, current_user: CurrentUser, session: SessionDep):
        agent = _require_owned_text_agent(text_agent_id, current_user, session)
        payload = _serialize_text_agent(agent)
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

        if "name" in payload:
            name = str(payload.get("name") or "").strip()
            if not name:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="El nombre del agente es requerido",
                )
            agent.name = name

        if "provider" in payload:
            provider = _normalize_provider(payload.get("provider"))
            _resolve_provider_api_key(provider, current_user, session)
            agent.provider = provider
            if "model" not in payload:
                agent.model = _default_model(provider)

        if "model" in payload:
            agent.model = str(payload.get("model") or "").strip() or _default_model(agent.provider)

        if "system_prompt" in payload:
            agent.system_prompt = str(payload.get("system_prompt") or "")

        if "welcome_message" in payload:
            agent.welcome_message = str(payload.get("welcome_message") or "")

        if "language" in payload:
            agent.language = str(payload.get("language") or "es")

        if "temperature" in payload:
            value = float(payload.get("temperature") or 0.7)
            agent.temperature = max(0.0, min(2.0, value))

        if "max_tokens" in payload:
            value = int(payload.get("max_tokens") or 512)
            agent.max_tokens = max(64, min(8192, value))

        agent.updated_at = _utcnow()
        session.add(agent)
        session.commit()
        session.refresh(agent)

        response = _serialize_text_agent(agent)
        response["tools"] = [_serialize_tool(tool) for tool in _list_agent_tools(session, agent.id)]
        response["knowledge_base"] = _list_agent_knowledge_base(session, agent.id)
        return response

    @staticmethod
    async def delete_agent(text_agent_id: str, current_user: CurrentUser, session: SessionDep):
        agent = _require_owned_text_agent(text_agent_id, current_user, session)

        tools = session.exec(
            select(TextAgentTool).where(TextAgentTool.text_agent_id == agent.id)
        ).all()
        for tool in tools:
            session.delete(tool)

        links = session.exec(
            select(TextAgentKnowledgeBase).where(TextAgentKnowledgeBase.text_agent_id == agent.id)
        ).all()
        for link in links:
            session.delete(link)

        conversations = session.exec(
            select(TextConversation).where(TextConversation.text_agent_id == agent.id)
        ).all()

        conversation_ids = [conversation.id for conversation in conversations]
        if conversation_ids:
            session.exec(
                delete(TextMessage).where(TextMessage.conversation_id.in_(conversation_ids))
            )

        for conversation in conversations:
            session.delete(conversation)

        session.delete(agent)
        session.commit()
        return {"deleted": True}

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

        now = _utcnow()
        tool = TextAgentTool(
            text_agent_id=text_agent_id,
            name=name,
            description=str(payload.get("description") or ""),
            endpoint_url=endpoint_url,
            http_method=method,
            headers_json=json.dumps(headers),
            body_template=str(payload.get("body_template") or ""),
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

    @staticmethod
    async def list_knowledge_base_documents(current_user: CurrentUser, session: SessionDep):
        rows = session.exec(
            select(TextKnowledgeBaseDocument)
            .where(TextKnowledgeBaseDocument.user_id == current_user.id)
            .order_by(TextKnowledgeBaseDocument.updated_at.desc())
        ).all()
        return {"documents": [_serialize_document(doc) for doc in rows]}

    @staticmethod
    async def create_knowledge_base_document_from_text(
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        text = str(payload.get("text") or "").strip()
        if not text:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="El contenido de texto es requerido",
            )

        name = str(payload.get("name") or "Documento de texto").strip() or "Documento de texto"
        now = _utcnow()
        doc = TextKnowledgeBaseDocument(
            user_id=current_user.id,
            name=name,
            source_type="text",
            source_value="inline",
            content=text,
            created_at=now,
            updated_at=now,
        )
        session.add(doc)
        session.commit()
        session.refresh(doc)

        return _serialize_document(doc)

    @staticmethod
    async def create_knowledge_base_document_from_url(
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        url = str(payload.get("url") or "").strip()
        if not url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="La URL es requerida",
            )

        name = str(payload.get("name") or "Documento URL").strip() or "Documento URL"
        content = str(payload.get("content") or "").strip()

        if not content:
            try:
                with httpx.Client(timeout=15) as client:
                    response = client.get(url, follow_redirects=True)
                    if response.is_success:
                        content = response.text[:120_000]
            except Exception:
                content = ""

        now = _utcnow()
        doc = TextKnowledgeBaseDocument(
            user_id=current_user.id,
            name=name,
            source_type="url",
            source_value=url,
            content=content,
            created_at=now,
            updated_at=now,
        )
        session.add(doc)
        session.commit()
        session.refresh(doc)

        return _serialize_document(doc)

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
            created_at=now,
            updated_at=now,
        )
        session.add(doc)
        session.commit()
        session.refresh(doc)

        return _serialize_document(doc)

    @staticmethod
    async def update_knowledge_base_document(
        document_id: str,
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        doc = _require_owned_document(document_id, current_user, session)

        if "name" in payload:
            next_name = str(payload.get("name") or "").strip()
            if next_name:
                doc.name = next_name

        if "content" in payload:
            doc.content = str(payload.get("content") or "")

        doc.updated_at = _utcnow()
        session.add(doc)
        session.commit()
        session.refresh(doc)

        return _serialize_document(doc)

    @staticmethod
    async def delete_knowledge_base_document(
        document_id: str,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        doc = _require_owned_document(document_id, current_user, session)

        links = session.exec(
            select(TextAgentKnowledgeBase).where(
                TextAgentKnowledgeBase.document_id == document_id
            )
        ).all()
        for link in links:
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

    @staticmethod
    async def list_conversations(
        text_agent_id: str,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        _require_owned_text_agent(text_agent_id, current_user, session)

        rows = session.exec(
            select(TextConversation)
            .where(TextConversation.text_agent_id == text_agent_id)
            .order_by(TextConversation.updated_at.desc())
        ).all()

        if not rows:
            return {"conversations": []}

        conversation_ids = [row.id for row in rows]
        messages = session.exec(
            select(TextMessage)
            .where(TextMessage.conversation_id.in_(conversation_ids))
            .order_by(TextMessage.created_at.asc())
        ).all()

        grouped_messages: dict[str, list[TextMessage]] = {}
        for message in messages:
            grouped_messages.setdefault(message.conversation_id, []).append(message)

        response: list[dict[str, Any]] = []
        for conversation in rows:
            conversation_messages = grouped_messages.get(conversation.id, [])
            last_preview = conversation_messages[-1].content[:140] if conversation_messages else ""
            response.append(
                {
                    "conversation_id": conversation.id,
                    "agent_id": text_agent_id,
                    "status": "done",
                    "start_time_unix_secs": _to_unix(conversation.created_at),
                    "updated_at_unix_secs": _to_unix(conversation.updated_at),
                    "message_count": len(conversation_messages),
                    "last_message_preview": last_preview,
                }
            )

        return {"conversations": response}

    @staticmethod
    async def get_conversation_detail(
        conversation_id: str,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        conversation = session.get(TextConversation, conversation_id)
        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversacion no encontrada",
            )

        agent = _require_owned_text_agent(conversation.text_agent_id, current_user, session)

        messages = session.exec(
            select(TextMessage)
            .where(TextMessage.conversation_id == conversation.id)
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
            "transcript": transcript,
            "metadata": {
                "start_time_unix_secs": _to_unix(conversation.created_at),
                "message_count": len(messages),
            },
            "analysis": {
                "transcript_summary": latest_assistant[:400],
                "call_successful": "yes" if latest_assistant else "unknown",
            },
        }

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
            if not conversation or conversation.text_agent_id != agent.id or conversation.user_id != current_user.id:
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

        user_row = TextMessage(
            conversation_id=conversation.id,
            role="user",
            content=user_message,
            provider=agent.provider,
            model=agent.model,
        )
        session.add(user_row)
        session.commit()

        history_rows = session.exec(
            select(TextMessage)
            .where(TextMessage.conversation_id == conversation.id)
            .order_by(TextMessage.created_at.asc())
        ).all()

        history = [
            {"role": row.role, "content": row.content}
            for row in history_rows
            if row.role in {"user", "assistant"}
        ]

        tools = _list_agent_tools(session, agent.id)
        knowledge_base = _list_agent_knowledge_base(session, agent.id)
        context_block = _build_context_block(knowledge_base, tools)

        system_prompt = agent.system_prompt.strip() or "Eres un asistente util y claro."
        if context_block:
            system_prompt = f"{system_prompt}\n\n{context_block}"

        api_key, _ = _resolve_provider_api_key(agent.provider, current_user, session)

        if agent.provider == "openai":
            assistant_content, token_usage = _call_openai(
                api_key=api_key,
                model=agent.model,
                system_prompt=system_prompt,
                history=history,
                temperature=agent.temperature,
                max_tokens=agent.max_tokens,
            )
        else:
            assistant_content, token_usage = _call_gemini(
                api_key=api_key,
                model=agent.model,
                system_prompt=system_prompt,
                history=history,
                temperature=agent.temperature,
                max_tokens=agent.max_tokens,
            )

        assistant_row = TextMessage(
            conversation_id=conversation.id,
            role="assistant",
            content=assistant_content,
            provider=agent.provider,
            model=agent.model,
            token_usage=token_usage,
        )
        session.add(assistant_row)

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
