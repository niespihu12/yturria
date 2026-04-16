from __future__ import annotations

import os
import smtplib
import ssl
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from email.message import EmailMessage
import logging

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)
EMAIL_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="email")


@dataclass(frozen=True)
class EmailSettings:
    mail_user: str
    mail_password: str
    mail_server: str
    mail_port: int
    from_name: str
    from_email: str


def get_email_settings() -> EmailSettings:
    mail_user = os.getenv("MAIL_USER") or os.getenv("SMTP_USER", "")
    mail_password = os.getenv("MAIL_PASSWORD") or os.getenv("SMTP_PASS", "")
    mail_server = os.getenv("MAIL_SERVER") or os.getenv("SMTP_HOST", "")
    mail_port = int(os.getenv("MAIL_PORT") or os.getenv("SMTP_PORT") or "465")
    from_name = os.getenv("MAIL_FROM_NAME", "UpTask")
    from_email = os.getenv("MAIL_FROM_EMAIL", mail_user)

    return EmailSettings(
        mail_user=mail_user,
        mail_password=mail_password,
        mail_server=mail_server,
        mail_port=mail_port,
        from_name=from_name,
        from_email=from_email,
    )


def _deliver_email(*, to_email: str, subject: str, text: str, html: str) -> str:
    settings = get_email_settings()

    message = EmailMessage()
    message["From"] = f"{settings.from_name} <{settings.from_email}>"
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(text)
    message.add_alternative(html, subtype="html")

    if settings.mail_port == 465:
        with smtplib.SMTP_SSL(
            settings.mail_server,
            settings.mail_port,
            context=ssl.create_default_context(),
            timeout=10,
        ) as server:
            server.login(settings.mail_user, settings.mail_password)
            return server.send_message(message) or ""

    with smtplib.SMTP(settings.mail_server, settings.mail_port, timeout=10) as server:
        server.starttls(context=ssl.create_default_context())
        server.login(settings.mail_user, settings.mail_password)
        return server.send_message(message) or ""


def send_email(*, to_email: str, subject: str, text: str, html: str) -> str:
    return _deliver_email(
        to_email=to_email,
        subject=subject,
        text=text,
        html=html,
    )


def _log_async_email_result(future: Future[str], *, to_email: str, subject: str) -> None:
    try:
        future.result()
        logger.info("Email enviado a %s con asunto '%s'", to_email, subject)
    except Exception:
        logger.exception("No se pudo enviar el email a %s", to_email)


def send_email_async(*, to_email: str, subject: str, text: str, html: str) -> None:
    future = EMAIL_EXECUTOR.submit(
        _deliver_email,
        to_email=to_email,
        subject=subject,
        text=text,
        html=html,
    )
    future.add_done_callback(
        lambda current_future: _log_async_email_result(
            current_future,
            to_email=to_email,
            subject=subject,
        )
    )
