from __future__ import annotations

import asyncio
import logging
import os
import re
import unicodedata
from contextvars import ContextVar
from typing import Annotated, Any, TypedDict

from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from app.services.sofia_config import SofiaConfig, DEFAULT_CONFIG, get_escalation_message, get_language_instruction
from app.services.sofia_prompts import (
    CLASSIFY_PROMPT,
    ESCALATION_MESSAGE,
    ESCALATION_PHRASES,
    GUARD_PRICE_RULE_NO_PRICES,
    GUARD_PRICE_RULE_RANGES,
    GUARD_PROMPT,
    HUMAN_REQUEST_PHRASES,
    SOFIA_SYSTEM_PROMPT,
)

logger = logging.getLogger(__name__)

LLM_TIMEOUT_SECONDS = 30
LLM_MAX_RETRIES = 1

try:
    SOFIA_HISTORY_LIMIT = max(2, int(os.getenv("TEXT_AGENT_HISTORY_LIMIT", "30").strip() or "30"))
except ValueError:
    SOFIA_HISTORY_LIMIT = 30

# API key del dueño del agente para la ejecución en curso (no viaja en el estado del grafo).
_SOFIA_API_KEY: ContextVar[str | None] = ContextVar("sofia_api_key", default=None)


def _make_llm(
    model: str,
    temperature: float,
    max_tokens: int,
    api_key: str | None = None,
) -> ChatOpenAI:
    kwargs: dict[str, Any] = {}
    resolved_key = api_key or _SOFIA_API_KEY.get()
    if resolved_key:
        kwargs["api_key"] = resolved_key
    return ChatOpenAI(
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=LLM_TIMEOUT_SECONDS,
        max_retries=LLM_MAX_RETRIES,
        **kwargs,
    )


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
    uncertainty_count: int
    allow_threshold_escalation: bool


# Frases que indican que la IA no está segura de su respuesta.
_UNCERTAINTY_PHRASES: tuple[str, ...] = (
    "no estoy seguro",
    "no estoy segura",
    "permítame consultar",
    "permítame verificar",
    "tengo que verificar",
    "déjeme verificar",
    "necesito consultar",
    "debo consultar",
    "déjeme confirmar",
    "permítame confirmar",
    "no tengo esa información",
    "no cuento con esa información",
    "no puedo confirmar",
    "tendría que revisar",
    "habría que consultar",
    "le recomiendo consultar directamente",
    "es mejor que lo consulte",
    "no tengo certeza",
)
_UNCERTAINTY_ESCALATION_THRESHOLD = 2

# Palabras completas: "robo" no debe coincidir con "robot".
_CLAIM_KEYWORDS_RE = re.compile(
    r"\b("
    r"siniestros?|accidentes?|robos?|robaron|robad[oa]s?|hurtos?|"
    r"choques?|chocaron|reclamos?|reclamaci[oó]n(?:es)?"
    r")\b",
    re.IGNORECASE,
)

_PROMPT_PLACEHOLDERS = (
    "company_name",
    "company_years",
    "business_hours",
    "company_context",
    "carriers",
    "extra_context",
    "legal_notice_section",
)
_COMPANY_PLACEHOLDERS = _PROMPT_PLACEHOLDERS[:5]

_GUARD_STATUS_WORDS = {
    "OK",
    "CUMPLE",
    "APROBADO",
    "APROBADA",
    "VALIDO",
    "VALIDA",
    "CORRECTO",
    "CORRECTA",
    "SI",
    "YES",
    "PASS",
    "APPROVED",
}


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

    # legal_disclaimer era el nombre anterior — mapear al nombre canónico legal_notice.
    if "legal_disclaimer" in raw_config and "legal_notice" not in normalized:
        normalized["legal_notice"] = raw_config.get("legal_disclaimer")

    if "escalation_phrases" in raw_config and "extra_escalation_phrases" not in normalized:
        phrases = raw_config.get("escalation_phrases")
        if isinstance(phrases, list):
            normalized["extra_escalation_phrases"] = [
                str(item).strip() for item in phrases if str(item).strip()
            ]

    for flag in ("allow_price_ranges", "insurance_flows"):
        if flag in normalized:
            raw_flag = normalized[flag]
            normalized[flag] = (
                raw_flag if isinstance(raw_flag, bool)
                else str(raw_flag).strip().lower() not in {"false", "0", "no", ""}
            )

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

    if not config.insurance_flows:
        return _classify_without_insurance_flows(state, config, lower_msg, already_escalated, has_open_appointment)

    quote_keywords = [
        "cotiz",
        "precio",
        "costo",
        "contratar",
        "poliza",
        "asegurar",
    ]
    renewal_keywords = [
        "renov",
        "venc",
        "vigencia",
        "continuidad",
        "renueva",
    ]

    # Siniestro activo (cliente con reporte ya abierto) — escalación inmediata
    # con razón específica, antes del check genérico de siniestro.
    active_claim_keywords = [
        "siniestro activo",
        "siniestro abierto",
        "siniestro en proceso",
        "reporte abierto",
        "folio de siniestro",
    ]
    if any(kw in lower_msg for kw in active_claim_keywords) and not already_escalated:
        return {
            "intent": "siniestro",
            "should_escalate": True,
            "escalation_reason": "active_claim",
        }

    if _CLAIM_KEYWORDS_RE.search(lower_msg):
        return {"intent": "siniestro"}
    if any(keyword in lower_msg for keyword in renewal_keywords):
        return {"intent": "renovacion"}

    # Póliza específica del cliente (no cotización nueva) — escalar al asesor.
    # Va después de renewal_keywords para que consultas de vigencia/renovación
    # de "mi póliza" sigan siendo renovacion y no se escalen prematuramente.
    own_policy_keywords = [
        "mi póliza",
        "mi poliza",
        "número de póliza",
        "numero de poliza",
        "mi número de póliza",
        "mi numero de poliza",
        "folio de póliza",
        "folio de poliza",
        "tengo una póliza",
        "tengo una poliza",
        "tengo póliza",
        "tengo poliza",
    ]
    if any(kw in lower_msg for kw in own_policy_keywords) and not already_escalated:
        return {
            "intent": "otro",
            "should_escalate": True,
            "escalation_reason": "specific_policy",
        }

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

    # Tras una escalación resuelta no se re-escala por umbral; solo por solicitud explícita.
    if (
        state["message_count"] >= config.escalation_threshold
        and not already_escalated
        and not has_open_appointment
        and state.get("allow_threshold_escalation", True)
    ):
        return {
            "intent": "otro",
            "should_escalate": True,
            "escalation_reason": "auto_threshold",
        }

    prompt = CLASSIFY_PROMPT.format(user_message=user_msg)
    try:
        result = _make_llm(config.model, 0.0, 20).invoke([HumanMessage(content=prompt)])
        raw = str(result.content).strip().lower()
    except Exception:
        # Classification is best-effort: an LLM outage must not break the chat.
        logger.exception("classify: LLM no disponible, se usa intent 'otro'")
        return {"intent": "otro"}

    valid = {"cotizacion", "siniestro", "renovacion", "otro"}
    intent = raw if raw in valid else "otro"

    return {"intent": intent}


def _classify_without_insurance_flows(
    state: SofiaState,
    config: SofiaConfig,
    lower_msg: str,
    already_escalated: bool,
    has_open_appointment: bool,
) -> dict:
    """Negocios que no son seguros (p. ej. un banco): el agente responde según sus
    instrucciones (bloquear una tarjeta, cómo abrir un producto…) y solo escala si el
    cliente pide a una persona o la conversación supera el umbral."""
    if any(phrase in lower_msg for phrase in HUMAN_REQUEST_PHRASES + config.extra_escalation_phrases):
        if already_escalated:
            return {"intent": "otro"}
        return {"intent": "otro", "should_escalate": True, "escalation_reason": "user_request"}

    if (
        state["message_count"] >= config.escalation_threshold
        and not already_escalated
        and not has_open_appointment
        and state.get("allow_threshold_escalation", True)
    ):
        return {"intent": "otro", "should_escalate": True, "escalation_reason": "auto_threshold"}
    return {"intent": "otro"}


def answer_faq(state: SofiaState) -> dict:
    return {}


def quote_price(state: SofiaState) -> dict:
    return {}


def escalate_to_human(state: SofiaState) -> dict:
    reason = state.get("escalation_reason") or "user_request"
    config = _coerce_config(state.get("config"))
    escalation_msg = get_escalation_message(config.language)
    return {
        "should_escalate": True,
        "escalation_reason": reason,
        "response": escalation_msg,
    }


def _build_system_text(override: str, rag_context: str, config: SofiaConfig) -> str:
    """Arma el system prompt sin usar str.format sobre texto del usuario."""
    rag = (rag_context or "").strip()
    if rag and not rag.startswith("Contexto de base de conocimiento"):
        rag = f"Contexto de base de conocimiento:\n{rag}"

    legal_notice = str(config.legal_notice or "").strip()
    values = {
        "company_name": config.company_name,
        "company_years": config.company_years,
        "business_hours": config.business_hours,
        "company_context": config.company_context,
        "carriers": config.carriers,
        "extra_context": rag,
        "legal_notice_section": f"\nAVISO LEGAL: {legal_notice}" if legal_notice else "",
    }

    template = override if (override or "").strip() else SOFIA_SYSTEM_PROMPT
    present = {name for name in _PROMPT_PLACEHOLDERS if "{" + name + "}" in template}
    system_text = template
    for name in present:
        system_text = system_text.replace("{" + name + "}", str(values[name]))

    blocks: list[str] = []
    if not present.intersection(_COMPANY_PLACEHOLDERS):
        blocks.append(
            "Datos de la empresa:\n"
            f"- Nombre: {config.company_name}\n"
            f"- Años en el mercado: {config.company_years}\n"
            f"- Horario de atención: {config.business_hours}\n"
            f"- Contexto: {config.company_context}\n"
            f"- Aseguradoras: {config.carriers}"
        )
    if rag and "extra_context" not in present:
        blocks.append(rag)
    if legal_notice and "legal_notice_section" not in present:
        blocks.append(f"AVISO LEGAL: {legal_notice}")

    if blocks:
        system_text = system_text.rstrip() + "\n\n" + "\n\n".join(blocks)
    return system_text


def respond(state: SofiaState) -> dict:
    if state.get("should_escalate"):
        return {}

    config = _coerce_config(state.get("config"))

    system_text = _build_system_text(
        state.get("system_prompt_override") or "",
        state.get("rag_context") or "",
        config,
    )

    lang_instruction = get_language_instruction(config.language)
    if lang_instruction not in system_text:
        system_text = f"{lang_instruction}\n\n{system_text}"

    if state.get("has_open_appointment"):
        system_text += (
            "\n\nContexto operativo: Ya existe una cita o solicitud registrada para este cliente. "
            "No repitas el mensaje de escalación en cada turno. "
            f"Si el cliente pregunta por horarios/disponibilidad, responde usando este horario: {config.business_hours}. "
            "Después pide su preferencia concreta (día/hora/canal)."
        )

    llm = _make_llm(config.model, config.temperature, config.max_tokens)

    chat_messages = [SystemMessage(content=system_text)] + list(state["messages"])

    result = llm.invoke(chat_messages)
    return {"response": str(result.content).strip()}


def _detect_uncertainty(response: str) -> bool:
    lower = response.lower()
    return any(phrase in lower for phrase in _UNCERTAINTY_PHRASES)


def _is_guard_approval(verdict: str) -> bool:
    """True si el veredicto del guard es una aprobación y no una respuesta reescrita."""
    normalized = unicodedata.normalize("NFKD", verdict or "")
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    normalized = normalized.strip().strip("\"'`“”‘’«»*").strip()
    normalized = normalized.rstrip(".!¡¿?").strip().upper()
    if not normalized:
        return True
    if normalized in _GUARD_STATUS_WORDS:
        return True
    first_word = re.split(r"[\s,.:;!\-]+", normalized, maxsplit=1)[0]
    if first_word == "OK" and len(normalized) <= 40:
        return True
    return len(normalized) < 10


def guard(state: SofiaState) -> dict:
    if state.get("should_escalate"):
        return {}

    response = state.get("response", "")
    if not response:
        return {}

    # ── Detector de incertidumbre ─────────────────────────────────────────────
    uncertainty_count = int(state.get("uncertainty_count") or 0)
    if _detect_uncertainty(response):
        uncertainty_count += 1
        logger.info("guard: frase de incertidumbre detectada (count=%s)", uncertainty_count)
        if (
            uncertainty_count >= _UNCERTAINTY_ESCALATION_THRESHOLD
            and not state.get("already_escalated")
        ):
            logger.info("guard: umbral de incertidumbre alcanzado → escalando")
            return {
                "uncertainty_count": uncertainty_count,
                "should_escalate": True,
                "escalation_reason": "uncertainty_detected",
            }
        return {"uncertainty_count": uncertainty_count}

    # ── Validación de formato/longitud (comportamiento original) ──────────────
    config = _coerce_config(state.get("config"))
    prompt = GUARD_PROMPT.format(
        response=response,
        price_rule=GUARD_PRICE_RULE_RANGES if config.allow_price_ranges else GUARD_PRICE_RULE_NO_PRICES,
        max_response_lines=config.max_response_lines,
        max_chars=config.max_response_lines * 70,
        spanish_variant=config.spanish_variant,
    )
    try:
        result = _make_llm(config.model, 0.0, config.max_tokens).invoke([HumanMessage(content=prompt)])
        verdict = str(result.content).strip()
    except Exception:
        # The guard only polishes format; keep the original answer if it fails.
        logger.exception("guard: LLM no disponible, se conserva la respuesta original")
        return {}

    if _is_guard_approval(verdict):
        return {}

    return {"response": verdict}


# ── Routing ──────────────────────────────────────────────────────────────────

def route_intent(state: SofiaState) -> str:
    if state.get("should_escalate"):
        return "escalate_to_human"

    intent = state.get("intent", "general")
    if intent == "siniestro":
        # Si ya hay una escalación abierta, Sofía responde en lugar de re-escalar.
        return "respond" if state.get("already_escalated") else "escalate_to_human"
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
    *,
    uncertainty_count: int = 0,
    allow_threshold_escalation: bool = True,
    api_key: str | None = None,
) -> dict[str, Any]:
    from langchain_core.messages import HumanMessage as HM, AIMessage

    chat_messages = []
    for msg in history[:-1][-SOFIA_HISTORY_LIMIT:]:
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
        "uncertainty_count": max(0, int(uncertainty_count or 0)),
        "allow_threshold_escalation": allow_threshold_escalation,
    }

    # El grafo hace llamadas HTTP bloqueantes: se ejecuta fuera del event loop.
    token = _SOFIA_API_KEY.set(api_key or None)
    try:
        result = await asyncio.to_thread(sofia_app.invoke, initial_state)
    finally:
        _SOFIA_API_KEY.reset(token)

    return {
        "response": result.get("response", ""),
        "should_escalate": result.get("should_escalate", False),
        "escalation_reason": result.get("escalation_reason", ""),
        "intent": result.get("intent", ""),
        "uncertainty_count": int(result.get("uncertainty_count") or 0),
    }
