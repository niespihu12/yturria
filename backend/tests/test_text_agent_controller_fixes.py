"""Regresiones de TextAgentController: SSRF, zonas horarias, historial, citas, escalaciones."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

import app.controllers.TextAgentController as ctrl
import app.models  # noqa: F401
from app.models.TextAgent import TextAgent
from app.models.TextAgentTool import TextAgentTool
from app.models.TextAgentWhatsApp import TextAgentWhatsApp
from app.models.TextAppointment import TextAppointment
from app.models.TextConversation import TextConversation
from app.models.TextMessage import TextMessage
from app.models.User import User, UserRole
from app.utils.crypto import encrypt_secret


@pytest.fixture
def session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        yield db
    engine.dispose()


def _seed(session: Session, *, sofia_config: dict | None = None):
    user = User(email="owner@example.com", password="x", name="Owner", role=UserRole.AGENT)
    session.add(user)
    session.commit()
    now = datetime.utcnow()
    agent = TextAgent(
        user_id=user.id,
        name="Agente",
        provider="openai",
        model="gpt-4.1-mini",
        system_prompt="Eres un asistente.",
        sofia_mode=True,
        sofia_config_json=json.dumps(sofia_config or {}),
        created_at=now,
        updated_at=now,
    )
    session.add(agent)
    session.commit()
    conversation = TextConversation(
        text_agent_id=agent.id,
        user_id=user.id,
        title="whatsapp:+573001112233",
        channel="whatsapp",
    )
    session.add(conversation)
    session.commit()
    return user, agent, conversation


def _tool(endpoint: str, headers: dict | None = None) -> TextAgentTool:
    return TextAgentTool(
        text_agent_id="agent",
        name="consulta",
        description="Consulta externa",
        endpoint_url=endpoint,
        http_method="GET",
        headers_json=json.dumps(headers or {}),
    )


# ── SSRF ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "endpoint",
    [
        "http://169.254.169.254/latest/meta-data/",
        "http://localhost:8000/api/text-agents",
        "http://127.0.0.1/",
        "http://10.0.0.5/internal",
        "http://192.168.1.10/",
        "http://[::1]:8000/",
        "http://0.0.0.0/",
        "ftp://example.com/file",
        "file:///etc/passwd",
    ],
)
def test_tool_endpoint_rejects_internal_or_unsupported(endpoint: str) -> None:
    error, _ = ctrl._validate_tool_endpoint(endpoint)
    assert error


def test_tool_endpoint_rejects_hostname_resolving_to_private_ip(monkeypatch) -> None:
    monkeypatch.setattr(ctrl, "_resolve_host_ips", lambda host, port: ["10.1.2.3"])
    error, _ = ctrl._validate_tool_endpoint("https://innocent.example.com/api")
    assert error and "interna" in error


def test_tool_endpoint_accepts_public_host_and_internal_scheme(monkeypatch) -> None:
    monkeypatch.setattr(ctrl, "_resolve_host_ips", lambda host, port: ["93.184.216.34"])
    assert ctrl._validate_tool_endpoint("https://api.example.com/v1")[0] is None
    assert ctrl._validate_tool_endpoint("internal://appointments.create")[0] is None


def test_tool_endpoint_allow_list_is_authoritative(monkeypatch) -> None:
    monkeypatch.setenv("TEXT_AGENT_TOOLS_ALLOWED_HOSTS", "crm.internal.local")
    assert ctrl._validate_tool_endpoint("http://crm.internal.local/api")[0] is None
    error, code = ctrl._validate_tool_endpoint("https://api.example.com/v1")
    assert error and code == 403


def test_external_tool_blocks_private_target_before_request(monkeypatch) -> None:
    def _fail(*args, **kwargs):
        raise AssertionError("No debe haber peticion HTTP")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", _fail)
    result = ctrl._execute_external_http_tool(_tool("http://169.254.169.254/latest"), {})
    assert result["ok"] is False
    assert result["status_code"] == 400


def test_external_tool_does_not_follow_redirects(monkeypatch) -> None:
    monkeypatch.setattr(ctrl, "_resolve_host_ips", lambda host, port: ["93.184.216.34"])
    requested: list[str] = []

    def _redirect(self, request):
        requested.append(str(request.url))
        return httpx.Response(302, headers={"Location": "http://169.254.169.254/"}, request=request)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", _redirect)
    result = ctrl._execute_external_http_tool(_tool("https://api.example.com/v1"), {})
    assert result["ok"] is False
    assert result["status_code"] == 302
    assert requested == ["https://93.184.216.34/v1"]


def test_external_tool_network_error_is_generic(monkeypatch) -> None:
    monkeypatch.setattr(ctrl, "_resolve_host_ips", lambda host, port: ["93.184.216.34"])

    def _boom(self, request):
        raise httpx.ConnectError("detalle interno 10.0.0.1:5432", request=request)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", _boom)
    result = ctrl._execute_external_http_tool(_tool("https://api.example.com/v1"), {})
    assert result["status_code"] == 502
    assert "10.0.0.1" not in result["error"]


# ── Herramientas: headers y prompt ───────────────────────────────────────────

def test_serialize_tool_masks_sensitive_headers_and_merge_keeps_secret() -> None:
    secret = "Bearer sk-super-secret-token-123"
    tool = _tool("https://api.example.com", {"Authorization": secret, "Content-Type": "application/json"})
    serialized = ctrl._serialize_tool(tool)
    assert serialized["headers"]["Authorization"] != secret
    assert serialized["headers"]["Content-Type"] == "application/json"

    merged = ctrl._merge_masked_headers(serialized["headers"], ctrl._load_tool_headers(tool))
    assert merged["Authorization"] == secret

    replaced = ctrl._merge_masked_headers({"Authorization": "Bearer nuevo"}, ctrl._load_tool_headers(tool))
    assert replaced["Authorization"] == "Bearer nuevo"


def test_tools_description_omits_endpoint_url() -> None:
    description = ctrl._build_tools_description([_tool("https://secret-host.example.com/private")])
    assert "consulta" in description
    assert "secret-host" not in description


# ── Fechas y zonas horarias ──────────────────────────────────────────────────

def test_parse_optional_datetime_huge_unix_is_400() -> None:
    with pytest.raises(HTTPException) as exc_info:
        ctrl._parse_optional_datetime(1e13)
    assert exc_info.value.status_code == 400


def test_tool_naive_datetime_is_interpreted_in_timezone() -> None:
    assert ctrl._parse_tool_appointment_datetime(
        "2030-01-15T10:00:00", "America/Bogota"
    ) == datetime(2030, 1, 15, 15, 0)
    assert ctrl._parse_tool_appointment_datetime(
        "2030-01-15T10:00:00-05:00", "Europe/Madrid"
    ) == datetime(2030, 1, 15, 15, 0)
    assert ctrl._parse_tool_appointment_datetime("mañana", "America/Bogota") is None


def _internal_tool_result(session, agent, conversation, monkeypatch, arguments):
    monkeypatch.setattr(ctrl, "is_time_slot_available", lambda *a, **k: True)
    monkeypatch.setattr(ctrl, "_apply_google_calendar_sync", lambda *a, **k: None)
    tool = TextAgentTool(
        text_agent_id=agent.id,
        name="agendar_cita",
        endpoint_url="internal://appointments.create",
        http_method="POST",
    )
    return ctrl._execute_internal_tool(
        tool, arguments, session=session, agent=agent, conversation=conversation
    )


def test_internal_tool_stores_local_time_as_utc(session, monkeypatch) -> None:
    _, agent, conversation = _seed(session)
    result = _internal_tool_result(
        session, agent, conversation, monkeypatch,
        {"appointment_date": "2030-01-15T10:00:00", "contact_name": "Ana"},
    )
    assert result["ok"] is True
    appointment = session.exec(select(TextAppointment)).one()
    assert appointment.appointment_date == datetime(2030, 1, 15, 15, 0)
    assert appointment.timezone == "America/Bogota"


def test_internal_tool_respects_timezone_argument(session, monkeypatch) -> None:
    _, agent, conversation = _seed(session)
    result = _internal_tool_result(
        session, agent, conversation, monkeypatch,
        {
            "appointment_date": "2030-01-15T10:00:00",
            "timezone": "America/Mexico_City",
            "contact_name": "Ana",
        },
    )
    assert result["ok"] is True
    appointment = session.exec(select(TextAppointment)).one()
    assert appointment.appointment_date == datetime(2030, 1, 15, 16, 0)
    assert appointment.timezone == "America/Mexico_City"


@pytest.mark.parametrize(
    "arguments",
    [
        {"appointment_date": "2030-01-15T10:00:00", "timezone": "Marte/Base", "contact_name": "Ana"},
        {"appointment_date": "2030-01-15T10:00:00", "timezone": "../../etc/passwd", "contact_name": "Ana"},
        {"appointment_date": 1e13, "contact_name": "Ana"},
    ],
)
def test_internal_tool_invalid_input_returns_error_to_llm(session, monkeypatch, arguments) -> None:
    _, agent, conversation = _seed(session)
    result = _internal_tool_result(session, agent, conversation, monkeypatch, arguments)
    assert result["ok"] is False
    assert result["status_code"] == 400
    assert session.exec(select(TextAppointment)).all() == []


def test_internal_tool_past_check_uses_local_time(session, monkeypatch) -> None:
    _, agent, conversation = _seed(session)
    # 08:00 UTC del 15/01 son las 03:00 en Bogota; las 05:00 locales ya son futuro.
    monkeypatch.setattr(ctrl, "_utcnow", lambda: datetime(2030, 1, 15, 8, 0))
    result = _internal_tool_result(
        session, agent, conversation, monkeypatch,
        {"appointment_date": "2030-01-15T05:00:00", "contact_name": "Ana"},
    )
    assert result["ok"] is True


# ── Historial acotado ────────────────────────────────────────────────────────

def test_recent_history_is_limited_and_chronological(session, monkeypatch) -> None:
    _, agent, conversation = _seed(session)
    base = datetime(2030, 1, 1, 12, 0)
    for idx in range(12):
        session.add(
            TextMessage(
                conversation_id=conversation.id,
                role="user" if idx % 2 == 0 else "assistant",
                content=f"m{idx}",
                created_at=base + timedelta(seconds=idx),
            )
        )
    session.commit()
    monkeypatch.setattr(ctrl, "HISTORY_MESSAGE_LIMIT", 5)

    history = ctrl._load_recent_history(session, conversation.id)
    assert [item["content"] for item in history] == ["m7", "m8", "m9", "m10", "m11"]
    assert ctrl._count_user_messages(session, conversation.id) == 6
    assert ctrl._has_prior_assistant_message(session, conversation.id) is True


# ── Citas automáticas de Sofía ───────────────────────────────────────────────

@pytest.mark.parametrize(
    "messages, expected",
    [
        (["Quiero agendar una cita para mañana"], True),
        (["Deseo una cita con un asesor"], True),
        (["no quiero cita"], False),
        (["Quiero agendar una cita", "no gracias"], False),
        (["quiero cancelar la cita"], False),
        (["¿Cuál es la agenda del equipo?"], False),
        (["Tengo una duda sobre mi cita médica de ayer"], False),
    ],
)
def test_explicit_scheduling_intent(messages, expected) -> None:
    assert ctrl._has_explicit_scheduling_intent(messages) is expected


def test_sofia_no_appointment_on_negative_message(session, monkeypatch) -> None:
    _, agent, conversation = _seed(session)
    monkeypatch.setattr(ctrl, "_apply_google_calendar_sync", lambda *a, **k: None)
    ctrl._maybe_auto_create_appointment_from_sofia(
        agent=agent,
        conversation=conversation,
        history=[],
        user_message="no quiero cita, gracias",
        session=session,
        sender_phone="+573001112233",
    )
    session.commit()
    assert session.exec(select(TextAppointment)).all() == []


def test_sofia_does_not_reactivate_cancelled_appointment(session, monkeypatch) -> None:
    _, agent, conversation = _seed(session)
    monkeypatch.setattr(ctrl, "_apply_google_calendar_sync", lambda *a, **k: None)
    monkeypatch.setattr(ctrl, "is_time_slot_available", lambda *a, **k: True)
    original_date = datetime(2030, 1, 10, 15, 0)
    cancelled = TextAppointment(
        text_agent_id=agent.id,
        user_id=agent.user_id,
        conversation_id=conversation.id,
        contact_phone="+573001112233",
        appointment_date=original_date,
        status="cancelled",
        source="agent",
    )
    session.add(cancelled)
    session.commit()

    ctrl._maybe_auto_create_appointment_from_sofia(
        agent=agent,
        conversation=conversation,
        history=[],
        user_message="el 20/01/2030 a las 10:00",
        session=session,
        sender_phone="+573001112233",
    )
    session.commit()
    session.refresh(cancelled)
    assert cancelled.status == "cancelled"
    assert cancelled.appointment_date == original_date


def test_sofia_reschedule_requires_available_slot(session, monkeypatch) -> None:
    _, agent, conversation = _seed(session)
    monkeypatch.setattr(ctrl, "_apply_google_calendar_sync", lambda *a, **k: None)
    monkeypatch.setattr(ctrl, "is_time_slot_available", lambda *a, **k: False)
    original_date = datetime(2030, 1, 10, 15, 0)
    appointment = TextAppointment(
        text_agent_id=agent.id,
        user_id=agent.user_id,
        conversation_id=conversation.id,
        contact_phone="+573001112233",
        appointment_date=original_date,
        status="scheduled",
        source="agent",
    )
    session.add(appointment)
    session.commit()

    ctrl._maybe_auto_create_appointment_from_sofia(
        agent=agent,
        conversation=conversation,
        history=[],
        user_message="mejor el 20/01/2030 a las 10:00",
        session=session,
        sender_phone="+573001112233",
    )
    session.commit()
    session.refresh(appointment)
    assert appointment.appointment_date == original_date


# ── Escalaciones: notificación única y conteo de incertidumbre ───────────────

def test_run_sofia_chat_notifies_only_on_transition(session, monkeypatch) -> None:
    _, agent, conversation = _seed(session, sofia_config={"advisor_phone": "+573009998877"})
    session.add(
        TextAgentWhatsApp(
            text_agent_id=agent.id,
            provider="twilio",
            phone_number="+15550001111",
            account_sid="AC123",
            auth_token_encrypted=encrypt_secret("token"),
            active=True,
        )
    )
    session.commit()

    captured_kwargs: list[dict] = []

    async def fake_run_sofia(**kwargs):
        captured_kwargs.append(kwargs)
        return {
            "response": "Le comunico con un asesor.",
            "should_escalate": True,
            "escalation_reason": "user_request",
            "intent": "otro",
        }

    sends: list[tuple] = []
    monkeypatch.setattr(ctrl, "run_sofia", fake_run_sofia)
    monkeypatch.setattr(ctrl, "_send_twilio_message", lambda *args: sends.append(args))

    for _ in range(3):
        asyncio.run(
            ctrl._run_sofia_chat(
                agent, conversation, [{"role": "user", "content": "quiero un asesor"}],
                "quiero hablar con un asesor", "", session,
                sender_phone="+573001112233",
                api_key="sk-owner",
            )
        )

    assert len(sends) == 1
    assert conversation.escalation_status == "pending"
    assert captured_kwargs[0]["api_key"] == "sk-owner"
    assert captured_kwargs[0]["already_escalated"] is False
    assert captured_kwargs[1]["already_escalated"] is True

    conversation.escalation_status = "resolved"
    session.add(conversation)
    session.commit()
    asyncio.run(
        ctrl._run_sofia_chat(
            agent, conversation, [{"role": "user", "content": "hola"}], "hola", "", session,
        )
    )
    assert captured_kwargs[-1]["allow_threshold_escalation"] is False


def test_run_sofia_chat_persists_uncertainty_count(session, monkeypatch) -> None:
    _, agent, conversation = _seed(session)
    captured: list[dict] = []

    async def fake_run_sofia(**kwargs):
        captured.append(kwargs)
        return {
            "response": "No estoy seguro.",
            "should_escalate": False,
            "escalation_reason": "",
            "intent": "otro",
            "uncertainty_count": kwargs["uncertainty_count"] + 1,
        }

    monkeypatch.setattr(ctrl, "run_sofia", fake_run_sofia)
    for _ in range(2):
        asyncio.run(
            ctrl._run_sofia_chat(
                agent, conversation, [{"role": "user", "content": "x"}], "x", "", session,
            )
        )

    assert [item["uncertainty_count"] for item in captured] == [0, 1]
    assert session.get(TextConversation, conversation.id).sofia_uncertainty_count == 2


def test_run_sofia_chat_maps_graph_failure_to_502(session, monkeypatch) -> None:
    _, agent, conversation = _seed(session)

    async def failing_run_sofia(**kwargs):
        raise RuntimeError("openai caido")

    monkeypatch.setattr(ctrl, "run_sofia", failing_run_sofia)
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            ctrl._run_sofia_chat(
                agent, conversation, [{"role": "user", "content": "x"}], "x", "", session,
            )
        )
    assert exc_info.value.status_code == 502


# ── Llamadas al LLM: errores de red ──────────────────────────────────────────

@pytest.mark.parametrize(
    "error, expected_status",
    [(httpx.ReadTimeout("timeout"), 504), (httpx.ConnectError("refused"), 502)],
)
def test_call_openai_maps_network_errors(monkeypatch, error, expected_status) -> None:
    def _raise(self, request):
        raise error

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", _raise)
    with pytest.raises(HTTPException) as exc_info:
        ctrl._call_openai("sk", "gpt-4.1-mini", "system", [], 0.2, 64)
    assert exc_info.value.status_code == expected_status


def test_call_openai_handles_string_error_body(monkeypatch) -> None:
    def _respond(self, request):
        return httpx.Response(401, json={"error": "invalid api key"}, request=request)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", _respond)
    with pytest.raises(HTTPException) as exc_info:
        ctrl._call_openai("sk", "gpt-4.1-mini", "system", [], 0.2, 64)
    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == "invalid api key"


def test_external_tool_connects_to_validated_ip_dns_rebinding(monkeypatch) -> None:
    # First resolution (validation) is public; a rebinding DNS would return an
    # internal IP afterwards, so the request must go to the already-validated IP.
    monkeypatch.setattr(ctrl, "_resolve_host_ips", lambda host, port: ["93.184.216.34"])
    seen: dict = {}

    def _capture(self, request):
        seen["host"] = request.url.host
        seen["host_header"] = request.headers.get("host")
        seen["sni"] = request.extensions.get("sni_hostname")
        return httpx.Response(200, json={"ok": True}, request=request)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", _capture)
    result = ctrl._execute_external_http_tool(_tool("https://api.example.com:8443/v1"), {})
    assert result["ok"] is True
    assert seen == {"host": "93.184.216.34", "host_header": "api.example.com:8443", "sni": "api.example.com"}
