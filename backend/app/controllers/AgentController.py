import os
import re
from typing import Any

import httpx
from fastapi import HTTPException, Response, UploadFile, status
from sqlmodel import Session, select

from app.controllers.deps.auth import CurrentUser
from app.controllers.deps.db_session import SessionDep
from app.models.User import User
from app.models.UserAgent import UserAgent
from app.models.UserPhoneNumber import UserPhoneNumber
from app.models.UserTool import UserTool
from app.utils.roles import is_super_admin_user, role_as_value

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_BASE = "https://api.elevenlabs.io/v1"
E164_PHONE_PATTERN = re.compile(r"^\+[1-9]\d{7,15}$")


def _headers(*, json_body: bool = False) -> dict[str, str]:
    if not ELEVENLABS_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
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


def _elevenlabs_request(
    method: str,
    path: str,
    *,
    json: dict | None = None,
    params: dict | None = None,
    data: dict | None = None,
    files: dict | None = None,
) -> Any:
    headers = _headers(json_body=json is not None and files is None and data is None)
    with httpx.Client(timeout=60) as client:
        resp = client.request(
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


def _elevenlabs_get(path: str, *, params: dict | None = None) -> Any:
    return _elevenlabs_request("GET", path, params=params)


def _elevenlabs_post(path: str, body: dict) -> Any:
    return _elevenlabs_request("POST", path, json=body)


def _elevenlabs_patch(path: str, body: dict) -> Any:
    return _elevenlabs_request("PATCH", path, json=body)


def _elevenlabs_delete(path: str) -> Any:
    return _elevenlabs_request("DELETE", path)


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

        el_data = _elevenlabs_get("/convai/agents")
        el_agents: list[dict] = el_data.get("agents", [])

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
        return _elevenlabs_get(f"/convai/agents/{agent_id}")

    @staticmethod
    async def get_signed_url(
        agent_id: str, current_user: CurrentUser, session: SessionDep
    ):
        _require_owned_agent(agent_id, current_user, session)
        data = _elevenlabs_post(f"/convai/agents/{agent_id}/link", {})
        conversation_token = data.get("token", {}).get("conversation_token", "")
        return {
            "signed_url": (
                f"wss://api.elevenlabs.io/v1/convai/conversation?agent_id={agent_id}"
                f"&token={conversation_token}"
            )
        }

    @staticmethod
    async def create_agent(payload: dict, current_user: CurrentUser, session: SessionDep):
        # ElevenLabs requires eleven_turbo_v2_5 for non-English agents.
        # Always set it as default to avoid validation errors.
        conv_cfg: dict = payload.get("conversation_config", {})
        if "tts" not in conv_cfg or not conv_cfg["tts"].get("model_id"):
            conv_cfg.setdefault("tts", {})["model_id"] = "eleven_turbo_v2_5"
        payload["conversation_config"] = conv_cfg

        el_agent = _elevenlabs_post("/convai/agents/create", payload)
        agent_id: str = el_agent["agent_id"]

        # Store ownership
        mapping = UserAgent(user_id=current_user.id, agent_id=agent_id)
        session.add(mapping)
        session.commit()

        return el_agent

    @staticmethod
    async def update_agent(
        agent_id: str, payload: dict, current_user: CurrentUser, session: SessionDep
    ):
        _require_owned_agent(agent_id, current_user, session)
        return _elevenlabs_patch(f"/convai/agents/{agent_id}", payload)

    @staticmethod
    async def list_voices(_: CurrentUser):
        return _elevenlabs_get("/voices")

    @staticmethod
    async def get_voice_preview(voice_id: str, _: CurrentUser):
        data = _elevenlabs_get(f"/voices/{voice_id}")
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

        return _elevenlabs_request(
            "GET", "/convai/conversations", params=params
        )

    @staticmethod
    async def get_conversation_detail(
        conversation_id: str, current_user: CurrentUser, session: SessionDep
    ):
        data = _elevenlabs_get(f"/convai/conversations/{conversation_id}")
        agent_id = data.get("agent_id")
        if isinstance(agent_id, str):
            _require_owned_agent(agent_id, current_user, session)
        return data

    @staticmethod
    async def get_conversation_audio(
        conversation_id: str, current_user: CurrentUser, session: SessionDep
    ):
        detail = _elevenlabs_get(f"/convai/conversations/{conversation_id}")
        agent_id = detail.get("agent_id")
        if isinstance(agent_id, str):
            _require_owned_agent(agent_id, current_user, session)

        headers = _headers()
        with httpx.Client(timeout=120) as client:
            resp = client.get(
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
        detail = _elevenlabs_get(f"/convai/conversations/{conversation_id}")
        agent_id = detail.get("agent_id")
        if isinstance(agent_id, str):
            _require_owned_agent(agent_id, current_user, session)
        return _elevenlabs_post(f"/convai/conversations/{conversation_id}/analysis/run", {})

    @staticmethod
    async def list_knowledge_base_documents(_: CurrentUser):
        return _elevenlabs_get("/convai/knowledge-base")

    @staticmethod
    async def create_knowledge_base_document_from_file(
        file: UploadFile, name: str | None, _: CurrentUser
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
        return _elevenlabs_request(
            "POST",
            "/convai/knowledge-base/file",
            data=data,
            files=files,
        )

    @staticmethod
    async def create_knowledge_base_document_from_text(payload: dict, _: CurrentUser):
        return _elevenlabs_post("/convai/knowledge-base/text", payload)

    @staticmethod
    async def create_knowledge_base_document_from_url(payload: dict, _: CurrentUser):
        return _elevenlabs_post("/convai/knowledge-base/url", payload)

    @staticmethod
    async def update_knowledge_base_document(
        documentation_id: str, payload: dict, _: CurrentUser
    ):
        return _elevenlabs_patch(f"/convai/knowledge-base/{documentation_id}", payload)

    @staticmethod
    async def delete_knowledge_base_document(documentation_id: str, _: CurrentUser):
        return _elevenlabs_delete(f"/convai/knowledge-base/{documentation_id}")

    @staticmethod
    async def get_knowledge_base_rag_indexes(documentation_id: str, _: CurrentUser):
        return _elevenlabs_get(f"/convai/knowledge-base/{documentation_id}/rag-index")

    @staticmethod
    async def compute_knowledge_base_rag_index(
        documentation_id: str, payload: dict, _: CurrentUser
    ):
        return _elevenlabs_post(f"/convai/knowledge-base/{documentation_id}/rag-index", payload)

    @staticmethod
    async def list_tools(current_user: CurrentUser, session: SessionDep):
        is_super_admin = is_super_admin_user(current_user)

        owned_tool_rows = session.exec(
            select(UserTool).where(UserTool.user_id == current_user.id)
        ).all()
        owned_tool_ids = {row.tool_id for row in owned_tool_rows}

        if not is_super_admin and not owned_tool_ids:
            return {"tools": []}

        data = _elevenlabs_get(
            "/convai/tools",
            params={
                "types": "webhook",
            },
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

        result = _elevenlabs_post("/convai/tools", payload)

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

        return result

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
            _elevenlabs_delete(f"/convai/tools/{tool_id}")
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
        return _elevenlabs_get(f"/convai/agents/{agent_id}/widget")

    @staticmethod
    async def list_phone_numbers(
        current_user: CurrentUser,
        session: SessionDep,
        user_id: str | None = None,
    ):
        scoped_user_id = _resolve_user_scope(current_user, user_id)
        is_super_admin = is_super_admin_user(current_user)

        el_data = _elevenlabs_get("/convai/phone-numbers")
        if isinstance(el_data, list):
            all_numbers_raw = el_data
        elif isinstance(el_data, dict):
            candidate = el_data.get("phone_numbers", [])
            all_numbers_raw = candidate if isinstance(candidate, list) else []
        else:
            all_numbers_raw = []

        if is_super_admin:
            number_rows_statement = select(UserPhoneNumber)
            if scoped_user_id:
                number_rows_statement = number_rows_statement.where(
                    UserPhoneNumber.user_id == scoped_user_id
                )

            phone_number_rows = session.exec(number_rows_statement).all()
            if not phone_number_rows:
                return {"phone_numbers": []}

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

        owned_numbers_rows = session.exec(
            select(UserPhoneNumber).where(UserPhoneNumber.user_id == current_user.id)
        ).all()
        owned_number_ids = {row.phone_number_id for row in owned_numbers_rows}

        owned_agents_rows = session.exec(
            select(UserAgent).where(UserAgent.user_id == current_user.id)
        ).all()
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
        agent_id = payload.get("agent_id")
        if isinstance(agent_id, str) and agent_id:
            _require_owned_agent(agent_id, current_user, session)

        result = _elevenlabs_post("/convai/phone-numbers", payload)
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
        return _elevenlabs_patch(f"/convai/phone-numbers/{phone_number_id}", payload)

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
            return _elevenlabs_post("/convai/twilio/outbound-call", outbound_payload)
        except HTTPException as exc:
            # Some versions expose the same endpoint using an underscore style.
            if exc.status_code == status.HTTP_404_NOT_FOUND:
                return _elevenlabs_post("/convai/twilio/outbound_call", outbound_payload)
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

            _elevenlabs_delete(f"/convai/agents/{agent_id}")

            for row in rows:
                session.delete(row)

            session.commit()
            return {"deleted": True}

        row = _require_owned_agent(agent_id, current_user, session)

        _elevenlabs_delete(f"/convai/agents/{agent_id}")

        session.delete(row)
        session.commit()
        return {"deleted": True}
