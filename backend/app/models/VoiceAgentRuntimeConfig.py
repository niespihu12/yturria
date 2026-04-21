from datetime import datetime
from uuid import uuid4

from sqlmodel import Field, SQLModel


class VoiceAgentRuntimeConfig(SQLModel, table=True):
    __tablename__ = "voice_agent_runtime_configs"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    agent_id: str = Field(index=True, nullable=False)
    user_id: str = Field(foreign_key="users.id", index=True, nullable=False)

    whatsapp_enabled: bool = Field(default=False, nullable=False)
    default_escalation_channel: str = Field(default="phone", nullable=False)
    escalation_phone_number: str = Field(default="", nullable=False)

    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
