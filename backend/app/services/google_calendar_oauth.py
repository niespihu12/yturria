from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

from app.models.TextAppointment import TextAppointment
from app.models.UserCalendarConnection import UserCalendarConnection
from app.utils.crypto import decrypt_secret, encrypt_secret

logger = logging.getLogger(__name__)

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip()
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "").strip()
FRONTEND_URL = (
    os.getenv("FRONTEND_PUBLIC_URL") or os.getenv("FRONTEND_URL") or "http://localhost:5173"
).split(",")[0].strip().rstrip("/")

SCOPES = ["https://www.googleapis.com/auth/calendar.events"]


def generate_pkce_verifier() -> str:
    return _generate_pkce_verifier()


def _generate_pkce_verifier() -> str:
    """Genera un code_verifier PKCE (43-128 chars, URL-safe)."""
    token = secrets.token_bytes(32)
    return base64.urlsafe_b64encode(token).decode("ascii").rstrip("=")


def _generate_pkce_challenge(verifier: str) -> str:
    """Genera el code_challenge S256 a partir del verifier."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _is_configured() -> bool:
    return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)


def _get_redirect_uri() -> str:
    backend_url = os.getenv("BACKEND_PUBLIC_URL", "").strip().rstrip("/")
    if not backend_url:
        backend_url = f"{FRONTEND_URL}/api"
    return f"{backend_url}/calendars/google/callback"


def build_auth_url(*, state: str, code_verifier: str | None = None) -> tuple[str, str]:
    """Genera la URL de autorización de Google con PKCE.
    
    Args:
        state: Parámetro state para la URL de autorización.
        code_verifier: PKCE verifier existente (si None, se genera uno nuevo).
    
    Returns:
        (auth_url, code_verifier) — el verifier debe guardarse para el callback.
    """
    if not _is_configured():
        raise RuntimeError("Google OAuth no configurado")

    verifier = code_verifier or _generate_pkce_verifier()
    code_challenge = _generate_pkce_challenge(verifier)

    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [_get_redirect_uri()],
            }
        },
        scopes=SCOPES,
        redirect_uri=_get_redirect_uri(),
    )

    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=state,
        code_challenge=code_challenge,
        code_challenge_method="S256",
    )
    return auth_url, verifier


def exchange_code(*, code: str, code_verifier: str = "") -> dict[str, Any]:
    """Intercambia el código de autorización por tokens usando httpx.
    
    Usamos httpx directamente para evitar que oauthlib lance excepciones
    cuando Google devuelve scopes adicionales (ej. drive.readonly).
    
    Args:
        code: El código de autorización devuelto por Google.
        code_verifier: El PKCE code_verifier generado en build_auth_url().
    """
    if not _is_configured():
        raise RuntimeError("Google OAuth no configurado")

    import httpx

    payload = {
        "grant_type": "authorization_code",
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": _get_redirect_uri(),
        "code": code,
    }
    if code_verifier:
        payload["code_verifier"] = code_verifier

    resp = httpx.post("https://oauth2.googleapis.com/token", data=payload, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    access_token = data.get("access_token", "")
    refresh_token = data.get("refresh_token", "")
    expires_in = data.get("expires_in")
    expires_at = None
    if expires_in:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expires_at,
    }


def _is_invalid_grant(exc: Exception) -> bool:
    return "invalid_grant" in str(exc).lower()


def _mark_connection_needs_reauth(conn: UserCalendarConnection, exc: Exception) -> None:
    """Google revoco el refresh token: se desactiva la conexion para forzar reconexion.
    El caller debe hacer commit de la sesion para persistirlo."""
    logger.warning(
        "Conexion de Google Calendar %s desactivada (requiere reconectar): %s",
        conn.id,
        exc,
    )
    conn.active = False
    conn.is_default = False
    conn.updated_at = datetime.utcnow()


def _build_credentials_from_connection(conn: UserCalendarConnection) -> Credentials | None:
    if not conn.access_token_encrypted:
        return None

    try:
        access_token = decrypt_secret(conn.access_token_encrypted)
        refresh_token = (
            decrypt_secret(conn.refresh_token_encrypted) if conn.refresh_token_encrypted else None
        )
    except ValueError as exc:
        logger.warning("No se pudieron descifrar los tokens de la conexion %s: %s", conn.id, exc)
        return None

    creds = Credentials(
        token=access_token,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        scopes=SCOPES,
    )

    # Refresh if expired
    if conn.token_expires_at and conn.token_expires_at <= datetime.utcnow():
        try:
            creds.refresh(Request())
            # Update stored tokens
            conn.access_token_encrypted = encrypt_secret(creds.token)
            if creds.refresh_token:
                conn.refresh_token_encrypted = encrypt_secret(creds.refresh_token)
            conn.token_expires_at = datetime.fromtimestamp(creds.expiry.timestamp(), tz=timezone.utc).replace(tzinfo=None) if creds.expiry else None
            conn.updated_at = datetime.utcnow()
        except Exception as exc:
            if _is_invalid_grant(exc):
                _mark_connection_needs_reauth(conn, exc)
            else:
                logger.warning("No se pudo refrescar token de Google Calendar: %s", exc)
            return None

    return creds


def _handle_api_error(conn: UserCalendarConnection, exc: Exception, message: str) -> None:
    # google-auth refresca de forma transparente durante execute(); si el refresh token
    # fue revocado el error llega aqui como invalid_grant.
    if _is_invalid_grant(exc):
        _mark_connection_needs_reauth(conn, exc)
    else:
        logger.warning("%s: %s", message, exc)


def _as_utc(dt: datetime) -> datetime:
    """Normaliza a UTC con tzinfo. Asume UTC si viene naive (asi guardamos las fechas)."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _parse_rfc3339(value: str | None) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if raw.endswith("Z"):
        raw = raw[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(raw)
    except ValueError:
        try:
            dt = datetime.fromisoformat(raw + "T00:00:00+00:00")  # evento de dia completo (YYYY-MM-DD)
        except ValueError:
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def list_events(
    conn: UserCalendarConnection,
    time_min: datetime,
    time_max: datetime,
) -> list[dict[str, Any]]:
    """Lista eventos del calendario del usuario en el rango dado (para mostrar en la app)."""
    creds = _build_credentials_from_connection(conn)
    if not creds:
        return []

    cal_id = conn.calendar_id or "primary"
    try:
        service = build("calendar", "v3", credentials=creds, cache_discovery=False)
        result = (
            service.events()
            .list(
                calendarId=cal_id,
                timeMin=_as_utc(time_min).isoformat(),
                timeMax=_as_utc(time_max).isoformat(),
                singleEvents=True,
                orderBy="startTime",
                maxResults=250,
            )
            .execute()
        )
    except Exception as exc:
        _handle_api_error(conn, exc, "Error listando eventos de Google Calendar")
        return []

    events: list[dict[str, Any]] = []
    for item in result.get("items", []):
        if item.get("status") == "cancelled":
            continue
        start_raw = item.get("start") or {}
        end_raw = item.get("end") or {}
        start_dt = _parse_rfc3339(start_raw.get("dateTime") or start_raw.get("date"))
        if not start_dt:
            continue
        end_dt = _parse_rfc3339(end_raw.get("dateTime") or end_raw.get("date"))
        events.append(
            {
                "id": item.get("id", ""),
                "summary": item.get("summary") or "(Sin titulo)",
                "start_unix": int(start_dt.timestamp()),
                "end_unix": int(end_dt.timestamp()) if end_dt else None,
                "all_day": "date" in start_raw,
            }
        )
    return events


def get_busy_intervals(
    conn: UserCalendarConnection,
    time_min: datetime,
    time_max: datetime,
    *,
    exclude_event_ids: set[str] | None = None,
) -> list[tuple[datetime, datetime]]:
    """Devuelve las franjas ocupadas para verificar disponibilidad real.

    Se construye a partir de events.list (funciona con el scope calendar.events).
    No usamos la API freeBusy porque requiere el scope calendar.readonly.
    Se ignoran eventos de dia completo, los marcados como "libre" (transparency) y los
    de `exclude_event_ids` (p. ej. el evento de la cita que se esta reprogramando).
    """
    creds = _build_credentials_from_connection(conn)
    if not creds:
        return []

    cal_id = conn.calendar_id or "primary"
    try:
        service = build("calendar", "v3", credentials=creds, cache_discovery=False)
        result = (
            service.events()
            .list(
                calendarId=cal_id,
                timeMin=_as_utc(time_min).isoformat(),
                timeMax=_as_utc(time_max).isoformat(),
                singleEvents=True,
                orderBy="startTime",
                maxResults=250,
            )
            .execute()
        )
    except Exception as exc:
        _handle_api_error(conn, exc, "Error consultando disponibilidad de Google Calendar")
        return []

    intervals: list[tuple[datetime, datetime]] = []
    for item in result.get("items", []):
        if item.get("status") == "cancelled" or item.get("transparency") == "transparent":
            continue
        if exclude_event_ids and item.get("id") in exclude_event_ids:
            continue
        start_raw = item.get("start") or {}
        end_raw = item.get("end") or {}
        if "dateTime" not in start_raw:  # ignorar eventos de dia completo
            continue
        start_dt = _parse_rfc3339(start_raw.get("dateTime"))
        end_dt = _parse_rfc3339(end_raw.get("dateTime")) or start_dt
        if start_dt and end_dt:
            intervals.append((start_dt, end_dt))
    return intervals


def list_user_calendars(conn: UserCalendarConnection) -> list[dict[str, str]]:
    creds = _build_credentials_from_connection(conn)
    if not creds:
        return []

    try:
        service = build("calendar", "v3", credentials=creds, cache_discovery=False)
        result = service.calendarList().list().execute()
        items = result.get("items", [])
        return [
            {"id": item.get("id", ""), "name": item.get("summary", "")}
            for item in items
            if item.get("id")
        ]
    except Exception as exc:
        _handle_api_error(conn, exc, "Error listando calendarios")
        return []


def sync_appointment_via_oauth(
    conn: UserCalendarConnection,
    appointment: TextAppointment,
    *,
    operation: str = "upsert",
) -> dict[str, str]:
    creds = _build_credentials_from_connection(conn)
    if not creds:
        return {
            "status": "error",
            "event_id": appointment.google_event_id or "",
            "calendar_id": conn.calendar_id,
            "error": "Credenciales OAuth invalidas",
        }

    try:
        service = build("calendar", "v3", credentials=creds, cache_discovery=False)
        events_api = service.events()

        from app.services.google_calendar import _build_event_payload

        if operation == "delete":
            if appointment.google_event_id:
                events_api.delete(
                    calendarId=conn.calendar_id,
                    eventId=appointment.google_event_id,
                ).execute()
            return {
                "status": "synced",
                "event_id": "",
                "calendar_id": conn.calendar_id,
                "error": "",
            }

        event_payload = _build_event_payload(appointment)
        if appointment.google_event_id:
            event = events_api.update(
                calendarId=conn.calendar_id,
                eventId=appointment.google_event_id,
                body=event_payload,
            ).execute()
        else:
            event = events_api.insert(
                calendarId=conn.calendar_id,
                body=event_payload,
            ).execute()

        event_id = str(event.get("id") or appointment.google_event_id or "")
        return {
            "status": "synced",
            "event_id": event_id,
            "calendar_id": conn.calendar_id,
            "error": "",
        }
    except Exception as exc:
        _handle_api_error(conn, exc, "Error sincronizando cita con Google Calendar")
        return {
            "status": "error",
            "event_id": appointment.google_event_id or "",
            "calendar_id": conn.calendar_id,
            "error": str(exc)[:250],
        }
