from typing import Annotated, Generator
from fastapi import Depends
from sqlmodel import Session
from app.config.db import engine

def get_db() -> Generator[Session, None, None]:
    with Session(engine, expire_on_commit=False) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_db)]
