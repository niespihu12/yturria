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
    # Variante que exige el guard de respuestas (p. ej. "español colombiano").
    spanish_variant: str = field(default_factory=lambda: TENANT.spanish_variant)
    # False: el guard no admite rangos de precio (compañías que no publican tarifas).
    allow_price_ranges: bool = True
    # False (p. ej. un banco): sin flujos de seguros. Siniestros, robos, pólizas e interés
    # de compra no escalan solos; solo escala cuando el cliente pide hablar con una persona.
    insurance_flows: bool = True
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
    # Sofía trata de "usted" (ver reglas del system prompt).
    "es": (
        "Entendido. Voy a comunicarle con un asesor que podrá ayudarle mejor. "
        "En breve alguien de nuestro equipo se pondrá en contacto con usted."
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


# Canales sin teléfono (chat web / widget): antes de pasar a un asesor se piden los datos.
_CONTACT_REQUEST_MESSAGES: dict[str, str] = {
    "es": (
        "Con gusto le comunico con un asesor. Para que pueda contactarle, ¿me indica su "
        "nombre y un número de teléfono o correo electrónico?"
    ),
    "en": (
        "I'll gladly connect you with an advisor. So they can reach you, could you share "
        "your name and a phone number or email address?"
    ),
    "pt": (
        "Com prazer vou te conectar com um assessor. Para que ele possa entrar em contato, "
        "pode me informar seu nome e um telefone ou e-mail?"
    ),
}

_CONTACT_CONFIRMATION_MESSAGES: dict[str, str] = {
    "es": "Gracias{name}. Un asesor se comunicará con usted al {contact} lo antes posible.",
    "en": "Thank you{name}. An advisor will contact you at {contact} as soon as possible.",
    "pt": "Obrigado{name}. Um assessor entrará em contato pelo {contact} o quanto antes.",
}


def get_contact_request_message(language: str) -> str:
    return _CONTACT_REQUEST_MESSAGES.get(language, _CONTACT_REQUEST_MESSAGES["es"])


def get_contact_confirmation_message(language: str, name: str, contact: str) -> str:
    template = _CONTACT_CONFIRMATION_MESSAGES.get(language, _CONTACT_CONFIRMATION_MESSAGES["es"])
    return template.format(name=f", {name}" if name else "", contact=contact)


def get_escalation_message(language: str) -> str:
    return _ESCALATION_MESSAGES.get(language, _ESCALATION_MESSAGES["es"])


def get_language_instruction(language: str) -> str:
    return _LANGUAGE_INSTRUCTIONS.get(language, _LANGUAGE_INSTRUCTIONS["es"])
