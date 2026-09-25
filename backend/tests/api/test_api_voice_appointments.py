"""Citas de voz: orden commit/efectos externos, reprogramacion con Google y validaciones."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import Session

from app.models.TextAppointment import TextAppointment
from app.models.UserAgent import UserAgent
from app.models.UserCalendarConnection import UserCalendarConnection


@pytest.fixture
def owner(db, make_user):
    user = make_user("citas@example.com")
    db.add(UserAgent(user_id=user.id, agent_id="agentCitas"))
    db.commit()
    return user


@pytest.fixture
def google_calls(monkeypatch):
    calls: list[dict] = []

    def _fake_sync(appointment, *, operation="upsert", user_calendar_connection=None):
        calls.append({"operation": operation, "event_id": appointment.google_event_id})
        if operation == "delete":
            return {"status": "synced", "event_id": "", "calendar_id": "primary", "error": ""}
        return {
            "status": "synced",
            "event_id": appointment.google_event_id or "evt-new",
            "calendar_id": "primary",
            "error": "",
        }

    monkeypatch.setattr(
        "app.controllers.AgentController.sync_google_calendar_for_appointment", _fake_sync
    )
    return calls


def _future_iso(hours: int = 48) -> str:
    return (datetime.utcnow() + timedelta(hours=hours)).replace(microsecond=0).isoformat()


def test_appointment_is_committed_before_google_sync(
    client, owner, headers_for, google_calls, monkeypatch
):
    events: list[str] = []
    original_commit = Session.commit

    def _tracking_commit(self):
        events.append("commit")
        return original_commit(self)

    monkeypatch.setattr(Session, "commit", _tracking_commit)

    def _sync(appointment, *, operation="upsert", user_calendar_connection=None):
        events.append("google")
        return {"status": "synced", "event_id": "evt-1", "calendar_id": "primary", "error": ""}

    monkeypatch.setattr("app.controllers.AgentController.sync_google_calendar_for_appointment", _sync)

    res = client.post(
        "/api/agents/agentCitas/appointments",
        json={"appointment_date": _future_iso(), "contact_name": "Cliente"},
        headers=headers_for(owner),
    )
    assert res.status_code == 200, res.text
    assert res.json()["google_event_id"] == "evt-1"
    assert "google" in events
    assert events.index("commit") < events.index("google")


def test_reschedule_ignores_own_google_event(client, db, owner, headers_for, google_calls, monkeypatch):
    start = (datetime.utcnow() + timedelta(days=2)).replace(microsecond=0)
    appointment = TextAppointment(
        voice_agent_id="agentCitas",
        user_id=owner.id,
        contact_name="Cliente",
        appointment_date=start,
        google_event_id="evt-own",
    )
    db.add(appointment)
    db.add(
        UserCalendarConnection(
            user_id=owner.id,
            access_token_encrypted="x",
            is_default=True,
            active=True,
        )
    )
    db.commit()

    seen_excludes: list[set] = []

    def _busy(conn, time_min, time_max, *, exclude_event_ids=None):
        seen_excludes.append(set(exclude_event_ids or ()))
        own_start = start.replace(tzinfo=timezone.utc)
        if exclude_event_ids and "evt-own" in exclude_event_ids:
            return []
        return [(own_start, own_start + timedelta(minutes=45))]

    monkeypatch.setattr("app.services.google_calendar_oauth.get_busy_intervals", _busy)

    res = client.patch(
        f"/api/agents/agentCitas/appointments/{appointment.id}",
        json={"appointment_date": (start + timedelta(minutes=30)).isoformat()},
        headers=headers_for(owner),
    )
    assert res.status_code == 200, res.text
    assert seen_excludes and "evt-own" in seen_excludes[-1]
    assert google_calls[-1]["operation"] == "upsert"


@pytest.mark.parametrize("new_status", ["cancelled", "no_show"])
def test_cancel_deletes_google_event(client, db, owner, headers_for, google_calls, new_status):
    appointment = TextAppointment(
        voice_agent_id="agentCitas",
        user_id=owner.id,
        contact_name="Cliente",
        appointment_date=datetime.utcnow() + timedelta(days=3),
        google_event_id="evt-cancel",
    )
    db.add(appointment)
    db.commit()

    res = client.patch(
        f"/api/agents/agentCitas/appointments/{appointment.id}",
        json={"status": new_status},
        headers=headers_for(owner),
    )
    assert res.status_code == 200, res.text
    assert google_calls[-1] == {"operation": "delete", "event_id": "evt-cancel"}
    assert res.json()["google_event_id"] == ""


@pytest.mark.parametrize("bad_timezone", ["Nope/Zone", "America", "../etc/passwd"])
def test_invalid_timezone_returns_400(client, owner, headers_for, google_calls, bad_timezone):
    res = client.post(
        "/api/agents/agentCitas/appointments",
        json={
            "appointment_date": _future_iso(),
            "contact_name": "Cliente",
            "timezone": bad_timezone,
        },
        headers=headers_for(owner),
    )
    assert res.status_code == 400, res.text
    assert google_calls == []


def test_invalid_timezone_on_update_returns_400(client, db, owner, headers_for, google_calls):
    appointment = TextAppointment(
        voice_agent_id="agentCitas",
        user_id=owner.id,
        contact_name="Cliente",
        appointment_date=datetime.utcnow() + timedelta(days=3),
    )
    db.add(appointment)
    db.commit()
    res = client.patch(
        f"/api/agents/agentCitas/appointments/{appointment.id}",
        json={"timezone": "Mars/Base"},
        headers=headers_for(owner),
    )
    assert res.status_code == 400, res.text


def test_huge_timestamps_return_400(client, owner, headers_for, google_calls):
    headers = headers_for(owner)
    res = client.post(
        "/api/agents/agentCitas/appointments",
        json={"appointment_date": 10**20, "contact_name": "Cliente"},
        headers=headers,
    )
    assert res.status_code == 400, res.text

    res = client.get(
        "/api/agents/agentCitas/appointments", params={"from_unix": 10**18}, headers=headers
    )
    assert res.status_code == 400, res.text

