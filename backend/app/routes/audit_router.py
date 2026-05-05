from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query  # noqa: F401
from fastapi.responses import StreamingResponse
from sqlmodel import select

from app.controllers.deps.auth import CurrentUser
from app.controllers.deps.db_session import SessionDep
from app.models.AuditTrailEvent import AuditTrailEvent
from app.utils.roles import is_super_admin_user, role_as_value

audit_router = APIRouter(prefix="/audit", tags=["Audit"])

_MAX_EXPORT_ROWS = 10_000


def _parse_date(value: str | None, field_name: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Formato de fecha inválido en '{field_name}'. Use ISO 8601: YYYY-MM-DD")


@audit_router.get("/export")
async def export_audit(
    current_user: CurrentUser,
    session: SessionDep,
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
    event_type: str | None = Query(default=None),
    actor_user_id: str | None = Query(default=None),
    format: str = Query(default="csv", pattern="^(csv|json)$"),
):
    if not is_super_admin_user(current_user) and role_as_value(getattr(current_user, "role", None)) not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Acceso denegado")

    since = _parse_date(from_date, "from")
    until = _parse_date(to_date, "to")

    stmt = select(AuditTrailEvent).order_by(AuditTrailEvent.created_at.desc()).limit(_MAX_EXPORT_ROWS)
    if since:
        stmt = stmt.where(AuditTrailEvent.created_at >= since)
    if until:
        stmt = stmt.where(AuditTrailEvent.created_at <= until)
    if event_type:
        stmt = stmt.where(AuditTrailEvent.event_type == event_type)
    if actor_user_id:
        stmt = stmt.where(AuditTrailEvent.actor_user_id == actor_user_id)

    events = session.exec(stmt).all()
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

    if format == "json":
        rows = [
            {
                "id": e.id,
                "event_type": e.event_type,
                "actor_user_id": e.actor_user_id,
                "subject_user_id": e.subject_user_id,
                "entity_type": e.entity_type,
                "entity_id": e.entity_id,
                "details": json.loads(e.details_json or "{}"),
                "created_at": e.created_at.isoformat(),
            }
            for e in events
        ]
        content = json.dumps(rows, ensure_ascii=False, indent=2)
        return StreamingResponse(
            iter([content]),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="audit_{timestamp}.json"'},
        )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "id", "event_type", "actor_user_id", "subject_user_id",
        "entity_type", "entity_id", "details", "created_at",
    ])
    for e in events:
        writer.writerow([
            e.id,
            e.event_type,
            e.actor_user_id or "",
            e.subject_user_id or "",
            e.entity_type,
            e.entity_id,
            e.details_json,
            e.created_at.isoformat(),
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="audit_{timestamp}.csv"'},
    )


@audit_router.get("/events")
async def list_audit_events(
    current_user: CurrentUser,
    session: SessionDep,
    from_date: str | None = Query(default=None, alias="from"),
    to_date: str | None = Query(default=None, alias="to"),
    event_type: str | None = Query(default=None),
    actor_user_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    if not is_super_admin_user(current_user) and role_as_value(getattr(current_user, "role", None)) not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Acceso denegado")

    since = _parse_date(from_date, "from")
    until = _parse_date(to_date, "to")

    stmt = select(AuditTrailEvent).order_by(AuditTrailEvent.created_at.desc())
    if since:
        stmt = stmt.where(AuditTrailEvent.created_at >= since)
    if until:
        stmt = stmt.where(AuditTrailEvent.created_at <= until)
    if event_type:
        stmt = stmt.where(AuditTrailEvent.event_type == event_type)
    if actor_user_id:
        stmt = stmt.where(AuditTrailEvent.actor_user_id == actor_user_id)

    events = session.exec(stmt.offset(offset).limit(limit)).all()

    return {
        "events": [
            {
                "id": e.id,
                "event_type": e.event_type,
                "actor_user_id": e.actor_user_id,
                "subject_user_id": e.subject_user_id,
                "entity_type": e.entity_type,
                "entity_id": e.entity_id,
                "details": json.loads(e.details_json or "{}"),
                "created_at": int(e.created_at.replace(tzinfo=timezone.utc).timestamp()),
            }
            for e in events
        ],
        "limit": limit,
        "offset": offset,
    }
