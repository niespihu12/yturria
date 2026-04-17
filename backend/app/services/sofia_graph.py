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


# ── Nodes ────────────────────────────────────────────────────────────────────

def classify(state: SofiaState) -> dict:
    user_msg = state["user_message"]
    config = SofiaConfig(**state.get("config", {}))

    lower_msg = user_msg.lower()
    for phrase in ESCALATION_PHRASES + config.extra_escalation_phrases:
        if phrase in lower_msg:
            return {"intent": "escalate"}

    if state["message_count"] >= config.escalation_threshold:
        return {
            "intent": "escalate",
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

    valid = {"greeting", "faq", "quote", "escalate", "general"}
    intent = raw if raw in valid else "general"

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

    config = SofiaConfig(**state.get("config", {}))

    system_base = state.get("system_prompt_override") or SOFIA_SYSTEM_PROMPT
    rag = state.get("rag_context") or ""
    extra = f"Contexto de base de conocimiento:\n{rag}" if rag else ""

    system_text = system_base.format(
        company_name=config.company_name,
        company_years=config.company_years,
        extra_context=extra,
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

    config = SofiaConfig(**state.get("config", {}))
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
    intent = state.get("intent", "general")
    if intent == "escalate":
        return "escalate_to_human"
    if intent == "quote":
        return "quote_price"
    if intent == "faq":
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
    }

    result = sofia_app.invoke(initial_state)

    return {
        "response": result.get("response", ""),
        "should_escalate": result.get("should_escalate", False),
        "escalation_reason": result.get("escalation_reason", ""),
        "intent": result.get("intent", ""),
    }
