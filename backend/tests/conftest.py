import os
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

# Tests must never touch the real database, mail server or paid APIs. These are
# set before any app module runs load_dotenv(), which never overrides existing vars.
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["JWT_SECRET"] = "test-secret-" + "x" * 40
os.environ["SKIP_STARTUP_CHECK"] = "true"
for _var in (
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "ELEVENLABS_API_KEY",
    "MAIL_PASSWORD",
    "MAIL_USER",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "CLOUDFLARE_TUNNEL_TOKEN",
    "HUBSPOT_API_KEY",
    "SALESFORCE_CLIENT_ID",
    "SALESFORCE_CLIENT_SECRET",
):
    os.environ[_var] = ""

import httpx  # noqa: E402
import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _block_external_network(monkeypatch):
    """Any real outbound HTTP call (OpenAI, Meta, Twilio, Google...) fails the test."""

    def _blocked(self, request, *args, **kwargs):
        raise RuntimeError(f"External network disabled in tests: {request.url}")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", _blocked)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", _blocked)


class FakeSofiaLLM:
    """Deterministic stand-in for ChatOpenAI inside the Sofía graph."""

    def __init__(self, *args, **kwargs):
        pass

    def invoke(self, messages):
        from langchain_core.messages import AIMessage

        prompt = str(getattr(messages[-1], "content", ""))
        if prompt.startswith("Analiza el mensaje del usuario"):
            return AIMessage(content="otro")
        if prompt.startswith("Revisa esta respuesta"):
            return AIMessage(content="OK")
        return AIMessage(content="Respuesta de prueba de Sofía.")


@pytest.fixture(autouse=True)
def _offline_sofia_llm(monkeypatch):
    monkeypatch.setattr("app.services.sofia_graph._make_llm", lambda *a, **k: FakeSofiaLLM())
