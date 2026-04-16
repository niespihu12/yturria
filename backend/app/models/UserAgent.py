from datetime import datetime
from uuid import uuid4

from sqlmodel import Field, SQLModel


class UserAgent(SQLModel, table=True):
    __tablename__ = "user_agents"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True, nullable=False)
    agent_id: str = Field(index=True, nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
