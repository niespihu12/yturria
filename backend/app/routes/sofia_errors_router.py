from __future__ import annotations

import csv
import io
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from app.controllers.deps.auth import CurrentUser
from app.controllers.deps.db_session import SessionDep
from app.models.TextAgent import TextAgent
from app.models.TextConversation import TextConversation
from app.models.TextMessage import TextMessage

sofia_errors_router = APIRouter(prefix="/text-agents", tags=["Sofia Errors"])

_VALID_LABELS = {"", "false_positive", "true_positive"}


def _conversation_to_dict(conv: TextConversation, messages: list[TextMessage]) -> dict:
    return {
        "conversation_id": conv.id,
        "title": conv.title,
        "channel": conv.channel,
        "escalation_reason": conv.escalation_reason,
        "escalation_status": conv.escalation_status,
        "sofia_error_label": conv.sofia_error_label,
        "escalated_at_unix_secs": (
            int(conv.escalated_at.replace(tzinfo=timezone.utc).timestamp())
            if conv.escalated_at else None
        ),
        "created_at_unix_secs": int(conv.created_at.replace(tzinfo=timezone.utc).timestamp()),
        "transcript": [
            {"role": m.role, "message": m.content}
            for m in messages
            if not m.deleted_at
        ],
    }


@sofia_errors_router.get("/{text_agent_id}/sofia-errors")
async def list_sofia_errors(
    text_agent_id: str,
    current_user: CurrentUser,
    session: SessionDep,
    label: str | None = Query(default=None, description="Filtrar por label: false_positive, true_positive o vacío"),
):
    agent = session.get(TextAgent, text_agent_id)
    if not agent or agent.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agente no encontrado")

    stmt = select(TextConversation).where(
        TextConversation.text_agent_id == text_agent_id,
        TextConversation.escalation_reason == "uncertainty_detected",
        TextConversation.deleted_at == None,  # noqa: E711
    )
    if label is not None:
        stmt = stmt.where(TextConversation.sofia_error_label == label)

    conversations = session.exec(stmt.order_by(TextConversation.created_at.desc())).all()

    result = []
    for conv in conversations:
        messages = session.exec(
            select(TextMessage)
            .where(TextMessage.conversation_id == conv.id)
            .order_by(TextMessage.created_at)
        ).all()
        result.append(_conversation_to_dict(conv, list(messages)))

    return {"sofia_errors": result, "total": len(result)}


@sofia_errors_router.patch("/{text_agent_id}/sofia-errors/{conversation_id}")
async def update_sofia_error_label(
    text_agent_id: str,
    conversation_id: str,
    current_user: CurrentUser,
    session: SessionDep,
    payload: dict,
):
    agent = session.get(TextAgent, text_agent_id)
    if not agent or agent.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agente no encontrado")

    conv = session.get(TextConversation, conversation_id)
    if not conv or conv.text_agent_id != text_agent_id:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")

    label = payload.get("sofia_error_label", "")
    if label not in _VALID_LABELS:
        raise HTTPException(status_code=400, detail="Label inválido. Use: false_positive, true_positive o ''")

    conv.sofia_error_label = label
    conv.updated_at = datetime.utcnow()
    session.add(conv)
    session.commit()
    return {"ok": True, "sofia_error_label": label}


@sofia_errors_router.get("/{text_agent_id}/sofia-errors/export")
async def export_sofia_errors_csv(
    text_agent_id: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    agent = session.get(TextAgent, text_agent_id)
    if not agent or agent.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agente no encontrado")

    conversations = session.exec(
        select(TextConversation).where(
            TextConversation.text_agent_id == text_agent_id,
            TextConversation.escalation_reason == "uncertainty_detected",
            TextConversation.deleted_at == None,  # noqa: E711
        ).order_by(TextConversation.created_at.desc())
    ).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["conversation_id", "title", "channel", "label", "created_at", "transcript"])

    for conv in conversations:
        messages = session.exec(
            select(TextMessage)
            .where(TextMessage.conversation_id == conv.id)
            .order_by(TextMessage.created_at)
        ).all()
        transcript = " | ".join(f"[{m.role}] {m.content}" for m in messages if not m.deleted_at)
        writer.writerow([
            conv.id,
            conv.title,
            conv.channel,
            conv.sofia_error_label,
            conv.created_at.isoformat(),
            transcript,
        ])

    output.seek(0)
    filename = f"sofia_errors_{text_agent_id}_{datetime.utcnow().strftime('%Y%m%d')}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
