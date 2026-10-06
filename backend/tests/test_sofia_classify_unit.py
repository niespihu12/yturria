import pytest

from app.services.sofia_graph import classify, route_intent


def _state(
    user_message: str,
    *,
    message_count: int = 0,
    already_escalated: bool = False,
    has_open_appointment: bool = False,
    config: dict | None = None,
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
        "config": config or {},
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


BANK = {"insurance_flows": False}


@pytest.mark.parametrize(
    "message",
    [
        "Me robaron la tarjeta, ¿qué hago?",
        "No reconozco una compra, creo que es fraude",
        "Me interesa la Cuenta Móvil",
        "Quiero contratar un CDT",
        "¿Cuál es el costo de la cuota de manejo?",
        "Tengo una póliza de vida deudores con mi crédito",
    ],
)
def test_without_insurance_flows_the_agent_answers_instead_of_escalating(message) -> None:
    state = _state(message, message_count=1, config=BANK)
    result = classify(state)
    assert result == {"intent": "otro"}
    assert route_intent({**state, **result}) == "respond"


@pytest.mark.parametrize("flag", [False, "false"])
def test_without_insurance_flows_asking_for_a_person_still_escalates(flag) -> None:
    result = classify(_state("Quiero hablar con un asesor", message_count=1, config={"insurance_flows": flag}))
    assert result["should_escalate"] is True
    assert result["escalation_reason"] == "user_request"


def test_without_insurance_flows_threshold_still_applies() -> None:
    result = classify(_state("¿Y la App DaviPlata?", message_count=10, config={**BANK, "escalation_threshold": 10}))
    assert result["escalation_reason"] == "auto_threshold"


def test_insurance_flows_default_keeps_claims_escalating() -> None:
    state = _state("Me robaron el carro", message_count=1)
    assert route_intent({**state, **classify(state)}) == "escalate_to_human"
