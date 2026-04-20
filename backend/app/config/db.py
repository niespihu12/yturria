import os
from sqlmodel import create_engine
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
SQL_ECHO = os.getenv("SQL_ECHO", "false").strip().lower() == "true"

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL environment variable is required")

# SQLAlchemy maps bare mysql:// to mysqlclient (MySQLdb); use pure-python PyMySQL.
if DATABASE_URL.startswith("mysql://"):
    DATABASE_URL = DATABASE_URL.replace("mysql://", "mysql+pymysql://", 1)

engine = create_engine(DATABASE_URL, echo=SQL_ECHO)
