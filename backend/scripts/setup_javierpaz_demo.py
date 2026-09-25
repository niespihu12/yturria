"""
Prepara la demo para Javier Paz Suarez y Cia Ltda (correduria de seguros, Popayan).

1. Borra TODOS los agentes de voz y de texto de nicolas.pinzon@aossas.com
   (incluye limpieza de dependencias y del agente en ElevenLabs).
2. Crea una Secretaria Virtual (voz + texto) alineada a javierpaz.com.

Ejecutar desde backend/ con:
  ./.venv/Scripts/python.exe scripts/setup_javierpaz_demo.py
"""
import os
import sys
from uuid import uuid4
from datetime import datetime

from dotenv import load_dotenv
load_dotenv()

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "").strip()
if not ELEVENLABS_API_KEY:
    print("ERROR: ELEVENLABS_API_KEY no esta configurada en el .env")
    sys.exit(1)

import httpx
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.config.db import engine
from sqlmodel import Session, select, delete

from app.models import User, UserAgent, TextAgent
from app.models.TextAppointment import TextAppointment
from app.models.TextAgentTool import TextAgentTool
from app.models.TextAgentKnowledgeBase import TextAgentKnowledgeBase
from app.models.TextAgentWhatsApp import TextAgentWhatsApp
from app.models.TextConversation import TextConversation
from app.models.TextMessage import TextMessage
from app.models.VoiceAgentRuntimeConfig import VoiceAgentRuntimeConfig

EMAIL = "nicolas.pinzon@aossas.com"
BASE_URL = "https://api.elevenlabs.io/v1"
HEADERS = {"xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json"}
# Voz femenina calida en espanol (misma que la demo anterior).
VOICE_ID = "Xb7hH8MSUJpSbSDYk0k2"

# ── Contenido alineado a javierpaz.com ────────────────────────────────────────

COMPANY = "Javier Paz Suarez y Cia Ltda"

SECRETARY_PROMPT = """Eres la secretaria virtual de Javier Paz Suarez y Cia Ltda, una correduria de seguros con mas de 30 anos de experiencia en Popayan, Cauca (Colombia). Tu trabajo es recibir y atender a los clientes como lo haria una secretaria profesional: con calidez, orden y eficiencia.

SOBRE LA EMPRESA:
- Correduria/asesoria de seguros con mas de 30 anos en el mercado.
- Atiende a personas naturales y empresas de todos los tamanos.
- Direccion: Carrera 7 #2-56, Centro, Popayan, Cauca.
- Telefono / WhatsApp: +57 315 542 6211.
- Correo: recepcion@javierpaz.com.
- Horario de atencion: lunes a viernes de 7:00 a.m. a 6:00 p.m.; sabados y festivos de 7:00 a.m. a 1:00 p.m.

RAMOS Y SERVICIOS QUE OFRECEMOS:
- Danos: seguro de automoviles, hogar/vivienda, pequenas empresas (pyme), propiedad horizontal (copropiedades), transporte de carga, transporte de valores, responsabilidad civil, todo riesgo construccion y maquinaria.
- Personas: vida individual y colectiva, accidentes personales y seguro escolar.
- Finanzas y garantias: garantias de cumplimiento, cauciones judiciales y garantias de comercio exterior.
- Servicios complementarios: asesoria en licitaciones (polizas para procesos de contratacion), acompanamiento en reclamaciones de siniestros y analisis preventivo de riesgos.

TU ROL COMO SECRETARIA VIRTUAL:
1. Saluda con cortesia y presentate como la secretaria virtual de la empresa.
2. Identifica que necesita el cliente: cotizar un seguro, renovar, reportar o hacer seguimiento a un siniestro, agendar una cita o hablar con un asesor.
3. Para cotizaciones: pregunta el ramo (auto, hogar, vida, empresa, etc.) y toma los datos basicos: nombre completo, telefono de contacto, ciudad y una breve descripcion de lo que desea asegurar. Confirma que un asesor lo contactara.
4. Para siniestros: toma nota del nombre, telefono, numero de poliza si lo tiene y una descripcion del suceso; indica que un asesor dara acompanamiento en el proceso de reclamacion.
5. Para citas: ofrece los horarios de atencion y agenda segun la disponibilidad del cliente, confirmando los datos.
6. Brinda informacion general de horarios, ubicacion y canales de contacto cuando la pidan.

REGLAS:
- Habla en espanol de Colombia, de forma profesional y cercana; trata de "usted".
- Manten las respuestas breves, claras y accionables (no mas de 3 o 4 frases por turno).
- Nunca des precios ni primas exactas: explica que el valor depende del riesgo y que un asesor preparara la cotizacion.
- No inventes coberturas, condiciones ni datos que no aparezcan aqui; si no sabes algo, ofrece tomar los datos para que un asesor responda.
- Nunca digas que eres una inteligencia artificial; di que eres la secretaria virtual de Javier Paz Suarez y Cia.
- Si el cliente quiere cerrar la compra, reportar un siniestro urgente o hablar con una persona, toma sus datos y conecta o deriva con un asesor humano."""

SECRETARY_WELCOME = (
    "Buen dia, le saluda la secretaria virtual de Javier Paz Suarez y Cia, su correduria de "
    "seguros en Popayan. Con gusto le ayudo a cotizar un seguro, agendar una cita o atender una "
    "reclamacion. En que le puedo colaborar?"
)

VOICE_AGENT_NAME = "Secretaria Virtual - Javier Paz Suarez y Cia"
TEXT_AGENT_NAME = "Secretaria Virtual - Javier Paz Suarez y Cia"
BRAND_COLOR = "#0B3D69"  # azul corporativo (seguros)


# ── ElevenLabs helpers ────────────────────────────────────────────────────────

def el_delete_agent(agent_id: str) -> None:
    try:
        r = httpx.delete(f"{BASE_URL}/convai/agents/{agent_id}", headers=HEADERS, timeout=30)
        if r.is_success:
            print(f"    [EL] borrado {agent_id}")
        elif r.status_code == 404:
            print(f"    [EL] {agent_id} ya no existia (404)")
        else:
            print(f"    [EL] WARN {r.status_code} al borrar {agent_id}: {r.text[:160]}")
    except Exception as e:
        print(f"    [EL] ERROR borrando {agent_id}: {e}")


def el_create_agent(name: str, first_message: str, prompt: str) -> dict | None:
    payload = {
        "conversation_config": {
            "agent": {
                "prompt": {"prompt": prompt},
                "first_message": first_message,
                "language": "es",
            },
            "tts": {"model_id": "eleven_turbo_v2_5", "voice_id": VOICE_ID},
        },
        "name": name,
        "platform_settings": {"widget": {"title": "Secretaria Virtual", "avatar_url": ""}},
    }
    r = httpx.post(f"{BASE_URL}/convai/agents/create", json=payload, headers=HEADERS, timeout=60)
    if not r.is_success:
        print(f"    [EL] ERROR {r.status_code}: {r.text[:300]}")
        return None
    return r.json()


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    with Session(engine) as session:
        user = session.exec(select(User).where(User.email == EMAIL)).first()
        if not user:
            print(f"ERROR: usuario {EMAIL} no encontrado")
            sys.exit(1)
        uid = user.id
        print(f"Usuario: {user.email} | id={uid} | rol={user.role}")
        print("=" * 70)

        # 1) BORRAR AGENTES DE VOZ
        voice_rows = session.exec(select(UserAgent).where(UserAgent.user_id == uid)).all()
        print(f"\n[1/3] Borrando {len(voice_rows)} agente(s) de VOZ...")
        for row in voice_rows:
            print(f"  - {row.agent_id}")
            el_delete_agent(row.agent_id)
            session.exec(
                delete(VoiceAgentRuntimeConfig).where(
                    VoiceAgentRuntimeConfig.agent_id == row.agent_id
                )
            )
            session.exec(
                delete(TextAppointment).where(TextAppointment.voice_agent_id == row.agent_id)
            )
            session.delete(row)
        session.commit()

        # 2) BORRAR AGENTES DE TEXTO (con dependencias)
        text_rows = session.exec(select(TextAgent).where(TextAgent.user_id == uid)).all()
        print(f"\n[2/3] Borrando {len(text_rows)} agente(s) de TEXTO...")
        for ta in text_rows:
            print(f"  - {ta.id}  ({ta.name})")
            session.exec(delete(TextAppointment).where(TextAppointment.text_agent_id == ta.id))
            session.exec(delete(TextAgentTool).where(TextAgentTool.text_agent_id == ta.id))
            session.exec(
                delete(TextAgentKnowledgeBase).where(TextAgentKnowledgeBase.text_agent_id == ta.id)
            )
            session.exec(delete(TextAgentWhatsApp).where(TextAgentWhatsApp.text_agent_id == ta.id))
            conv_ids = [
                c.id
                for c in session.exec(
                    select(TextConversation).where(TextConversation.text_agent_id == ta.id)
                ).all()
            ]
            if conv_ids:
                session.exec(delete(TextMessage).where(TextMessage.conversation_id.in_(conv_ids)))
            session.exec(delete(TextConversation).where(TextConversation.text_agent_id == ta.id))
            session.exec(delete(TextAgent).where(TextAgent.id == ta.id))
        session.commit()

        # 3) CREAR SECRETARIA VIRTUAL (voz + texto)
        print("\n[3/3] Creando Secretaria Virtual de Javier Paz Suarez y Cia...")

        # 3a) Voz
        print("  > Agente de VOZ...")
        result = el_create_agent(VOICE_AGENT_NAME, SECRETARY_WELCOME, SECRETARY_PROMPT)
        if result and result.get("agent_id"):
            voice_id = result["agent_id"]
            session.add(UserAgent(user_id=uid, agent_id=voice_id))
            print(f"    [OK] voz creada: {voice_id}")
        else:
            voice_id = None
            print("    [FAIL] no se pudo crear el agente de voz")

        # 3b) Texto
        print("  > Agente de TEXTO...")
        now = datetime.utcnow()
        text_agent = TextAgent(
            id=str(uuid4()),
            user_id=uid,
            name=TEXT_AGENT_NAME,
            provider="openai",
            model="gpt-4o-mini",
            system_prompt=SECRETARY_PROMPT,
            welcome_message=SECRETARY_WELCOME,
            language="es",
            temperature=0.6,
            max_tokens=600,
            template_key="recepcionista",
            sofia_mode=False,
            sofia_config_json="{}",
            embed_enabled=True,
            embed_token=str(uuid4())[:16],
            embed_primary_color=BRAND_COLOR,
            embed_position="bottom-right",
            embed_logo_url="",
            legal_notice="",
            created_at=now,
            updated_at=now,
        )
        session.add(text_agent)
        session.commit()
        print(f"    [OK] texto creado: {text_agent.id}")

        # Resumen
        print("\n" + "=" * 70)
        print("LISTO. Estado final de la cuenta:")
        va = session.exec(select(UserAgent).where(UserAgent.user_id == uid)).all()
        ta = session.exec(select(TextAgent).where(TextAgent.user_id == uid)).all()
        print(f"  Voz:   {len(va)} -> " + ", ".join(a.agent_id for a in va))
        print(f"  Texto: {len(ta)} -> " + ", ".join(f'{a.name} [{a.id}]' for a in ta))
        print("=" * 70)


if __name__ == "__main__":
    main()
