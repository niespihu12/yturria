from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, Text
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlmodel import Field, SQLModel

# TEXT en MySQL solo admite 64 KB; transcripciones y notas pueden superarlo.
LONG_TEXT = Text().with_variant(LONGTEXT(), "mysql")


class VoiceMessage(SQLModel, table=True):
    __tablename__ = "voice_messages"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True, index=True)
    user_id: str = Field(foreign_key="users.id", index=True, nullable=False)
    voice_agent_id: str = Field(index=True, nullable=False)
    caller_number: str = Field(nullable=False)
    requested_person: str = Field(default="", nullable=False)
    message_summary: str = Field(default="", sa_column=Column(LONG_TEXT, nullable=False))
    full_transcript: str = Field(default="", sa_column=Column(LONG_TEXT, nullable=False))
    whatsapp_sent: bool = Field(default=False, nullable=False)
    whatsapp_sent_at: datetime | None = Field(default=None, nullable=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
