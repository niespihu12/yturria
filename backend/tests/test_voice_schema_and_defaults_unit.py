from types import SimpleNamespace

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

import app.main as main_module
from app.models.User import User, UserRole
from app.utils.client_defaults import (
    SOFIA_VOICE_PROMPT,
    apply_client_voice_defaults,
    build_client_built_in_tools,
)
from app.utils.roles import PLATFORM_SUPER_ADMIN_EMAILS


@pytest.fixture
def sqlite_engine(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(main_module, "engine", engine)
    yield engine
    engine.dispose()


def test_widen_columns_only_touches_varchar(sqlite_engine, monkeypatch) -> None:
    column_types = {
        ("voice_messages", "message_summary"): "VARCHAR(255)",
        ("voice_messages", "full_transcript"): "LONGTEXT",
        ("text_appointments", "notes"): "VARCHAR(255)",
        ("text_appointments", "google_sync_error"): "TEXT",
    }
    widened: list[tuple[str, str]] = []
    monkeypatch.setattr(
        main_module, "_get_column_type_str", lambda conn, t, c: column_types[(t, c)]
    )
    monkeypatch.setattr(
        main_module, "_make_column_not_null_text", lambda conn, t, c: widened.append((t, c))
    )

    main_module.ensure_voice_text_columns()

    assert widened == [("voice_messages", "message_summary"), ("text_appointments", "notes")]


def test_platform_super_admin_role_uses_enum_name(sqlite_engine) -> None:
    email = next(iter(PLATFORM_SUPER_ADMIN_EMAILS))
    with Session(sqlite_engine) as session:
        session.add(User(email=email, password="x", name="Admin", role=UserRole.AGENT))
        session.commit()

    main_module.ensure_platform_super_admin_role()

    with Session(sqlite_engine) as session:
        # Con 'super_admin' (valor) SQLAlchemy lanzaria LookupError al leer.
        user = session.exec(select(User).where(User.email == email)).one()
        assert user.role == UserRole.SUPER_ADMIN


def test_partial_voice_defaults_do_not_inject_prompt() -> None:
    payload = apply_client_voice_defaults(
        {"platform_settings": {"call_recording_enabled": True}}, partial=True
    )
    agent_cfg = payload["conversation_config"]["agent"]
    assert "prompt" not in agent_cfg["prompt"]
    assert "first_message" not in agent_cfg and "language" not in agent_cfg
    assert agent_cfg["prompt"]["llm"]

    full = apply_client_voice_defaults({})
    assert full["conversation_config"]["agent"]["prompt"]["prompt"] == SOFIA_VOICE_PROMPT


def test_transfers_skip_invalid_phone_numbers() -> None:
    contacts = [
        SimpleNamespace(name="Ok", last_name="", specialty="", phone="+52 55 1234 5678"),
        SimpleNamespace(name="Malo", last_name="", specialty="", phone="5512345678"),
    ]
    tools = build_client_built_in_tools(contacts)
    transfers = tools["transfer_to_number"]["params"]["transfers"]
    assert [t["phone_number"] for t in transfers] == ["+525512345678"]
