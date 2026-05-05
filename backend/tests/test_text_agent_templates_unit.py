from __future__ import annotations

import asyncio
import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import app.models  # noqa: F401
from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine

from app.controllers.TextAgentController import TextAgentController
from app.models.TextAgent import TextAgent
from app.models.User import User, UserRole


def _make_session() -> Session:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _run(coro):
    return asyncio.run(coro)


def _make_user(session: Session, *, role: UserRole = UserRole.AGENT) -> User:
    user = User(
        email=f"{role.value}@example.com",
        password="secret",
        name="Template Tester",
        role=role,
        confirmed=True,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def _seed_agent(
    session: Session,
    user: User,
    *,
    name: str,
    template_key: str,
    provider: str = "openai",
    model: str = "gpt-4.1-mini",
    system_prompt: str = "",
    welcome_message: str = "",
    sofia_mode: bool = False,
) -> TextAgent:
    now = datetime.utcnow()
    agent = TextAgent(
        user_id=user.id,
        name=name,
        provider=provider,
        model=model,
        template_key=template_key,
        system_prompt=system_prompt,
        welcome_message=welcome_message,
        language="es",
        temperature=0.7,
        max_tokens=512,
        sofia_mode=sofia_mode,
        sofia_config_json="{}",
        embed_enabled=True,
        embed_token="tok",
        legal_notice="",
        created_at=now,
        updated_at=now,
    )
    session.add(agent)
    session.commit()
    session.refresh(agent)
    return agent


class TestTextAgentTemplates:
    def test_list_templates_returns_catalog_and_limit(self):
        payload = _run(TextAgentController.list_templates())

        assert payload["client_agent_limit"] == 3
        assert [item["key"] for item in payload["templates"]] == [
            "sofia",
            "recepcionista",
            "faq_bot",
            "custom",
        ]

    def test_create_agent_applies_selected_template_and_provider(self):
        with _make_session() as session:
            user = _make_user(session)

            with patch(
                "app.controllers.TextAgentController._resolve_provider_api_key",
                return_value=("key", "env"),
            ), patch("app.controllers.TextAgentController._ensure_default_appointment_tool"):
                result = _run(
                    TextAgentController.create_agent(
                        {
                            "name": "Mesa principal",
                            "provider": "gemini",
                            "template_key": "custom",
                        },
                        user,
                        session,
                    )
                )

        assert result["template_key"] == "custom"
        assert result["provider"] == "gemini"
        assert result["model"] == "gemini-2.5-flash"
        assert result["system_prompt"] == ""
        assert result["welcome_message"] == ""
        assert result["sofia_mode"] is False

    def test_non_admin_cannot_create_more_than_three_agents(self):
        with _make_session() as session:
            user = _make_user(session)
            for index in range(3):
                _seed_agent(
                    session,
                    user,
                    name=f"Agente {index + 1}",
                    template_key="custom",
                )

            with patch(
                "app.controllers.TextAgentController._resolve_provider_api_key",
                return_value=("key", "env"),
            ), patch("app.controllers.TextAgentController._ensure_default_appointment_tool"):
                with pytest.raises(HTTPException) as exc_info:
                    _run(
                        TextAgentController.create_agent(
                            {
                                "name": "Cuarto agente",
                                "provider": "openai",
                                "template_key": "faq_bot",
                            },
                            user,
                            session,
                        )
                    )

        assert exc_info.value.status_code == 409
        assert "hasta 3 agentes" in str(exc_info.value.detail)

    def test_custom_template_allows_non_admin_prompt_edits(self):
        with _make_session() as session:
            user = _make_user(session)
            agent = _seed_agent(
                session,
                user,
                name="Custom",
                template_key="custom",
            )

            with patch("app.controllers.TextAgentController._ensure_default_appointment_tool"):
                result = _run(
                    TextAgentController.update_agent(
                        agent.id,
                        {
                            "system_prompt": "Eres un agente custom.",
                            "welcome_message": "Hola, soy un agente a medida.",
                            "model": "gpt-4.1",
                            "temperature": 1.1,
                            "max_tokens": 1024,
                        },
                        user,
                        session,
                    )
                )

        assert result["system_prompt"] == "Eres un agente custom."
        assert result["welcome_message"] == "Hola, soy un agente a medida."
        assert result["model"] == "gpt-4.1"
        assert result["temperature"] == 1.1
        assert result["max_tokens"] == 1024

    def test_locked_template_keeps_prompt_locked_for_non_admin(self):
        with _make_session() as session:
            user = _make_user(session)
            agent = _seed_agent(
                session,
                user,
                name="Recepcion",
                template_key="recepcionista",
                system_prompt="Prompt original",
                welcome_message="Hola original",
            )

            with patch("app.controllers.TextAgentController._ensure_default_appointment_tool"):
                result = _run(
                    TextAgentController.update_agent(
                        agent.id,
                        {
                            "system_prompt": "Prompt editado",
                            "welcome_message": "Bienvenida editada",
                            "model": "gpt-4.1",
                            "temperature": 1.4,
                        },
                        user,
                        session,
                    )
                )

        assert result["system_prompt"] == "Prompt original"
        assert result["welcome_message"] == "Hola original"
        assert result["model"] == "gpt-4.1-mini"
        assert result["temperature"] == 0.7
