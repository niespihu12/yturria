from datetime import datetime
from uuid import uuid4

from sqlmodel import Field, SQLModel


class TextAgentWhatsApp(SQLModel, table=True):
    __tablename__ = "text_agent_whatsapp_configs"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    text_agent_id: str = Field(foreign_key="text_agents.id", index=True, nullable=False)
    provider: str = Field(nullable=False)  # 'meta' | 'twilio'
    phone_number: str = Field(default="", nullable=False)
    # Twilio
    account_sid: str = Field(default="", nullable=False)
    auth_token_encrypted: str = Field(default="", nullable=False)
    # Meta Cloud API
    access_token_encrypted: str = Field(default="", nullable=False)
    phone_number_id: str = Field(default="", nullable=False)
    business_account_id: str = Field(default="", nullable=False)
    # Common
    webhook_verify_token: str = Field(default="", nullable=False)
    active: bool = Field(default=True, nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
