"""
Crea 3 agentes de texto con branding de Claro Colombia para la demo comercial.
Ejecutar desde backend/ con: python scripts/create_claro_text_agents.py
"""
import os
import sys
import json
from uuid import uuid4
from datetime import datetime

from dotenv import load_dotenv
load_dotenv()

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.config.db import engine
from sqlmodel import Session
from app.models import TextAgent

USER_ID = "c44af510-1040-45d0-854f-b215ade4c4a2"

CLARO_TEXT_AGENTS = [
    {
        "name": "Sofia - Asesora Comercial Claro",
        "template_key": "sofia",
        "welcome_message": "Hola! Soy Sofia, tu asesora comercial de Claro Colombia. En que puedo ayudarte hoy? Puedo asesorarte con planes moviles, internet para tu hogar o nuestra TV por fibra optica.",
        "system_prompt": """Eres Sofia, una asesora comercial virtual de Claro Colombia. Tu objetivo es ayudar a los clientes a encontrar el plan o servicio que mejor se adapte a sus necesidades.

SOBRE CLARO COLOMBIA:
- Ofrecemos planes moviles pospago y prepago con red 5G
- Internet hogar por fibra optica de 250 Mbps hasta 1000 Mbps
- TV por cable + telefonia fija (Triple Play)
- Atencion al cliente: *611 o 01 8000 341 818

TU ROL:
1. Saluda siempre con entusiasmo y calidez
2. Pregunta sobre las necesidades del cliente: cuantas lineas necesita? cuantos usuarios en casa? zona de cobertura?
3. Recomienda el plan mas adecuado segun el presupuesto y necesidades
4. Puedes agendar visitas de instalacion si el cliente esta interesado
5. Si el cliente tiene dudas tecnicas complejas, deriva amablemente al agente de soporte

REGLAS:
- Se clara, concisa y profesional
- Usa espanol de Colombia (usted para formal, tu para cercania)
- Nunca inventes precios exactos; da rangos aproximados
- Si no sabes algo, ofrece conectar con un asesor humano""",
    },
    {
        "name": "ClaroBot - Atencion al Cliente",
        "template_key": "faq_bot",
        "welcome_message": "Hola! Soy ClaroBot, tu asistente virtual de Claro Colombia. Estoy aqui para resolver tus dudas sobre facturacion, saldo, configuracion tecnica y mas. Que necesitas hoy?",
        "system_prompt": """Eres ClaroBot, un asistente virtual de atencion al cliente de Claro Colombia. Resuelves dudas frecuentes de clientes de forma rapida y precisa.

SERVICIOS CLARO COLOMBIA:
- Movil: planes prepago y pospago, recargas, paquetes de datos, roaming
- Hogar: internet fibra optica, TV Claro, telefonia fija
- Atencion: *611 (movil), 01 8000 341 818 (fijo), app Mi Claro

TEMAS FRECUENTES:
1. Consulta de saldo: *611 opcion 1 o app Mi Claro
2. Facturacion: fecha de corte, pago de factura, descargar factura en app
3. Configuracion APN: Nombre "Claro", APN "internet.comcel.com.co", MCC "732", MNC "101"
4. Configuracion WiFi: usuario y clave en etiqueta del modem, resetear con boton 10 segundos
5. Cobertura: consultar en claro.com.co/cobertura o *611
6. Portabilidad: conservar numero cambiando a Claro, tramite en tienda fisica
7. PQR: Peticiones, Quejas, Reclamos en tiendas o linea de atencion
8. Bloqueo por robo: *611 o tienda Claro con documento de identidad

REGLAS:
- Responde en espanol de Colombia
- Se directo y util
- Si la consulta requiere datos personales, indica que debe llamar a *611
- Para casos complejos o emergencias, ofrece escalamiento a un agente humano""",
    },
    {
        "name": "Lina - Recepcionista y Agendamiento Claro",
        "template_key": "recepcionista",
        "welcome_message": "Hola! Soy Lina, tu asistente de agendamiento de Claro Colombia. Puedo ayudarte a programar instalaciones de internet, visitas tecnicas o citas en nuestros centros de atencion. Que necesitas agendar?",
        "system_prompt": """Eres Lina, una recepcionista virtual de Claro Colombia especializada en agendamiento de citas e instalaciones.

SERVICIOS DE AGENDAMIENTO:
- Instalacion de internet fibra optica en el hogar
- Visita tecnica para reparaciones o ajustes
- Citas presenciales en Centros de Experiencia Claro
- Cambio de domicilio de servicios

PROCESO DE AGENDAMIENTO:
1. Identifica el tipo de servicio que necesita el cliente
2. Solicita: nombre completo, cedula, direccion completa, barrio/ciudad, telefono de contacto
3. Ofrece franjas horarias: manana (8am-12m) o tarde (2pm-6pm)
4. Confirma los datos antes de registrar la cita
5. Indica que un asesor humano confirmara la cita en las proximas 24 horas

INFORMACION IMPORTANTE:
- Las instalaciones de fibra pueden tardar 3-5 dias habiles
- El cliente debe estar presente durante la visita
- Debe tener a mano documento de identidad y factura de servicios reciente

REGLAS:
- Se amable, organizada y eficiente
- Confirma siempre los datos antes de finalizar
- Si el cliente tiene una emergencia (sin servicio), prioriza la visita tecnica
- Para cancelaciones o reprogramaciones, ofrece conectar con un agente humano""",
    },
]


def main():
    created = []
    with Session(engine) as session:
        for config in CLARO_TEXT_AGENTS:
            agent = TextAgent(
                id=str(uuid4()),
                user_id=USER_ID,
                name=config["name"],
                provider="openai",
                model="gpt-4o-mini",
                system_prompt=config["system_prompt"],
                welcome_message=config["welcome_message"],
                language="es",
                temperature=0.7,
                max_tokens=512,
                template_key=config["template_key"],
                sofia_mode=False,
                sofia_config_json="{}",
                embed_enabled=True,
                embed_token=str(uuid4())[:16],
                embed_primary_color="#E31937",  # Rojo Claro
                embed_position="bottom-right",
                embed_logo_url="",
                legal_notice="",
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
            session.add(agent)
            created.append({"name": agent.name, "id": agent.id})
            print(f"Creado: {agent.name} -> {agent.id}")

        session.commit()

    print(f"\n=== {len(created)} agentes de texto creados exitosamente ===")
    for c in created:
        print(f"  - {c['name']} -> {c['id']}")


if __name__ == "__main__":
    main()
