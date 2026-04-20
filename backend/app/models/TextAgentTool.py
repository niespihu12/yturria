from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, Text
from sqlmodel import Field, SQLModel


class TextAgentTool(SQLModel, table=True):
    __tablename__ = "text_agent_tools"

    id: str = Field(default_factory=lambda: str(uuid4()), primary_key=True)
    text_agent_id: str = Field(foreign_key="text_agents.id", index=True, nullable=False)
    name: str = Field(nullable=False)
    description: str = Field(default="", nullable=False)
    endpoint_url: str = Field(nullable=False)
    http_method: str = Field(default="POST", nullable=False)
    headers_json: str = Field(default="{}", nullable=False)
    body_template: str = Field(default="", nullable=False)
    parameters_schema_json: str = Field(sa_column=Column(Text, nullable=False), default="{}")
    response_mapping_json: str = Field(sa_column=Column(Text, nullable=False), default="{}")
    enabled: bool = Field(default=True, nullable=False)
    created_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
    updated_at: datetime = Field(default_factory=datetime.utcnow, nullable=False)
