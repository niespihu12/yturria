"""Crea una base SQLite limpia con usuarios conocidos para las pruebas end-to-end.

Uso (desde backend/):  DATABASE_URL=sqlite:///./e2e.db python scripts/seed_e2e.py
Se niega a correr contra cualquier base que no sea SQLite.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

DATABASE_URL = os.environ.get("DATABASE_URL", "")
if not DATABASE_URL.startswith("sqlite:///"):
    sys.exit("seed_e2e: DATABASE_URL debe ser sqlite:///<archivo> (nunca la base real)")

db_file = Path(DATABASE_URL.removeprefix("sqlite:///"))
if not db_file.is_absolute():
    db_file = ROOT / db_file
db_file.unlink(missing_ok=True)

from sqlmodel import Session, SQLModel, create_engine  # noqa: E402

import app.models  # noqa: E402,F401
from app.models.User import User, UserRole  # noqa: E402
from app.utils.auth import hash_password  # noqa: E402

E2E_PASSWORD = "E2eClave123!"
USERS = [
    ("admin@e2e.test", "Admin E2E", UserRole.SUPER_ADMIN),
    ("cliente@e2e.test", "Cliente E2E", UserRole.AGENT),
]

engine = create_engine(f"sqlite:///{db_file}")
SQLModel.metadata.create_all(engine)
with Session(engine) as session:
    for email, name, role in USERS:
        session.add(
            User(email=email, name=name, role=role, confirmed=True, password=hash_password(E2E_PASSWORD))
        )
    session.commit()

print(f"seed_e2e: {len(USERS)} usuarios creados en {db_file}")
