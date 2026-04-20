from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import app.models  # noqa: F401
from sqlmodel import Session, SQLModel, create_engine, select

from app.controllers.TextAgentController import _maybe_auto_create_appointment_from_sofia
from app.models.TextAgent import TextAgent
from app.models.TextAppointment import TextAppointment
from app.models.TextConversation import TextConversation
from app.models.User import User, UserRole


def _make_session() -> Session:
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine)
    return Session(engine)


def test_sofia_auto_creates_appointment_when_contact_detected() -> None:
    with _make_session() as session:
        user = User(
            email="cliente@example.com",
            password="secret",
            name="Cliente",
            role=UserRole.AGENT,
        )
        session.add(user)
        session.commit()
        session.refresh(user)

        now = datetime.utcnow()
        agent = TextAgent(
            user_id=user.id,
            name="Sofia Test",
            provider="openai",
            model="gpt-4.1-mini",
            system_prompt="",
            welcome_message="",
            language="es",
            temperature=0.2,
            max_tokens=300,
            sofia_mode=True,
            sofia_config_json="{}",
            created_at=now,
            updated_at=now,
        )
        session.add(agent)
        session.commit()
        session.refresh(agent)

        conversation = TextConversation(
            text_agent_id=agent.id,
            user_id=user.id,
            title="Chat de prueba",
            created_at=now,
            updated_at=now,
        )
        session.add(conversation)
        session.commit()
        session.refresh(conversation)

        history = [
            {"role": "user", "content": "Quiero agendar una cita para mañana"},
            {"role": "assistant", "content": "Claro, compárteme tus datos"},
        ]

        _maybe_auto_create_appointment_from_sofia(
            agent=agent,
            conversation=conversation,
            history=history,
            user_message="Soy Laura Gómez, mi correo es laura@example.com y mi celular es +573001112233",
            session=session,
            sender_phone="+573001112233",
        )
        session.commit()

        appointments = session.exec(select(TextAppointment)).all()
        assert len(appointments) == 1
        assert appointments[0].text_agent_id == agent.id
        assert appointments[0].contact_email == "laura@example.com"
        assert appointments[0].contact_phone in {"+573001112233", "573001112233"}


def test_sofia_does_not_duplicate_open_appointment() -> None:
    with _make_session() as session:
        user = User(
            email="cliente2@example.com",
            password="secret",
            name="Cliente 2",
            role=UserRole.AGENT,
        )
        session.add(user)
        session.commit()
        session.refresh(user)

        now = datetime.utcnow()
        agent = TextAgent(
            user_id=user.id,
            name="Sofia Test 2",
            provider="openai",
            model="gpt-4.1-mini",
            system_prompt="",
            welcome_message="",
            language="es",
            temperature=0.2,
            max_tokens=300,
            sofia_mode=True,
            sofia_config_json="{}",
            created_at=now,
            updated_at=now,
        )
        session.add(agent)
        session.commit()
        session.refresh(agent)

        conversation = TextConversation(
            text_agent_id=agent.id,
            user_id=user.id,
            title="Chat de prueba 2",
            created_at=now,
            updated_at=now,
        )
        session.add(conversation)
        session.commit()
        session.refresh(conversation)

        history = [{"role": "user", "content": "Deseo agendar una cita"}]

        _maybe_auto_create_appointment_from_sofia(
            agent=agent,
            conversation=conversation,
            history=history,
            user_message="Mi nombre es Carlos, mi celular es +573004445566",
            session=session,
            sender_phone="+573004445566",
        )
        session.commit()

        _maybe_auto_create_appointment_from_sofia(
            agent=agent,
            conversation=conversation,
            history=history,
            user_message="¿Me confirma por favor?",
            session=session,
            sender_phone="+573004445566",
        )
        session.commit()

        appointments = session.exec(select(TextAppointment)).all()
        assert len(appointments) == 1


def test_sofia_updates_existing_appointment_with_followup_datetime() -> None:
    with _make_session() as session:
        user = User(
            email="cliente3@example.com",
            password="secret",
            name="Cliente 3",
            role=UserRole.AGENT,
        )
        session.add(user)
        session.commit()
        session.refresh(user)

        now = datetime.utcnow()
        agent = TextAgent(
            user_id=user.id,
            name="Sofia Test 3",
            provider="openai",
            model="gpt-4.1-mini",
            system_prompt="",
            welcome_message="",
            language="es",
            temperature=0.2,
            max_tokens=300,
            sofia_mode=True,
            sofia_config_json="{}",
            created_at=now,
            updated_at=now,
        )
        session.add(agent)
        session.commit()
        session.refresh(agent)

        conversation = TextConversation(
            text_agent_id=agent.id,
            user_id=user.id,
            title="Chat de prueba 3",
            created_at=now,
            updated_at=now,
        )
        session.add(conversation)
        session.commit()
        session.refresh(conversation)

        first_history = [{"role": "user", "content": "Quiero agendar una cita"}]
        _maybe_auto_create_appointment_from_sofia(
            agent=agent,
            conversation=conversation,
            history=first_history,
            user_message="Nicolas Pinzon, +573134869103, que horas tienes disponible?",
            session=session,
            sender_phone="+573134869103",
        )
        session.commit()

        first_appointment = session.exec(select(TextAppointment)).first()
        assert first_appointment is not None
        assert first_appointment.contact_name == "Nicolas Pinzon"

        followup_history = first_history + [
            {
                "role": "user",
                "content": "Nicolas Pinzon, +573134869103, que horas tienes disponible?",
            }
        ]
        _maybe_auto_create_appointment_from_sofia(
            agent=agent,
            conversation=conversation,
            history=followup_history,
            user_message="el lunes a las 10:00",
            session=session,
            sender_phone="+573134869103",
        )
        session.commit()

        appointments = session.exec(select(TextAppointment)).all()
        assert len(appointments) == 1

        updated = appointments[0]
        localized = (
            updated.appointment_date.replace(tzinfo=timezone.utc)
            .astimezone(ZoneInfo(updated.timezone or "America/Bogota"))
            .replace(tzinfo=None)
        )
        assert localized.weekday() == 0
        assert localized.hour == 10
        assert localized.minute == 0
