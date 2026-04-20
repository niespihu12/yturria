from __future__ import annotations

from fastapi import APIRouter, Request

from app.controllers.PrivacyController import PrivacyController
from app.controllers.deps.auth import CurrentUser
from app.controllers.deps.db_session import SessionDep

privacy_router = APIRouter(prefix="/privacy", tags=["Privacy"])


async def _safe_json_payload(request: Request) -> dict:
    try:
        payload = await request.json()
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


@privacy_router.get("/deletion-requests")
async def list_deletion_requests(
    current_user: CurrentUser,
    session: SessionDep,
):
    return await PrivacyController.list_deletion_requests(current_user, session)


@privacy_router.post("/deletion-requests")
async def create_deletion_request(
    request: Request,
    current_user: CurrentUser,
    session: SessionDep,
):
    payload = await _safe_json_payload(request)
    return await PrivacyController.create_deletion_request(payload, current_user, session)


@privacy_router.post("/deletion-requests/{request_id}/process")
async def process_deletion_request(
    request_id: str,
    request: Request,
    current_user: CurrentUser,
    session: SessionDep,
):
    payload = await _safe_json_payload(request)
    return await PrivacyController.process_deletion_request(
        request_id,
        payload,
        current_user,
        session,
    )


@privacy_router.post("/delete-my-data")
async def delete_my_data(
    request: Request,
    current_user: CurrentUser,
    session: SessionDep,
):
    payload = await _safe_json_payload(request)
    return await PrivacyController.delete_my_data(payload, current_user, session)
