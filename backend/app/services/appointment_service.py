from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlmodel import Session, select

from app.models.TextAppointment import TextAppointment

BUSY_STATUSES = {"scheduled", "confirmed"}


def is_time_slot_available(
    session: Session,
    *,
    user_id: str,
    appointment_date: datetime,
    buffer_minutes: int = 60,
    exclude_appointment_id: str | None = None,
) -> bool:
    window_start = appointment_date - timedelta(minutes=max(5, int(buffer_minutes)))
    window_end = appointment_date + timedelta(minutes=max(5, int(buffer_minutes)))

    statement = select(TextAppointment).where(
        TextAppointment.user_id == user_id,
        TextAppointment.deleted_at == None,
        TextAppointment.status.in_(sorted(BUSY_STATUSES)),
        TextAppointment.appointment_date >= window_start,
        TextAppointment.appointment_date <= window_end,
    )

    if exclude_appointment_id:
        statement = statement.where(TextAppointment.id != exclude_appointment_id)

    return session.exec(statement).first() is None


def parse_preferred_datetime(
    preferred_date: str,
    preferred_time: str,
    *,
    timezone_name: str,
) -> datetime:
    raw_date = str(preferred_date or "").strip()
    raw_time = str(preferred_time or "").strip()

    if not raw_date:
        raise ValueError("preferred_date es requerido")

    if not raw_time:
        raise ValueError("preferred_time es requerido")

    naive_local = datetime.fromisoformat(f"{raw_date}T{raw_time}")

    try:
        tz = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError("timezone invalido") from exc

    as_utc = naive_local.replace(tzinfo=tz).astimezone(timezone.utc)
    return as_utc.replace(tzinfo=None)


def format_appointment_for_humans(appointment_date: datetime, timezone_name: str) -> str:
    try:
        tz = ZoneInfo(timezone_name)
        localized = appointment_date.replace(tzinfo=timezone.utc).astimezone(tz)
    except ZoneInfoNotFoundError:
        localized = appointment_date.replace(tzinfo=timezone.utc)

    return localized.strftime("%Y-%m-%d %H:%M")
