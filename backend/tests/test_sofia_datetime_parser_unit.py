from datetime import datetime

from app.controllers.TextAgentController import _extract_requested_local_datetime_from_messages


def test_extract_weekday_and_time_from_spanish_message() -> None:
    base = datetime(2026, 4, 19, 9, 0, 0)

    result = _extract_requested_local_datetime_from_messages(
        ["el lunes a las 10:00"],
        base_local_dt=base,
    )

    assert result == datetime(2026, 4, 20, 10, 0, 0)


def test_extract_explicit_date_and_pm_meridian() -> None:
    base = datetime(2026, 4, 19, 9, 0, 0)

    result = _extract_requested_local_datetime_from_messages(
        ["agendemos para el 25/12/2030 a las 7:30 pm"],
        base_local_dt=base,
    )

    assert result == datetime(2030, 12, 25, 19, 30, 0)


def test_extract_weekday_and_afternoon_phrase() -> None:
    base = datetime(2026, 4, 20, 9, 0, 0)

    result = _extract_requested_local_datetime_from_messages(
        ["me gustaria una cita el miercoles a las 2 de la tarde"],
        base_local_dt=base,
    )

    assert result == datetime(2026, 4, 22, 14, 0, 0)
