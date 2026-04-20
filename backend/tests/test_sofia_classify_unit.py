from app.services.sofia_graph import classify


def _state(
    user_message: str,
    *,
    message_count: int = 0,
    already_escalated: bool = False,
    has_open_appointment: bool = False,
) -> dict:
    return {
        "messages": [],
        "user_message": user_message,
        "intent": "",
        "rag_context": "",
        "should_escalate": False,
        "escalation_reason": "",
        "message_count": message_count,
        "response": "",
        "system_prompt_override": "",
        "config": {},
        "already_escalated": already_escalated,
        "has_open_appointment": has_open_appointment,
    }


def test_followup_with_existing_appointment_stays_in_normal_flow() -> None:
    result = classify(
        _state(
            "si por favor, que horario tienen disponible",
            message_count=8,
            has_open_appointment=True,
        )
    )

    assert result["intent"] == "otro"
    assert result.get("should_escalate", False) is False


def test_escalation_phrase_triggers_escalation_once() -> None:
    result = classify(
        _state(
            "quiero hablar con un asesor humano ahora",
            message_count=1,
            already_escalated=False,
        )
    )

    assert result["intent"] == "otro"
    assert result.get("should_escalate", False) is True
    assert result.get("escalation_reason") == "user_request"


def test_escalation_phrase_does_not_repeat_after_escalated() -> None:
    result = classify(
        _state(
            "quiero hablar con un asesor humano ahora",
            message_count=5,
            already_escalated=True,
        )
    )

    assert result["intent"] == "otro"
    assert result.get("should_escalate", False) is False


def test_quote_phrase_quiero_contratar_triggers_escalation() -> None:
    result = classify(
        _state(
            "quiero contratar un seguro de auto",
            message_count=1,
            already_escalated=False,
        )
    )

    assert result["intent"] == "cotizacion"
    assert result.get("should_escalate", False) is True
    assert result.get("escalation_reason") == "user_request"
