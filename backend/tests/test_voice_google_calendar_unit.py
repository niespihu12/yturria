from datetime import datetime, timedelta, timezone

from google.auth.exceptions import RefreshError

from app.models.TextAppointment import TextAppointment
from app.models.UserCalendarConnection import UserCalendarConnection
from app.services import google_calendar_oauth
from app.services.google_calendar import _build_event_payload
from app.utils.crypto import encrypt_secret


def _connection(**overrides) -> UserCalendarConnection:
    values = {
        "user_id": "user_1",
        "access_token_encrypted": encrypt_secret("access"),
        "refresh_token_encrypted": encrypt_secret("refresh"),
        "is_default": True,
        "active": True,
    }
    values.update(overrides)
    return UserCalendarConnection(**values)


def test_event_payload_sends_utc_offset() -> None:
    appointment = TextAppointment(
        user_id="user_1",
        appointment_date=datetime(2026, 4, 20, 15, 0, 0),  # 10:00 en Bogota
        timezone="America/Bogota",
    )
    payload = _build_event_payload(appointment)

    assert payload["start"]["dateTime"] == "2026-04-20T15:00:00+00:00"
    assert payload["end"]["dateTime"] == "2026-04-20T15:45:00+00:00"
    start = datetime.fromisoformat(payload["start"]["dateTime"])
    assert start.astimezone(timezone(timedelta(hours=-5))).hour == 10


def test_invalid_grant_deactivates_connection(monkeypatch) -> None:
    def _refresh(self, request):
        raise RefreshError("invalid_grant: Token has been expired or revoked.")

    monkeypatch.setattr(google_calendar_oauth.Credentials, "refresh", _refresh)
    conn = _connection(token_expires_at=datetime.utcnow() - timedelta(minutes=5))

    assert google_calendar_oauth.list_events(conn, datetime.utcnow(), datetime.utcnow()) == []
    assert conn.active is False
    assert conn.is_default is False


def test_transient_refresh_error_keeps_connection(monkeypatch) -> None:
    def _refresh(self, request):
        raise RefreshError("temporarily_unavailable")

    monkeypatch.setattr(google_calendar_oauth.Credentials, "refresh", _refresh)
    conn = _connection(token_expires_at=datetime.utcnow() - timedelta(minutes=5))

    assert google_calendar_oauth.list_user_calendars(conn) == []
    assert conn.active is True


def test_undecryptable_tokens_return_empty() -> None:
    conn = _connection(access_token_encrypted="corrupto")
    assert google_calendar_oauth.list_user_calendars(conn) == []
    assert google_calendar_oauth.get_busy_intervals(conn, datetime.utcnow(), datetime.utcnow()) == []


class _FakeRequest:
    def __init__(self, result):
        self._result = result

    def execute(self):
        return self._result


class _FakeService:
    def __init__(self, items):
        self._items = items

    def events(self):
        return self

    def list(self, **kwargs):
        return _FakeRequest({"items": self._items})


def test_busy_intervals_skip_excluded_events(monkeypatch) -> None:
    items = [
        {
            "id": "evt-own",
            "start": {"dateTime": "2026-05-01T15:00:00Z"},
            "end": {"dateTime": "2026-05-01T15:45:00Z"},
        },
        {
            "id": "evt-other",
            "start": {"dateTime": "2026-05-01T17:00:00-05:00"},
            "end": {"dateTime": "2026-05-01T18:00:00-05:00"},
        },
    ]
    monkeypatch.setattr(google_calendar_oauth, "build", lambda *a, **k: _FakeService(items))

    intervals = google_calendar_oauth.get_busy_intervals(
        _connection(),
        datetime(2026, 5, 1, tzinfo=timezone.utc),
        datetime(2026, 5, 2, tzinfo=timezone.utc),
        exclude_event_ids={"evt-own"},
    )
    assert intervals == [
        (
            datetime(2026, 5, 1, 22, 0, tzinfo=timezone.utc),
            datetime(2026, 5, 1, 23, 0, tzinfo=timezone.utc),
        )
    ]
