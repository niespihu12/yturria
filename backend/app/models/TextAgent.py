from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, Text
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlmodel import Field, SQLModel


LONG_TEXT = Text().with_variant(LONGTEXT(), "mysql")


class TextAgent(SQLModel, table=True):
    __tablename__ = "text_agents"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True, nullable=False)
    name: str = Field(nullable=False)
    provider: str = Field(index=True, nullable=False)
    model: str = Field(nullable=False)
    system_prompt: str = Field(
        default="",
        sa_column=Column(LONG_TEXT, nullable=False),
    )
    welcome_message: str = Field(
        default="",
        sa_column=Column(LONG_TEXT, nullable=False),
    )
    language: str = Field(default="es", nullable=False)
    temperature: float = Field(default=0.7, nullable=False)
    max_tokens: int = Field(default=512, nullable=False)
    sofia_mode: bool = Field(default=False, nullable=False)
    sofia_config_json: str = Field(default="{}", nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
