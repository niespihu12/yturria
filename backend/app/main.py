import asyncio
import logging
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
from app.routes.privacy_router import privacy_router
from app.routes.text_agents_router import text_agents_router
from app.routes.webhooks_router import webhooks_router
from app.services.renewal_scheduler import run_due_renewal_reminders, RENEWAL_REMINDER_DAYS_AHEAD
from app.utils.roles import PLATFORM_SUPER_ADMIN_EMAILS, normalize_email
from app.utils.startup_check import validate_startup_secrets


logger = logging.getLogger(__name__)


def _is_mysql_engine() -> bool:
    return engine.dialect.name == "mysql"


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


def _index_exists(connection, table: str, index_name: str) -> bool:
    return (
        connection.execute(
            text(
                """
                SELECT COUNT(*) FROM information_schema.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = :t AND INDEX_NAME = :i
                """
            ),
            {"t": table, "i": index_name},
        ).scalar_one()
        > 0
    )


def ensure_user_auth_columns() -> None:
    columns = {
        "role": "role VARCHAR(20) NOT NULL DEFAULT 'agent'",
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


def ensure_platform_super_admin_role() -> None:
    if not PLATFORM_SUPER_ADMIN_EMAILS:
        return

    with Session(engine) as session:
        connection = session.connection()

        if not _table_exists(connection, "users"):
            session.commit()
            return

        if not _column_exists(connection, "users", "email"):
            session.commit()
            return

        if not _column_exists(connection, "users", "role"):
            session.commit()
            return

        for email in PLATFORM_SUPER_ADMIN_EMAILS:
            connection.execute(
                text(
                    "UPDATE users SET role = 'super_admin' WHERE LOWER(TRIM(email)) = :email"
                ),
                {"email": normalize_email(email)},
            )

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

        if not _column_exists(connection, "text_agent_tools", "body_template"):
            connection.execute(
                text(
                    "ALTER TABLE text_agent_tools "
                    "ADD COLUMN body_template VARCHAR(255) NOT NULL DEFAULT ''"
                )
            )
        else:
            connection.execute(
                text(
                    "ALTER TABLE text_agent_tools "
                    "MODIFY COLUMN body_template VARCHAR(255) NOT NULL DEFAULT ''"
                )
            )

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


def ensure_text_appointments_columns() -> None:
    with Session(engine) as session:
        connection = session.connection()
        if not _table_exists(connection, "text_appointments"):
            session.commit()
            return

        if _column_exists(connection, "text_appointments", "text_agent_id"):
            text_agent_column_type = connection.execute(
                text(
                    """
                    SELECT COLUMN_TYPE FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = 'text_appointments'
                      AND COLUMN_NAME = 'text_agent_id'
                    """
                )
            ).scalar_one_or_none()
            normalized_type = str(text_agent_column_type or "VARCHAR(255)").strip()
            connection.execute(
                text(
                    "ALTER TABLE text_appointments "
                    f"MODIFY COLUMN text_agent_id {normalized_type} NULL"
                )
            )

        if not _column_exists(connection, "text_appointments", "voice_agent_id"):
            connection.execute(
                text(
                    "ALTER TABLE text_appointments "
                    "ADD COLUMN voice_agent_id VARCHAR(255) NULL"
                )
            )

        if not _index_exists(connection, "text_appointments", "ix_text_appointments_voice_agent_id"):
            connection.execute(
                text(
                    "CREATE INDEX ix_text_appointments_voice_agent_id "
                    "ON text_appointments (voice_agent_id)"
                )
            )

        if not _column_exists(connection, "text_appointments", "google_event_id"):
            connection.execute(
                text(
                    "ALTER TABLE text_appointments "
                    "ADD COLUMN google_event_id VARCHAR(255) NOT NULL DEFAULT ''"
                )
            )

        if not _column_exists(connection, "text_appointments", "google_calendar_id"):
            connection.execute(
                text(
                    "ALTER TABLE text_appointments "
                    "ADD COLUMN google_calendar_id VARCHAR(255) NOT NULL DEFAULT ''"
                )
            )

        if not _column_exists(connection, "text_appointments", "google_sync_status"):
            connection.execute(
                text(
                    "ALTER TABLE text_appointments "
                    "ADD COLUMN google_sync_status VARCHAR(50) "
                    "NOT NULL DEFAULT 'not_configured'"
                )
            )

        if not _column_exists(connection, "text_appointments", "google_sync_error"):
            connection.execute(
                text(
                    "ALTER TABLE text_appointments "
                    "ADD COLUMN google_sync_error VARCHAR(500) NOT NULL DEFAULT ''"
                )
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


def ensure_sofia_and_escalation_columns() -> None:
    with Session(engine) as session:
        connection = session.connection()

        if _table_exists(connection, "text_agents"):
            if not _column_exists(connection, "text_agents", "sofia_mode"):
                connection.execute(
                    text(
                        "ALTER TABLE text_agents "
                        "ADD COLUMN sofia_mode BOOLEAN NOT NULL DEFAULT FALSE"
                    )
                )
            if not _column_exists(connection, "text_agents", "sofia_config_json"):
                connection.execute(
                    text(
                        "ALTER TABLE text_agents "
                        "ADD COLUMN sofia_config_json LONGTEXT"
                    )
                )
            connection.execute(
                text(
                    "UPDATE text_agents "
                    "SET sofia_config_json = '{}' "
                    "WHERE sofia_config_json IS NULL"
                )
            )
            connection.execute(
                text(
                    "ALTER TABLE text_agents "
                    "MODIFY COLUMN sofia_config_json LONGTEXT NOT NULL"
                )
            )
            if not _column_exists(connection, "text_agents", "embed_enabled"):
                connection.execute(
                    text(
                        "ALTER TABLE text_agents "
                        "ADD COLUMN embed_enabled BOOLEAN NOT NULL DEFAULT TRUE"
                    )
                )
            if not _column_exists(connection, "text_agents", "embed_token"):
                connection.execute(
                    text(
                        "ALTER TABLE text_agents "
                        "ADD COLUMN embed_token VARCHAR(255) NOT NULL DEFAULT ''"
                    )
                )

        if _table_exists(connection, "text_conversations"):
            if not _column_exists(connection, "text_conversations", "escalation_status"):
                connection.execute(
                    text(
                        "ALTER TABLE text_conversations "
                        "ADD COLUMN escalation_status VARCHAR(50) NOT NULL DEFAULT 'none'"
                    )
                )
            if not _column_exists(connection, "text_conversations", "escalation_reason"):
                connection.execute(
                    text(
                        "ALTER TABLE text_conversations "
                        "ADD COLUMN escalation_reason VARCHAR(255) NOT NULL DEFAULT ''"
                    )
                )
            if not _column_exists(connection, "text_conversations", "escalated_at"):
                connection.execute(
                    text(
                        "ALTER TABLE text_conversations "
                        "ADD COLUMN escalated_at DATETIME NULL"
                    )
                )
            if not _column_exists(connection, "text_conversations", "renewal_date"):
                connection.execute(
                    text(
                        "ALTER TABLE text_conversations "
                        "ADD COLUMN renewal_date DATETIME NULL"
                    )
                )
            if not _column_exists(connection, "text_conversations", "renewal_status"):
                connection.execute(
                    text(
                        "ALTER TABLE text_conversations "
                        "ADD COLUMN renewal_status VARCHAR(50) NOT NULL DEFAULT 'none'"
                    )
                )
            if not _column_exists(connection, "text_conversations", "renewal_note"):
                connection.execute(
                    text(
                        "ALTER TABLE text_conversations "
                        "ADD COLUMN renewal_note VARCHAR(255) NOT NULL DEFAULT ''"
                    )
                )
            if not _column_exists(connection, "text_conversations", "renewal_reminder_sent_at"):
                connection.execute(
                    text(
                        "ALTER TABLE text_conversations "
                        "ADD COLUMN renewal_reminder_sent_at DATETIME NULL"
                    )
                )
            if not _column_exists(connection, "text_conversations", "deleted_at"):
                connection.execute(
                    text(
                        "ALTER TABLE text_conversations "
                        "ADD COLUMN deleted_at DATETIME NULL"
                    )
                )

        if _table_exists(connection, "text_messages"):
            if not _column_exists(connection, "text_messages", "deleted_at"):
                connection.execute(
                    text(
                        "ALTER TABLE text_messages "
                        "ADD COLUMN deleted_at DATETIME NULL"
                    )
                )

        if _table_exists(connection, "users"):
            if not _column_exists(connection, "users", "deleted_at"):
                connection.execute(
                    text(
                        "ALTER TABLE users "
                        "ADD COLUMN deleted_at DATETIME NULL"
                    )
                )

        session.commit()


def ensure_text_agents_legal_notice_column() -> None:
    with Session(engine) as session:
        connection = session.connection()
        if not _table_exists(connection, "text_agents"):
            session.commit()
            return
        if not _column_exists(connection, "text_agents", "legal_notice"):
            connection.execute(
                text("ALTER TABLE text_agents ADD COLUMN legal_notice LONGTEXT NULL")
            )
        connection.execute(
            text("UPDATE text_agents SET legal_notice = '' WHERE legal_notice IS NULL")
        )
        connection.execute(
            text("ALTER TABLE text_agents MODIFY COLUMN legal_notice LONGTEXT NOT NULL")
        )
        session.commit()


async def _renewal_scheduler_loop(stop_event: asyncio.Event) -> None:
    """Ejecuta recordatorios de renovación de forma periódica."""
    while not stop_event.is_set():
        try:
            with Session(engine) as session:
                processed = run_due_renewal_reminders(session, days_ahead=RENEWAL_REMINDER_DAYS_AHEAD)
                if processed:
                    logger.info("renewal scheduler sent %s reminders", processed)
        except Exception:
            logger.exception("renewal scheduler failed")

        try:
            await asyncio.wait_for(stop_event.wait(), timeout=3600)
        except asyncio.TimeoutError:
            continue


@asynccontextmanager
async def lifespan(_: FastAPI):
    validate_startup_secrets()

    SQLModel.metadata.create_all(engine)
    scheduler_stop = asyncio.Event()
    scheduler_task: asyncio.Task | None = None

    if _is_mysql_engine():
        ensure_user_auth_columns()
        ensure_platform_super_admin_role()
        ensure_token_auth_columns()
        ensure_text_agents_content_columns()
        ensure_text_agent_tools_schema_columns()
        ensure_text_appointments_columns()
        ensure_kb_index_columns()
        ensure_sofia_and_escalation_columns()
        ensure_text_agents_legal_notice_column()
        scheduler_task = asyncio.create_task(_renewal_scheduler_loop(scheduler_stop))

    yield

    if scheduler_task:
        scheduler_stop.set()
        await scheduler_task


app = FastAPI(lifespan=lifespan)

register_exception_handlers(app)
add_cors_middleware(app)

app.include_router(auth_router, prefix="/api")
app.include_router(agents_router, prefix="/api")
app.include_router(text_agents_router, prefix="/api")
app.include_router(privacy_router, prefix="/api")
app.include_router(webhooks_router, prefix="/api")
