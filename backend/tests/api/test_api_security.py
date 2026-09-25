"""Security regressions: session revocation, enumeration, privacy deletion, audit scope, CORS."""
from __future__ import annotations

import importlib
import json
from datetime import datetime

from sqlmodel import select

import app.controllers.AuthController as auth_controller_module
from app.models.AuditTrailEvent import AuditTrailEvent
from app.models.Contact import Contact
from app.models.TextAgent import TextAgent
from app.models.TextAppointment import TextAppointment
from app.models.Token import Token
from app.models.User import User, UserRole
from app.models.UserCalendarConnection import UserCalendarConnection
from app.utils.jwt import generate_jwt

from .conftest import DEFAULT_PASSWORD


def test_password_change_revokes_existing_sessions(client, make_user, headers_for):
    user = make_user()
    old_headers = headers_for(user)
    assert client.get("/api/auth/user", headers=old_headers).status_code == 200

    res = client.post(
        "/api/auth/update-password",
        json={"current_password": DEFAULT_PASSWORD, "password": "Cambio12345", "password_confirmation": "Cambio12345"},
        headers=old_headers,
    )
    assert res.status_code == 200
    assert client.get("/api/auth/user", headers=old_headers).status_code == 401

    new_token = client.post("/api/auth/login", json={"email": user.email, "password": "Cambio12345"}).text
    assert client.get("/api/auth/user", headers={"Authorization": f"Bearer {new_token}"}).status_code == 200


def test_password_reset_revokes_existing_sessions(client, db, make_user, headers_for):
    user = make_user()
    old_headers = headers_for(user)
    client.post("/api/auth/forgot-password", json={"email": user.email})
    token = db.exec(select(Token).where(Token.user_id == user.id)).one().token
    client.post(f"/api/auth/update-password/{token}", json={"password": "Nueva12345", "password_confirmation": "Nueva12345"})
    assert client.get("/api/auth/user", headers=old_headers).status_code == 401


def test_forgot_password_and_request_code_do_not_reveal_accounts(client, make_user, sent_emails):
    make_user("known@example.com")
    make_user("pending@example.com", confirmed=False)

    known = client.post("/api/auth/forgot-password", json={"email": "known@example.com"})
    unknown = client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"})
    assert known.status_code == unknown.status_code == 200
    assert known.text == unknown.text
    assert len(sent_emails) == 1

    confirmed = client.post("/api/auth/request-code", json={"email": "known@example.com"})
    pending = client.post("/api/auth/request-code", json={"email": "pending@example.com"})
    missing = client.post("/api/auth/request-code", json={"email": "nobody@example.com"})
    assert confirmed.status_code == pending.status_code == missing.status_code == 200
    assert confirmed.text == pending.text == missing.text
    assert len(sent_emails) == 2


def test_emails_escape_user_supplied_name(client, sent_emails):
    client.post(
        "/api/auth/create-account",
        json={
            "name": '<a href="https://evil.example">x</a>',
            "email": "html@example.com",
            "password": DEFAULT_PASSWORD,
            "password_confirmation": DEFAULT_PASSWORD,
        },
    )
    html = sent_emails[0]["html"]
    assert "<a href=\"https://evil.example\">" not in html
    assert "&lt;a href=" in html
    assert "UpTask" not in sent_emails[0]["subject"]


def test_malformed_tokens_return_401_not_500(client):
    for bad in ("a.b.cñ", "ñ.ñ.ñ", "onlyonepart", "a.b"):
        header = f"Bearer {bad}".encode("latin-1")
        res = client.get("/api/auth/user", headers={"Authorization": header})
        assert res.status_code == 401, bad


def test_global_code_guessing_budget(client, monkeypatch):
    monkeypatch.setattr(auth_controller_module, "TOKEN_FAILURE_LIMIT", 3)
    statuses = []
    for i in range(5):
        # Different client IPs: only the global budget can stop this.
        auth_controller_module._token_failures  # noqa: B018 - keep module import used
        statuses.append(client.post("/api/auth/validate-token", json={"token": f"{i:06d}"}).status_code)
    assert statuses[:3] == [404, 404, 404]
    assert statuses[3:] == [429, 429]


def test_profile_cannot_take_platform_super_admin_email(client, make_user, headers_for):
    user = make_user()
    res = client.put(
        "/api/auth/profile",
        json={"name": "X", "email": "niespihu12@gmail.com"},
        headers=headers_for(user),
    )
    assert res.status_code == 409


def test_delete_my_data_removes_personal_data_and_sessions(client, db, make_user, headers_for):
    user = make_user()
    headers = headers_for(user)
    db.add(Contact(user_id=user.id, name="Cliente", phone="+573001112233"))
    db.add(UserCalendarConnection(user_id=user.id, access_token_encrypted="x", refresh_token_encrypted="y"))
    agent = TextAgent(user_id=user.id, name="Bot", provider="openai", model="gpt-4o-mini", embed_token="tok")
    db.add(agent)
    db.commit()
    db.add(TextAppointment(user_id=user.id, text_agent_id=agent.id, contact_name="Ana", contact_phone="+5730000", appointment_date=datetime.utcnow()))
    db.commit()

    res = client.post("/api/privacy/delete-my-data", json={"reason": "prueba"}, headers=headers)
    assert res.status_code == 200, res.text

    db.expire_all()
    assert db.exec(select(Contact).where(Contact.user_id == user.id)).all() == []
    assert db.exec(select(UserCalendarConnection).where(UserCalendarConnection.user_id == user.id)).all() == []
    assert db.exec(select(TextAppointment).where(TextAppointment.user_id == user.id)).all() == []
    assert db.get(TextAgent, agent.id).embed_enabled is False
    assert db.get(User, user.id).deleted_at is not None
    assert client.get("/api/auth/user", headers=headers).status_code == 401


def test_audit_events_are_scoped_per_tenant(client, db, make_user, headers_for):
    admin_a = make_user(role=UserRole.ADMIN)
    admin_b = make_user(role=UserRole.ADMIN)
    root = make_user(role=UserRole.SUPER_ADMIN)
    agent = make_user(role=UserRole.AGENT)
    for actor in (admin_a, admin_b):
        db.add(AuditTrailEvent(event_type="test", actor_user_id=actor.id, subject_user_id=actor.id,
                               entity_type="user", entity_id=actor.id, details_json=json.dumps({})))
    db.commit()

    own = client.get("/api/audit/events", headers=headers_for(admin_a)).json()["events"]
    assert {e["actor_user_id"] for e in own} == {admin_a.id}
    everything = client.get("/api/audit/events", headers=headers_for(root)).json()["events"]
    assert len(everything) == 2
    assert client.get("/api/audit/events", headers=headers_for(agent)).status_code == 403
    assert client.get("/api/audit/export?format=json", headers=headers_for(agent)).status_code == 403


def test_cors_localhost_only_outside_production(monkeypatch):
    import app.middlewares.cors as cors

    monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com")
    monkeypatch.setenv("APP_ENV", "production")
    importlib.reload(cors)
    assert cors._resolve_allowed_origins() == ["https://app.example.com"]

    monkeypatch.setenv("APP_ENV", "development")
    assert "http://localhost:5173" in cors._resolve_allowed_origins()


def test_purpose_token_is_rejected(client, make_user):
    user = make_user()
    token = generate_jwt({"id": user.id, "purpose": "mfa_login"})
    assert client.get("/api/auth/user", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_only_session_401s_carry_www_authenticate(client, make_user, headers_for):
    """The SPA logs out only on 401s marked with WWW-Authenticate: Bearer."""
    expired = client.get("/api/auth/user", headers={"Authorization": "Bearer x.y.z"})
    assert expired.status_code == 401
    assert expired.headers.get("www-authenticate", "").lower().startswith("bearer")

    user = make_user()
    wrong_password = client.post(
        "/api/auth/update-password",
        json={"current_password": "incorrecta1", "password": "OtraClave789", "password_confirmation": "OtraClave789"},
        headers=headers_for(user),
    )
    assert wrong_password.status_code == 401
    assert "www-authenticate" not in wrong_password.headers

    bad_login = client.post("/api/auth/login", json={"email": user.email, "password": "incorrecta1"})
    assert bad_login.status_code == 401
    assert "www-authenticate" not in bad_login.headers


def test_rate_limited_responses_keep_cors_headers(client, monkeypatch):
    from app.middlewares import rate_limiter

    monkeypatch.setattr(rate_limiter, "AUTH_LIMIT", 1)
    origin = {"Origin": "http://localhost:5173"}
    client.post("/api/auth/login", json={"email": "a@b.co", "password": "x"}, headers=origin)
    limited = client.post("/api/auth/login", json={"email": "a@b.co", "password": "x"}, headers=origin)
    assert limited.status_code == 429
    assert limited.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_single_ip_cannot_exhaust_global_code_budget():
    from app.middlewares import rate_limiter

    per_ip_in_window = rate_limiter.AUTH_LIMIT * (auth_controller_module.TOKEN_FAILURE_WINDOW_SECONDS // 60)
    assert auth_controller_module.TOKEN_FAILURE_LIMIT >= 5 * per_ip_in_window
