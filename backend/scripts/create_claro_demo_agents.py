"""
Crea 3 agentes de voz con branding de Claro Colombia para la demo comercial.
Ejecutar desde backend/ con: python scripts/create_claro_demo_agents.py
"""
import os
import sys

# Cargar .env primero
from dotenv import load_dotenv
load_dotenv()

# Verificar API key
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "").strip()
if not ELEVENLABS_API_KEY:
    print("ERROR: ELEVENLABS_API_KEY no está configurada en el .env")
    sys.exit(1)

import requests
from uuid import uuid4
from datetime import datetime

# Asegurar que app/ esté en el path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.config.db import engine
from sqlmodel import Session, select
from app.models import User, UserAgent

USER_ID = "c44af510-1040-45d0-854f-b215ade4c4a2"
BASE_URL = "https://api.elevenlabs.io/v1"
HEADERS = {"xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json"}


# Prompts personalizados para Claro Colombia
CLARO_PROMPTS = {
    "sofia": {
        "name": "Sofia - Asesora Comercial Claro",
        "first_message": "¡Hola! Soy Sofía, tu asesora comercial de Claro Colombia. ¿En qué puedo ayudarte hoy? Puedo asesorarte con planes móviles, internet para tu hogar o nuestra TV por fibra óptica.",
        "prompt": """Eres Sofía, una asesora comercial virtual de Claro Colombia. Tu objetivo es ayudar a los clientes a encontrar el plan o servicio que mejor se adapte a sus necesidades.

SOBRE CLARO COLOMBIA:
- Ofrecemos planes móviles pospago y prepago con red 5G
- Internet hogar por fibra óptica de 250 Mbps hasta 1000 Mbps
- TV por cable + telefonía fija (Triple Play)
- Atención al cliente: *611 o 01 8000 341 818

TU ROL:
1. Saluda siempre con entusiasmo y calidez
2. Pregunta sobre las necesidades del cliente: ¿cuántas líneas necesita? ¿cuántos usuarios en casa? ¿zona de cobertura?
3. Recomienda el plan más adecuado según el presupuesto y necesidades
4. Puedes agendar visitas de instalación si el cliente está interesado
5. Si el cliente tiene dudas técnicas complejas, deriva amablemente al agente de soporte

REGLAS:
- Sé clara, concisa y profesional
- Usa español de Colombia (usted para formal, tú para cercanía)
- Nunca inventes precios exactos; da rangos aproximados
- Si no sabes algo, ofrece conectar con un asesor humano""",
    },
    "clarobot": {
        "name": "ClaroBot - Atencion al Cliente",
        "first_message": "¡Hola! Soy ClaroBot, tu asistente virtual de Claro Colombia. Estoy aquí para resolver tus dudas sobre facturación, saldo, configuración técnica y más. ¿Qué necesitas hoy?",
        "prompt": """Eres ClaroBot, un asistente virtual de atención al cliente de Claro Colombia. Resuelves dudas frecuentes de clientes de forma rápida y precisa.

SERVICIOS CLARO COLOMBIA:
- Móvil: planes prepago y pospago, recargas, paquetes de datos, roaming
- Hogar: internet fibra óptica, TV Claro, telefonía fija
- Atención: *611 (móvil), 01 8000 341 818 (fijo), app Mi Claro

TEMAS FRECUENTES:
1. Consulta de saldo: *611 opción 1 o app Mi Claro
2. Facturación: fecha de corte, pago de factura, descargar factura en app
3. Configuración APN: Nombre "Claro", APN "internet.comcel.com.co", MCC "732", MNC "101"
4. Configuración WiFi: usuario y clave en etiqueta del módem, resetear con botón 10 segundos
5. Cobertura: consultar en claro.com.co/cobertura o *611
6. Portabilidad: conservar número cambiando a Claro, trámite en tienda física
7. PQR: Peticiones, Quejas, Reclamos en tiendas o línea de atención
8. Bloqueo por robo: *611 o tienda Claro con documento de identidad

REGLAS:
- Responde en español de Colombia
- Sé directo y útil
- Si la consulta requiere datos personales, indica que debe llamar a *611
- Para casos complejos o emergencias, ofrece escalamiento a un agente humano""",
    },
    "lina": {
        "name": "Lina - Recepcionista y Agendamiento Claro",
        "first_message": "¡Hola! Soy Lina, tu asistente de agendamiento de Claro Colombia. Puedo ayudarte a programar instalaciones de internet, visitas técnicas o citas en nuestros centros de atención. ¿Qué necesitas agendar?",
        "prompt": """Eres Lina, una recepcionista virtual de Claro Colombia especializada en agendamiento de citas e instalaciones.

SERVICIOS DE AGENDAMIENTO:
- Instalación de internet fibra óptica en el hogar
- Visita técnica para reparaciones o ajustes
- Citas presenciales en Centros de Experiencia Claro
- Cambio de domicilio de servicios

PROCESO DE AGENDAMIENTO:
1. Identifica el tipo de servicio que necesita el cliente
2. Solicita: nombre completo, cédula, dirección completa, barrio/ciudad, teléfono de contacto
3. Ofrece franjas horarias: mañana (8am-12m) o tarde (2pm-6pm)
4. Confirma los datos antes de registrar la cita
5. Indica que un asesor humano confirmará la cita en las próximas 24 horas

INFORMACIÓN IMPORTANTE:
- Las instalaciones de fibra pueden tardar 3-5 días hábiles
- El cliente debe estar presente durante la visita
- Debe tener a mano documento de identidad y factura de servicios reciente

REGLAS:
- Sé amable, organizada y eficiente
- Confirma siempre los datos antes de finalizar
- Si el cliente tiene una emergencia (sin servicio), prioriza la visita técnica
- Para cancelaciones o reprogramaciones, ofrece conectar con un agente humano""",
    },
}


def create_elevenlabs_agent(name: str, first_message: str, prompt: str) -> dict:
    """Crea un agente en ElevenLabs ConvAI."""
    payload = {
        "conversation_config": {
            "agent": {
                "prompt": {"prompt": prompt},
                "first_message": first_message,
                "language": "es",
            },
            "tts": {
                "model_id": "eleven_turbo_v2_5",
                "voice_id": "Xb7hH8MSUJpSbSDYk0k2",  # Sophia - voz femenina cálida en español
            },
        },
        "name": name,
        "platform_settings": {
            "widget": {
                "title": name.split(" - ")[0],
                "avatar_url": "",
            }
        },
    }

    resp = requests.post(f"{BASE_URL}/convai/agents/create", json=payload, headers=HEADERS)
    if resp.status_code != 200:
        print(f"  ERROR {resp.status_code}: {resp.text[:300]}")
        return None
    return resp.json()


def main():
    with Session(engine) as session:
        user = session.exec(select(User).where(User.id == USER_ID)).first()
        if not user:
            print(f"ERROR: Usuario {USER_ID} no encontrado")
            sys.exit(1)

        print(f"Usuario: {user.email} (rol: {user.role})")
        print(f"API Key ElevenLabs: {ELEVENLABS_API_KEY[:12]}...")
        print()

        # Verificar agentes de voz existentes
        existing_voice = session.exec(select(UserAgent).where(UserAgent.user_id == USER_ID)).all()
        print(f"Agentes de voz existentes: {len(existing_voice)}")
        for va in existing_voice:
            print(f"  - {va.agent_id}")
        print()

        created = []
        for key, config in CLARO_PROMPTS.items():
            print(f"Creando agente de voz: {config['name']} ...")
            result = create_elevenlabs_agent(config["name"], config["first_message"], config["prompt"])
            if result:
                agent_id = result["agent_id"]
                mapping = UserAgent(user_id=USER_ID, agent_id=agent_id)
                session.add(mapping)
                created.append({"key": key, "name": config["name"], "agent_id": agent_id})
                print(f"  [OK] Creado: {agent_id}")
            else:
                print(f"  [FAIL] Fallo la creacion")
            print()

        if created:
            session.commit()
            print(f"=== {len(created)} agentes de voz creados exitosamente ===")
            for c in created:
                print(f"  - {c['name']} -> {c['agent_id']}")
        else:
            print("No se creó ningún agente.")


if __name__ == "__main__":
    main()
