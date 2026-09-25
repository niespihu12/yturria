from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlmodel import Session, select

from app.controllers.deps.auth import CurrentUser
from app.controllers.deps.db_session import SessionDep
from app.models.Contact import Contact
from app.models.UserAgent import UserAgent
from app.services.elevenlabs_client import elevenlabs_get, elevenlabs_patch
from app.utils.client_defaults import (
    build_client_built_in_tools,
    build_contact_catalog_prompt,
    is_valid_e164,
    normalize_phone_number,
)
from app.utils.roles import is_super_admin_user

logger = logging.getLogger(__name__)


def _validated_phone(value, field_label: str) -> str:
    phone = normalize_phone_number(value)
    if phone and not is_valid_e164(phone):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"El {field_label} debe estar en formato internacional E.164, "
                "por ejemplo +525512345678"
            ),
        )
    return phone


def _sync_voice_agent_transfers(user_id: str, session: Session) -> None:
    """Sincroniza los contactos activos del usuario con sus agentes de voz en ElevenLabs.

    Reconstruye los built_in_tools (transfers) y actualiza el catálogo de contactos
    en el prompt de cada agente de voz del usuario.
    """
    # Obtener contactos activos del usuario
    contacts = session.exec(
        select(Contact).where(
            Contact.user_id == user_id,
            Contact.active == True,
        ).order_by(Contact.name, Contact.last_name)
    ).all()

    # Obtener agentes de voz del usuario
    voice_agents = session.exec(
        select(UserAgent).where(UserAgent.user_id == user_id)
    ).all()

    if not voice_agents:
        return

    # Construir built_in_tools con transfers actualizados
    built_in_tools = build_client_built_in_tools(contacts)

    # Construir catálogo de contactos para el prompt
    contact_catalog = build_contact_catalog_prompt(user_id, session)

    for mapping in voice_agents:
        agent_id = mapping.agent_id
        try:
            # Obtener configuración actual del agente
            current_config = elevenlabs_get(f"/convai/agents/{agent_id}")

            # Preparar payload de actualización
            conv_cfg = current_config.get("conversation_config", {})
            agent_cfg = conv_cfg.get("agent", {})
            prompt_cfg = agent_cfg.get("prompt", {})

            # Actualizar built_in_tools
            prompt_cfg["built_in_tools"] = built_in_tools

            # Actualizar prompt: quitar catálogo viejo y agregar nuevo
            current_prompt = str(prompt_cfg.get("prompt") or "").strip()
            if "--- DIRECTORIO DE ASESORES ---" in current_prompt:
                current_prompt = current_prompt.split("--- DIRECTORIO DE ASESORES ---")[0].strip()
            if contact_catalog:
                current_prompt = current_prompt + "\n" + contact_catalog
            prompt_cfg["prompt"] = current_prompt

            payload = {
                "conversation_config": {
                    "agent": {
                        "prompt": prompt_cfg,
                    }
                }
            }

            elevenlabs_patch(f"/convai/agents/{agent_id}", payload)
        except Exception:
            # No bloquear el flujo principal si ElevenLabs falla
            logger.exception(
                "No se pudieron sincronizar los contactos con el agente de voz %s", agent_id
            )

contacts_router = APIRouter(prefix="/contacts", tags=["Contacts"])


# Handlers sync (def): FastAPI los ejecuta en threadpool, asi las llamadas bloqueantes a
# ElevenLabs de _sync_voice_agent_transfers no congelan el event loop.
@contacts_router.get("")
def list_contacts(
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
def create_contact(
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
        phone=_validated_phone(payload.get("phone", ""), "teléfono"),
        email=str(payload.get("email", "")).strip().lower(),
        whatsapp=_validated_phone(payload.get("whatsapp", ""), "WhatsApp"),
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
def update_contact(
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
        contact.phone = _validated_phone(payload.get("phone", ""), "teléfono")
    if "email" in payload:
        contact.email = str(payload.get("email", "")).strip().lower()
    if "whatsapp" in payload:
        contact.whatsapp = _validated_phone(payload.get("whatsapp", ""), "WhatsApp")
    if "active" in payload:
        contact.active = bool(payload["active"])

    if not contact.name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El nombre es requerido",
        )

    contact.updated_at = datetime.utcnow()
    session.add(contact)
    session.commit()
    session.refresh(contact)

    _sync_voice_agent_transfers(contact.user_id, session)

    return contact.model_dump()


@contacts_router.delete("/{contact_id}")
def delete_contact(
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
