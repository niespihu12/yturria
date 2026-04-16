from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text
from sqlmodel import Session
from sqlmodel import SQLModel

import app.models  # noqa: F401
from app.config.db import engine
from app.middlewares.cors import add_cors_middleware
from app.middlewares.http_error_handler import register_exception_handlers
from app.routes.auth_router import auth_router
from app.routes.agents_router import agents_router
from app.routes.text_agents_router import text_agents_router


def ensure_user_auth_columns() -> None:
    columns = {
        "mfa_enabled": "mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE",
        "mfa_failed_attempts": "mfa_failed_attempts INT NOT NULL DEFAULT 0",
        "mfa_locked_until": "mfa_locked_until DATETIME NULL",
    }

    with Session(engine) as session:
        connection = session.connection()
        for column_name, ddl in columns.items():
            exists = connection.execute(
                text(
                    """
                    SELECT COUNT(*)
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = :table_name
                      AND COLUMN_NAME = :column_name
                    """
                ),
                {"table_name": "users", "column_name": column_name},
            ).scalar_one()
            if exists == 0:
                connection.execute(text(f"ALTER TABLE users ADD COLUMN {ddl}"))
        session.commit()


def ensure_token_auth_columns() -> None:
    with Session(engine) as session:
        connection = session.connection()
        exists = connection.execute(
            text(
                """
                SELECT COUNT(*)
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = :table_name
                  AND COLUMN_NAME = :column_name
                """
            ),
            {"table_name": "tokens", "column_name": "purpose"},
        ).scalar_one()
        if exists == 0:
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
    ]

    with Session(engine) as session:
        connection = session.connection()

        for table_name, column_name in targets:
            table_exists = connection.execute(
                text(
                    """
                    SELECT COUNT(*)
                    FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = :table_name
                    """
                ),
                {"table_name": table_name},
            ).scalar_one()

            if table_exists == 0:
                continue

            data_type = connection.execute(
                text(
                    """
                    SELECT DATA_TYPE
                    FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = :table_name
                      AND COLUMN_NAME = :column_name
                    """
                ),
                {"table_name": table_name, "column_name": column_name},
            ).scalar_one_or_none()

            if not data_type:
                continue

            normalized = str(data_type).strip().lower()
            if normalized not in {"text", "mediumtext", "longtext"}:
                connection.execute(
                    text(
                        f"ALTER TABLE {table_name} MODIFY COLUMN {column_name} LONGTEXT NOT NULL"
                    )
                )

        session.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    SQLModel.metadata.create_all(engine)
    ensure_user_auth_columns()
    ensure_token_auth_columns()
    ensure_text_agents_content_columns()
    yield


app = FastAPI(lifespan=lifespan)

register_exception_handlers(app)
add_cors_middleware(app)

app.include_router(auth_router, prefix="/api")
app.include_router(agents_router, prefix="/api")
app.include_router(text_agents_router, prefix="/api")
