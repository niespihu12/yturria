"""HTTP: regresiones de agentes de texto (chat, herramientas, KB, conversaciones)."""
from __future__ import annotations

import importlib
import io
import json
import threading
from datetime import datetime, timedelta

import httpx
import pytest
from langchain_core.messages import AIMessage
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from sqlmodel import select

import app.controllers.TextAgentController as ctrl
import app.services.sofia_graph as sofia_graph
from app.models.TextAgent import TextAgent
from app.models.TextAgentTool import TextAgentTool
from app.models.TextConversation import TextConversation
from app.models.TextKnowledgeBaseDocument import TextKnowledgeBaseDocument
from app.models.TextMessage import TextMessage


@pytest.fixture(autouse=True)
def _server_openai_key(monkeypatch):
    monkeypatch.setattr(ctrl, "OPENAI_API_KEY", "sk-test-env")


def _create_agent(client, headers, **overrides) -> dict:
    payload = {"name": "Agente QA", "template_key": "custom", "system_prompt": "Eres un asistente."}
    payload.update(overrides)
    res = client.post("/api/text-agents", json=payload, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


# ── Parámetros numéricos ─────────────────────────────────────────────────────

def test_create_agent_keeps_zero_temperature(client, make_user, headers_for):
    headers = headers_for(make_user())
    agent = _create_agent(client, headers, temperature=0)
    assert agent["temperature"] == 0.0

    res = client.patch(f"/api/text-agents/{agent['agent_id']}", json={"temperature": 0}, headers=headers)
    assert res.status_code == 200
    assert res.json()["temperature"] == 0.0


@pytest.mark.parametrize("field, value", [("temperature", "abc"), ("max_tokens", "muchos"), ("temperature", True)])
def test_non_numeric_runtime_params_are_400(client, make_user, headers_for, field, value):
    headers = headers_for(make_user())
    res = client.post(
        "/api/text-agents",
        json={"name": "X", "template_key": "custom", field: value},
        headers=headers,
    )
    assert res.status_code == 400

    agent = _create_agent(client, headers)
    res = client.patch(f"/api/text-agents/{agent['agent_id']}", json={field: value}, headers=headers)
    assert res.status_code == 400


# ── Chat ─────────────────────────────────────────────────────────────────────

def test_chat_rejects_oversized_message(client, make_user, headers_for):
    headers = headers_for(make_user())
    agent = _create_agent(client, headers)
    res = client.post(
        f"/api/text-agents/{agent['agent_id']}/chat",
        json={"message": "x" * 4001},
        headers=headers,
    )
    assert res.status_code == 400


def test_public_embed_chat_rejects_oversized_message(client, db, make_user, headers_for):
    headers = headers_for(make_user())
    agent = _create_agent(client, headers)
    token = db.get(TextAgent, agent["agent_id"]).embed_token
    res = client.post(
        f"/api/text-agents/public/{agent['agent_id']}/chat",
        json={"token": token, "message": "x" * 4001},
    )
    assert res.status_code == 400


def test_chat_llm_call_runs_in_threadpool(client, make_user, headers_for, monkeypatch):
    headers = headers_for(make_user())
    agent = _create_agent(client, headers)
    threads: dict[str, int] = {}
    real_rag = ctrl._retrieve_rag_context

    def spy_rag(*args, **kwargs):
        threads["loop"] = threading.get_ident()
        return real_rag(*args, **kwargs)

    def fake_dispatch(**kwargs):
        threads["llm"] = threading.get_ident()
        return "Hola, ¿en qué te ayudo?", 7

    monkeypatch.setattr(ctrl, "_retrieve_rag_context", spy_rag)
    monkeypatch.setattr(ctrl, "_dispatch_llm_with_optional_tool_execution", fake_dispatch)

    res = client.post(
        f"/api/text-agents/{agent['agent_id']}/chat", json={"message": "hola"}, headers=headers
    )
    assert res.status_code == 200, res.text
    assert res.json()["response"] == "Hola, ¿en qué te ayudo?"
    assert threads["llm"] != threads["loop"]


def test_chat_llm_timeout_is_504(client, make_user, headers_for, monkeypatch):
    headers = headers_for(make_user())
    agent = _create_agent(client, headers)

    def _timeout(self, request):
        raise httpx.ReadTimeout("timeout", request=request)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", _timeout)
    res = client.post(
        f"/api/text-agents/{agent['agent_id']}/chat", json={"message": "hola"}, headers=headers
    )
    assert res.status_code == 504


def test_chat_sends_bounded_history(client, db, make_user, headers_for, monkeypatch):
    headers = headers_for(make_user())
    agent = _create_agent(client, headers)
    user_id = db.get(TextAgent, agent["agent_id"]).user_id
    conversation = TextConversation(text_agent_id=agent["agent_id"], user_id=user_id, title="larga")
    db.add(conversation)
    db.commit()
    base = datetime.utcnow() - timedelta(hours=1)
    for idx in range(80):
        db.add(
            TextMessage(
                conversation_id=conversation.id,
                role="user" if idx % 2 == 0 else "assistant",
                content=f"m{idx}",
                created_at=base + timedelta(seconds=idx),
            )
        )
    db.commit()

    seen: dict = {}

    def fake_dispatch(**kwargs):
        seen["history"] = kwargs["history"]
        return "ok", 1

    monkeypatch.setattr(ctrl, "_dispatch_llm_with_optional_tool_execution", fake_dispatch)
    res = client.post(
        f"/api/text-agents/{agent['agent_id']}/chat",
        json={"message": "ultimo", "conversation_id": conversation.id},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    assert len(seen["history"]) == ctrl.HISTORY_MESSAGE_LIMIT
    assert seen["history"][-1] == {"role": "user", "content": "ultimo"}


class _PromptRecordingLLM:
    calls: list = []

    def __init__(self, *args, **kwargs):
        pass

    def invoke(self, messages):
        _PromptRecordingLLM.calls.append(messages)
        prompt = str(getattr(messages[-1], "content", ""))
        if prompt.startswith("Analiza el mensaje del usuario"):
            return AIMessage(content="otro")
        if prompt.startswith("Revisa esta respuesta"):
            return AIMessage(content="OK")
        return AIMessage(content="El plan Oro cubre robo total.")


def test_sofia_chat_includes_knowledge_base_and_survives_braces(client, db, make_user, headers_for, monkeypatch):
    headers = headers_for(make_user())
    agent = _create_agent(client, headers, template_key="sofia")
    stored = db.get(TextAgent, agent["agent_id"])
    stored.system_prompt = 'Eres Sofía. Responde {"formato": "breve"} y no uses {placeholder}.'
    db.add(stored)
    db.commit()

    upload = client.post(
        "/api/text-agents/knowledge-base/file",
        files={"file": ("planes.txt", "El plan Oro de Seguros Demo cubre robo total del vehiculo.".encode(), "text/plain")},
        headers=headers,
    )
    assert upload.status_code == 200, upload.text
    doc_id = upload.json()["id"]
    attach = client.post(
        f"/api/text-agents/{agent['agent_id']}/knowledge-base/{doc_id}",
        json={"usage_mode": "auto"},
        headers=headers,
    )
    assert attach.status_code == 200

    _PromptRecordingLLM.calls = []
    monkeypatch.setattr(sofia_graph, "_make_llm", lambda *a, **k: _PromptRecordingLLM())

    res = client.post(
        f"/api/text-agents/{agent['agent_id']}/chat",
        json={"message": "¿qué cubre el plan oro?"},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    system_messages = [
        str(call[0].content) for call in _PromptRecordingLLM.calls if len(call) > 1
    ]
    assert system_messages, "Sofía no llamó al LLM de respuesta"
    assert "cubre robo total del vehiculo" in system_messages[0]
    assert '{"formato": "breve"}' in system_messages[0]


# ── Herramientas ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "endpoint",
    ["http://169.254.169.254/latest/meta-data", "http://localhost:8000/api/text-agents", "http://127.0.0.1:3306"],
)
def test_create_tool_rejects_internal_endpoints(client, make_user, headers_for, endpoint):
    headers = headers_for(make_user())
    agent = _create_agent(client, headers)
    res = client.post(
        f"/api/text-agents/{agent['agent_id']}/tools",
        json={"name": "t", "endpoint_url": endpoint, "http_method": "GET"},
        headers=headers,
    )
    assert res.status_code == 400


def test_tool_crud_validates_and_masks_headers(client, db, make_user, headers_for, monkeypatch):
    monkeypatch.setattr(ctrl, "_resolve_host_ips", lambda host, port: ["93.184.216.34"])
    headers = headers_for(make_user())
    agent = _create_agent(client, headers)
    base = f"/api/text-agents/{agent['agent_id']}/tools"

    too_long = client.post(
        base, json={"name": "n" * 300, "endpoint_url": "https://api.example.com"}, headers=headers
    )
    assert too_long.status_code == 400

    secret = "Bearer sk-live-abcdef123456"
    created = client.post(
        base,
        json={
            "name": "crm",
            "endpoint_url": "https://api.example.com/leads",
            "http_method": "POST",
            "headers": {"Authorization": secret},
        },
        headers=headers,
    )
    assert created.status_code == 200, created.text
    tool = created.json()
    assert tool["headers"]["Authorization"] != secret

    resubmit = client.patch(
        f"{base}/{tool['id']}", json={"headers": tool["headers"], "enabled": False}, headers=headers
    )
    assert resubmit.status_code == 200
    db.expire_all()
    assert json.loads(db.get(TextAgentTool, tool["id"]).headers_json)["Authorization"] == secret

    to_internal = client.patch(
        f"{base}/{tool['id']}", json={"endpoint_url": "http://10.0.0.8/admin"}, headers=headers
    )
    assert to_internal.status_code == 400


# ── Base de conocimiento ─────────────────────────────────────────────────────

def _text_pdf(text: str) -> bytes:
    writer = PdfWriter()
    page = writer.add_blank_page(width=300, height=144)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})}
    )
    stream = DecodedStreamObject()
    stream.set_data(f"BT /F1 18 Tf 20 60 Td ({text}) Tj ET".encode("latin-1"))
    page[NameObject("/Contents")] = writer._add_object(stream)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def _blank_pdf(password: str | None = None) -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    if password:
        writer.encrypt(user_password=password, algorithm="AES-128")
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def _upload(client, headers, filename, content, content_type="application/octet-stream"):
    return client.post(
        "/api/text-agents/knowledge-base/file",
        files={"file": (filename, content, content_type)},
        headers=headers,
    )


def test_kb_upload_accepts_text_and_pdf(client, make_user, headers_for):
    headers = headers_for(make_user())

    txt = _upload(client, headers, "faq.md", "# FAQ\nHorario de 9 a 18.".encode(), "text/markdown")
    assert txt.status_code == 200, txt.text
    assert txt.json()["index_status"] == "indexed"

    pdf = _upload(client, headers, "presentacion.pdf", _text_pdf("Plan Oro cubre robo total"), "application/pdf")
    assert pdf.status_code == 200, pdf.text
    assert "Plan Oro cubre robo total" in pdf.json()["content_preview"]


def test_kb_upload_pdf_via_extraction_helper(client, make_user, headers_for, monkeypatch):
    headers = headers_for(make_user())
    monkeypatch.setattr(ctrl, "_read_pdf_pages_text", lambda raw: ["Pagina uno", "", "Pagina dos"])
    res = _upload(client, headers, "doc.pdf", b"%PDF-1.4 fake", "application/pdf")
    assert res.status_code == 200, res.text
    assert res.json()["content_preview"] == "Pagina uno\n\nPagina dos"


@pytest.mark.parametrize(
    "filename, content, expected_status",
    [
        ("escaneado.pdf", _blank_pdf(), 400),
        ("protegido.pdf", _blank_pdf(password="clave"), 400),
        ("roto.pdf", b"%PDF-1.4\nesto no es un pdf valido", 400),
        ("contrato.docx", b"PK\x03\x04binario", 400),
        ("programa.exe", b"MZ\x90\x00", 400),
        ("binario.txt", b"texto\x00con nulos", 400),
        ("vacio.txt", b"   ", 400),
        ("enorme.txt", b"a" * (5 * 1024 * 1024 + 1), 413),
    ],
    ids=["pdf-sin-texto", "pdf-cifrado", "pdf-roto", "docx", "exe", "txt-binario", "txt-vacio", "demasiado-grande"],
)
def test_kb_upload_rejects_invalid_files(client, db, make_user, headers_for, filename, content, expected_status):
    headers = headers_for(make_user())
    res = _upload(client, headers, filename, content)
    assert res.status_code == expected_status, res.text
    assert "error" in res.json()
    assert db.exec(select(TextKnowledgeBaseDocument)).all() == []


def test_kb_index_failure_marks_failed_without_pending_rollback(client, db, make_user, headers_for, monkeypatch):
    headers = headers_for(make_user())

    def broken_index(doc, session):
        session.add(TextMessage(conversation_id="no-existe", role=None, content="x"))
        session.flush()
        return 0

    monkeypatch.setattr(ctrl, "_index_document", broken_index)
    res = _upload(client, headers, "faq.txt", "Contenido de prueba suficiente".encode(), "text/plain")
    assert res.status_code == 200, res.text
    assert res.json()["index_status"] == "failed"


# ── Conversaciones y escalaciones ────────────────────────────────────────────

def test_list_conversations_and_escalations_use_aggregates(client, db, make_user, headers_for):
    headers = headers_for(make_user())
    agent = _create_agent(client, headers)
    user_id = db.get(TextAgent, agent["agent_id"]).user_id
    conversation = TextConversation(
        text_agent_id=agent["agent_id"],
        user_id=user_id,
        title="conv",
        escalation_status="pending",
        escalated_at=datetime.utcnow(),
    )
    empty = TextConversation(text_agent_id=agent["agent_id"], user_id=user_id, title="vacia")
    db.add(conversation)
    db.add(empty)
    db.commit()
    base = datetime.utcnow() - timedelta(minutes=5)
    for idx, (role, content) in enumerate(
        [("user", "primero"), ("assistant", "resp 1"), ("user", "ultimo del cliente"), ("assistant", "resp final")]
    ):
        db.add(
            TextMessage(
                conversation_id=conversation.id,
                role=role,
                content=content,
                created_at=base + timedelta(seconds=idx),
            )
        )
    db.add(
        TextMessage(
            conversation_id=conversation.id,
            role="user",
            content="borrado",
            deleted_at=datetime.utcnow(),
            created_at=base + timedelta(seconds=10),
        )
    )
    db.commit()

    res = client.get(f"/api/text-agents/{agent['agent_id']}/conversations", headers=headers)
    assert res.status_code == 200
    by_id = {item["conversation_id"]: item for item in res.json()["conversations"]}
    assert by_id[conversation.id]["message_count"] == 4
    assert by_id[conversation.id]["last_message_preview"] == "resp final"
    assert by_id[empty.id]["message_count"] == 0
    assert by_id[empty.id]["last_message_preview"] == ""

    res = client.get(f"/api/text-agents/{agent['agent_id']}/escalations", headers=headers)
    assert res.status_code == 200
    escalations = res.json()["escalations"]
    assert len(escalations) == 1
    assert escalations[0]["last_user_message"] == "ultimo del cliente"


def test_push_to_crm_rejects_non_object_json(client, db, make_user, headers_for, monkeypatch):
    router_module = importlib.import_module("app.routes.text_agents_router")
    monkeypatch.setattr(router_module, "is_crm_configured", lambda: True)
    headers = headers_for(make_user())
    agent = _create_agent(client, headers)
    user_id = db.get(TextAgent, agent["agent_id"]).user_id
    conversation = TextConversation(text_agent_id=agent["agent_id"], user_id=user_id, title="lead")
    db.add(conversation)
    db.commit()

    url = f"/api/text-agents/{agent['agent_id']}/conversations/{conversation.id}/push-to-crm"
    res = client.post(url, content="[1, 2]", headers={**headers, "Content-Type": "application/json"})
    assert res.status_code == 400
    res = client.post(url, content="{roto", headers={**headers, "Content-Type": "application/json"})
    assert res.status_code == 400
