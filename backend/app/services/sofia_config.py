from dataclasses import dataclass, field

from app.utils.client_defaults import TENANT


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


DEFAULT_CONFIG = SofiaConfig()
