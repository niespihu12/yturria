from datetime import datetime
from uuid import uuid4

from sqlmodel import Field, SQLModel


class UserWhatsAppConfig(SQLModel, table=True):
    __tablename__ = "user_whatsapp_configs"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True, nullable=False)

    provider: str = Field(default="twilio", nullable=False)
    default_sender_number: str = Field(default="", nullable=False)

    # Twilio
    account_sid: str = Field(default="", nullable=False)
    auth_token_encrypted: str = Field(default="", nullable=False)

    # Meta Cloud API
    access_token_encrypted: str = Field(default="", nullable=False)
    phone_number_id: str = Field(default="", nullable=False)
    business_account_id: str = Field(default="", nullable=False)

    message_template_escalation: str = Field(default="", nullable=False)
    message_template_appointment: str = Field(default="", nullable=False)

    active: bool = Field(default=True, nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
