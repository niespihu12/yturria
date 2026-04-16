import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()


def _resolve_allowed_origins() -> list[str]:
    raw = os.getenv("FRONTEND_URL", "http://localhost:5173")
    origins = [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]

    defaults = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:5175",
    ]
    for origin in defaults:
        if origin not in origins:
            origins.append(origin)

    return origins


# def add_cors_middleware(app: FastAPI):
#     app.add_middleware(
#         CORSMiddleware,
#         allow_origins=_resolve_allowed_origins(),

#         allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
#         allow_credentials=True,
#         allow_methods=["*"],
#         allow_headers=["*"],
#     )
    
def add_cors_middleware(app: FastAPI):
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  
        allow_credentials=True,
        allow_methods=["*"],  
        allow_headers=["*"],  
    )