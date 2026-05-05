from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, func, select

from app.models.TextAppointment import TextAppointment
from app.models.TextConversation import TextConversation

# Costo mensual estimado de una secretaria en Colombia (COP)
_SECRETARY_MONTHLY_COP = 2_500_000
# Conversaciones promedio que maneja una secretaria al mes
_SECRETARY_CONVERSATIONS_MONTH = 300


@dataclass
class FunnelMetrics:
    agent_id: str
    period_days: int
    conversations_started: int
    leads_qualified: int          # conversaciones que no escalaron inmediatamente
    appointments_scheduled: int   # citas agendadas en el período
    appointments_completed: int   # citas marcadas como completadas
    escalations_total: int
    escalations_resolved: int
    conversion_rate_pct: float    # appointments / conversations * 100
    estimated_savings_cop: int    # ahorro vs secretaria humana


def get_funnel_metrics(session: Session, agent_id: str, period_days: int = 30) -> FunnelMetrics:
    since = datetime.now(timezone.utc) - timedelta(days=period_days)
    since_naive = since.replace(tzinfo=None)

    # Conversaciones iniciadas en el período
    conversations_started = session.exec(
        select(func.count(TextConversation.id)).where(
            TextConversation.text_agent_id == agent_id,
            TextConversation.created_at >= since_naive,
            TextConversation.deleted_at == None,  # noqa: E711
        )
    ).one() or 0

    # Leads calificados = conversaciones sin escalación inmediata (más de 2 mensajes implicados)
    # Aproximación: conversaciones donde escalation_reason no es 'active_claim' en primer mensaje
    leads_qualified = session.exec(
        select(func.count(TextConversation.id)).where(
            TextConversation.text_agent_id == agent_id,
            TextConversation.created_at >= since_naive,
            TextConversation.deleted_at == None,  # noqa: E711
            TextConversation.escalation_reason.notin_(["active_claim"]),
        )
    ).one() or 0

    # Citas agendadas por el agente en el período
    appointments_scheduled = session.exec(
        select(func.count(TextAppointment.id)).where(
            TextAppointment.text_agent_id == agent_id,
            TextAppointment.created_at >= since_naive,
            TextAppointment.source.in_(["agent", "embed"]),
        )
    ).one() or 0

    appointments_completed = session.exec(
        select(func.count(TextAppointment.id)).where(
            TextAppointment.text_agent_id == agent_id,
            TextAppointment.created_at >= since_naive,
            TextAppointment.status == "completed",
        )
    ).one() or 0

    escalations_total = session.exec(
        select(func.count(TextConversation.id)).where(
            TextConversation.text_agent_id == agent_id,
            TextConversation.created_at >= since_naive,
            TextConversation.escalation_status != "none",
        )
    ).one() or 0

    escalations_resolved = session.exec(
        select(func.count(TextConversation.id)).where(
            TextConversation.text_agent_id == agent_id,
            TextConversation.created_at >= since_naive,
            TextConversation.escalation_status == "resolved",
        )
    ).one() or 0

    conversion_rate = (
        (appointments_scheduled / conversations_started * 100)
        if conversations_started > 0 else 0.0
    )

    # Ahorro estimado: proporcional a las conversaciones manejadas vs capacidad de secretaria
    handled_fraction = min(conversations_started / _SECRETARY_CONVERSATIONS_MONTH, 1.0)
    estimated_savings = int(_SECRETARY_MONTHLY_COP * handled_fraction * (period_days / 30))

    return FunnelMetrics(
        agent_id=agent_id,
        period_days=period_days,
        conversations_started=int(conversations_started),
        leads_qualified=int(leads_qualified),
        appointments_scheduled=int(appointments_scheduled),
        appointments_completed=int(appointments_completed),
        escalations_total=int(escalations_total),
        escalations_resolved=int(escalations_resolved),
        conversion_rate_pct=round(conversion_rate, 1),
        estimated_savings_cop=estimated_savings,
    )
