from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, Text
from sqlmodel import Field, SQLModel


class TextKnowledgeBaseChunk(SQLModel, table=True):
    __tablename__ = "text_knowledge_base_chunks"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    document_id: str = Field(
        foreign_key="text_knowledge_base_documents.id",
        index=True,
        nullable=False,
    )
    chunk_index: int = Field(nullable=False)
    content: str = Field(sa_column=Column(Text, nullable=False), default="")
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
