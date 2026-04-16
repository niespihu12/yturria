from datetime import datetime
from uuid import uuid4

from sqlmodel import Field, SQLModel


class TextAgentKnowledgeBase(SQLModel, table=True):
    __tablename__ = "text_agent_knowledge_base"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    text_agent_id: str = Field(foreign_key="text_agents.id", index=True, nullable=False)
    document_id: str = Field(
        foreign_key="text_knowledge_base_documents.id",
        index=True,
        nullable=False,
    )
    usage_mode: str = Field(default="auto", nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
