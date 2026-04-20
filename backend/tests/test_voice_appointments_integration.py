import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace

import app.models  # noqa: F401
from sqlmodel import Session, SQLModel, create_engine

from app.controllers.AgentController import AgentController
from app.models.User import User, UserRole
from app.models.UserAgent import UserAgent


def _make_session() -> Session:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def test_voice_appointment_crud_flow() -> None:
    with _make_session() as session:
        user = User(
            email="voice-owner@example.com",
            password="secret",
            name="Voice Owner",
            role=UserRole.AGENT,
        )
        session.add(user)
        session.commit()
        session.refresh(user)

        agent_id = "voice_agent_test_1"
        session.add(UserAgent(user_id=user.id, agent_id=agent_id))
        session.commit()

        current_user = SimpleNamespace(id=user.id, role=UserRole.AGENT.value)

        create_payload = {
            "appointment_date": (datetime.utcnow() + timedelta(days=1)).isoformat(),
            "contact_name": "Cliente Voz",
            "contact_phone": "+573009998877",
            "timezone": "America/Bogota",
            "source": "voice",
            "notes": "Agendada desde prueba de integración",
        }

        created = asyncio.run(
            AgentController.create_appointment(agent_id, create_payload, current_user, session)
        )

        assert created["voice_agent_id"] == agent_id
        assert created["text_agent_id"] is None
        assert created["status"] == "scheduled"

        listed = asyncio.run(
            AgentController.list_appointments(agent_id, current_user, session, limit=50)
        )
        assert len(listed["appointments"]) == 1

        appointment_id = listed["appointments"][0]["id"]

        updated = asyncio.run(
            AgentController.update_appointment(
                agent_id,
                appointment_id,
                {"status": "confirmed"},
                current_user,
                session,
            )
        )
        assert updated["status"] == "confirmed"

        deleted = asyncio.run(
            AgentController.delete_appointment(agent_id, appointment_id, current_user, session)
        )
        assert deleted["deleted"] is True

        listed_after_delete = asyncio.run(
            AgentController.list_appointments(agent_id, current_user, session, limit=50)
        )
        assert listed_after_delete["appointments"] == []
