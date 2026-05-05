from __future__ import annotations

from fastapi import APIRouter, File, Form, Query, Request, UploadFile
from fastapi import HTTPException

from app.controllers.TextAgentController import TextAgentController
from app.controllers.deps.auth import CurrentUser
from app.controllers.deps.db_session import SessionDep
from app.models.TextAgent import TextAgent
from app.models.TextConversation import TextConversation
from app.services.analytics_service import get_funnel_metrics
from app.services.crm_integration import push_lead_to_crm, LeadData, is_crm_configured

text_agents_router = APIRouter(prefix="/text-agents", tags=["Text Agents"])


async def _safe_json_payload(request: Request) -> dict:
    try:
        payload = await request.json()
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


# ── Escalation management ────────────────────────────────────────────────────

@text_agents_router.get("/{text_agent_id}/escalations")
async def list_escalations(
    text_agent_id: str,
    current_user: CurrentUser,
    session: SessionDep,
    status: str | None = Query(default=None),
):
    return await TextAgentController.list_escalations(
        text_agent_id, current_user, session, status_filter=status
    )


@text_agents_router.patch("/{text_agent_id}/escalations/{conversation_id}")
async def update_escalation(
    text_agent_id: str,
    conversation_id: str,
    request: Request,
    current_user: CurrentUser,
    session: SessionDep,
):
    payload = await request.json()
    return await TextAgentController.update_escalation(
        text_agent_id, conversation_id, payload, current_user, session
    )


@text_agents_router.get("/provider-configs")
async def list_provider_configs(current_user: CurrentUser, session: SessionDep):
    return await TextAgentController.list_provider_configs(current_user, session)


@text_agents_router.put("/provider-configs/{provider}")
async def upsert_provider_config(
    provider: str,
    request: Request,
    current_user: CurrentUser,
    session: SessionDep,
):
    payload = await request.json()
    return await TextAgentController.upsert_provider_config(provider, payload, current_user, session)


@text_agents_router.delete("/provider-configs/{provider}")
async def delete_provider_config(
    provider: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    return await TextAgentController.delete_provider_config(provider, current_user, session)


@text_agents_router.get("")
async def list_text_agents(
    current_user: CurrentUser,
    session: SessionDep,
    user_id: str | None = Query(default=None),
):
    return await TextAgentController.list_agents(current_user, session, user_id)


@text_agents_router.get("/templates")
async def list_text_agent_templates(current_user: CurrentUser):
    del current_user
    return await TextAgentController.list_templates()


@text_agents_router.post("")
async def create_text_agent(request: Request, current_user: CurrentUser, session: SessionDep):
    payload = await request.json()
    return await TextAgentController.create_agent(payload, current_user, session)


# ── Knowledge base (global) ───────────────────────────────────────────────────

@text_agents_router.get("/knowledge-base")
async def list_knowledge_base_documents(
    current_user: CurrentUser,
    session: SessionDep,
    user_id: str | None = Query(default=None),
):
    return await TextAgentController.list_knowledge_base_documents(
        current_user,
        session,
        user_id,
    )


@text_agents_router.post("/knowledge-base/file")
async def create_knowledge_base_document_from_file(
    current_user: CurrentUser,
    session: SessionDep,
    file: UploadFile = File(...),
    name: str | None = Form(None),
):
    return await TextAgentController.create_knowledge_base_document_from_file(
        file, name, current_user, session
    )


@text_agents_router.post("/knowledge-base/{document_id}/reindex")
async def reindex_knowledge_base_document(
    document_id: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    return await TextAgentController.reindex_document(document_id, current_user, session)


@text_agents_router.delete("/knowledge-base/{document_id}")
async def delete_knowledge_base_document(
    document_id: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    return await TextAgentController.delete_knowledge_base_document(document_id, current_user, session)


# ── Conversations (global) ────────────────────────────────────────────────────

@text_agents_router.get("/conversations/{conversation_id}")
async def get_text_conversation_detail(
    conversation_id: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    return await TextAgentController.get_conversation_detail(conversation_id, current_user, session)


@text_agents_router.get("/renewals/upcoming")
async def list_upcoming_renewals(
    current_user: CurrentUser,
    session: SessionDep,
    days: int = Query(default=30, ge=1, le=365),
    user_id: str | None = Query(default=None),
):
    return await TextAgentController.list_upcoming_renewals(
        current_user,
        session,
        days=days,
        user_id=user_id,
    )


@text_agents_router.post("/renewals/reminders/run")
async def run_renewal_reminders(
    current_user: CurrentUser,
    session: SessionDep,
    days_ahead: int = Query(default=7, ge=1, le=60),
):
    return await TextAgentController.run_renewal_reminders(
        current_user,
        session,
        days_ahead=days_ahead,
    )


# ── Public embed routes (text-only) ─────────────────────────────────────────

@text_agents_router.get("/public/{text_agent_id}/embed-info")
async def get_public_embed_info(
    text_agent_id: str,
    session: SessionDep,
    token: str = Query(...),
):
    return await TextAgentController.get_public_embed_info(text_agent_id, token, session)


@text_agents_router.post("/public/{text_agent_id}/chat")
async def chat_with_public_text_embed(
    text_agent_id: str,
    request: Request,
    session: SessionDep,
):
    payload = await _safe_json_payload(request)
    return await TextAgentController.public_embed_chat(text_agent_id, payload, session)


# ── Per-agent routes ──────────────────────────────────────────────────────────

@text_agents_router.get("/{text_agent_id}/embed-config")
async def get_text_agent_embed_config(
    text_agent_id: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    return await TextAgentController.get_embed_config(text_agent_id, current_user, session)


@text_agents_router.get("/{text_agent_id}/appointments")
async def list_text_agent_appointments(
    text_agent_id: str,
    current_user: CurrentUser,
    session: SessionDep,
    status: str | None = Query(default=None),
    from_unix: int | None = Query(default=None, ge=1),
    to_unix: int | None = Query(default=None, ge=1),
    limit: int = Query(default=100, ge=1, le=200),
):
    return await TextAgentController.list_appointments(
        text_agent_id,
        current_user,
        session,
        status_filter=status,
        from_unix=from_unix,
        to_unix=to_unix,
        limit=limit,
    )


@text_agents_router.post("/{text_agent_id}/appointments")
async def create_text_agent_appointment(
    text_agent_id: str,
    request: Request,
    current_user: CurrentUser,
    session: SessionDep,
):
    payload = await request.json()
    return await TextAgentController.create_appointment(
        text_agent_id,
        payload,
        current_user,
        session,
    )


@text_agents_router.patch("/{text_agent_id}/appointments/{appointment_id}")
async def update_text_agent_appointment(
    text_agent_id: str,
    appointment_id: str,
    request: Request,
    current_user: CurrentUser,
    session: SessionDep,
):
    payload = await request.json()
    return await TextAgentController.update_appointment(
        text_agent_id,
        appointment_id,
        payload,
        current_user,
        session,
    )


@text_agents_router.delete("/{text_agent_id}/appointments/{appointment_id}")
async def delete_text_agent_appointment(
    text_agent_id: str,
    appointment_id: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    return await TextAgentController.delete_appointment(
        text_agent_id,
        appointment_id,
        current_user,
        session,
    )

@text_agents_router.get("/{text_agent_id}/tools")
async def list_text_agent_tools(
    text_agent_id: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    return await TextAgentController.list_tools(text_agent_id, current_user, session)


@text_agents_router.post("/{text_agent_id}/tools")
async def create_text_agent_tool(
    text_agent_id: str,
    request: Request,
    current_user: CurrentUser,
    session: SessionDep,
):
    payload = await request.json()
    return await TextAgentController.create_tool(text_agent_id, payload, current_user, session)


@text_agents_router.patch("/{text_agent_id}/tools/{tool_id}")
async def update_text_agent_tool(
    text_agent_id: str,
    tool_id: str,
    request: Request,
    current_user: CurrentUser,
    session: SessionDep,
):
    payload = await request.json()
    return await TextAgentController.update_tool(
        text_agent_id, tool_id, payload, current_user, session
    )


@text_agents_router.delete("/{text_agent_id}/tools/{tool_id}")
async def delete_text_agent_tool(
    text_agent_id: str,
    tool_id: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    return await TextAgentController.delete_tool(text_agent_id, tool_id, current_user, session)


@text_agents_router.get("/{text_agent_id}/knowledge-base")
async def list_agent_knowledge_base(
    text_agent_id: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    return await TextAgentController.list_agent_knowledge_base(text_agent_id, current_user, session)


@text_agents_router.post("/{text_agent_id}/knowledge-base/{document_id}")
async def attach_knowledge_base_document(
    text_agent_id: str,
    document_id: str,
    request: Request,
    current_user: CurrentUser,
    session: SessionDep,
):
    payload = await request.json()
    return await TextAgentController.attach_knowledge_base_document(
        text_agent_id, document_id, payload, current_user, session
    )


@text_agents_router.delete("/{text_agent_id}/knowledge-base/{document_id}")
async def detach_knowledge_base_document(
    text_agent_id: str,
    document_id: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    return await TextAgentController.detach_knowledge_base_document(
        text_agent_id, document_id, current_user, session
    )


@text_agents_router.get("/{text_agent_id}/whatsapp")
async def get_whatsapp_config(
    text_agent_id: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    return await TextAgentController.get_whatsapp_config(text_agent_id, current_user, session)


@text_agents_router.put("/{text_agent_id}/whatsapp")
async def upsert_whatsapp_config(
    text_agent_id: str,
    request: Request,
    current_user: CurrentUser,
    session: SessionDep,
):
    payload = await request.json()
    return await TextAgentController.upsert_whatsapp_config(
        text_agent_id, payload, current_user, session
    )


@text_agents_router.delete("/{text_agent_id}/whatsapp")
async def delete_whatsapp_config(
    text_agent_id: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    return await TextAgentController.delete_whatsapp_config(text_agent_id, current_user, session)


@text_agents_router.post("/{text_agent_id}/chat")
async def chat_with_text_agent(
    text_agent_id: str,
    request: Request,
    current_user: CurrentUser,
    session: SessionDep,
):
    payload = await request.json()
    return await TextAgentController.chat(text_agent_id, payload, current_user, session)


@text_agents_router.get("/{text_agent_id}/conversations")
async def list_text_agent_conversations(
    text_agent_id: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    return await TextAgentController.list_conversations(text_agent_id, current_user, session)


@text_agents_router.patch("/{text_agent_id}/conversations/{conversation_id}/renewal")
async def update_text_conversation_renewal(
    text_agent_id: str,
    conversation_id: str,
    request: Request,
    current_user: CurrentUser,
    session: SessionDep,
):
    payload = await request.json()
    return await TextAgentController.update_conversation_renewal(
        text_agent_id,
        conversation_id,
        payload,
        current_user,
        session,
    )


@text_agents_router.get("/{text_agent_id}")
async def get_text_agent(
    text_agent_id: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    return await TextAgentController.get_agent(text_agent_id, current_user, session)


@text_agents_router.patch("/{text_agent_id}")
async def update_text_agent(
    text_agent_id: str,
    request: Request,
    current_user: CurrentUser,
    session: SessionDep,
):
    payload = await request.json()
    return await TextAgentController.update_agent(text_agent_id, payload, current_user, session)


@text_agents_router.delete("/{text_agent_id}")
async def delete_text_agent(
    text_agent_id: str,
    current_user: CurrentUser,
    session: SessionDep,
):
    return await TextAgentController.delete_agent(text_agent_id, current_user, session)


@text_agents_router.post("/{text_agent_id}/conversations/{conversation_id}/push-to-crm")
async def push_conversation_to_crm(
    text_agent_id: str,
    conversation_id: str,
    current_user: CurrentUser,
    session: SessionDep,
    request: Request,
):
    agent = session.get(TextAgent, text_agent_id)
    if not agent or agent.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agente no encontrado")

    conv = session.get(TextConversation, conversation_id)
    if not conv or conv.text_agent_id != text_agent_id:
        raise HTTPException(status_code=404, detail="Conversación no encontrada")

    if not is_crm_configured():
        raise HTTPException(
            status_code=400,
            detail="Ningún CRM configurado. Define HUBSPOT_API_KEY o SALESFORCE_CLIENT_ID en el entorno."
        )

    payload = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    lead = LeadData(
        name=payload.get("name", conv.title or "Sin nombre"),
        phone=payload.get("phone", ""),
        email=payload.get("email", ""),
        source="sofia_agent",
        agent_id=text_agent_id,
        conversation_id=conversation_id,
        notes=payload.get("notes", f"Escalado: {conv.escalation_reason}"),
    )
    results = await push_lead_to_crm(lead)
    return {"pushed": results}


@text_agents_router.get("/{text_agent_id}/analytics/funnel")
async def get_analytics_funnel(
    text_agent_id: str,
    current_user: CurrentUser,
    session: SessionDep,
    period_days: int = Query(default=30, ge=1, le=365),
):
    agent = session.get(TextAgent, text_agent_id)
    if not agent or agent.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Agente no encontrado")
    metrics = get_funnel_metrics(session, text_agent_id, period_days)
    return {
        "agent_id": metrics.agent_id,
        "period_days": metrics.period_days,
        "conversations_started": metrics.conversations_started,
        "leads_qualified": metrics.leads_qualified,
        "appointments_scheduled": metrics.appointments_scheduled,
        "appointments_completed": metrics.appointments_completed,
        "escalations_total": metrics.escalations_total,
        "escalations_resolved": metrics.escalations_resolved,
        "conversion_rate_pct": metrics.conversion_rate_pct,
        "estimated_savings_cop": metrics.estimated_savings_cop,
    }
