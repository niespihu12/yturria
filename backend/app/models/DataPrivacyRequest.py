from datetime import datetime
from uuid import uuid4

from sqlmodel import Field, SQLModel


class DataPrivacyRequest(SQLModel, table=True):
    __tablename__ = "data_privacy_requests"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True, nullable=False)
    requested_by_user_id: str = Field(foreign_key="users.id", index=True, nullable=False)
    reason: str = Field(default="", nullable=False)
    status: str = Field(default="pending", nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    processed_at: datetime | None = Field(default=None, nullable=True)
