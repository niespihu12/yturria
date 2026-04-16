import os
from sqlmodel import create_engine
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
SQL_ECHO = os.getenv("SQL_ECHO", "false").strip().lower() == "true"

engine = create_engine(DATABASE_URL, echo=SQL_ECHO)
