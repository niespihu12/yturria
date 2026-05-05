from dataclasses import dataclass, field

from app.utils.client_defaults import TENANT

# Supported languages: 'es' (español), 'en' (English), 'pt' (Português)
SUPPORTED_LANGUAGES: frozenset[str] = frozenset({"es", "en", "pt"})


@dataclass
class SofiaConfig:
    company_name: str = field(default_factory=lambda: TENANT.company_name)
    company_years: str = field(default_factory=lambda: TENANT.company_years)
    business_hours: str = field(default_factory=lambda: TENANT.business_hours)
    company_context: str = field(default_factory=lambda: TENANT.company_context)
    carriers: str = field(default_factory=lambda: TENANT.carriers)
    legal_notice: str = field(default_factory=lambda: TENANT.legal_notice)
    escalation_threshold: int = 4
    temperature: float = 0.3
    max_tokens: int = 256
    model: str = "gpt-4.1-mini"
    advisor_phone: str = ""
    advisor_whatsapp_config_id: str = ""
    max_response_lines: int = 3
    extra_escalation_phrases: list[str] = field(default_factory=list)
    language: str = "es"


DEFAULT_CONFIG = SofiaConfig()


# ── Mensajes de escalación por idioma ─────────────────────────────────────────

_ESCALATION_MESSAGES: dict[str, str] = {
    "es": (
        "Entendido. Voy a comunicarte con un asesor humano que podrá ayudarte mejor. "
        "En breve alguien de nuestro equipo se pondrá en contacto contigo."
    ),
    "en": (
        "Understood. I'm connecting you with a human advisor who can better assist you. "
        "Someone from our team will be in touch with you shortly."
    ),
    "pt": (
        "Entendido. Vou te conectar com um assessor humano que poderá te ajudar melhor. "
        "Em breve alguém da nossa equipe entrará em contato com você."
    ),
}

_LANGUAGE_INSTRUCTIONS: dict[str, str] = {
    "es": "Responde SIEMPRE en español.",
    "en": "Always respond in English.",
    "pt": "Responda SEMPRE em português.",
}


def get_escalation_message(language: str) -> str:
    return _ESCALATION_MESSAGES.get(language, _ESCALATION_MESSAGES["es"])


def get_language_instruction(language: str) -> str:
    return _LANGUAGE_INSTRUCTIONS.get(language, _LANGUAGE_INSTRUCTIONS["es"])
