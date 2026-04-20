from datetime import datetime, timedelta

from app.models.TextAppointment import TextAppointment
from app.services.google_calendar import sync_google_calendar_for_appointment


def _sample_appointment() -> TextAppointment:
    return TextAppointment(
        text_agent_id="text_agent_1",
        user_id="user_1",
        conversation_id="conv_1",
        contact_name="Cliente",
        contact_phone="+573001112233",
        contact_email="cliente@example.com",
        appointment_date=datetime.utcnow() + timedelta(hours=4),
        timezone="America/Bogota",
        status="scheduled",
        source="manual",
        notes="Prueba",
    )


def test_google_sync_returns_not_configured_when_disabled(monkeypatch) -> None:
    monkeypatch.delenv("GOOGLE_CALENDAR_ENABLED", raising=False)
    monkeypatch.delenv("GOOGLE_SERVICE_ACCOUNT_JSON", raising=False)
    monkeypatch.delenv("GOOGLE_SERVICE_ACCOUNT_FILE", raising=False)
    monkeypatch.delenv("GOOGLE_CALENDAR_ID", raising=False)

    result = sync_google_calendar_for_appointment(_sample_appointment(), operation="upsert")

    assert result["status"] == "not_configured"
    assert result["event_id"] == ""
    assert result["calendar_id"] == "primary"


def test_google_sync_reports_missing_credentials_when_enabled(monkeypatch) -> None:
    monkeypatch.setenv("GOOGLE_CALENDAR_ENABLED", "true")
    monkeypatch.delenv("GOOGLE_SERVICE_ACCOUNT_JSON", raising=False)
    monkeypatch.delenv("GOOGLE_SERVICE_ACCOUNT_FILE", raising=False)

    result = sync_google_calendar_for_appointment(_sample_appointment(), operation="upsert")

    assert result["status"] in {"not_configured", "error"}
    assert isinstance(result["error"], str)
