"""
Regression tests: legal notice injection on first assistant response only.

Covers:
  - _maybe_prepend_legal_notice helper (pure logic)
  - chat channel (authenticated)
  - embed channel
  - whatsapp/meta channel
  - whatsapp/twilio channel
  - existing conversation (notice must NOT appear on turn 2+)
  - agent with no legal_notice (no-op)
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import app.models  # noqa: F401
from sqlmodel import Session, SQLModel, create_engine

from app.controllers.TextAgentController import (
    TextAgentController,
    _maybe_prepend_legal_notice,
)
from app.models.TextAgent import TextAgent
from app.models.TextAgentWhatsApp import TextAgentWhatsApp
from app.models.TextConversation import TextConversation
from app.models.TextMessage import TextMessage
from app.models.User import User, UserRole

NOTICE = "AVISO LEGAL: Esta conversacion es confidencial."
LLM_REPLY = "Hola, ¿en qué puedo ayudarle?"


# ── helpers ──────────────────────────────────────────────────────────────────

def _make_session() -> Session:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _seed_base(session: Session, legal_notice: str = NOTICE) -> tuple[User, TextAgent]:
    user = User(email="test@example.com", password="x", name="Test", role=UserRole.AGENT)
    session.add(user)
    session.commit()
    session.refresh(user)

    now = datetime.utcnow()
    agent = TextAgent(
        user_id=user.id,
        name="Agent",
        provider="openai",
        model="gpt-4.1-mini",
        system_prompt="Eres un asistente.",
        welcome_message="",
        language="es",
        temperature=0.7,
        max_tokens=512,
        sofia_mode=False,
        sofia_config_json="{}",
        legal_notice=legal_notice,
        created_at=now,
        updated_at=now,
    )
    session.add(agent)
    session.commit()
    session.refresh(agent)
    return user, agent


def _seed_conversation_with_history(
    session: Session,
    agent: TextAgent,
    user: User,
    prior_turns: int = 0,
) -> TextConversation:
    now = datetime.utcnow()
    conv = TextConversation(
        text_agent_id=agent.id,
        user_id=user.id,
        title="test conv",
        created_at=now,
        updated_at=now,
    )
    session.add(conv)
    session.commit()
    session.refresh(conv)

    for i in range(prior_turns):
        session.add(TextMessage(
            conversation_id=conv.id, role="user",
            content=f"msg {i}", provider=agent.provider, model=agent.model,
        ))
        session.add(TextMessage(
            conversation_id=conv.id, role="assistant",
            content=f"reply {i}", provider=agent.provider, model=agent.model,
        ))
    session.commit()
    return conv


def _run(coro: Any) -> Any:
    return asyncio.run(coro)


# ── pure helper ──────────────────────────────────────────────────────────────

class TestMaybePrependLegalNotice:
    def test_first_turn_prepends(self):
        result = _maybe_prepend_legal_notice(LLM_REPLY, NOTICE, has_prior_assistant=False)
        assert result.startswith(NOTICE)
        assert LLM_REPLY in result

    def test_subsequent_turn_no_prepend(self):
        result = _maybe_prepend_legal_notice(LLM_REPLY, NOTICE, has_prior_assistant=True)
        assert result == LLM_REPLY
        assert NOTICE not in result

    def test_no_notice_configured(self):
        result = _maybe_prepend_legal_notice(LLM_REPLY, "", has_prior_assistant=False)
        assert result == LLM_REPLY

    def test_whitespace_only_notice(self):
        result = _maybe_prepend_legal_notice(LLM_REPLY, "   ", has_prior_assistant=False)
        assert result == LLM_REPLY

    def test_format_separator(self):
        result = _maybe_prepend_legal_notice(LLM_REPLY, NOTICE, has_prior_assistant=False)
        assert result == f"{NOTICE}\n\n{LLM_REPLY}"


# ── chat (authenticated) ──────────────────────────────────────────────────────

class TestChatChannel:
    def _call_chat(self, session, agent, user, conversation_id=""):
        payload = {"message": "hola", "conversation_id": conversation_id}

        current_user = MagicMock()
        current_user.id = user.id

        with patch(
            "app.controllers.TextAgentController._dispatch_llm_with_optional_tool_execution",
            return_value=(LLM_REPLY, 10),
        ), patch(
            "app.controllers.TextAgentController._resolve_provider_api_key",
            return_value=("key", None),
        ), patch(
            "app.controllers.TextAgentController._retrieve_rag_context",
            return_value="",
        ), patch(
            "app.controllers.TextAgentController._require_owned_text_agent",
            return_value=agent,
        ), patch(
            "app.controllers.TextAgentController._ensure_default_appointment_tool",
        ), patch(
            "app.controllers.TextAgentController._list_agent_tools",
            return_value=[],
        ), patch(
            "app.controllers.TextAgentController._build_tools_description",
            return_value="",
        ):
            return _run(TextAgentController.chat(agent.id, payload, current_user, session))

    def test_first_message_includes_notice(self):
        with _make_session() as session:
            user, agent = _seed_base(session)
            result = self._call_chat(session, agent, user)
            assert result["response"].startswith(NOTICE)

    def test_second_message_excludes_notice(self):
        with _make_session() as session:
            user, agent = _seed_base(session)
            conv = _seed_conversation_with_history(session, agent, user, prior_turns=1)
            result = self._call_chat(session, agent, user, conversation_id=conv.id)
            assert NOTICE not in result["response"]
            assert result["response"] == LLM_REPLY

    def test_no_notice_configured(self):
        with _make_session() as session:
            user, agent = _seed_base(session, legal_notice="")
            result = self._call_chat(session, agent, user)
            assert result["response"] == LLM_REPLY


# ── embed ─────────────────────────────────────────────────────────────────────

class TestEmbedChannel:
    def _call_embed(self, session, agent, conversation_id=""):
        token = "tok123"
        agent.embed_token = token
        agent.embed_enabled = True
        session.add(agent)
        session.commit()

        payload = {
            "message": "hola",
            "token": token,
            "session_id": "sess-abc",
            "conversation_id": conversation_id,
        }

        with patch(
            "app.controllers.TextAgentController._dispatch_llm_with_optional_tool_execution",
            return_value=(LLM_REPLY, 10),
        ), patch(
            "app.controllers.TextAgentController._resolve_provider_api_key",
            return_value=("key", None),
        ), patch(
            "app.controllers.TextAgentController._retrieve_rag_context",
            return_value="",
        ), patch(
            "app.controllers.TextAgentController._require_public_embed_agent",
            return_value=agent,
        ), patch(
            "app.controllers.TextAgentController._ensure_default_appointment_tool",
        ), patch(
            "app.controllers.TextAgentController._list_agent_tools",
            return_value=[],
        ), patch(
            "app.controllers.TextAgentController._build_tools_description",
            return_value="",
        ):
            return _run(
                TextAgentController.public_embed_chat(agent.id, payload, session)
            )

    def test_first_embed_message_includes_notice(self):
        with _make_session() as session:
            user, agent = _seed_base(session)
            result = self._call_embed(session, agent)
            assert result["response"].startswith(NOTICE)

    def test_second_embed_message_excludes_notice(self):
        with _make_session() as session:
            user, agent = _seed_base(session)
            conv = _seed_conversation_with_history(session, agent, user, prior_turns=1)
            conv.title = "embed:sess-abc"
            session.add(conv)
            session.commit()
            result = self._call_embed(session, agent, conversation_id=conv.id)
            assert NOTICE not in result["response"]


# ── whatsapp (meta + twilio share same handler) ───────────────────────────────

class TestWhatsAppChannel:
    def _seed_wa_config(self, session, agent, provider="meta"):
        config = TextAgentWhatsApp(
            text_agent_id=agent.id,
            provider=provider,
            phone_number="+57300000000",
            webhook_verify_token="tok",
            active=True,
        )
        session.add(config)
        session.commit()
        session.refresh(config)
        return config

    def _call_wa(self, session, config_id, sender="+57311111111"):
        with patch(
            "app.controllers.TextAgentController._dispatch_llm_with_optional_tool_execution",
            return_value=(LLM_REPLY, 10),
        ), patch(
            "app.controllers.TextAgentController._retrieve_rag_context",
            return_value="",
        ), patch(
            "app.controllers.TextAgentController._ensure_default_appointment_tool",
        ), patch(
            "app.controllers.TextAgentController._list_agent_tools",
            return_value=[],
        ), patch(
            "app.controllers.TextAgentController._build_tools_description",
            return_value="",
        ), patch(
            "app.controllers.TextAgentController._get_env_provider_key",
            return_value="env-key",
        ):
            return _run(
                TextAgentController.handle_whatsapp_incoming(
                    config_id, sender, "hola", session
                )
            )

    def test_meta_first_message_includes_notice(self):
        with _make_session() as session:
            user, agent = _seed_base(session)
            config = self._seed_wa_config(session, agent, provider="meta")
            reply = self._call_wa(session, config.id)
            assert reply.startswith(NOTICE)

    def test_meta_second_message_excludes_notice(self):
        with _make_session() as session:
            user, agent = _seed_base(session)
            config = self._seed_wa_config(session, agent, provider="meta")
            sender = "+57311111111"
            _seed_conversation_with_history_wa(session, agent, user, sender, prior_turns=1)
            reply = self._call_wa(session, config.id, sender=sender)
            assert NOTICE not in reply
            assert reply == LLM_REPLY

    def test_twilio_first_message_includes_notice(self):
        with _make_session() as session:
            user, agent = _seed_base(session)
            config = self._seed_wa_config(session, agent, provider="twilio")
            reply = self._call_wa(session, config.id)
            assert reply.startswith(NOTICE)

    def test_no_notice_configured_whatsapp(self):
        with _make_session() as session:
            user, agent = _seed_base(session, legal_notice="")
            config = self._seed_wa_config(session, agent, provider="meta")
            reply = self._call_wa(session, config.id)
            assert reply == LLM_REPLY


def _seed_conversation_with_history_wa(
    session: Session,
    agent: TextAgent,
    user: User,
    sender: str,
    prior_turns: int = 0,
) -> TextConversation:
    now = datetime.utcnow()
    wa_title = f"whatsapp:{sender}"
    conv = TextConversation(
        text_agent_id=agent.id,
        user_id=user.id,
        title=wa_title,
        created_at=now,
        updated_at=now,
    )
    session.add(conv)
    session.commit()
    session.refresh(conv)

    for i in range(prior_turns):
        session.add(TextMessage(
            conversation_id=conv.id, role="user",
            content=f"msg {i}", provider=agent.provider, model=agent.model,
        ))
        session.add(TextMessage(
            conversation_id=conv.id, role="assistant",
            content=f"reply {i}", provider=agent.provider, model=agent.model,
        ))
    session.commit()
    return conv
