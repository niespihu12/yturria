"""Fixtures for HTTP-level integration tests (FastAPI TestClient + in-memory SQLite)."""
from __future__ import annotations

from typing import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

import app.models  # noqa: F401
import app.controllers.AuthController as auth_controller_module
from app.controllers.deps.db_session import get_db
from app.main import app
from app.middlewares import rate_limiter
from app.models.User import User, UserRole
from app.utils.auth import hash_password
from app.utils.jwt import generate_jwt

DEFAULT_PASSWORD = "Password123!"


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    stores = (
        rate_limiter._ip_hits,
        rate_limiter._user_hits,
        rate_limiter._auth_hits,
        auth_controller_module._token_failures,
    )
    for store in stores:
        store.clear()
    yield
    for store in stores:
        store.clear()


@pytest.fixture
def sent_emails(monkeypatch) -> list[dict]:
    outbox: list[dict] = []

    def _capture(**kwargs):
        outbox.append(kwargs)

    monkeypatch.setattr("app.services.AuthEmail.send_email_async", _capture)
    monkeypatch.setattr("app.controllers.TextAgentController.send_email_async", _capture)
    return outbox


@pytest.fixture
def engine():
    test_engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(test_engine)
    yield test_engine
    test_engine.dispose()


@pytest.fixture
def db(engine):
    with Session(engine, expire_on_commit=False) as session:
        yield session


@pytest.fixture
def client(engine, sent_emails):
    def _get_test_db():
        with Session(engine, expire_on_commit=False) as session:
            yield session

    app.dependency_overrides[get_db] = _get_test_db
    # No context manager: skips the lifespan (tunnel, MySQL migrations, scheduler).
    test_client = TestClient(app, raise_server_exceptions=False)
    yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def make_user(db) -> Callable[..., User]:
    counter = {"n": 0}

    def _make(
        email: str | None = None,
        *,
        password: str = DEFAULT_PASSWORD,
        role: UserRole = UserRole.AGENT,
        confirmed: bool = True,
        name: str = "Usuario Prueba",
    ) -> User:
        counter["n"] += 1
        user = User(
            email=email or f"user{counter['n']}@example.com",
            password=hash_password(password),
            name=name,
            role=role,
            confirmed=confirmed,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    return _make


def auth_headers(user: User) -> dict[str, str]:
    token = generate_jwt({"id": user.id, "tv": user.token_version or 0})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def headers_for() -> Callable[[User], dict[str, str]]:
    return auth_headers
