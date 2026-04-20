from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from fastapi import HTTPException, status
from sqlmodel import delete, select

from app.controllers.deps.auth import CurrentUser
from app.controllers.deps.db_session import SessionDep
from app.models.AuditTrailEvent import AuditTrailEvent
from app.models.DataPrivacyRequest import DataPrivacyRequest
from app.models.TextConversation import TextConversation
from app.models.TextMessage import TextMessage
from app.models.TextProviderConfig import TextProviderConfig
from app.models.Token import Token
from app.models.User import User
from app.utils.roles import is_super_admin_user


def _utcnow() -> datetime:
    return datetime.utcnow()


def _to_unix(value: datetime | None) -> int | None:
    if not value:
        return None
    return int(value.timestamp())


def _log_audit(
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


def _serialize_request(request: DataPrivacyRequest) -> dict[str, Any]:
    return {
        "id": request.id,
        "user_id": request.user_id,
        "requested_by_user_id": request.requested_by_user_id,
        "reason": request.reason,
        "status": request.status,
        "created_at_unix_secs": _to_unix(request.created_at),
        "processed_at_unix_secs": _to_unix(request.processed_at),
    }


def _anonymized_email(user_id: str, now: datetime) -> str:
    return f"deleted+{user_id[:8]}+{int(now.timestamp())}@anon.local"


def _soft_delete_user_data(
    *,
    user_id: str,
    actor_user_id: str,
    reason: str,
    session: SessionDep,
) -> dict[str, int]:
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Usuario no encontrado",
        )

    now = _utcnow()

    conversations = session.exec(
        select(TextConversation).where(
            TextConversation.user_id == user_id,
            TextConversation.deleted_at == None,
        )
    ).all()

    conversation_ids = [conversation.id for conversation in conversations]

    for conversation in conversations:
        conversation.deleted_at = now
        conversation.title = "conversation_redacted"
        conversation.escalation_reason = ""
        conversation.renewal_note = ""
        session.add(conversation)

    redacted_messages = 0
    if conversation_ids:
        messages = session.exec(
            select(TextMessage).where(
                TextMessage.conversation_id.in_(conversation_ids),
                TextMessage.deleted_at == None,
            )
        ).all()

        for message in messages:
            message.content = "[Contenido eliminado por solicitud de privacidad LFPDPPP]"
            message.deleted_at = now
            session.add(message)

        redacted_messages = len(messages)

    session.exec(delete(TextProviderConfig).where(TextProviderConfig.user_id == user_id))
    session.exec(delete(Token).where(Token.user_id == user_id))

    user.deleted_at = now
    user.name = "Usuario eliminado"
    user.email = _anonymized_email(user.id, now)
    user.confirmed = False
    user.mfa_enabled = False
    user.mfa_failed_attempts = 0
    user.mfa_locked_until = None
    session.add(user)

    _log_audit(
        session,
        event_type="privacy_soft_delete_completed",
        actor_user_id=actor_user_id,
        subject_user_id=user_id,
        entity_type="user",
        entity_id=user_id,
        details={
            "reason": reason,
            "conversations_soft_deleted": len(conversations),
            "messages_redacted": redacted_messages,
        },
    )

    return {
        "conversations_soft_deleted": len(conversations),
        "messages_redacted": redacted_messages,
    }


class PrivacyController:

    @staticmethod
    async def list_deletion_requests(current_user: CurrentUser, session: SessionDep):
        query = select(DataPrivacyRequest)
        if not is_super_admin_user(current_user):
            query = query.where(DataPrivacyRequest.user_id == current_user.id)

        rows = session.exec(query.order_by(DataPrivacyRequest.created_at.desc())).all()
        return {"requests": [_serialize_request(row) for row in rows]}

    @staticmethod
    async def create_deletion_request(
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        reason = str(payload.get("reason") or "").strip()[:255]

        existing = session.exec(
            select(DataPrivacyRequest).where(
                DataPrivacyRequest.user_id == current_user.id,
                DataPrivacyRequest.status == "pending",
            )
        ).first()

        if existing:
            return {
                "request": _serialize_request(existing),
                "created": False,
            }

        request = DataPrivacyRequest(
            user_id=current_user.id,
            requested_by_user_id=current_user.id,
            reason=reason,
            status="pending",
            created_at=_utcnow(),
        )

        session.add(request)
        session.flush()

        _log_audit(
            session,
            event_type="privacy_deletion_requested",
            actor_user_id=current_user.id,
            subject_user_id=current_user.id,
            entity_type="privacy_request",
            entity_id=request.id,
            details={"reason": reason},
        )

        session.commit()
        session.refresh(request)

        return {
            "request": _serialize_request(request),
            "created": True,
        }

    @staticmethod
    async def process_deletion_request(
        request_id: str,
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        request = session.get(DataPrivacyRequest, request_id)
        if not request:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Solicitud de privacidad no encontrada",
            )

        is_super_admin = is_super_admin_user(current_user)
        if not is_super_admin and request.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tienes permisos para procesar esta solicitud",
            )

        if request.status == "completed":
            return {
                "request": _serialize_request(request),
                "processed": False,
                "already_processed": True,
            }

        reason_override = str(payload.get("reason") or "").strip()[:255]
        effective_reason = reason_override or request.reason

        result = _soft_delete_user_data(
            user_id=request.user_id,
            actor_user_id=current_user.id,
            reason=effective_reason,
            session=session,
        )

        request.status = "completed"
        request.processed_at = _utcnow()
        session.add(request)

        _log_audit(
            session,
            event_type="privacy_request_processed",
            actor_user_id=current_user.id,
            subject_user_id=request.user_id,
            entity_type="privacy_request",
            entity_id=request.id,
            details={
                "result": result,
                "reason": effective_reason,
            },
        )

        session.commit()
        session.refresh(request)

        return {
            "request": _serialize_request(request),
            "processed": True,
            "result": result,
        }

    @staticmethod
    async def delete_my_data(
        payload: dict,
        current_user: CurrentUser,
        session: SessionDep,
    ):
        created = await PrivacyController.create_deletion_request(payload, current_user, session)
        request = created["request"]
        result = await PrivacyController.process_deletion_request(
            request["id"],
            payload,
            current_user,
            session,
        )
        return {
            "request": result["request"],
            "processed": result["processed"],
            "result": result.get("result", {}),
        }
