import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import inspect as sa_inspect, text
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401
from app.config.db import engine
from app.middlewares.cors import add_cors_middleware
from app.middlewares.http_error_handler import register_exception_handlers
from app.middlewares.rate_limiter import RateLimiterMiddleware
from app.routes.auth_router import auth_router
from app.routes.agents_router import agents_router
from app.routes.privacy_router import privacy_router
from app.routes.text_agents_router import text_agents_router
from app.routes.webhooks_router import webhooks_router
from app.routes.sofia_errors_router import sofia_errors_router
from app.routes.audit_router import audit_router
from app.routes.contacts_router import contacts_router
from app.routes.calendars_router import calendars_router
from app.services.renewal_scheduler import run_due_renewal_reminders, RENEWAL_REMINDER_DAYS_AHEAD
from app.utils.roles import PLATFORM_SUPER_ADMIN_EMAILS, normalize_email
from app.utils.startup_check import validate_startup_secrets, start_cloudflare_tunnel, stop_cloudflare_tunnel


logger = logging.getLogger(__name__)


# ── Dialect helpers ────────────────────────────────────────────────────────────

def _dialect() -> str:
    return engine.dialect.name  # "mysql", "postgresql", "sqlite", …


def _needs_schema_migrations() -> bool:
    """Idempotent ALTER TABLE migrations run only on persistent DBs.
    SQLite skips them because create_all always starts from a fresh schema."""
    return _dialect() in {"mysql", "postgresql"}


def _text_ddl() -> str:
    """Unlimited-text DDL type for the active dialect."""
    return "LONGTEXT" if _dialect() == "mysql" else "TEXT"


def _ts_ddl() -> str:
    """Nullable timestamp DDL type for the active dialect."""
    return "DATETIME" if _dialect() == "mysql" else "TIMESTAMP"


# ── Dialect-agnostic schema inspection ────────────────────────────────────────

def _column_exists(connection, table: str, column: str) -> bool:
    try:
        return any(c["name"] == column for c in sa_inspect(connection).get_columns(table))
    except Exception:
        return False


def _table_exists(connection, table: str) -> bool:
    try:
        return table in sa_inspect(connection).get_table_names()
    except Exception:
        return False


def _index_exists(connection, table: str, index_name: str) -> bool:
    try:
        return any(
            idx["name"] == index_name
            for idx in sa_inspect(connection).get_indexes(table)
        )
    except Exception:
        return False


def _get_column_type_str(connection, table: str, column: str) -> str:
    """Return the column SQL type as an uppercase string, e.g. 'VARCHAR(255)'."""
    try:
        col = next(
            (c for c in sa_inspect(connection).get_columns(table) if c["name"] == column),
            None,
        )
        return str(col["type"]).upper() if col else ""
    except Exception:
        return ""


# ── Dialect-aware DDL helpers ──────────────────────────────────────────────────

def _make_column_not_null_text(connection, table: str, column: str) -> None:
    """Set column to unlimited-text type and NOT NULL, dialect-agnostically."""
    if _dialect() == "mysql":
        connection.execute(
            text(f"ALTER TABLE {table} MODIFY COLUMN {column} {_text_ddl()} NOT NULL")
        )
    elif _dialect() == "postgresql":
        connection.execute(
            text(
                f"ALTER TABLE {table} ALTER COLUMN {column} "
                f"TYPE {_text_ddl()} USING {column}::{_text_ddl()}"
            )
        )
        connection.execute(
            text(f"ALTER TABLE {table} ALTER COLUMN {column} SET NOT NULL")
        )


def _make_column_nullable(connection, table: str, column: str, col_type: str) -> None:
    """Remove NOT NULL constraint from an existing column."""
    if _dialect() == "mysql":
        connection.execute(
            text(f"ALTER TABLE {table} MODIFY COLUMN {column} {col_type} NULL")
        )
    elif _dialect() == "postgresql":
        connection.execute(
            text(f"ALTER TABLE {table} ALTER COLUMN {column} DROP NOT NULL")
        )


def _ensure_column_varchar_not_null(
    connection, table: str, column: str, size: int, default: str
) -> None:
    """Ensure a VARCHAR column is NOT NULL with a given default (add or fix)."""
    ddl = f"VARCHAR({size}) NOT NULL DEFAULT '{default}'"
    if not _column_exists(connection, table, column):
        connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
    elif _dialect() == "mysql":
        connection.execute(text(f"ALTER TABLE {table} MODIFY COLUMN {column} {ddl}"))
    # PostgreSQL: column already has correct type from create_all; skip MODIFY.


# ── Ensure functions ───────────────────────────────────────────────────────────

def ensure_user_auth_columns() -> None:
    columns = {
        "role": f"VARCHAR(20) NOT NULL DEFAULT 'agent'",
        "mfa_enabled": "BOOLEAN NOT NULL DEFAULT FALSE",
        "mfa_failed_attempts": "INT NOT NULL DEFAULT 0",
        "mfa_locked_until": f"{_ts_ddl()} NULL",
    }
    with Session(engine) as session:
        connection = session.connection()
        for column_name, ddl in columns.items():
            if not _column_exists(connection, "users", column_name):
                connection.execute(text(f"ALTER TABLE users ADD COLUMN {column_name} {ddl}"))
        session.commit()


def _ensure_userrole_enum_has_super_admin() -> None:
    """Idempotently add 'super_admin' to the PostgreSQL userrole enum."""
    if _dialect() != "postgresql":
        return
    with Session(engine) as session:
        connection = session.connection()
        result = connection.execute(
            text(
                """
                SELECT EXISTS (
                    SELECT 1 FROM pg_enum
                    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'userrole')
                    AND enumlabel = 'super_admin'
                )
                """
            )
        ).scalar()
        if not result:
            connection.execute(text("ALTER TYPE userrole ADD VALUE 'super_admin'"))
        session.commit()


def ensure_contacts_table() -> None:
    with Session(engine) as session:
        connection = session.connection()
        if not _table_exists(connection, "contacts"):
            connection.execute(
                text(
                    """
                    CREATE TABLE contacts (
                        id VARCHAR(36) PRIMARY KEY,
                        user_id VARCHAR(36) NOT NULL,
                        name VARCHAR(255) NOT NULL,
                        last_name VARCHAR(255) NOT NULL DEFAULT '',
                        specialty VARCHAR(255) NOT NULL DEFAULT '',
                        phone VARCHAR(50) NOT NULL DEFAULT '',
                        email VARCHAR(255) NOT NULL DEFAULT '',
                        whatsapp VARCHAR(50) NOT NULL DEFAULT '',
                        active BOOLEAN NOT NULL DEFAULT TRUE,
                        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        INDEX ix_contacts_user_id (user_id),
                        INDEX ix_contacts_name (name),
                        INDEX ix_contacts_specialty (specialty)
                    )
                    """
                )
            )
        session.commit()


def ensure_voice_messages_table() -> None:
    with Session(engine) as session:
        connection = session.connection()
        if not _table_exists(connection, "voice_messages"):
            connection.execute(
                text(
                    """
                    CREATE TABLE voice_messages (
                        id VARCHAR(36) PRIMARY KEY,
                        user_id VARCHAR(36) NOT NULL,
                        voice_agent_id VARCHAR(255) NOT NULL,
                        caller_number VARCHAR(50) NOT NULL,
                        requested_person VARCHAR(255) NOT NULL DEFAULT '',
                        message_summary TEXT NOT NULL DEFAULT '',
                        full_transcript TEXT NOT NULL DEFAULT '',
                        whatsapp_sent BOOLEAN NOT NULL DEFAULT FALSE,
                        whatsapp_sent_at TIMESTAMP NULL,
                        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        INDEX ix_voice_messages_user_id (user_id),
                        INDEX ix_voice_messages_voice_agent_id (voice_agent_id)
                    )
                    """
                )
            )
        session.commit()


def ensure_user_calendar_connections_table() -> None:
    with Session(engine) as session:
        connection = session.connection()
        if not _table_exists(connection, "user_calendar_connections"):
            connection.execute(
                text(
                    """
                    CREATE TABLE user_calendar_connections (
                        id VARCHAR(36) PRIMARY KEY,
                        user_id VARCHAR(36) NOT NULL,
                        provider VARCHAR(50) NOT NULL DEFAULT 'google',
                        calendar_id VARCHAR(255) NOT NULL DEFAULT 'primary',
                        calendar_name VARCHAR(255) NOT NULL DEFAULT '',
                        access_token_encrypted TEXT NOT NULL DEFAULT '',
                        refresh_token_encrypted TEXT NOT NULL DEFAULT '',
                        token_expires_at TIMESTAMP NULL,
                        is_default BOOLEAN NOT NULL DEFAULT FALSE,
                        active BOOLEAN NOT NULL DEFAULT TRUE,
                        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        INDEX ix_user_calendar_connections_user_id (user_id)
                    )
                    """
                )
            )
        session.commit()


def ensure_platform_super_admin_role() -> None:
    if not PLATFORM_SUPER_ADMIN_EMAILS:
        return
    with Session(engine) as session:
        connection = session.connection()
        if not _table_exists(connection, "users"):
            session.commit()
            return
        if not _column_exists(connection, "users", "email") or not _column_exists(
            connection, "users", "role"
        ):
            session.commit()
            return
        for email in PLATFORM_SUPER_ADMIN_EMAILS:
            connection.execute(
                text("UPDATE users SET role = 'super_admin' WHERE LOWER(TRIM(email)) = :email"),
                {"email": normalize_email(email)},
            )
        session.commit()


def ensure_token_auth_columns() -> None:
    with Session(engine) as session:
        connection = session.connection()
        if not _column_exists(connection, "tokens", "purpose"):
            connection.execute(
                text("ALTER TABLE tokens ADD COLUMN purpose VARCHAR(50) NOT NULL DEFAULT 'generic'")
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
            col_type_str = _get_column_type_str(connection, table_name, column_name)
            if not col_type_str:
                continue
            # TEXT / MEDIUMTEXT / LONGTEXT (MySQL) and TEXT (PostgreSQL) are already large enough.
            is_large_text = any(t in col_type_str for t in ("TEXT", "CLOB"))
            if not is_large_text:
                _make_column_not_null_text(connection, table_name, column_name)
        session.commit()


def ensure_text_agent_tools_schema_columns() -> None:
    with Session(engine) as session:
        connection = session.connection()
        if not _table_exists(connection, "text_agent_tools"):
            session.commit()
            return

        _ensure_column_varchar_not_null(connection, "text_agent_tools", "body_template", 255, "")

        for col in ("parameters_schema_json", "response_mapping_json"):
            if not _column_exists(connection, "text_agent_tools", col):
                connection.execute(
                    text(f"ALTER TABLE text_agent_tools ADD COLUMN {col} {_text_ddl()}")
                )
                connection.execute(
                    text(f"UPDATE text_agent_tools SET {col} = '{{}}' WHERE {col} IS NULL")
                )
                _make_column_not_null_text(connection, "text_agent_tools", col)

        session.commit()


def ensure_text_appointments_columns() -> None:
    with Session(engine) as session:
        connection = session.connection()
        if not _table_exists(connection, "text_appointments"):
            session.commit()
            return

        # Make text_agent_id nullable — it was NOT NULL in older schema versions.
        if _column_exists(connection, "text_appointments", "text_agent_id"):
            col_type = _get_column_type_str(connection, "text_appointments", "text_agent_id") or "VARCHAR(255)"
            _make_column_nullable(connection, "text_appointments", "text_agent_id", col_type)

        if not _column_exists(connection, "text_appointments", "voice_agent_id"):
            connection.execute(
                text("ALTER TABLE text_appointments ADD COLUMN voice_agent_id VARCHAR(255) NULL")
            )

        if not _index_exists(connection, "text_appointments", "ix_text_appointments_voice_agent_id"):
            connection.execute(
                text(
                    "CREATE INDEX ix_text_appointments_voice_agent_id "
                    "ON text_appointments (voice_agent_id)"
                )
            )

        for col, ddl in [
            ("google_event_id", "VARCHAR(255) NOT NULL DEFAULT ''"),
            ("google_calendar_id", "VARCHAR(255) NOT NULL DEFAULT ''"),
            ("google_sync_status", "VARCHAR(50) NOT NULL DEFAULT 'not_configured'"),
            ("google_sync_error", "VARCHAR(500) NOT NULL DEFAULT ''"),
        ]:
            if not _column_exists(connection, "text_appointments", col):
                connection.execute(
                    text(f"ALTER TABLE text_appointments ADD COLUMN {col} {ddl}")
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
                    text(f"ALTER TABLE text_agents ADD COLUMN sofia_config_json {_text_ddl()}")
                )
            connection.execute(
                text(
                    "UPDATE text_agents SET sofia_config_json = '{}' "
                    "WHERE sofia_config_json IS NULL"
                )
            )
            _make_column_not_null_text(connection, "text_agents", "sofia_config_json")

            if not _column_exists(connection, "text_agents", "template_key"):
                connection.execute(
                    text(
                        "ALTER TABLE text_agents "
                        "ADD COLUMN template_key VARCHAR(50) NOT NULL DEFAULT 'sofia'"
                    )
                )
            connection.execute(
                text(
                    "UPDATE text_agents "
                    "SET template_key = CASE "
                    "WHEN template_key IS NULL OR TRIM(template_key) = '' "
                    "THEN CASE WHEN sofia_mode THEN 'sofia' ELSE 'custom' END "
                    "ELSE template_key END"
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
            nullable_ts_cols = ("escalated_at", "renewal_date", "renewal_reminder_sent_at", "deleted_at")
            varchar_cols = {
                "escalation_status": ("VARCHAR(50)", "none"),
                "escalation_reason": ("VARCHAR(255)", ""),
                "renewal_status": ("VARCHAR(50)", "none"),
                "renewal_note": ("VARCHAR(255)", ""),
            }
            for col, (typ, default) in varchar_cols.items():
                if not _column_exists(connection, "text_conversations", col):
                    connection.execute(
                        text(
                            f"ALTER TABLE text_conversations "
                            f"ADD COLUMN {col} {typ} NOT NULL DEFAULT '{default}'"
                        )
                    )
            for col in nullable_ts_cols:
                if not _column_exists(connection, "text_conversations", col):
                    connection.execute(
                        text(
                            f"ALTER TABLE text_conversations "
                            f"ADD COLUMN {col} {_ts_ddl()} NULL"
                        )
                    )

        if _table_exists(connection, "text_messages"):
            if not _column_exists(connection, "text_messages", "deleted_at"):
                connection.execute(
                    text(f"ALTER TABLE text_messages ADD COLUMN deleted_at {_ts_ddl()} NULL")
                )

        if _table_exists(connection, "users"):
            if not _column_exists(connection, "users", "deleted_at"):
                connection.execute(
                    text(f"ALTER TABLE users ADD COLUMN deleted_at {_ts_ddl()} NULL")
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
                text(f"ALTER TABLE text_agents ADD COLUMN legal_notice {_text_ddl()} NULL")
            )
        connection.execute(
            text("UPDATE text_agents SET legal_notice = '' WHERE legal_notice IS NULL")
        )
        _make_column_not_null_text(connection, "text_agents", "legal_notice")
        session.commit()


def ensure_whatsapp_app_secret_column() -> None:
    with Session(engine) as session:
        connection = session.connection()
        if not _table_exists(connection, "text_agent_whatsapp_configs"):
            session.commit()
            return
        if not _column_exists(connection, "text_agent_whatsapp_configs", "app_secret_encrypted"):
            connection.execute(
                text(
                    "ALTER TABLE text_agent_whatsapp_configs "
                    "ADD COLUMN app_secret_encrypted VARCHAR(500) NOT NULL DEFAULT ''"
                )
            )
        session.commit()


def ensure_embed_customization_columns() -> None:
    with Session(engine) as session:
        connection = session.connection()
        if not _table_exists(connection, "text_agents"):
            session.commit()
            return
        for col, ddl in [
            ("embed_primary_color", "VARCHAR(20) NOT NULL DEFAULT '#271173'"),
            ("embed_position", "VARCHAR(20) NOT NULL DEFAULT 'bottom-right'"),
            ("embed_logo_url", "VARCHAR(500) NOT NULL DEFAULT ''"),
        ]:
            if not _column_exists(connection, "text_agents", col):
                connection.execute(text(f"ALTER TABLE text_agents ADD COLUMN {col} {ddl}"))
        session.commit()


def ensure_sofia_error_label_column() -> None:
    with Session(engine) as session:
        connection = session.connection()
        if not _table_exists(connection, "text_conversations"):
            session.commit()
            return
        if not _column_exists(connection, "text_conversations", "sofia_error_label"):
            connection.execute(
                text(
                    "ALTER TABLE text_conversations "
                    "ADD COLUMN sofia_error_label VARCHAR(50) NOT NULL DEFAULT ''"
                )
            )
        session.commit()


def ensure_text_conversations_channel_column() -> None:
    with Session(engine) as session:
        connection = session.connection()
        if not _table_exists(connection, "text_conversations"):
            session.commit()
            return
        if not _column_exists(connection, "text_conversations", "channel"):
            connection.execute(
                text(
                    "ALTER TABLE text_conversations "
                    "ADD COLUMN channel VARCHAR(20) NOT NULL DEFAULT 'web'"
                )
            )
            connection.execute(
                text(
                    """
                    UPDATE text_conversations SET channel =
                        CASE
                            WHEN title LIKE 'whatsapp:%' THEN 'whatsapp'
                            WHEN title LIKE 'embed:%'    THEN 'embed'
                            ELSE 'web'
                        END
                    """
                )
            )
        session.commit()


# ── Background scheduler ───────────────────────────────────────────────────────

async def _renewal_scheduler_loop(stop_event: asyncio.Event) -> None:
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


# ── Lifespan ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_: FastAPI):
    validate_startup_secrets()
    start_cloudflare_tunnel()

    SQLModel.metadata.create_all(engine)

    if _needs_schema_migrations():
        ensure_user_auth_columns()
        _ensure_userrole_enum_has_super_admin()
        ensure_platform_super_admin_role()
        ensure_token_auth_columns()
        ensure_text_agents_content_columns()
        ensure_text_agent_tools_schema_columns()
        ensure_text_appointments_columns()
        ensure_kb_index_columns()
        ensure_sofia_and_escalation_columns()
        ensure_text_agents_legal_notice_column()
        ensure_whatsapp_app_secret_column()
        ensure_text_conversations_channel_column()
        ensure_sofia_error_label_column()
        ensure_embed_customization_columns()
        ensure_contacts_table()
        ensure_voice_messages_table()
        ensure_user_calendar_connections_table()

    scheduler_stop = asyncio.Event()
    scheduler_task = asyncio.create_task(_renewal_scheduler_loop(scheduler_stop))

    yield

    scheduler_stop.set()
    await scheduler_task
    stop_cloudflare_tunnel()


# ── App factory ────────────────────────────────────────────────────────────────

app = FastAPI(lifespan=lifespan)

register_exception_handlers(app)
add_cors_middleware(app)
app.add_middleware(RateLimiterMiddleware)

app.include_router(auth_router, prefix="/api")
app.include_router(agents_router, prefix="/api")
app.include_router(text_agents_router, prefix="/api")
app.include_router(privacy_router, prefix="/api")
app.include_router(webhooks_router, prefix="/api")
app.include_router(sofia_errors_router, prefix="/api")
app.include_router(audit_router, prefix="/api")
app.include_router(contacts_router, prefix="/api")
app.include_router(calendars_router, prefix="/api")


@app.get("/health", include_in_schema=False)
async def health_check():
    return {"status": "ok"}
