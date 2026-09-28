from __future__ import annotations

from typing import Any

from app.utils.client_defaults import (
    DEFAULT_LANGUAGE,
    DEFAULT_TEXT_MODEL,
    SOFIA_FIRST_MESSAGE,
    SOFIA_VOICE_PROMPT,
    TENANT,
)

TEXT_AGENT_NON_ADMIN_LIMIT = 3
VOICE_AGENT_NON_ADMIN_LIMIT = 3
TEXT_AGENT_DEFAULT_TEMPLATE_KEY = "sofia"

_SUPPORTED_TEMPLATE_KEYS = ("sofia", "recepcionista", "faq_bot", "custom")
_TEMPLATE_ALIASES = {"blank": "custom"}


def default_text_model_for_provider(provider: str) -> str:
    return "gemini-2.5-flash" if str(provider or "").strip().lower() == "gemini" else DEFAULT_TEXT_MODEL


def normalize_text_agent_template_key(
    value: Any,
    *,
    fallback: str = TEXT_AGENT_DEFAULT_TEMPLATE_KEY,
) -> str:
    normalized = str(value or "").strip().lower()
    if not normalized:
        return fallback
    normalized = _TEMPLATE_ALIASES.get(normalized, normalized)
    return normalized if normalized in _SUPPORTED_TEMPLATE_KEYS else fallback


def is_text_agent_template_key_supported(value: Any) -> bool:
    normalized = str(value or "").strip().lower()
    if not normalized:
        return False
    normalized = _TEMPLATE_ALIASES.get(normalized, normalized)
    return normalized in _SUPPORTED_TEMPLATE_KEYS


def _tenant_company_name() -> str:
    return (TENANT.company_name or "").strip() or "tu negocio"


def _build_receptionist_prompt() -> str:
    company_name = _tenant_company_name()
    return (
        f"Eres la recepcionista virtual de {company_name}.\n"
        "Tu trabajo es responder con claridad, tomar mensajes y ayudar a agendar citas.\n"
        "Prioridades:\n"
        "1. Responder preguntas generales sobre horarios, ubicacion, servicios y disponibilidad.\n"
        "2. Cuando falte informacion, pedir solo los datos minimos necesarios.\n"
        "3. Si el cliente quiere una llamada o cita, confirma sus datos y usa la herramienta de agenda si esta disponible.\n"
        "4. Si no puedes resolver algo, explica la limitacion con honestidad y ofrece tomar el mensaje.\n"
        "Estilo:\n"
        "- Responde en espanol neutro.\n"
        "- Mensajes breves, amables y accionables.\n"
        "- No inventes politicas, precios ni horarios si no aparecen en el contexto.\n"
        "- Nunca digas que eres una IA, di que eres la recepcion virtual de la empresa."
    )


def _build_receptionist_welcome() -> str:
    company_name = _tenant_company_name()
    return (
        f"Hola, soy la recepcion virtual de {company_name}. "
        "Puedo ayudarte con horarios, mensajes y citas. Que necesitas?"
    )


def _build_faq_prompt() -> str:
    company_name = _tenant_company_name()
    return (
        f"Eres el asistente de preguntas frecuentes de {company_name}.\n"
        "Responde usando solo la informacion confiable disponible en el contexto y la base de conocimiento.\n"
        "Reglas:\n"
        "1. Si la respuesta no esta en el contexto, dilo claramente.\n"
        "2. No inventes procesos, precios, horarios ni coberturas.\n"
        "3. No escales automaticamente ni prometas seguimiento humano.\n"
        "4. Cuando falte informacion, invita al usuario a dejar una pregunta mas especifica o un dato de contacto.\n"
        "Estilo:\n"
        "- Respuestas directas, utiles y faciles de leer.\n"
        "- Usa listas cortas solo cuando ayuden.\n"
        "- Mantente enfocado en resolver FAQs."
    )


def _build_faq_welcome() -> str:
    company_name = _tenant_company_name()
    return f"Hola, soy el bot de preguntas frecuentes de {company_name}. Que te gustaria consultar?"


_TEMPLATE_DEFINITIONS: dict[str, dict[str, Any]] = {
    "sofia": {
        "key": "sofia",
        "label": "Sofía",
        "summary": "Asistente comercial especializada en seguros, con escalamiento automático a un asesor.",
        "description": (
            "Ideal para ventas y atención de seguros. Conversa con el flujo especializado de Sofía, "
            "reúne el contexto comercial y pasa la conversación a un asesor cuando hace falta."
        ),
        "highlights": [
            "Flujo especializado en seguros",
            "Escalamiento automático",
            "Configuración guiada",
        ],
        "recommended": True,
        "capabilities": {
            "show_sofia_tab": True,
            "show_knowledge_tab": True,
            "show_tools_tab": False,
            "show_appointments_tab": True,
            "allow_prompt_edit": False,
            "allow_welcome_edit": False,
            "allow_model_edit": False,
            "allow_runtime_tuning": False,
            "launches_onboarding": True,
        },
        "defaults": {
            "system_prompt": SOFIA_VOICE_PROMPT,
            "welcome_message": SOFIA_FIRST_MESSAGE,
            "language": DEFAULT_LANGUAGE,
            "sofia_mode": True,
        },
    },
    "recepcionista": {
        "key": "recepcionista",
        "label": "Recepcionista",
        "summary": "Agenda citas, toma mensajes y responde dudas del día a día de cualquier negocio.",
        "description": (
            "Pensada para recepción y primer contacto. Informa horarios y disponibilidad, "
            "toma mensajes y agenda citas sin usar el flujo de Sofía."
        ),
        "highlights": [
            "Agenda y mensajes",
            "Sirve para cualquier negocio",
            "Conversaciones cortas",
        ],
        "recommended": False,
        "capabilities": {
            "show_sofia_tab": False,
            "show_knowledge_tab": True,
            "show_tools_tab": False,
            "show_appointments_tab": True,
            "allow_prompt_edit": False,
            "allow_welcome_edit": False,
            "allow_model_edit": False,
            "allow_runtime_tuning": False,
            "launches_onboarding": False,
        },
        "defaults": {
            "system_prompt": _build_receptionist_prompt(),
            "welcome_message": _build_receptionist_welcome(),
            "language": DEFAULT_LANGUAGE,
            "sofia_mode": False,
        },
    },
    "faq_bot": {
        "key": "faq_bot",
        "label": "Preguntas frecuentes",
        "summary": "Responde preguntas frecuentes con la base de conocimiento, sin escalamientos automáticos.",
        "description": (
            "Hecho para autoservicio. Responde con base en sus documentos, "
            "sin inventar respuestas ni escalar automáticamente."
        ),
        "highlights": [
            "Basado en sus documentos",
            "No inventa respuestas",
            "Sin escalamientos automáticos",
        ],
        "recommended": False,
        "capabilities": {
            "show_sofia_tab": False,
            "show_knowledge_tab": True,
            "show_tools_tab": False,
            "show_appointments_tab": False,
            "allow_prompt_edit": False,
            "allow_welcome_edit": False,
            "allow_model_edit": False,
            "allow_runtime_tuning": False,
            "launches_onboarding": False,
        },
        "defaults": {
            "system_prompt": _build_faq_prompt(),
            "welcome_message": _build_faq_welcome(),
            "language": DEFAULT_LANGUAGE,
            "sofia_mode": False,
        },
    },
    "custom": {
        "key": "custom",
        "label": "Personalizado",
        "summary": "Empiece desde cero y configure cada detalle del agente.",
        "description": (
            "Parte de una base limpia: puede editar las instrucciones, el primer mensaje, "
            "el modelo y los parámetros para crear un agente a la medida."
        ),
        "highlights": [
            "Instrucciones editables",
            "Modelo configurable",
            "Para casos especiales",
        ],
        "recommended": False,
        "capabilities": {
            "show_sofia_tab": False,
            "show_knowledge_tab": True,
            "show_tools_tab": True,
            "show_appointments_tab": True,
            "allow_prompt_edit": True,
            "allow_welcome_edit": True,
            "allow_model_edit": True,
            "allow_runtime_tuning": True,
            "launches_onboarding": False,
        },
        "defaults": {
            "system_prompt": "",
            "welcome_message": "",
            "language": DEFAULT_LANGUAGE,
            "sofia_mode": False,
        },
    },
}


def get_text_agent_template_definition(template_key: Any) -> dict[str, Any]:
    normalized = normalize_text_agent_template_key(template_key, fallback="")
    if normalized and normalized in _TEMPLATE_DEFINITIONS:
        definition = _TEMPLATE_DEFINITIONS[normalized]
    else:
        definition = _TEMPLATE_DEFINITIONS[TEXT_AGENT_DEFAULT_TEMPLATE_KEY]
    return {
        **definition,
        "capabilities": dict(definition["capabilities"]),
        "defaults": dict(definition["defaults"]),
        "highlights": list(definition["highlights"]),
    }


def list_text_agent_templates() -> list[dict[str, Any]]:
    return [get_text_agent_template_definition(key) for key in _SUPPORTED_TEMPLATE_KEYS]


def apply_text_agent_template_defaults(payload: dict[str, Any], template_key: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        payload = {}

    definition = get_text_agent_template_definition(template_key)
    defaults = definition["defaults"]
    next_payload = dict(payload)
    provider = str(next_payload.get("provider") or "openai").strip().lower() or "openai"

    next_payload["template_key"] = definition["key"]
    next_payload["provider"] = provider
    next_payload["model"] = default_text_model_for_provider(provider)
    next_payload["language"] = str(defaults.get("language") or DEFAULT_LANGUAGE).strip() or DEFAULT_LANGUAGE
    next_payload["system_prompt"] = str(defaults.get("system_prompt") or "")
    next_payload["welcome_message"] = str(defaults.get("welcome_message") or "")
    next_payload["sofia_mode"] = bool(defaults.get("sofia_mode", False))

    # "custom" conserva lo que envió el cliente (se lee de payload: next_payload ya tiene los defaults).
    if definition["key"] == "custom":
        next_payload["system_prompt"] = str(payload.get("system_prompt") or "")
        next_payload["welcome_message"] = str(payload.get("welcome_message") or "")
        next_payload["sofia_mode"] = bool(payload.get("sofia_mode", False))

    return next_payload
