from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, Text
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlmodel import Field, SQLModel


LONG_TEXT = Text().with_variant(LONGTEXT(), "mysql")


class TextKnowledgeBaseDocument(SQLModel, table=True):
    __tablename__ = "text_knowledge_base_documents"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True, nullable=False)
    name: str = Field(nullable=False)
    source_type: str = Field(nullable=False)
    source_value: str = Field(default="", nullable=False)
    content: str = Field(sa_column=Column(LONG_TEXT, nullable=False), default="")
    index_status: str = Field(default="indexed", nullable=False)
    chunk_count: int = Field(default=0, nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
