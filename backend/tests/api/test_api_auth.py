"""HTTP integration tests for /api/auth."""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlmodel import select

from app.models.Token import Token
from app.models.User import User, UserRole
from app.utils.jwt import generate_jwt

from .conftest import DEFAULT_PASSWORD


def _login(client, email, password=DEFAULT_PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_register_confirm_login_flow(client, db, sent_emails):
    res = client.post(
        "/api/auth/create-account",
        json={
            "name": "Ana",
            "email": "  Ana@Example.com ",
            "password": DEFAULT_PASSWORD,
            "password_confirmation": DEFAULT_PASSWORD,
        },
    )
    assert res.status_code == 200, res.text
    user = db.exec(select(User).where(User.email == "ana@example.com")).one()
    assert user.confirmed is False
    assert len(sent_emails) == 1

    assert _login(client, "ana@example.com").status_code == 401

    token = db.exec(select(Token).where(Token.user_id == user.id)).one()
    res = client.post("/api/auth/confirm-account", json={"token": token.token})
    assert res.status_code == 200, res.text

    res = _login(client, "ANA@example.com")
    assert res.status_code == 200, res.text
    jwt = res.text
    me = client.get("/api/auth/user", headers={"Authorization": f"Bearer {jwt}"})
    assert me.status_code == 200
    assert me.json()["email"] == "ana@example.com"
    assert me.json()["role"] == "agent"


def test_register_rejects_duplicate_and_bad_payloads(client, make_user):
    make_user("dup@example.com")
    base = {"name": "X", "password": DEFAULT_PASSWORD, "password_confirmation": DEFAULT_PASSWORD}
    assert client.post("/api/auth/create-account", json={**base, "email": "dup@example.com"}).status_code == 409
    assert client.post("/api/auth/create-account", json={**base, "email": "not-an-email"}).status_code == 400
    res = client.post(
        "/api/auth/create-account",
        json={**base, "email": "new@example.com", "password_confirmation": "different1"},
    )
    assert res.status_code == 400


def test_login_errors_do_not_reveal_whether_account_exists(client, make_user):
    make_user("real@example.com")
    unknown = _login(client, "ghost@example.com")
    wrong_pw = _login(client, "real@example.com", "WrongPassword1")
    assert unknown.status_code == wrong_pw.status_code == 401
    assert unknown.json() == wrong_pw.json()


def test_unconfirmed_login_with_wrong_password_sends_no_email(client, make_user, sent_emails):
    make_user("pending@example.com", confirmed=False)
    res = _login(client, "pending@example.com", "WrongPassword1")
    assert res.status_code == 401
    assert sent_emails == []


def test_protected_endpoint_requires_valid_token(client, make_user):
    assert client.get("/api/auth/user").status_code == 401
    assert client.get("/api/auth/user", headers={"Authorization": "Bearer garbage"}).status_code == 401
    user = make_user()
    expired = generate_jwt({"id": user.id}, expires_minutes=-1)
    assert client.get("/api/auth/user", headers={"Authorization": f"Bearer {expired}"}).status_code == 401


def test_soft_deleted_user_token_is_rejected(client, db, make_user, headers_for):
    user = make_user()
    headers = headers_for(user)
    assert client.get("/api/auth/user", headers=headers).status_code == 200
    user.deleted_at = datetime.utcnow()
    db.add(user)
    db.commit()
    assert client.get("/api/auth/user", headers=headers).status_code == 401
    assert _login(client, user.email).status_code == 401


def test_mfa_flow_and_challenge_token_cannot_be_used_as_access_token(client, db, make_user, headers_for, sent_emails):
    user = make_user("mfa@example.com")
    res = client.post("/api/auth/mfa/enable", json={"current_password": DEFAULT_PASSWORD}, headers=headers_for(user))
    assert res.status_code == 200, res.text

    res = _login(client, "mfa@example.com")
    assert res.status_code == 200
    body = res.json()
    assert body["requires_mfa"] is True
    mfa_token = body["mfa_token"]

    # The MFA challenge token must not grant API access by itself.
    bypass = client.get("/api/auth/user", headers={"Authorization": f"Bearer {mfa_token}"})
    assert bypass.status_code == 401

    wrong = client.post("/api/auth/login/mfa", json={"mfa_token": mfa_token, "code": "000000"})
    code = db.exec(select(Token).where(Token.user_id == user.id, Token.purpose == "mfa_login")).one().token
    if code == "000000":  # pragma: no cover - 1 in a million
        assert wrong.status_code == 200
        return
    assert wrong.status_code == 401

    ok = client.post("/api/auth/login/mfa", json={"mfa_token": mfa_token, "code": code})
    assert ok.status_code == 200, ok.text
    assert client.get("/api/auth/user", headers={"Authorization": f"Bearer {ok.text}"}).status_code == 200


def test_mfa_locks_after_max_attempts(client, db, make_user):
    user = make_user("lock@example.com")
    user.mfa_enabled = True
    db.add(user)
    db.commit()
    mfa_token = _login(client, "lock@example.com").json()["mfa_token"]
    code = db.exec(select(Token).where(Token.user_id == user.id, Token.purpose == "mfa_login")).one().token
    wrong = "111111" if code != "111111" else "222222"
    statuses = [
        client.post("/api/auth/login/mfa", json={"mfa_token": mfa_token, "code": wrong}).status_code
        for _ in range(5)
    ]
    assert statuses[:4] == [401] * 4
    assert statuses[4] == 429
    locked = client.post("/api/auth/login/mfa", json={"mfa_token": mfa_token, "code": code})
    assert locked.status_code == 429


def test_password_reset_flow(client, db, make_user, sent_emails):
    user = make_user("reset@example.com")
    assert client.post("/api/auth/forgot-password", json={"email": "reset@example.com"}).status_code == 200
    token = db.exec(select(Token).where(Token.user_id == user.id, Token.purpose == "password_reset")).one().token
    assert client.post("/api/auth/validate-token", json={"token": token}).status_code == 200
    new_pw = "NuevaClave456!"
    res = client.post(
        f"/api/auth/update-password/{token}",
        json={"password": new_pw, "password_confirmation": new_pw},
    )
    assert res.status_code == 200, res.text
    assert _login(client, "reset@example.com", new_pw).status_code == 200
    assert _login(client, "reset@example.com").status_code == 401
    # Token is single-use.
    assert client.post("/api/auth/validate-token", json={"token": token}).status_code == 404


def test_expired_reset_token_is_rejected(client, db, make_user):
    user = make_user()
    db.add(Token(token="123456", user_id=user.id, purpose="password_reset",
                 expires_at=datetime.utcnow() - timedelta(minutes=1)))
    db.commit()
    assert client.post("/api/auth/validate-token", json={"token": "123456"}).status_code == 404


def test_auth_token_endpoints_are_rate_limited(client):
    statuses = [
        client.post("/api/auth/validate-token", json={"token": f"{i:06d}"}).status_code
        for i in range(30)
    ]
    assert 429 in statuses, "brute forcing 6-digit reset codes must be throttled"


def test_rate_limit_cannot_be_bypassed_with_forwarded_for_header(client):
    statuses = [
        client.post(
            "/api/auth/validate-token",
            json={"token": f"{i:06d}"},
            headers={"X-Forwarded-For": f"10.0.0.{i}"},
        ).status_code
        for i in range(30)
    ]
    assert 429 in statuses


def test_change_password_and_profile(client, make_user, headers_for):
    user = make_user("me@example.com")
    other = make_user("taken@example.com")
    h = headers_for(user)
    assert client.put("/api/auth/profile", json={"name": "Nuevo", "email": other.email}, headers=h).status_code == 409
    assert client.put("/api/auth/profile", json={"name": "Nuevo", "email": "me2@example.com"}, headers=h).status_code == 200
    bad = client.post(
        "/api/auth/update-password",
        json={"current_password": "wrong-pass", "password": "OtraClave789", "password_confirmation": "OtraClave789"},
        headers=h,
    )
    assert bad.status_code == 401
    ok = client.post(
        "/api/auth/update-password",
        json={"current_password": DEFAULT_PASSWORD, "password": "OtraClave789", "password_confirmation": "OtraClave789"},
        headers=h,
    )
    assert ok.status_code == 200
    assert _login(client, "me2@example.com", "OtraClave789").status_code == 200


def test_admin_endpoints_require_super_admin(client, make_user, headers_for):
    agent = make_user(role=UserRole.AGENT)
    admin = make_user(role=UserRole.ADMIN)
    root = make_user(role=UserRole.SUPER_ADMIN)
    payload = {"email": "created@example.com", "name": "Creado", "password": DEFAULT_PASSWORD, "role": "agent"}

    assert client.get("/api/auth/admin/users", headers=headers_for(agent)).status_code == 403
    assert client.get("/api/auth/admin/users", headers=headers_for(admin)).status_code == 403
    assert client.post("/api/auth/admin/users", json=payload, headers=headers_for(agent)).status_code == 403

    listed = client.get("/api/auth/admin/users", headers=headers_for(root))
    assert listed.status_code == 200
    assert len(listed.json()["users"]) == 3

    created = client.post("/api/auth/admin/users", json=payload, headers=headers_for(root))
    assert created.status_code == 200, created.text
    assert created.json()["role"] == "agent"
    assert _login(client, "created@example.com").status_code == 200


def test_admin_create_user_rejects_unknown_role(client, make_user, headers_for):
    root = make_user(role=UserRole.SUPER_ADMIN)
    res = client.post(
        "/api/auth/admin/users",
        json={"email": "x@example.com", "name": "X", "password": DEFAULT_PASSWORD, "role": "god"},
        headers=headers_for(root),
    )
    assert res.status_code == 400
