"""Agentes de voz: PATCH parcial, allow-list de cliente final, paginacion, token de tools."""
from __future__ import annotations

import copy

import pytest
from fastapi import HTTPException

from app.models.Contact import Contact
from app.models.User import UserRole
from app.models.UserAgent import UserAgent
from app.models.UserKnowledgeBaseDocument import UserKnowledgeBaseDocument


class FakeElevenLabs:
    def __init__(self):
        self.calls: list[dict] = []
        self.routes: dict[tuple[str, str], object] = {}

    async def __call__(self, method, path, *, json=None, params=None, data=None, files=None):
        self.calls.append(
            {"method": method, "path": path, "json": copy.deepcopy(json), "params": params}
        )
        handler = self.routes.get((method, path))
        if handler is None:
            raise HTTPException(status_code=404, detail=f"no route {method} {path}")
        if callable(handler):
            return handler(json=json, params=params)
        return copy.deepcopy(handler)

    def last(self, method, path) -> dict:
        matches = [c for c in self.calls if c["method"] == method and c["path"] == path]
        assert matches, f"{method} {path} no fue llamado"
        return matches[-1]


@pytest.fixture
def el(monkeypatch):
    fake = FakeElevenLabs()
    monkeypatch.setattr("app.controllers.AgentController._elevenlabs_request", fake)
    return fake


@pytest.fixture
def client_agent(db, make_user, el):
    user = make_user("cliente@example.com")
    db.add(UserAgent(user_id=user.id, agent_id="agent1"))
    db.commit()
    el.routes[("PATCH", "/convai/agents/agent1")] = lambda json, params: {"agent_id": "agent1"}
    el.routes[("GET", "/convai/agents/agent1")] = {
        "agent_id": "agent1",
        "conversation_config": {
            "agent": {"prompt": {"prompt": "Prompt propio", "knowledge_base": [{"id": "legacyDoc"}]}}
        },
    }
    return user


def _sent_prompt(el) -> dict:
    return el.last("PATCH", "/convai/agents/agent1")["json"]["conversation_config"]["agent"]


def test_partial_patch_from_client_keeps_custom_prompt(client, client_agent, headers_for, el):
    res = client.patch(
        "/api/agents/agent1",
        json={
            "platform_settings": {
                "call_recording_enabled": True,
                "evaluation": {"criteria": []},
                "overrides": {"conversation_config_override": {"agent": {"prompt": {"prompt": True}}}},
                "workspace_overrides": {"webhooks": {"post_call_webhook_id": "x"}},
            }
        },
        headers=headers_for(client_agent),
    )
    assert res.status_code == 200, res.text

    sent = el.last("PATCH", "/convai/agents/agent1")["json"]
    agent_cfg = sent["conversation_config"]["agent"]
    # No se envia prompt/first_message/language: ElevenLabs conserva los actuales.
    assert "prompt" not in agent_cfg["prompt"]
    assert "first_message" not in agent_cfg
    assert "language" not in agent_cfg
    # Politica de cliente sigue forzada.
    assert agent_cfg["prompt"]["llm"] == "gpt-4.1-mini"
    assert "built_in_tools" in agent_cfg["prompt"]
    assert sent["conversation_config"]["tts"]["model_id"] == "eleven_turbo_v2_5"
    # Solo claves permitidas de platform_settings.
    assert sent["platform_settings"] == {"call_recording_enabled": True}


def test_client_cannot_attach_tools_or_mcp(client, client_agent, headers_for, el):
    res = client.patch(
        "/api/agents/agent1",
        json={
            "name": "Nuevo nombre",
            "tags": ["x"],
            "conversation_config": {
                "agent": {
                    "prompt": {
                        "prompt": "Mi prompt editado",
                        "tool_ids": ["tool_de_otro"],
                        "tools": [{"type": "webhook", "name": "exfil"}],
                        "mcp_server_ids": ["mcp1"],
                        "custom_llm": {"url": "https://evil.example"},
                    },
                    "first_message": "Hola!",
                }
            },
        },
        headers=headers_for(client_agent),
    )
    assert res.status_code == 200, res.text

    sent = el.last("PATCH", "/convai/agents/agent1")["json"]
    prompt_cfg = sent["conversation_config"]["agent"]["prompt"]
    assert prompt_cfg["prompt"] == "Mi prompt editado"
    assert sent["conversation_config"]["agent"]["first_message"] == "Hola!"
    for blocked in ("tool_ids", "tools", "mcp_server_ids", "custom_llm"):
        assert blocked not in prompt_cfg
    assert "tags" not in sent
    assert sent["name"] == "Nuevo nombre"


def test_client_knowledge_base_attach_requires_ownership(
    client, db, client_agent, make_user, headers_for, el
):
    other = make_user("otro@example.com")
    db.add(UserKnowledgeBaseDocument(user_id=other.id, documentation_id="docAjeno"))
    db.add(UserKnowledgeBaseDocument(user_id=client_agent.id, documentation_id="docPropio"))
    db.commit()

    def _patch(doc_ids):
        return client.patch(
            "/api/agents/agent1",
            json={
                "conversation_config": {
                    "agent": {"prompt": {"knowledge_base": [{"id": d} for d in doc_ids]}}
                }
            },
            headers=headers_for(client_agent),
        )

    assert _patch(["docAjeno"]).status_code == 404
    # Propio + el legacy que el agente ya tenia: permitido.
    res = _patch(["docPropio", "legacyDoc"])
    assert res.status_code == 200, res.text


def test_super_admin_edit_uses_owner_contacts(client, db, client_agent, make_user, headers_for, el):
    admin = make_user("admin@example.com", role=UserRole.SUPER_ADMIN)
    db.add(Contact(user_id=client_agent.id, name="AsesorDelCliente", phone="+525511112222"))
    db.add(Contact(user_id=admin.id, name="ContactoDelAdmin", phone="+525533334444"))
    db.commit()

    res = client.patch(
        "/api/agents/agent1",
        json={"conversation_config": {"agent": {"prompt": {"prompt": "Base"}}}},
        headers=headers_for(admin),
    )
    assert res.status_code == 200, res.text
    prompt = _sent_prompt(el)["prompt"]["prompt"]
    assert "AsesorDelCliente" in prompt
    assert "ContactoDelAdmin" not in prompt


def test_list_agents_follows_cursor(client, db, client_agent, headers_for, el):
    db.add(UserAgent(user_id=client_agent.id, agent_id="agent_page2"))
    db.commit()

    def _pages(*, params, json=None):
        if (params or {}).get("cursor") == "c2":
            return {"agents": [{"agent_id": "agent_page2"}], "has_more": False}
        return {
            "agents": [{"agent_id": "agent1"}, {"agent_id": "ajeno"}],
            "has_more": True,
            "next_cursor": "c2",
        }

    el.routes[("GET", "/convai/agents")] = _pages
    res = client.get("/api/agents", headers=headers_for(client_agent))
    assert res.status_code == 200, res.text
    assert {a["agent_id"] for a in res.json()["agents"]} == {"agent1", "agent_page2"}


def test_conversation_without_agent_id_is_not_exposed(client, client_agent, headers_for, el):
    el.routes[("GET", "/convai/conversations/conv_sin_agente")] = {"conversation_id": "x"}
    el.routes[("GET", "/convai/conversations/conv_ajena")] = {"agent_id": "agente_de_otro"}
    el.routes[("GET", "/convai/conversations/conv_propia")] = {"agent_id": "agent1"}
    headers = headers_for(client_agent)

    assert client.get("/api/agents/conversations/conv_sin_agente", headers=headers).status_code == 404
    assert client.get("/api/agents/conversations/conv_ajena", headers=headers).status_code == 404
    assert (
        client.post(
            "/api/agents/conversations/conv_sin_agente/analysis/run", headers=headers
        ).status_code
        == 404
    )
    assert client.get("/api/agents/conversations/conv_propia", headers=headers).status_code == 200


def test_voice_tool_token_is_injected_server_side_and_redacted(
    client, make_user, headers_for, el, monkeypatch
):
    monkeypatch.setenv("VOICE_AGENT_TOOL_TOKEN", "server-secret")
    admin = make_user("admin@example.com", role=UserRole.SUPER_ADMIN)
    el.routes[("POST", "/convai/tools")] = lambda json, params: copy.deepcopy(
        {"id": "tool1", **json}
    )

    res = client.post(
        "/api/agents/tools",
        json={
            "tool_config": {
                "type": "webhook",
                "name": "schedule_appointment",
                "api_schema": {
                    "url": "https://api.example.com/api/webhooks/voice/tools/schedule-appointment",
                    "method": "POST",
                    "request_headers": {"x-voice-tool-token": "valor-del-frontend"},
                },
            }
        },
        headers=headers_for(admin),
    )
    assert res.status_code == 200, res.text

    sent_headers = el.last("POST", "/convai/tools")["json"]["tool_config"]["api_schema"][
        "request_headers"
    ]
    assert sent_headers == {"X-Voice-Tool-Token": "server-secret"}
    returned_headers = res.json()["tool_config"]["api_schema"]["request_headers"]
    assert returned_headers["X-Voice-Tool-Token"] != "server-secret"


def test_external_tool_headers_untouched(client, make_user, headers_for, el, monkeypatch):
    monkeypatch.setenv("VOICE_AGENT_TOOL_TOKEN", "server-secret")
    admin = make_user("admin@example.com", role=UserRole.SUPER_ADMIN)
    el.routes[("POST", "/convai/tools")] = lambda json, params: {"id": "tool2"}

    res = client.post(
        "/api/agents/tools",
        json={
            "tool_config": {
                "type": "webhook",
                "name": "crm",
                "api_schema": {
                    "url": "https://crm.example.com/hook",
                    "request_headers": {"Authorization": "Bearer abc"},
                },
            }
        },
        headers=headers_for(admin),
    )
    assert res.status_code == 200, res.text
    sent_headers = el.last("POST", "/convai/tools")["json"]["tool_config"]["api_schema"][
        "request_headers"
    ]
    assert sent_headers == {"Authorization": "Bearer abc"}


def test_get_agent_redacts_inline_tool_token(client, client_agent, headers_for, el):
    el.routes[("GET", "/convai/agents/agent1")] = {
        "agent_id": "agent1",
        "conversation_config": {
            "agent": {
                "prompt": {
                    "tools": [
                        {
                            "type": "webhook",
                            "api_schema": {
                                "url": "https://x/api/webhooks/voice/tools/take-message",
                                "request_headers": {"X-Voice-Tool-Token": "server-secret"},
                            },
                        }
                    ]
                }
            }
        },
    }
    res = client.get("/api/agents/agent1", headers=headers_for(client_agent))
    assert res.status_code == 200, res.text
    assert "server-secret" not in res.text


def test_phone_numbers_skip_elevenlabs_without_local_rows(client, make_user, headers_for, el):
    user = make_user("sin-numeros@example.com")
    admin = make_user("admin@example.com", role=UserRole.SUPER_ADMIN)

    for who in (user, admin):
        res = client.get("/api/agents/phone-numbers", headers=headers_for(who))
        assert res.status_code == 200, res.text
        assert res.json() == {"phone_numbers": []}
    assert el.calls == []


def test_missing_elevenlabs_key_returns_503(client, make_user, headers_for):
    user = make_user("voces@example.com")
    res = client.get("/api/agents/voices", headers=headers_for(user))
    assert res.status_code == 503
    assert "ELEVENLABS_API_KEY" in res.json()["error"]
