import asyncio
import os
from pprint import pprint

from dotenv import load_dotenv

from app.services.sofia_graph import run_sofia, SofiaConfig
from app.services.sofia_prompts import SOFIA_SYSTEM_PROMPT

load_dotenv()

async def test_escalation():
    print("=== Testing Escalation Flow ===")
    config = SofiaConfig(
        model="gpt-4o-mini",
        extra_escalation_phrases=["asesor", "humano", "hablar con alguien"],
        escalation_threshold=2
    )

    # Simulate a conversation where the user is getting frustrated
    history = [
        {"role": "user", "content": "La bomba de la pipa no enciende y ya intenté todo."},
        {"role": "assistant", "content": "Por favor, verifica si la toma de corriente tiene voltaje y si el interruptor principal está activado."},
        {"role": "user", "content": "Sigue sin funcionar. Qué más hago?"},
        {"role": "assistant", "content": "Revisa que no haya obstrucción mecánica en las aspas."}
    ]
    user_message = "No veo nada. Necesito que un asesor humano me atienda o me manden un técnico porque esto urge."

    result = await run_sofia(
        user_message=user_message,
        history=history,
        rag_context="", # No KB matched
        message_count=len(history) // 2,
        system_prompt_override=SOFIA_SYSTEM_PROMPT,
        config=config.__dict__
    )

    print("Result State:", result)
    print("Action taken / Intent:", result.get("intent"))
    print("Should Escalate:", result.get("should_escalate"))
    print("Last Message / Response:", result.get("response"))
    print("\n")


async def test_rag():
    print("=== Testing Support RAG Flow ===")
    config = SofiaConfig(
        model="gpt-4o-mini",
        extra_escalation_phrases=["asesor", "humano", "hablar con alguien"],
        escalation_threshold=2
    )

    history = []
    user_message = "¿Cuál es la presión de trabajo normal para la válvula de paso 3/4?"

    kb_context = "Manual de Válvulas Yturria: La válvula de paso de 3/4 pulgada debe operar entre 40 y 60 PSI para evitar desgaste acelerado."

    result = await run_sofia(
        user_message=user_message,
        history=history,
        rag_context=kb_context,
        message_count=0,
        system_prompt_override=SOFIA_SYSTEM_PROMPT,
        config=config.__dict__
    )

    print("Result State:", result)
    print("Action taken / Intent:", result.get("intent"))
    print("Should Escalate:", result.get("should_escalate"))
    print("Last Message / Response:", result.get("response"))
    print("\n")

if __name__ == "__main__":
    asyncio.run(test_escalation())
    asyncio.run(test_rag())
