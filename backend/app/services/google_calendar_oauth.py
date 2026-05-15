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
).strip().rstrip("/")

SCOPES = ["https://www.googleapis.com/auth/calendar.events"]


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


def _build_credentials_from_connection(conn: UserCalendarConnection) -> Credentials | None:
    if not conn.access_token_encrypted:
        return None

    access_token = decrypt_secret(conn.access_token_encrypted)
    refresh_token = decrypt_secret(conn.refresh_token_encrypted) if conn.refresh_token_encrypted else None

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
            logger.warning("No se pudo refrescar token de Google Calendar: %s", exc)
            return None

    return creds


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
        logger.warning("Error listando calendarios: %s", exc)
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
        return {
            "status": "error",
            "event_id": appointment.google_event_id or "",
            "calendar_id": conn.calendar_id,
            "error": str(exc)[:250],
        }
