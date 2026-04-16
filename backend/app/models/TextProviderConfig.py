from datetime import datetime
from uuid import uuid4

from sqlmodel import Field, SQLModel


class TextProviderConfig(SQLModel, table=True):
    __tablename__ = "text_provider_configs"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True, nullable=False)
    provider: str = Field(index=True, nullable=False)
    api_key_encrypted: str = Field(nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
