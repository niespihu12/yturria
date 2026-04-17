from dataclasses import dataclass, field


@dataclass
class SofiaConfig:
    company_name: str = "Yturria Agente de Seguros"
    company_years: str = "75"
    escalation_threshold: int = 4
    temperature: float = 0.3
    max_tokens: int = 256
    model: str = "gpt-4.1-mini"
    advisor_phone: str = ""
    advisor_whatsapp_config_id: str = ""
    extra_escalation_phrases: list[str] = field(default_factory=list)


DEFAULT_CONFIG = SofiaConfig()
