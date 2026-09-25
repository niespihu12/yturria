"""OAuth de Google Calendar: state cifrado, redirects seguros y manejo de conexiones."""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import pytest
from sqlmodel import select

from app.models.User import UserRole
from app.models.UserCalendarConnection import UserCalendarConnection
from app.routes import calendars_router
from app.utils.crypto import encrypt_secret


@pytest.fixture
def captured_state(monkeypatch):
    captured: dict = {}

    def _fake_build_auth_url(*, state, code_verifier=None):
        captured["state"] = state
        captured["verifier"] = code_verifier
        return f"https://accounts.google.com/o/oauth2/auth?state={state}", code_verifier

    monkeypatch.setattr(calendars_router, "build_auth_url", _fake_build_auth_url)
    return captured


@pytest.fixture
def exchange_calls(monkeypatch):
    calls: list[dict] = []

    def _fake_exchange(*, code, code_verifier=""):
        calls.append({"code": code, "code_verifier": code_verifier})
        return {
            "access_token": "new-access",
            "refresh_token": "new-refresh",
            "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        }

    monkeypatch.setattr(calendars_router, "exchange_code", _fake_exchange)
    return calls


def _start_auth(client, headers, redirect_after="/citas") -> None:
    res = client.get(
        "/api/calendars/google/auth", params={"redirect_after": redirect_after}, headers=headers
    )
    assert res.status_code == 200, res.text


def test_state_is_opaque_and_callback_uses_it(
    client, db, make_user, headers_for, captured_state, exchange_calls
):
    user = make_user("cal@example.com")
    previous = UserCalendarConnection(
        user_id=user.id,
        access_token_encrypted=encrypt_secret("old-access"),
        refresh_token_encrypted=encrypt_secret("old-refresh"),
        is_default=True,
        active=True,
    )
    db.add(previous)
    db.commit()

    _start_auth(client, headers_for(user), redirect_after="/agenda")
    state = captured_state["state"]
    assert user.id not in state
    assert captured_state["verifier"] not in state

    res = client.get(
        "/api/calendars/google/callback",
        params={"code": "abc", "state": state},
        follow_redirects=False,
    )
    assert res.status_code in (302, 307), res.text
    location = urlparse(res.headers["location"])
    assert location.path == "/agenda"
    assert parse_qs(location.query) == {"calendar_connected": ["1"]}
    assert exchange_calls == [{"code": "abc", "code_verifier": captured_state["verifier"]}]

    db.expire_all()
    rows = db.exec(
        select(UserCalendarConnection).where(UserCalendarConnection.user_id == user.id)
    ).all()
    active = [row for row in rows if row.active]
    assert len(active) == 1 and active[0].id != previous.id
    old = next(row for row in rows if row.id == previous.id)
    assert old.active is False and old.refresh_token_encrypted == ""


@pytest.mark.parametrize(
    "state",
    [
        "",
        "victim-user-id:/citas:verifier",
        encrypt_secret(json.dumps({"uid": "x", "cv": "y", "r": "/citas", "exp": int(time.time()) - 5})),
    ],
)
def test_invalid_or_expired_state_is_rejected(client, db, exchange_calls, state):
    res = client.get(
        "/api/calendars/google/callback",
        params={"code": "abc", "state": state},
        follow_redirects=False,
    )
    assert res.status_code == 400
    assert exchange_calls == []
    assert db.exec(select(UserCalendarConnection)).all() == []


@pytest.mark.parametrize("redirect_after", ["//evil.com", ".evil.com", "https://evil.com", "/\\evil.com"])
def test_open_redirect_is_blocked(
    client, make_user, headers_for, captured_state, exchange_calls, redirect_after
):
    user = make_user("redir@example.com")
    _start_auth(client, headers_for(user), redirect_after=redirect_after)
    res = client.get(
        "/api/calendars/google/callback",
        params={"code": "abc", "state": captured_state["state"]},
        follow_redirects=False,
    )
    location = urlparse(res.headers["location"])
    assert location.netloc == urlparse(calendars_router.FRONTEND_URL).netloc
    assert location.path == "/citas"


def test_google_error_redirects_to_frontend(client, make_user, headers_for, captured_state):
    user = make_user("deny@example.com")
    _start_auth(client, headers_for(user), redirect_after="/agenda")
    res = client.get(
        "/api/calendars/google/callback",
        params={"error": "access_denied", "state": captured_state["state"]},
        follow_redirects=False,
    )
    assert res.status_code in (302, 307)
    location = urlparse(res.headers["location"])
    assert location.path == "/agenda"
    assert parse_qs(location.query) == {"calendar_error": ["access_denied"]}


def test_auth_error_does_not_leak_exception(client, make_user, headers_for):
    # Sin GOOGLE_OAUTH_CLIENT_ID en tests: build_auth_url falla internamente.
    user = make_user("noconf@example.com")
    res = client.get("/api/calendars/google/auth", headers=headers_for(user))
    assert res.status_code == 503
    assert "no configurado" not in res.text


def test_super_admin_delete_missing_connection_is_404(client, make_user, headers_for):
    admin = make_user("admin@example.com", role=UserRole.SUPER_ADMIN)
    res = client.delete("/api/calendars/no-existe", headers=headers_for(admin))
    assert res.status_code == 404


def test_events_with_huge_timestamp_return_400(client, db, make_user, headers_for):
    user = make_user("events@example.com")
    db.add(
        UserCalendarConnection(
            user_id=user.id,
            access_token_encrypted=encrypt_secret("tok"),
            is_default=True,
            active=True,
        )
    )
    db.commit()
    res = client.get(
        "/api/calendars/google/events",
        params={"from_unix": 10**18, "to_unix": 10**18 + 1},
        headers=headers_for(user),
    )
    assert res.status_code == 400, res.text


def test_undecryptable_token_does_not_500(client, db, make_user, headers_for):
    user = make_user("corrupt@example.com")
    conn = UserCalendarConnection(
        user_id=user.id,
        access_token_encrypted="no-es-fernet",
        is_default=True,
        active=True,
    )
    db.add(conn)
    db.commit()
    res = client.get(f"/api/calendars/{conn.id}/calendars", headers=headers_for(user))
    assert res.status_code == 200, res.text
    assert res.json() == {"calendars": []}
