"""
Verifica que todos los agentes de demo para Claro Colombia existan.
Ejecutar antes de la reunion comercial.
"""
import os
import sys

from dotenv import load_dotenv
load_dotenv()

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.config.db import engine
from sqlmodel import Session, select
from app.models import TextAgent, UserAgent

USER_ID = "c44af510-1040-45d0-854f-b215ade4c4a2"


def main():
    with Session(engine) as session:
        print("=" * 60)
        print("VERIFICACION PRE-DEMO: Claro Colombia")
        print("=" * 60)

        # Voice agents
        voice_agents = session.exec(
            select(UserAgent).where(UserAgent.user_id == USER_ID)
        ).all()
        print(f"\n[VOZ] Agentes encontrados: {len(voice_agents)}")
        for va in voice_agents:
            print(f"  OK - {va.agent_id}")

        # Text agents
        text_agents = session.exec(
            select(TextAgent).where(TextAgent.user_id == USER_ID)
        ).all()
        print(f"\n[TEXTO] Agentes encontrados: {len(text_agents)}")
        for ta in text_agents:
            print(f"  OK - {ta.name} ({ta.template_key})")

        # Check
        all_ok = len(voice_agents) == 3 and len(text_agents) == 3
        print("\n" + "=" * 60)
        if all_ok:
            print("[OK] TODO LISTO para la demo")
        else:
            print("[FAIL] FALTAN AGENTES. Ejecutar:")
            print("   python scripts/create_claro_demo_agents.py")
            print("   python scripts/create_claro_text_agents.py")
        print("=" * 60)


if __name__ == "__main__":
    main()
