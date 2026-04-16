from __future__ import annotations

from fastapi import APIRouter, File, Form, Request, UploadFile

from app.controllers.TextAgentController import TextAgentController
from app.controllers.deps.auth import CurrentUser
from app.controllers.deps.db_session import SessionDep

text_agents_router = APIRouter(prefix="/text-agents", tags=["Text Agents"])


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
async def list_text_agents(current_user: CurrentUser, session: SessionDep):
    return await TextAgentController.list_agents(current_user, session)


@text_agents_router.post("")
async def create_text_agent(request: Request, current_user: CurrentUser, session: SessionDep):
    payload = await request.json()
    return await TextAgentController.create_agent(payload, current_user, session)


# ── Knowledge base (global) ───────────────────────────────────────────────────

@text_agents_router.get("/knowledge-base")
async def list_knowledge_base_documents(current_user: CurrentUser, session: SessionDep):
    return await TextAgentController.list_knowledge_base_documents(current_user, session)


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


# ── Per-agent routes ──────────────────────────────────────────────────────────

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
