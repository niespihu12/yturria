from __future__ import annotations

import logging
import os

from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlmodel import Session, select

from app.controllers.deps.auth import CurrentUser
from app.controllers.deps.db_session import SessionDep
from app.models.UserCalendarConnection import UserCalendarConnection
from app.services.google_calendar_oauth import (
    build_auth_url,
    exchange_code,
    list_user_calendars,
    sync_appointment_via_oauth,
)
from app.utils.crypto import encrypt_secret
from app.utils.roles import is_super_admin_user

logger = logging.getLogger(__name__)

calendars_router = APIRouter(prefix="/calendars", tags=["Calendars"])

FRONTEND_URL = (
    os.getenv("FRONTEND_PUBLIC_URL") or os.getenv("FRONTEND_URL") or "http://localhost:5173"
).strip().rstrip("/")


@calendars_router.get("/google/auth")
async def google_auth(
    current_user: CurrentUser,
    redirect_after: str = Query(default="/citas"),
):
    """Inicia el flujo OAuth con Google Calendar usando PKCE."""
    try:
        # Generamos el code_verifier y lo incluimos en el state
        # Formato: user_id:redirect_after:code_verifier
        state_payload = f"{current_user.id}:{redirect_after}"
        auth_url, code_verifier = build_auth_url(state=state_payload)
        state_with_verifier = f"{current_user.id}:{redirect_after}:{code_verifier}"
        auth_url, _ = build_auth_url(state=state_with_verifier, code_verifier=code_verifier)
        return {"auth_url": auth_url}
    except Exception as exc:
        logger.exception("Error iniciando OAuth de Google Calendar")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc


@calendars_router.get("/google/callback")
async def google_callback(
    request: Request,
    session: SessionDep,
    code: str = Query(default=""),
    state: str = Query(default=""),
    error: str = Query(default=""),
):
    """Callback de Google OAuth. Guarda los tokens y redirige al frontend."""
    if error:
        return {"status": "error", "message": f"Google OAuth error: {error}"}

    if not code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Codigo de autorizacion requerido",
        )

    # Parse state to get user_id, redirect path and code_verifier
    user_id = ""
    redirect_path = "/citas"
    code_verifier = ""
    if state and ":" in state:
        parts = state.split(":", maxsplit=2)
        user_id = parts[0]
        redirect_path = parts[1] if len(parts) > 1 else "/citas"
        code_verifier = parts[2] if len(parts) > 2 else ""

    try:
        token_data = exchange_code(code=code, code_verifier=code_verifier)
    except Exception as exc:
        logger.exception("Error intercambiando codigo OAuth")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error intercambiando codigo: {exc}",
        ) from exc

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Estado invalido",
        )

    access_token = token_data.get("access_token", "")
    refresh_token = token_data.get("refresh_token", "")
    expires_at = token_data.get("expires_at")

    # Desactivar cualquier conexion previa como default
    existing_defaults = session.exec(
        select(UserCalendarConnection).where(
            UserCalendarConnection.user_id == user_id,
            UserCalendarConnection.provider == "google",
            UserCalendarConnection.is_default == True,
        )
    ).all()
    for ed in existing_defaults:
        ed.is_default = False
        session.add(ed)

    # Crear nueva conexion
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

    # Redirect to frontend
    redirect_url = f"{FRONTEND_URL}{redirect_path}?calendar_connected=1"
    from fastapi.responses import RedirectResponse

    return RedirectResponse(url=redirect_url)


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
async def list_available_calendars(
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
    return {"connection": conn.model_dump()}


@calendars_router.delete("/{connection_id}")
async def delete_connection(
    connection_id: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    """Desconecta un calendario."""
    conn = session.get(UserCalendarConnection, connection_id)
    if not conn or conn.user_id != current_user.id:
        if not is_super_admin_user(current_user):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conexion no encontrada",
            )

    session.delete(conn)
    session.commit()
    return {"deleted": True}
