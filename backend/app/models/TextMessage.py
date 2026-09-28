from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, Text
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlmodel import Field, SQLModel


LONG_TEXT = Text().with_variant(LONGTEXT(), "mysql")


class TextMessage(SQLModel, table=True):
    __tablename__ = "text_messages"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    conversation_id: str = Field(
        foreign_key="text_conversations.id",
        index=True,
        nullable=False,
    )
    role: str = Field(nullable=False)
    content: str = Field(sa_column=Column(LONG_TEXT, nullable=False))
    deleted_at: datetime | None = Field(default=None, nullable=True)
    provider: str = Field(default="", nullable=False)
    model: str = Field(default="", nullable=False)
    token_usage: int | None = Field(default=None, nullable=True)
    # Id del proveedor (wamid de Meta / MessageSid de Twilio) para deduplicar reintentos.
    external_id: str | None = Field(default=None, nullable=True, unique=True, index=True, max_length=255)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)


def message_order(*, newest_first: bool = False) -> tuple:
    """Orden cronológico estable. Filas antiguas de MySQL guardan solo segundos: ante la
    misma hora, el mensaje del cliente va antes que la respuesta del asistente."""
    if newest_first:
        return (TextMessage.created_at.desc(), TextMessage.role.asc())
    return (TextMessage.created_at.asc(), TextMessage.role.desc())
