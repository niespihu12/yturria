from fastapi import APIRouter, File, Form, Query, Request, UploadFile

from app.controllers.AgentController import AgentController
from app.controllers.deps.auth import CurrentUser
from app.controllers.deps.db_session import SessionDep

agents_router = APIRouter(prefix="/agents", tags=["Agents"])


@agents_router.get("")
async def list_agents(
    current_user: CurrentUser,
    session: SessionDep,
    user_id: str | None = Query(default=None),
):
    return await AgentController.list_agents(current_user, session, user_id)


@agents_router.post("")
async def create_agent(request: Request, current_user: CurrentUser, session: SessionDep):
    payload = await request.json()
    return await AgentController.create_agent(payload, current_user, session)


@agents_router.get("/voices")
async def list_voices(current_user: CurrentUser):
    return await AgentController.list_voices(current_user)


@agents_router.get("/voices/{voice_id}/preview")
async def get_voice_preview(voice_id: str, current_user: CurrentUser):
    return await AgentController.get_voice_preview(voice_id, current_user)


@agents_router.get("/tools")
async def list_tools(current_user: CurrentUser, session: SessionDep):
    return await AgentController.list_tools(current_user, session)


@agents_router.post("/tools")
async def create_tool(request: Request, current_user: CurrentUser, session: SessionDep):
    payload = await request.json()
    return await AgentController.create_tool(payload, current_user, session)


@agents_router.delete("/tools/{tool_id}")
async def delete_tool(tool_id: str, current_user: CurrentUser, session: SessionDep):
    return await AgentController.delete_tool(tool_id, current_user, session)


@agents_router.get("/knowledge-base")
async def list_knowledge_base_documents(current_user: CurrentUser):
    return await AgentController.list_knowledge_base_documents(current_user)


@agents_router.post("/knowledge-base/file")
async def create_knowledge_base_document_from_file(
    current_user: CurrentUser,
    file: UploadFile = File(...),
    name: str | None = Form(None),
):
    return await AgentController.create_knowledge_base_document_from_file(
        file, name, current_user
    )


@agents_router.post("/knowledge-base/text")
async def create_knowledge_base_document_from_text(
    request: Request, current_user: CurrentUser
):
    payload = await request.json()
    return await AgentController.create_knowledge_base_document_from_text(
        payload, current_user
    )


@agents_router.post("/knowledge-base/url")
async def create_knowledge_base_document_from_url(
    request: Request, current_user: CurrentUser
):
    payload = await request.json()
    return await AgentController.create_knowledge_base_document_from_url(
        payload, current_user
    )


@agents_router.patch("/knowledge-base/{documentation_id}")
async def update_knowledge_base_document(
    documentation_id: str, request: Request, current_user: CurrentUser
):
    payload = await request.json()
    return await AgentController.update_knowledge_base_document(
        documentation_id, payload, current_user
    )


@agents_router.delete("/knowledge-base/{documentation_id}")
async def delete_knowledge_base_document(
    documentation_id: str, current_user: CurrentUser
):
    return await AgentController.delete_knowledge_base_document(
        documentation_id, current_user
    )


@agents_router.get("/knowledge-base/{documentation_id}/rag-index")
async def get_knowledge_base_rag_indexes(
    documentation_id: str, current_user: CurrentUser
):
    return await AgentController.get_knowledge_base_rag_indexes(
        documentation_id, current_user
    )


@agents_router.post("/knowledge-base/{documentation_id}/rag-index")
async def compute_knowledge_base_rag_index(
    documentation_id: str, request: Request, current_user: CurrentUser
):
    payload = await request.json()
    return await AgentController.compute_knowledge_base_rag_index(
        documentation_id, payload, current_user
    )


@agents_router.get("/phone-numbers")
async def list_phone_numbers(
    current_user: CurrentUser,
    session: SessionDep,
    user_id: str | None = Query(default=None),
):
    return await AgentController.list_phone_numbers(current_user, session, user_id)


@agents_router.post("/phone-numbers")
async def create_phone_number(
    request: Request,
    current_user: CurrentUser,
    session: SessionDep,
):
    payload = await request.json()
    return await AgentController.create_phone_number(payload, current_user, session)


@agents_router.patch("/phone-numbers/{phone_number_id}")
async def update_phone_number(
    phone_number_id: str,
    request: Request,
    current_user: CurrentUser,
    session: SessionDep,
):
    payload = await request.json()
    return await AgentController.update_phone_number(
        phone_number_id, payload, current_user, session
    )


@agents_router.post("/twilio/outbound-call")
async def create_twilio_outbound_call(
    request: Request,
    current_user: CurrentUser,
    session: SessionDep,
):
    payload = await request.json()
    return await AgentController.create_twilio_outbound_call(
        payload,
        current_user,
        session,
    )


@agents_router.get("/conversations/{conversation_id}")
async def get_conversation_detail(
    conversation_id: str, current_user: CurrentUser, session: SessionDep
):
    return await AgentController.get_conversation_detail(
        conversation_id, current_user, session
    )


@agents_router.get("/conversations/{conversation_id}/audio")
async def get_conversation_audio(
    conversation_id: str, current_user: CurrentUser, session: SessionDep
):
    return await AgentController.get_conversation_audio(
        conversation_id, current_user, session
    )


@agents_router.post("/conversations/{conversation_id}/analysis/run")
async def run_conversation_analysis(
    conversation_id: str, current_user: CurrentUser, session: SessionDep
):
    return await AgentController.run_conversation_analysis(
        conversation_id, current_user, session
    )


@agents_router.get("/{agent_id}/conversations")
async def list_conversations(
    agent_id: str,
    current_user: CurrentUser,
    session: SessionDep,
    cursor: str | None = None,
    page_size: int = Query(default=20, ge=1, le=100),
):
    return await AgentController.list_conversations(
        agent_id,
        current_user,
        session,
        cursor,
        page_size,
    )


@agents_router.get("/{agent_id}/widget")
async def get_agent_widget(agent_id: str, current_user: CurrentUser, session: SessionDep):
    return await AgentController.get_agent_widget(agent_id, current_user, session)


@agents_router.get("/{agent_id}/signed-url")
async def get_agent_signed_url(
    agent_id: str, current_user: CurrentUser, session: SessionDep
):
    return await AgentController.get_signed_url(agent_id, current_user, session)


@agents_router.get("/{agent_id}")
async def get_agent(agent_id: str, current_user: CurrentUser, session: SessionDep):
    return await AgentController.get_agent(agent_id, current_user, session)


@agents_router.patch("/{agent_id}")
async def update_agent(agent_id: str, request: Request, current_user: CurrentUser, session: SessionDep):
    payload = await request.json()
    return await AgentController.update_agent(agent_id, payload, current_user, session)


@agents_router.delete("/{agent_id}")
async def delete_agent(agent_id: str, current_user: CurrentUser, session: SessionDep):
    return await AgentController.delete_agent(agent_id, current_user, session)
