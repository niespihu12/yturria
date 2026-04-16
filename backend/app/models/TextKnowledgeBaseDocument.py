from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, Text
from sqlmodel import Field, SQLModel


class TextKnowledgeBaseDocument(SQLModel, table=True):
    __tablename__ = "text_knowledge_base_documents"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True, nullable=False)
    name: str = Field(nullable=False)
    source_type: str = Field(nullable=False)
    source_value: str = Field(default="", nullable=False)
    content: str = Field(sa_column=Column(Text, nullable=False), default="")
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
