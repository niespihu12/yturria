from datetime import datetime, timedelta, timezone

from app.controllers.AgentController import _to_unix as voice_to_unix
from app.controllers.TextAgentController import _to_unix as text_to_unix


def test_to_unix_treats_naive_datetime_as_utc() -> None:
    value = datetime(2026, 4, 20, 15, 0, 0)
    expected = int(datetime(2026, 4, 20, 15, 0, 0, tzinfo=timezone.utc).timestamp())

    assert text_to_unix(value) == expected
    assert voice_to_unix(value) == expected


def test_to_unix_normalizes_aware_datetime_to_utc() -> None:
    value = datetime(2026, 4, 20, 10, 0, 0, tzinfo=timezone(timedelta(hours=-5)))
    expected = int(datetime(2026, 4, 20, 15, 0, 0, tzinfo=timezone.utc).timestamp())

    assert text_to_unix(value) == expected
    assert voice_to_unix(value) == expected
