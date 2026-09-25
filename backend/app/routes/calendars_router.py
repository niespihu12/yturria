from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from sqlmodel import Session, select

from app.controllers.deps.auth import CurrentUser
from app.controllers.deps.db_session import SessionDep
from app.models.UserCalendarConnection import UserCalendarConnection
from app.services.google_calendar_oauth import (
    build_auth_url,
    exchange_code,
    generate_pkce_verifier,
    list_events,
    list_user_calendars,
    sync_appointment_via_oauth,
)
from app.utils.crypto import decrypt_secret, encrypt_secret
from app.utils.roles import is_super_admin_user

logger = logging.getLogger(__name__)

calendars_router = APIRouter(prefix="/calendars", tags=["Calendars"])

FRONTEND_URL = (
    os.getenv("FRONTEND_PUBLIC_URL") or os.getenv("FRONTEND_URL") or "http://localhost:5173"
).split(",")[0].strip().rstrip("/")

DEFAULT_REDIRECT_PATH = "/citas"
OAUTH_STATE_TTL_SECONDS = 600


def _safe_redirect_path(value: str | None) -> str:
    """Solo rutas relativas del frontend: evita open redirect ('//evil.com', '/\\evil.com')."""
    path = str(value or "").strip()
    if (
        not path.startswith("/")
        or path.startswith("//")
        or "\\" in path
        or any(ord(ch) < 32 for ch in path)
    ):
        return DEFAULT_REDIRECT_PATH
    return path


def _frontend_redirect(path: str, **params: str) -> RedirectResponse:
    query = "&".join(f"{key}={quote(str(value), safe='')}" for key, value in params.items())
    separator = "&" if "?" in path else "?"
    return RedirectResponse(url=f"{FRONTEND_URL}{path}{separator}{query}")


def _encode_oauth_state(user_id: str, code_verifier: str, redirect_after: str) -> str:
    # Cifrado + autenticado (Fernet): el callback no puede ser manipulado y el
    # code_verifier PKCE no queda expuesto en la URL.
    payload = {
        "uid": user_id,
        "cv": code_verifier,
        "r": redirect_after,
        "exp": int(time.time()) + OAUTH_STATE_TTL_SECONDS,
    }
    return encrypt_secret(json.dumps(payload, separators=(",", ":")))


def _decode_oauth_state(state: str) -> dict | None:
    if not state:
        return None
    try:
        payload = json.loads(decrypt_secret(state))
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, dict):
        return None
    if not isinstance(payload.get("exp"), int) or payload["exp"] < int(time.time()):
        return None
    if not str(payload.get("uid") or "").strip() or not str(payload.get("cv") or "").strip():
        return None
    return payload


def _parse_unix_or_400(value: int, field_name: str) -> datetime:
    try:
        return datetime.fromtimestamp(value, tz=timezone.utc)
    except (OverflowError, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} fuera de rango",
        ) from exc


@calendars_router.get("/google/auth")
async def google_auth(
    current_user: CurrentUser,
    redirect_after: str = Query(default=DEFAULT_REDIRECT_PATH),
):
    """Inicia el flujo OAuth con Google Calendar usando PKCE."""
    try:
        code_verifier = generate_pkce_verifier()
        state = _encode_oauth_state(
            current_user.id, code_verifier, _safe_redirect_path(redirect_after)
        )
        auth_url, _ = build_auth_url(state=state, code_verifier=code_verifier)
        return {"auth_url": auth_url}
    except Exception as exc:
        logger.exception("Error iniciando OAuth de Google Calendar")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo iniciar la conexion con Google Calendar",
        ) from exc


@calendars_router.get("/google/callback")
def google_callback(
    request: Request,
    session: SessionDep,
    code: str = Query(default=""),
    state: str = Query(default=""),
    error: str = Query(default=""),
):
    """Callback de Google OAuth. Guarda los tokens y redirige al frontend."""
    state_payload = _decode_oauth_state(state)

    if error:
        redirect_path = (
            _safe_redirect_path(state_payload.get("r")) if state_payload else DEFAULT_REDIRECT_PATH
        )
        return _frontend_redirect(redirect_path, calendar_error=error[:100])

    if not state_payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Estado invalido o expirado. Vuelve a conectar tu calendario.",
        )

    if not code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Codigo de autorizacion requerido",
        )

    user_id = str(state_payload["uid"])
    code_verifier = str(state_payload["cv"])
    redirect_path = _safe_redirect_path(state_payload.get("r"))

    try:
        token_data = exchange_code(code=code, code_verifier=code_verifier)
    except Exception as exc:
        logger.exception("Error intercambiando codigo OAuth")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No se pudo completar la conexion con Google Calendar",
        ) from exc

    access_token = token_data.get("access_token", "")
    refresh_token = token_data.get("refresh_token", "")
    expires_at = token_data.get("expires_at")

    # Reconexion: desactivar las conexiones previas (y descartar sus tokens) para no
    # dejar refresh tokens vigentes en filas huerfanas.
    previous_connections = session.exec(
        select(UserCalendarConnection).where(
            UserCalendarConnection.user_id == user_id,
            UserCalendarConnection.provider == "google",
            UserCalendarConnection.active == True,
        )
    ).all()
    now = datetime.utcnow()
    for previous in previous_connections:
        previous.active = False
        previous.is_default = False
        previous.access_token_encrypted = ""
        previous.refresh_token_encrypted = ""
        previous.updated_at = now
        session.add(previous)

    conn = UserCalendarConnection(
        user_id=user_id,
        provider="google",
        calendar_id="primary",
        calendar_name="Calendario principal",
        access_token_encrypted=encrypt_secret(access_token),
        refresh_token_encrypted=encrypt_secret(refresh_token) if refresh_token else "",
        token_expires_at=expires_at.replace(tzinfo=None) if expires_at else None,
        is_default=True,
        active=True,
    )
    session.add(conn)
    session.commit()

    return _frontend_redirect(redirect_path, calendar_connected="1")


@calendars_router.get("/google/events")
def google_events(
    current_user: CurrentUser,
    session: SessionDep,
    from_unix: int = Query(default=0),
    to_unix: int = Query(default=0),
):
    """Lista los eventos del Google Calendar conectado del usuario en el rango dado."""
    conn = session.exec(
        select(UserCalendarConnection).where(
            UserCalendarConnection.user_id == current_user.id,
            UserCalendarConnection.provider == "google",
            UserCalendarConnection.active == True,
            UserCalendarConnection.is_default == True,
        )
    ).first()

    if not conn:
        return {"events": []}

    now = datetime.now(timezone.utc)
    time_min = _parse_unix_or_400(from_unix, "from_unix") if from_unix > 0 else now - timedelta(days=31)
    time_max = _parse_unix_or_400(to_unix, "to_unix") if to_unix > 0 else now + timedelta(days=62)

    events = list_events(conn, time_min, time_max)
    session.commit()  # persiste el refresh de token (o la desactivacion por invalid_grant)
    return {"events": events}


@calendars_router.get("")
async def list_connections(
    current_user: CurrentUser,
    session: SessionDep,
):
    """Lista las conexiones de calendario del usuario."""
    statement = select(UserCalendarConnection).where(
        UserCalendarConnection.user_id == current_user.id,
        UserCalendarConnection.active == True,
    ).order_by(UserCalendarConnection.created_at.desc())

    connections = session.exec(statement).all()
    return {
        "connections": [
            {
                "id": c.id,
                "provider": c.provider,
                "calendar_id": c.calendar_id,
                "calendar_name": c.calendar_name,
                "is_default": c.is_default,
                "active": c.active,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in connections
        ]
    }


@calendars_router.get("/{connection_id}/calendars")
def list_available_calendars(
    connection_id: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    """Lista los calendarios disponibles en la cuenta Google del usuario."""
    conn = session.get(UserCalendarConnection, connection_id)
    if not conn or conn.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conexion no encontrada",
        )

    calendars = list_user_calendars(conn)
    session.commit()
    return {"calendars": calendars}


@calendars_router.put("/{connection_id}")
async def update_connection(
    connection_id: str,
    payload: dict,
    current_user: CurrentUser,
    session: SessionDep,
):
    """Actualiza la conexion (calendario por defecto, etc)."""
    conn = session.get(UserCalendarConnection, connection_id)
    if not conn or conn.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conexion no encontrada",
        )

    if "calendar_id" in payload:
        conn.calendar_id = str(payload["calendar_id"]).strip() or "primary"
    if "calendar_name" in payload:
        conn.calendar_name = str(payload.get("calendar_name", "")).strip()
    if "is_default" in payload:
        is_default = bool(payload["is_default"])
        if is_default:
            # Unset other defaults
            others = session.exec(
                select(UserCalendarConnection).where(
                    UserCalendarConnection.user_id == current_user.id,
                    UserCalendarConnection.id != connection_id,
                    UserCalendarConnection.is_default == True,
                )
            ).all()
            for o in others:
                o.is_default = False
                session.add(o)
        conn.is_default = is_default

    conn.updated_at = __import__("datetime").datetime.utcnow()
    session.add(conn)
    session.commit()
    session.refresh(conn)
    return {
        "connection": conn.model_dump(
            exclude={"access_token_encrypted", "refresh_token_encrypted"}
        )
    }


@calendars_router.delete("/{connection_id}")
async def delete_connection(
    connection_id: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    """Desconecta un calendario."""
    conn = session.get(UserCalendarConnection, connection_id)
    if not conn or (conn.user_id != current_user.id and not is_super_admin_user(current_user)):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Conexion no encontrada",
        )

    session.delete(conn)
    session.commit()
    return {"deleted": True}
