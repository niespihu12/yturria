from datetime import datetime
from typing import Optional
from uuid import uuid4

from sqlmodel import Field, SQLModel


class TextAppointment(SQLModel, table=True):
    __tablename__ = "text_appointments"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    text_agent_id: Optional[str] = Field(
        default=None,
        foreign_key="text_agents.id",
        index=True,
        nullable=True,
    )
    voice_agent_id: Optional[str] = Field(default=None, index=True, nullable=True)
    user_id: str = Field(foreign_key="users.id", index=True, nullable=False)
    conversation_id: Optional[str] = Field(default=None, index=True, nullable=True)
    contact_name: str = Field(default="", nullable=False)
    contact_phone: str = Field(default="", nullable=False)
    contact_email: str = Field(default="", nullable=False)
    appointment_date: datetime = Field(nullable=False)
    timezone: str = Field(default="America/Bogota", nullable=False)
    status: str = Field(default="scheduled", nullable=False)
    source: str = Field(default="manual", nullable=False)
    notes: str = Field(default="", nullable=False)
    google_event_id: str = Field(default="", nullable=False)
    google_calendar_id: str = Field(default="", nullable=False)
    google_sync_status: str = Field(default="not_configured", nullable=False)
    google_sync_error: str = Field(default="", nullable=False)
    deleted_at: Optional[datetime] = Field(default=None, nullable=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
