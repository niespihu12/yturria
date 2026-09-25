from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta

from sqlalchemy import update
from sqlmodel import Session, select

from app.models.AuditTrailEvent import AuditTrailEvent
from app.models.TextConversation import TextConversation

logger = logging.getLogger(__name__)

try:
    _env_days = int(os.getenv("RENEWAL_REMINDER_DAYS_AHEAD", "30").strip())
    RENEWAL_REMINDER_DAYS_AHEAD: int = max(1, _env_days)
except ValueError:
    RENEWAL_REMINDER_DAYS_AHEAD = 30


def run_due_renewal_reminders(session: Session, *, days_ahead: int | None = None) -> int:
    """Marca renovaciones próximas como 'reminder_due' y deja trazabilidad de auditoría.

    Aún no existe un canal de envío: NO se marca 'reminder_sent'. El asesor ve el
    estado 'reminder_due' y contacta al cliente. renewal_reminder_sent_at se usa como
    marca de procesado; la actualización condicional evita duplicados entre
    ejecuciones y entre workers concurrentes.

    days_ahead=None usa RENEWAL_REMINDER_DAYS_AHEAD (env RENEWAL_REMINDER_DAYS_AHEAD, default 30).
    """
    if days_ahead is None:
        days_ahead = RENEWAL_REMINDER_DAYS_AHEAD
    now = datetime.utcnow()
    horizon = now + timedelta(days=max(1, days_ahead))

    rows = session.exec(
        select(TextConversation).where(
            TextConversation.deleted_at == None,
            TextConversation.renewal_date != None,
            TextConversation.renewal_date >= now,
            TextConversation.renewal_date <= horizon,
            TextConversation.renewal_status.notin_(["renewed", "expired", "cancelled"]),
            TextConversation.renewal_reminder_sent_at == None,
        )
    ).all()

    processed = 0
    for conversation in rows:
        if not conversation.renewal_date:
            continue

        next_status = (
            "reminder_due"
            if conversation.renewal_status in {"", "none", "scheduled", "contacted"}
            else conversation.renewal_status
        )
        claimed = session.exec(
            update(TextConversation)
            .where(
                TextConversation.id == conversation.id,
                TextConversation.renewal_reminder_sent_at == None,
            )
            .values(renewal_reminder_sent_at=now, renewal_status=next_status)
            .execution_options(synchronize_session=False)
        )
        if not claimed.rowcount:
            continue

        conversation.renewal_reminder_sent_at = now
        conversation.renewal_status = next_status
        session.add(

            AuditTrailEvent(
                event_type="renewal_reminder_scheduled",
                actor_user_id=None,
                subject_user_id=conversation.user_id,
                entity_type="text_conversation",
                entity_id=conversation.id,
                details_json=json.dumps(
                    {
                        "renewal_date_unix_secs": int(conversation.renewal_date.timestamp()),
                        "days_ahead": days_ahead,
                    }
                ),
            )
        )
        processed += 1

    if processed > 0:
        logger.info("renewal_scheduler processed %s reminders", processed)

    session.commit()
    return processed
