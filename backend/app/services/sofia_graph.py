from __future__ import annotations

import logging
from typing import Annotated, Any, TypedDict

from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from app.services.sofia_config import SofiaConfig, DEFAULT_CONFIG
from app.services.sofia_prompts import (
    CLASSIFY_PROMPT,
    ESCALATION_MESSAGE,
    ESCALATION_PHRASES,
    GUARD_PROMPT,
    SOFIA_SYSTEM_PROMPT,
)

logger = logging.getLogger(__name__)


class SofiaState(TypedDict):
    messages: Annotated[list, add_messages]
    user_message: str
    intent: str
    rag_context: str
    should_escalate: bool
    escalation_reason: str
    message_count: int
    response: str
    system_prompt_override: str
    config: dict[str, Any]
    already_escalated: bool
    has_open_appointment: bool


def _coerce_config(raw_config: dict[str, Any] | None) -> SofiaConfig:
    if not isinstance(raw_config, dict):
        return DEFAULT_CONFIG

    normalized: dict[str, Any] = {}
    allowed_keys = set(SofiaConfig.__dataclass_fields__.keys())

    for key in allowed_keys:
        if key in raw_config:
            normalized[key] = raw_config[key]

    # Compatibilidad con configuraciones guardadas desde UI previa.
    if "business_name" in raw_config and "company_name" not in normalized:
        normalized["company_name"] = raw_config.get("business_name")

    if "escalation_phrases" in raw_config and "extra_escalation_phrases" not in normalized:
        phrases = raw_config.get("escalation_phrases")
        if isinstance(phrases, list):
            normalized["extra_escalation_phrases"] = [
                str(item).strip() for item in phrases if str(item).strip()
            ]

    if "escalation_threshold" in normalized:
        try:
            normalized["escalation_threshold"] = max(1, min(20, int(normalized["escalation_threshold"])))
        except (TypeError, ValueError):
            normalized.pop("escalation_threshold", None)

    try:
        return SofiaConfig(**normalized)
    except TypeError:
        logger.warning("Configuración Sofía inválida, usando defaults", exc_info=True)
        return DEFAULT_CONFIG


# ── Nodes ────────────────────────────────────────────────────────────────────

def classify(state: SofiaState) -> dict:
    user_msg = state["user_message"]
    config = _coerce_config(state.get("config"))
    already_escalated = bool(state.get("already_escalated", False))
    has_open_appointment = bool(state.get("has_open_appointment", False))

    lower_msg = user_msg.lower()
    compact_msg = lower_msg.strip()

    scheduling_followup_keywords = [
        "horario",
        "hora",
        "disponible",
        "llamada",
        "whatsapp",
        "mañana",
        "tarde",
        "noche",
        "si porfavor",
        "sí por favor",
        "por favor",
    ]

    if has_open_appointment and (
        compact_msg in {"si", "sí", "si porfavor", "sí por favor", "por favor"}
        or any(keyword in lower_msg for keyword in scheduling_followup_keywords)
    ):
        return {"intent": "otro"}

    quote_keywords = [
        "cotiz",
        "precio",
        "costo",
        "contratar",
        "poliza",
        "asegurar",
    ]
    claim_keywords = [
        "siniestro",
        "accidente",
        "robo",
        "choque",
        "reclamo",
        "reclamacion",
        "reclamación",
    ]
    renewal_keywords = [
        "renov",
        "venc",
        "vigencia",
        "continuidad",
        "renueva",
    ]

    if any(keyword in lower_msg for keyword in claim_keywords):
        return {"intent": "siniestro"}
    if any(keyword in lower_msg for keyword in renewal_keywords):
        return {"intent": "renovacion"}

    for phrase in ESCALATION_PHRASES + config.extra_escalation_phrases:
        if phrase in lower_msg:
            if already_escalated:
                return {"intent": "otro"}

            phrase_intent = "cotizacion" if any(
                keyword in lower_msg for keyword in quote_keywords
            ) else "otro"
            return {
                "intent": phrase_intent,
                "should_escalate": True,
                "escalation_reason": "user_request",
            }

    if any(keyword in lower_msg for keyword in quote_keywords):
        return {"intent": "cotizacion"}

    if (
        state["message_count"] >= config.escalation_threshold
        and not already_escalated
        and not has_open_appointment
    ):
        return {
            "intent": "otro",
            "should_escalate": True,
            "escalation_reason": "auto_threshold",
        }

    llm = ChatOpenAI(
        model=config.model,
        temperature=0.0,
        max_tokens=20,
    )

    prompt = CLASSIFY_PROMPT.format(user_message=user_msg)
    result = llm.invoke([HumanMessage(content=prompt)])
    raw = result.content.strip().lower()

    valid = {"cotizacion", "siniestro", "renovacion", "otro"}
    intent = raw if raw in valid else "otro"

    return {"intent": intent}


def answer_faq(state: SofiaState) -> dict:
    return {}


def quote_price(state: SofiaState) -> dict:
    return {}


def escalate_to_human(state: SofiaState) -> dict:
    reason = state.get("escalation_reason") or "user_request"
    return {
        "should_escalate": True,
        "escalation_reason": reason,
        "response": ESCALATION_MESSAGE,
    }


def respond(state: SofiaState) -> dict:
    if state.get("should_escalate"):
        return {}

    config = _coerce_config(state.get("config"))

    system_base = state.get("system_prompt_override") or SOFIA_SYSTEM_PROMPT
    rag = state.get("rag_context") or ""
    extra = f"Contexto de base de conocimiento:\n{rag}" if rag else ""

    legal_notice_section = (
        f"\nAVISO LEGAL: {config.legal_disclaimer}" if config.legal_disclaimer.strip() else ""
    )
    system_text = system_base.format(
        company_name=config.company_name,
        company_years=config.company_years,
        business_hours=config.business_hours,
        company_context=config.company_context,
        carriers=config.carriers,
        extra_context=extra,
        legal_notice_section=legal_notice_section,
    )

    if state.get("has_open_appointment"):
        system_text += (
            "\n\nContexto operativo: Ya existe una cita o solicitud registrada para este cliente. "
            "No repitas el mensaje de escalación en cada turno. "
            f"Si el cliente pregunta por horarios/disponibilidad, responde usando este horario: {config.business_hours}. "
            "Después pide su preferencia concreta (día/hora/canal)."
        )

    llm = ChatOpenAI(
        model=config.model,
        temperature=config.temperature,
        max_tokens=config.max_tokens,
    )

    chat_messages = [SystemMessage(content=system_text)] + list(state["messages"])

    result = llm.invoke(chat_messages)
    return {"response": result.content.strip()}


def guard(state: SofiaState) -> dict:
    if state.get("should_escalate"):
        return {}

    response = state.get("response", "")
    if not response:
        return {}

    config = _coerce_config(state.get("config"))
    llm = ChatOpenAI(
        model=config.model,
        temperature=0.0,
        max_tokens=config.max_tokens,
    )

    prompt = GUARD_PROMPT.format(response=response)
    result = llm.invoke([HumanMessage(content=prompt)])
    verdict = result.content.strip()

    if verdict.upper() == "OK":
        return {}

    return {"response": verdict}


# ── Routing ──────────────────────────────────────────────────────────────────

def route_intent(state: SofiaState) -> str:
    if state.get("should_escalate"):
        return "escalate_to_human"

    intent = state.get("intent", "general")
    if intent == "siniestro":
        return "escalate_to_human"
    if intent == "cotizacion":
        return "quote_price"
    if intent == "renovacion":
        return "answer_faq"
    return "respond"


# ── Graph ────────────────────────────────────────────────────────────────────

def build_sofia_graph():
    graph = StateGraph(SofiaState)

    graph.add_node("classify", classify)
    graph.add_node("answer_faq", answer_faq)
    graph.add_node("quote_price", quote_price)
    graph.add_node("escalate_to_human", escalate_to_human)
    graph.add_node("respond", respond)
    graph.add_node("guard", guard)

    graph.add_edge(START, "classify")

    graph.add_conditional_edges(
        "classify",
        route_intent,
        {
            "answer_faq": "answer_faq",
            "quote_price": "quote_price",
            "escalate_to_human": "escalate_to_human",
            "respond": "respond",
        },
    )

    graph.add_edge("answer_faq", "respond")
    graph.add_edge("quote_price", "respond")
    graph.add_edge("escalate_to_human", "guard")
    graph.add_edge("respond", "guard")
    graph.add_edge("guard", END)

    return graph.compile()


sofia_app = build_sofia_graph()


async def run_sofia(
    user_message: str,
    history: list[dict[str, str]],
    rag_context: str,
    message_count: int,
    system_prompt_override: str = "",
    config: dict[str, Any] | None = None,
    already_escalated: bool = False,
    has_open_appointment: bool = False,
) -> dict[str, Any]:
    from langchain_core.messages import HumanMessage as HM, AIMessage

    chat_messages = []
    for msg in history[:-1]:
        if msg["role"] == "user":
            chat_messages.append(HM(content=msg["content"]))
        elif msg["role"] == "assistant":
            chat_messages.append(AIMessage(content=msg["content"]))

    chat_messages.append(HM(content=user_message))

    initial_state: SofiaState = {
        "messages": chat_messages,
        "user_message": user_message,
        "intent": "",
        "rag_context": rag_context,
        "should_escalate": False,
        "escalation_reason": "",
        "message_count": message_count,
        "response": "",
        "system_prompt_override": system_prompt_override,
        "config": config or {},
        "already_escalated": already_escalated,
        "has_open_appointment": has_open_appointment,
    }

    result = sofia_app.invoke(initial_state)

    return {
        "response": result.get("response", ""),
        "should_escalate": result.get("should_escalate", False),
        "escalation_reason": result.get("escalation_reason", ""),
        "intent": result.get("intent", ""),
    }
