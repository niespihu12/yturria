from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlmodel import Session, select

from app.models.TextAppointment import TextAppointment

BUSY_STATUSES = {"scheduled", "confirmed"}

# Duracion estimada de una cita (debe coincidir con el evento que se crea en Google).
APPOINTMENT_DURATION_MINUTES = 45


def is_time_slot_available(
    session: Session,
    *,
    user_id: str,
    appointment_date: datetime,
    buffer_minutes: int = 0,
    exclude_appointment_id: str | None = None,
) -> bool:
    """Disponible si la cita (de ~45 min) no se solapa con otra cita ni con un evento
    de Google Calendar.

    `buffer_minutes` agrega un margen opcional a cada lado. Por defecto 0: solo se
    bloquea por solapamiento real, no por eventos cercanos (un evento de 15 min ya no
    tumba dos horas de agenda).
    """
    gap = max(0, int(buffer_minutes))
    appt_start = appointment_date
    appt_end = appointment_date + timedelta(minutes=APPOINTMENT_DURATION_MINUTES)

    # Una cita guardada en `astart` ocupa [astart, astart+duracion]; choca si astart cae
    # dentro de (appt_start - duracion - gap, appt_end + gap).
    overlap_lo = appt_start - timedelta(minutes=APPOINTMENT_DURATION_MINUTES + gap)
    overlap_hi = appt_end + timedelta(minutes=gap)

    statement = select(TextAppointment).where(
        TextAppointment.user_id == user_id,
        TextAppointment.deleted_at == None,
        TextAppointment.status.in_(sorted(BUSY_STATUSES)),
        TextAppointment.appointment_date > overlap_lo,
        TextAppointment.appointment_date < overlap_hi,
    )

    exclude_event_ids: set[str] = set()
    if exclude_appointment_id:
        statement = statement.where(TextAppointment.id != exclude_appointment_id)
        # Al reprogramar, el evento de Google de la propia cita no cuenta como ocupado.
        own = session.get(TextAppointment, exclude_appointment_id)
        if own is not None and own.google_event_id:
            exclude_event_ids.add(own.google_event_id)

    if session.exec(statement).first() is not None:
        return False

    # Respetar los eventos del Google Calendar conectado (solapamiento real con la cita).
    if _conflicts_with_google_calendar(
        session,
        user_id,
        appt_start - timedelta(minutes=gap),
        appt_end + timedelta(minutes=gap),
        exclude_event_ids=exclude_event_ids,
    ):
        return False

    return True


def _conflicts_with_google_calendar(
    session: Session,
    user_id: str,
    window_start: datetime,
    window_end: datetime,
    *,
    exclude_event_ids: set[str] | None = None,
) -> bool:
    """True si el usuario tiene un Google Calendar conectado y ya esta ocupado en la franja.

    Fail-open: ante cualquier error con Google nunca bloquea el agendamiento.
    """
    try:
        from app.models.UserCalendarConnection import UserCalendarConnection
        from app.services.google_calendar_oauth import get_busy_intervals

        conn = session.exec(
            select(UserCalendarConnection).where(
                UserCalendarConnection.user_id == user_id,
                UserCalendarConnection.provider == "google",
                UserCalendarConnection.active == True,
                UserCalendarConnection.is_default == True,
            )
        ).first()
        if not conn:
            return False

        start_utc = window_start.replace(tzinfo=timezone.utc)
        end_utc = window_end.replace(tzinfo=timezone.utc)
        for busy_start, busy_end in get_busy_intervals(
            conn, start_utc, end_utc, exclude_event_ids=exclude_event_ids
        ):
            if busy_start < end_utc and busy_end > start_utc:
                return True
        return False
    except Exception:
        return False


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
    except (ZoneInfoNotFoundError, ValueError, OSError) as exc:
        # OSError: p. ej. "America" (directorio de tzdata) en Windows.
        raise ValueError("timezone invalido") from exc

    as_utc = naive_local.replace(tzinfo=tz).astimezone(timezone.utc)
    return as_utc.replace(tzinfo=None)


def format_appointment_for_humans(appointment_date: datetime, timezone_name: str) -> str:
    try:
        tz = ZoneInfo(timezone_name)
        localized = appointment_date.replace(tzinfo=timezone.utc).astimezone(tz)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        localized = appointment_date.replace(tzinfo=timezone.utc)

    return localized.strftime("%Y-%m-%d %H:%M")
