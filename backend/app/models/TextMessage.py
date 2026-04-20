from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, Text
from sqlmodel import Field, SQLModel


class TextMessage(SQLModel, table=True):
    __tablename__ = "text_messages"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    conversation_id: str = Field(
        foreign_key="text_conversations.id",
        index=True,
        nullable=False,
    )
    role: str = Field(nullable=False)
    content: str = Field(sa_column=Column(Text, nullable=False))
    deleted_at: datetime | None = Field(default=None, nullable=True)
    provider: str = Field(default="", nullable=False)
    model: str = Field(default="", nullable=False)
    token_usage: int | None = Field(default=None, nullable=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
