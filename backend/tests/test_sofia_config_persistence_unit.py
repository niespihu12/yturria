import asyncio
import json
from datetime import datetime

import app.models  # noqa: F401
from sqlmodel import Session, SQLModel, create_engine

from app.controllers.TextAgentController import TextAgentController
from app.models.TextAgent import TextAgent
from app.models.User import User, UserRole


def _make_session() -> Session:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def _seed_user_and_agent(session: Session) -> tuple[User, TextAgent]:
    user = User(
        email="client.sofia@example.com",
        password="secret",
        name="Client Sofia",
        role=UserRole.AGENT,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    now = datetime.utcnow()
    agent = TextAgent(
        user_id=user.id,
        name="Sofia Persistence",
        provider="openai",
        model="gpt-4.1-mini",
        system_prompt="",
        welcome_message="",
        language="es",
        temperature=0.7,
        max_tokens=512,
        sofia_mode=False,
        sofia_config_json="{}",
        created_at=now,
        updated_at=now,
    )
    session.add(agent)
    session.commit()
    session.refresh(agent)

    return user, agent


def test_update_agent_persists_sofia_config_from_sofia_config_json_for_client() -> None:
    with _make_session() as session:
        user, agent = _seed_user_and_agent(session)

        payload = {
            "sofia_mode": True,
            "sofia_config_json": json.dumps(
                {
                    "advisor_name": "Juan Perez",
                    "advisor_phone": "+5218123456789",
                    "business_name": "Yturria Seguros",
                }
            ),
        }

        result = asyncio.run(TextAgentController.update_agent(agent.id, payload, user, session))
        session.refresh(agent)

        stored = json.loads(agent.sofia_config_json or "{}")
        returned = json.loads(result.get("sofia_config_json") or "{}")

        assert agent.sofia_mode is True
        assert stored.get("advisor_name") == "Juan Perez"
        assert stored.get("advisor_phone") == "+5218123456789"
        assert returned.get("advisor_name") == "Juan Perez"
        assert returned.get("advisor_phone") == "+5218123456789"


def test_update_agent_accepts_sofia_config_dict_payload_alias() -> None:
    with _make_session() as session:
        user, agent = _seed_user_and_agent(session)

        payload = {
            "sofia_config": {
                "advisor_name": "Laura Ramos",
                "advisor_phone": "+573001112233",
            }
        }

        result = asyncio.run(TextAgentController.update_agent(agent.id, payload, user, session))
        session.refresh(agent)

        stored = json.loads(agent.sofia_config_json or "{}")
        returned = result.get("sofia_config") or {}

        assert stored.get("advisor_name") == "Laura Ramos"
        assert stored.get("advisor_phone") == "+573001112233"
        assert returned.get("advisor_name") == "Laura Ramos"
        assert returned.get("advisor_phone") == "+573001112233"
