"""Conectores CRM para push de leads calificados.

Configuración por variables de entorno (globales) o por agente (no implementado aún):
    HUBSPOT_API_KEY   → activa el connector de HubSpot
    SALESFORCE_CLIENT_ID, SALESFORCE_CLIENT_SECRET, SALESFORCE_INSTANCE_URL → Salesforce

Uso:
    from app.services.crm_integration import push_lead_to_crm
    await push_lead_to_crm(lead_data)
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)


@dataclass
class LeadData:
    name: str
    phone: str
    email: str = ""
    source: str = "sofia_agent"
    agent_id: str = ""
    conversation_id: str = ""
    notes: str = ""
    properties: dict[str, Any] = field(default_factory=dict)


# ── HubSpot ───────────────────────────────────────────────────────────────────

_HUBSPOT_BASE = "https://api.hubapi.com"


async def _push_to_hubspot(lead: LeadData) -> bool:
    api_key = os.getenv("HUBSPOT_API_KEY", "").strip()
    if not api_key:
        return False

    payload = {
        "properties": {
            "firstname": lead.name.split()[0] if lead.name else "",
            "lastname": " ".join(lead.name.split()[1:]) if len(lead.name.split()) > 1 else "",
            "phone": lead.phone,
            "email": lead.email,
            "hs_lead_status": "NEW",
            "lead_source": lead.source,
            "description": lead.notes,
            **lead.properties,
        }
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{_HUBSPOT_BASE}/crm/v3/objects/contacts",
                json=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )
            if response.status_code in (200, 201):
                data = response.json()
                logger.info("HubSpot: lead creado id=%s", data.get("id"))
                return True
            elif response.status_code == 409:
                # Contacto ya existe — intentar actualizar
                existing_id = response.json().get("message", "").split("existing ID: ")
                if len(existing_id) > 1:
                    contact_id = existing_id[1].strip()
                    await client.patch(
                        f"{_HUBSPOT_BASE}/crm/v3/objects/contacts/{contact_id}",
                        json={"properties": payload["properties"]},
                        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    )
                    logger.info("HubSpot: contacto actualizado id=%s", contact_id)
                    return True
            else:
                logger.error("HubSpot error %s: %s", response.status_code, response.text[:200])
                return False
    except Exception:
        logger.exception("HubSpot: error de conexión")
        return False


# ── Salesforce ────────────────────────────────────────────────────────────────

_SF_TOKEN_CACHE: dict[str, str] = {}


async def _get_salesforce_token() -> str | None:
    client_id = os.getenv("SALESFORCE_CLIENT_ID", "").strip()
    client_secret = os.getenv("SALESFORCE_CLIENT_SECRET", "").strip()
    instance_url = os.getenv("SALESFORCE_INSTANCE_URL", "").strip()

    if not all([client_id, client_secret, instance_url]):
        return None

    if _SF_TOKEN_CACHE.get("access_token"):
        return _SF_TOKEN_CACHE["access_token"]

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{instance_url}/services/oauth2/token",
                data={
                    "grant_type": "client_credentials",
                    "client_id": client_id,
                    "client_secret": client_secret,
                },
            )
            if response.status_code == 200:
                token = response.json().get("access_token", "")
                _SF_TOKEN_CACHE["access_token"] = token
                return token
    except Exception:
        logger.exception("Salesforce: error obteniendo token")
    return None


async def _push_to_salesforce(lead: LeadData) -> bool:
    instance_url = os.getenv("SALESFORCE_INSTANCE_URL", "").strip()
    if not instance_url:
        return False

    token = await _get_salesforce_token()
    if not token:
        return False

    payload = {
        "LastName": lead.name or "Sin nombre",
        "Phone": lead.phone,
        "Email": lead.email,
        "LeadSource": "Web",
        "Description": f"[Sofia Agent {lead.agent_id}] {lead.notes}",
        "Status": "Open - Not Contacted",
        **lead.properties,
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{instance_url}/services/data/v59.0/sobjects/Lead/",
                json=payload,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
            )
            if response.status_code in (200, 201):
                logger.info("Salesforce: lead creado id=%s", response.json().get("id"))
                return True
            else:
                logger.error("Salesforce error %s: %s", response.status_code, response.text[:200])
                _SF_TOKEN_CACHE.clear()
                return False
    except Exception:
        logger.exception("Salesforce: error de conexión")
        return False


# ── Dispatcher ────────────────────────────────────────────────────────────────

async def push_lead_to_crm(lead: LeadData) -> dict[str, bool]:
    """Envía el lead a todos los CRMs configurados. Retorna {crm: success}."""
    results: dict[str, bool] = {}

    if os.getenv("HUBSPOT_API_KEY"):
        results["hubspot"] = await _push_to_hubspot(lead)

    if os.getenv("SALESFORCE_CLIENT_ID"):
        results["salesforce"] = await _push_to_salesforce(lead)

    if not results:
        logger.debug("crm_integration: ningún CRM configurado")

    return results


def is_crm_configured() -> bool:
    return bool(os.getenv("HUBSPOT_API_KEY") or os.getenv("SALESFORCE_CLIENT_ID"))
