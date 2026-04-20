from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, Text
from sqlmodel import Field, SQLModel


class AuditTrailEvent(SQLModel, table=True):
    __tablename__ = "audit_trail_events"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    event_type: str = Field(nullable=False, index=True)
    actor_user_id: str | None = Field(default=None, foreign_key="users.id", index=True, nullable=True)
    subject_user_id: str | None = Field(default=None, foreign_key="users.id", index=True, nullable=True)
    entity_type: str = Field(default="", nullable=False)
    entity_id: str = Field(default="", nullable=False)
    details_json: str = Field(default="{}", sa_column=Column(Text, nullable=False))
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
