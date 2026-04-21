"""Defaults de producción para cliente final (Sofía / Yturria).

Se aplican automáticamente en los controllers cuando un usuario no super_admin
crea un agente. Super_admin conserva flexibilidad completa.

Perfil de tenant configurable vía variables de entorno:
  TENANT_COMPANY_NAME, TENANT_COMPANY_YEARS, TENANT_BUSINESS_HOURS,
  TENANT_CARRIERS, TENANT_LEGAL_DISCLAIMER, TENANT_COMPANY_CONTEXT
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any


# ── Tenant Profile ────────────────────────────────────────────────────────────

_DEFAULT_CARRIERS = (
    "GNP, AXA, Chubb, MetLife, Bupa, Sura, Quálitas, "
    "Seguros Banorte, HDI, Zurich, Mapfre"
)
_DEFAULT_BUSINESS_HOURS = (
    "lunes a viernes 9:00-18:00 y sábados 9:00-14:00 (hora CDMX)"
)
_DEFAULT_COMPANY_CONTEXT = (
    "asesoría integral para seguros de auto, vida, gastos médicos y empresariales en México"
)


@dataclass
class TenantProfile:
    company_name: str = "Yturria Agente de Seguros"
    company_years: str = "75"
    business_hours: str = _DEFAULT_BUSINESS_HOURS
    carriers: str = _DEFAULT_CARRIERS
    legal_notice: str = ""
    company_context: str = _DEFAULT_COMPANY_CONTEXT


def _load_tenant_profile() -> TenantProfile:
    # TENANT_LEGAL_NOTICE es el nombre canónico; TENANT_LEGAL_DISCLAIMER se acepta
    # por backward compat con deployments que ya usaban la var anterior.
    legal_notice = (
        os.getenv("TENANT_LEGAL_NOTICE", "")
        or os.getenv("TENANT_LEGAL_DISCLAIMER", "")
    ).strip()
    return TenantProfile(
        company_name=os.getenv("TENANT_COMPANY_NAME", "Yturria Agente de Seguros").strip(),
        company_years=os.getenv("TENANT_COMPANY_YEARS", "75").strip(),
        business_hours=os.getenv("TENANT_BUSINESS_HOURS", _DEFAULT_BUSINESS_HOURS).strip(),
        carriers=os.getenv("TENANT_CARRIERS", _DEFAULT_CARRIERS).strip(),
        legal_notice=legal_notice,
        company_context=os.getenv("TENANT_COMPANY_CONTEXT", _DEFAULT_COMPANY_CONTEXT).strip(),
    )


TENANT: TenantProfile = _load_tenant_profile()


# ── Voice prompt & first message (built from TENANT at import time) ───────────

def _build_voice_prompt(t: TenantProfile) -> str:
    return (
        f"Eres Sofía, asistente virtual de {t.company_name}.\n"
        f"{t.company_name} tiene {t.company_years} años en el mercado asegurador mexicano.\n"
        f"Contexto de empresa: {t.company_context}.\n"
        f"Horario de atención humana: {t.business_hours}.\n"
        f"Trabajamos con: {t.carriers} y más.\n"
        "ROL:\n"
        "\n"
        "Responder dudas de seguros con claridad y calidez\n"
        "Dar rangos orientativos de precio (nunca precios exactos)\n"
        "Identificar qué tipo de seguro necesita el cliente\n"
        "Transferir al asesor cuando el cliente quiere comprar o tiene un siniestro\n"
        "TONO: Cálido, profesional, español mexicano.\n"
        "Respuestas cortas — máximo 3 líneas por mensaje.\n"
        "Sin jerga técnica sin explicar.\n"
        "\n"
        "ESCALAR AL ASESOR cuando el cliente:\n"
        "\n"
        "Dice \"quiero contratar\", \"me interesa\", \"cuándo me llaman\"\n"
        "Reporta un siniestro activo\n"
        "Pregunta por una póliza específica suya\n"
        "Lleva varios intentos sin resolver y sin compartir datos de contacto\n"
        "Si ya compartió nombre/teléfono para cita, NO repitas escalación en cada turno; responde horarios y solicita preferencia concreta\n"
        "NUNCA digas que eres una IA.\n"
        "NUNCA des precios exactos sin revisión del asesor.\n"
        "NUNCA hagas promesas de cobertura específica.\n"
        f"Siempre di: \"soy la asistente virtual de {t.company_name}\""
    )


def _build_first_message(t: TenantProfile) -> str:
    return f"Hola, soy la asistente virtual de {t.company_name}. ¿En qué le puedo ayudar hoy?"


SOFIA_VOICE_PROMPT: str = _build_voice_prompt(TENANT)
SOFIA_FIRST_MESSAGE: str = _build_first_message(TENANT)

DEFAULT_VOICE_LLM = "gpt-4.1-mini"
DEFAULT_TTS_MODEL = "eleven_turbo_v2_5"
DEFAULT_LANGUAGE = "es"
DEFAULT_TEXT_PROVIDER = "openai"
DEFAULT_TEXT_MODEL = "gpt-4.1-mini"

CLIENT_SYSTEM_TOOLS = ("end_call", "transfer_to_number", "voicemail_detection")
SYSTEM_TOOL_TYPE_BY_NAME = {
    "end_call": "end_call",
    "transfer_to_number": "transfer_to_number",
    "voicemail_detection": "voicemail_detection",
}


def build_client_built_in_tools() -> dict[str, Any]:
    """Retorna built_in_tools en formato SystemToolConfig por herramienta."""
    built_in_tools: dict[str, Any] = {}

    for tool_name in CLIENT_SYSTEM_TOOLS:
        system_tool_type = SYSTEM_TOOL_TYPE_BY_NAME.get(tool_name, tool_name)
        params: dict[str, Any] = {"system_tool_type": system_tool_type}

        # Este tool requiere transfers explícito (puede estar vacío).
        if system_tool_type == "transfer_to_number":
            params["transfers"] = []
            params["enable_client_message"] = True

        built_in_tools[tool_name] = {
            "type": "system",
            "name": tool_name,
            "description": "",
            "params": params,
        }

    return built_in_tools


def build_client_voice_payload(name: str) -> dict[str, Any]:
    """Payload completo listo para ElevenLabs con defaults Sofía."""
    safe_name = (name or "").strip() or "Sofía - Yturria"
    return {
        "name": safe_name,
        "conversation_config": {
            "agent": {
                "prompt": {
                    "prompt": SOFIA_VOICE_PROMPT,
                    "llm": DEFAULT_VOICE_LLM,
                    "built_in_tools": build_client_built_in_tools(),
                },
                "first_message": SOFIA_FIRST_MESSAGE,
                "language": DEFAULT_LANGUAGE,
            },
            "tts": {
                "model_id": DEFAULT_TTS_MODEL,
            },
        },
    }


def apply_client_voice_defaults(payload: dict[str, Any]) -> dict[str, Any]:
    """Mezcla defaults sobre un payload existente del cliente.

    Se fuerzan los campos no negociables (LLM, TTS model, language default si vacío).
    El prompt y first_message solo se inyectan si vienen vacíos.
    """
    if not isinstance(payload, dict):
        payload = {}

    conv = payload.setdefault("conversation_config", {})
    agent_cfg = conv.setdefault("agent", {})
    prompt_cfg = agent_cfg.setdefault("prompt", {})

    # Cliente final: prompt y mensaje inicial son inmutables por política.
    prompt_cfg["prompt"] = SOFIA_VOICE_PROMPT

    prompt_cfg["llm"] = DEFAULT_VOICE_LLM
    prompt_cfg["built_in_tools"] = build_client_built_in_tools()

    agent_cfg["first_message"] = SOFIA_FIRST_MESSAGE
    agent_cfg["language"] = DEFAULT_LANGUAGE


    tts = conv.setdefault("tts", {})
    tts["model_id"] = DEFAULT_TTS_MODEL

    return payload


def apply_client_text_defaults(payload: dict[str, Any]) -> dict[str, Any]:
    """Fuerza provider/model para cliente. Activa sofia_mode por defecto."""
    if not isinstance(payload, dict):
        payload = {}

    payload["provider"] = DEFAULT_TEXT_PROVIDER
    payload["model"] = DEFAULT_TEXT_MODEL
    payload["system_prompt"] = SOFIA_VOICE_PROMPT
    payload["welcome_message"] = SOFIA_FIRST_MESSAGE

    if "language" not in payload or not str(payload.get("language") or "").strip():
        payload["language"] = DEFAULT_LANGUAGE

    if "sofia_mode" not in payload:
        payload["sofia_mode"] = True

    return payload
