from datetime import datetime
from uuid import uuid4

from sqlmodel import Field, SQLModel


class VoiceMessage(SQLModel, table=True):
    __tablename__ = "voice_messages"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True, index=True)
    user_id: str = Field(foreign_key="users.id", index=True, nullable=False)
    voice_agent_id: str = Field(index=True, nullable=False)
    caller_number: str = Field(nullable=False)
    requested_person: str = Field(default="", nullable=False)
    message_summary: str = Field(default="", nullable=False)
    full_transcript: str = Field(default="", nullable=False)
    whatsapp_sent: bool = Field(default=False, nullable=False)
    whatsapp_sent_at: datetime | None = Field(default=None, nullable=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
