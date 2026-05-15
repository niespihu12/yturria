from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, status
from sqlmodel import Session, select

from app.controllers.deps.auth import CurrentUser
from app.controllers.deps.db_session import SessionDep
from app.models.Contact import Contact
from app.models.UserAgent import UserAgent
from app.services.elevenlabs_client import elevenlabs_patch
from app.utils.client_defaults import build_client_built_in_tools
from app.utils.roles import is_super_admin_user

contacts_router = APIRouter(prefix="/contacts", tags=["Contacts"])


@contacts_router.get("")
async def list_contacts(
    current_user: CurrentUser,
    session: SessionDep,
    search: str | None = Query(default=None),
    specialty: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
):
    is_super_admin = is_super_admin_user(current_user)
    target_user_id = user_id if (is_super_admin and user_id) else current_user.id

    statement = select(Contact).where(Contact.user_id == target_user_id)

    if search:
        search_term = f"%{search.lower()}%"
        statement = statement.where(
            (Contact.name.ilike(search_term))
            | (Contact.last_name.ilike(search_term))
            | (Contact.specialty.ilike(search_term))
            | (Contact.phone.ilike(search_term))
            | (Contact.email.ilike(search_term))
        )

    if specialty:
        statement = statement.where(Contact.specialty.ilike(f"%{specialty.lower()}%"))

    statement = statement.order_by(Contact.name, Contact.last_name)
    contacts = session.exec(statement).all()
    return {"contacts": [c.model_dump() for c in contacts]}


@contacts_router.post("")
async def create_contact(
    payload: dict,
    current_user: CurrentUser,
    session: SessionDep,
):
    is_super_admin = is_super_admin_user(current_user)
    target_user_id = payload.get("user_id") if is_super_admin else current_user.id
    if not target_user_id:
        target_user_id = current_user.id

    contact = Contact(
        user_id=target_user_id,
        name=str(payload.get("name", "")).strip(),
        last_name=str(payload.get("last_name", "")).strip(),
        specialty=str(payload.get("specialty", "")).strip(),
        phone=str(payload.get("phone", "")).strip(),
        email=str(payload.get("email", "")).strip().lower(),
        whatsapp=str(payload.get("whatsapp", "")).strip(),
        active=bool(payload.get("active", True)),
    )

    if not contact.name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El nombre es requerido",
        )

    session.add(contact)
    session.commit()
    session.refresh(contact)

    _sync_voice_agent_transfers(contact.user_id, session)

    return contact.model_dump()


@contacts_router.put("/{contact_id}")
async def update_contact(
    contact_id: str,
    payload: dict,
    current_user: CurrentUser,
    session: SessionDep,
):
    contact = session.get(Contact, contact_id)
    if not contact:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contacto no encontrado",
        )

    if contact.user_id != current_user.id and not is_super_admin_user(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permiso para editar este contacto",
        )

    if "name" in payload:
        contact.name = str(payload["name"]).strip()
    if "last_name" in payload:
        contact.last_name = str(payload.get("last_name", "")).strip()
    if "specialty" in payload:
        contact.specialty = str(payload.get("specialty", "")).strip()
    if "phone" in payload:
        contact.phone = str(payload.get("phone", "")).strip()
    if "email" in payload:
        contact.email = str(payload.get("email", "")).strip().lower()
    if "whatsapp" in payload:
        contact.whatsapp = str(payload.get("whatsapp", "")).strip()
    if "active" in payload:
        contact.active = bool(payload["active"])

    if not contact.name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El nombre es requerido",
        )

    from datetime import datetime
    contact.updated_at = datetime.utcnow()
    session.add(contact)
    session.commit()
    session.refresh(contact)

    _sync_voice_agent_transfers(contact.user_id, session)

    return contact.model_dump()


@contacts_router.delete("/{contact_id}")
async def delete_contact(
    contact_id: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    contact = session.get(Contact, contact_id)
    if not contact:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Contacto no encontrado",
        )

    if contact.user_id != current_user.id and not is_super_admin_user(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No tienes permiso para eliminar este contacto",
        )

    user_id = contact.user_id
    session.delete(contact)
    session.commit()

    _sync_voice_agent_transfers(user_id, session)

    return {"deleted": True}
