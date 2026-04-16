from datetime import datetime
from uuid import uuid4

from sqlmodel import Field, SQLModel


class TextConversation(SQLModel, table=True):
    __tablename__ = "text_conversations"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    text_agent_id: str = Field(foreign_key="text_agents.id", index=True, nullable=False)
    user_id: str = Field(foreign_key="users.id", index=True, nullable=False)
    title: str = Field(default="", nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
