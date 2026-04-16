from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401
from app.config.db import engine
from app.middlewares.cors import add_cors_middleware
from app.middlewares.http_error_handler import register_exception_handlers
from app.routes.auth_router import auth_router
from app.routes.agents_router import agents_router
from app.routes.text_agents_router import text_agents_router
from app.routes.webhooks_router import webhooks_router


def _column_exists(connection, table: str, column: str) -> bool:
    return (
        connection.execute(
            text(
                """
                SELECT COUNT(*) FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = :t AND COLUMN_NAME = :c
                """
            ),
            {"t": table, "c": column},
        ).scalar_one()
        > 0
    )


def _table_exists(connection, table: str) -> bool:
    return (
        connection.execute(
            text(
                """
                SELECT COUNT(*) FROM information_schema.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t
                """
            ),
            {"t": table},
        ).scalar_one()
        > 0
    )


def ensure_user_auth_columns() -> None:
    columns = {
        "mfa_enabled": "mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE",
        "mfa_failed_attempts": "mfa_failed_attempts INT NOT NULL DEFAULT 0",
        "mfa_locked_until": "mfa_locked_until DATETIME NULL",
    }

    with Session(engine) as session:
        connection = session.connection()
        for column_name, ddl in columns.items():
            if not _column_exists(connection, "users", column_name):
                connection.execute(text(f"ALTER TABLE users ADD COLUMN {ddl}"))
        session.commit()


def ensure_token_auth_columns() -> None:
    with Session(engine) as session:
        connection = session.connection()
        if not _column_exists(connection, "tokens", "purpose"):
            connection.execute(
                text(
                    "ALTER TABLE tokens ADD COLUMN purpose VARCHAR(50) NOT NULL DEFAULT 'generic'"
                )
            )
            connection.execute(text("CREATE INDEX ix_tokens_purpose ON tokens (purpose)"))
        session.commit()


def ensure_text_agents_content_columns() -> None:
    targets = [
        ("text_messages", "content"),
        ("text_knowledge_base_documents", "content"),
        ("text_agents", "system_prompt"),
        ("text_agents", "welcome_message"),
    ]

    with Session(engine) as session:
        connection = session.connection()

        for table_name, column_name in targets:
            if not _table_exists(connection, table_name):
                continue

            data_type = connection.execute(
                text(
                    """
                    SELECT DATA_TYPE FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = :t AND COLUMN_NAME = :c
                    """
                ),
                {"t": table_name, "c": column_name},
            ).scalar_one_or_none()

            if not data_type:
                continue

            if str(data_type).strip().lower() not in {"text", "mediumtext", "longtext"}:
                connection.execute(
                    text(
                        f"ALTER TABLE {table_name} MODIFY COLUMN {column_name} LONGTEXT NOT NULL"
                    )
                )

        session.commit()


def ensure_text_agent_tools_schema_columns() -> None:
    with Session(engine) as session:
        connection = session.connection()
        if not _table_exists(connection, "text_agent_tools"):
            session.commit()
            return

        if not _column_exists(connection, "text_agent_tools", "parameters_schema_json"):
            connection.execute(
                text("ALTER TABLE text_agent_tools ADD COLUMN parameters_schema_json LONGTEXT")
            )
            connection.execute(
                text("UPDATE text_agent_tools SET parameters_schema_json = '{}' WHERE parameters_schema_json IS NULL")
            )
            connection.execute(
                text("ALTER TABLE text_agent_tools MODIFY COLUMN parameters_schema_json LONGTEXT NOT NULL")
            )
        if not _column_exists(connection, "text_agent_tools", "response_mapping_json"):
            connection.execute(
                text("ALTER TABLE text_agent_tools ADD COLUMN response_mapping_json LONGTEXT")
            )
            connection.execute(
                text("UPDATE text_agent_tools SET response_mapping_json = '{}' WHERE response_mapping_json IS NULL")
            )
            connection.execute(
                text("ALTER TABLE text_agent_tools MODIFY COLUMN response_mapping_json LONGTEXT NOT NULL")
            )
        session.commit()


def ensure_kb_index_columns() -> None:
    with Session(engine) as session:
        connection = session.connection()
        if not _table_exists(connection, "text_knowledge_base_documents"):
            session.commit()
            return

        if not _column_exists(connection, "text_knowledge_base_documents", "index_status"):
            connection.execute(
                text(
                    "ALTER TABLE text_knowledge_base_documents "
                    "ADD COLUMN index_status VARCHAR(20) NOT NULL DEFAULT 'indexed'"
                )
            )
        if not _column_exists(connection, "text_knowledge_base_documents", "chunk_count"):
            connection.execute(
                text(
                    "ALTER TABLE text_knowledge_base_documents "
                    "ADD COLUMN chunk_count INT NOT NULL DEFAULT 0"
                )
            )
        session.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    SQLModel.metadata.create_all(engine)
    ensure_user_auth_columns()
    ensure_token_auth_columns()
    ensure_text_agents_content_columns()
    ensure_text_agent_tools_schema_columns()
    ensure_kb_index_columns()
    yield


app = FastAPI(lifespan=lifespan)

register_exception_handlers(app)
add_cors_middleware(app)

app.include_router(auth_router, prefix="/api")
app.include_router(agents_router, prefix="/api")
app.include_router(text_agents_router, prefix="/api")
app.include_router(webhooks_router, prefix="/api")
