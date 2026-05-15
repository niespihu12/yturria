from datetime import datetime
from uuid import uuid4

from sqlmodel import Field, SQLModel


class UserCalendarConnection(SQLModel, table=True):
    __tablename__ = "user_calendar_connections"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True, index=True)
    user_id: str = Field(foreign_key="users.id", index=True, nullable=False)
    provider: str = Field(default="google", nullable=False)  # google, microsoft, apple
    calendar_id: str = Field(default="primary", nullable=False)
    calendar_name: str = Field(default="", nullable=False)
    access_token_encrypted: str = Field(default="", nullable=False)
    refresh_token_encrypted: str = Field(default="", nullable=False)
    token_expires_at: datetime | None = Field(default=None, nullable=True)
    is_default: bool = Field(default=False, nullable=False)
    active: bool = Field(default=True, nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
