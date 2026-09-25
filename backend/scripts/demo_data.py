"""Datos de demostración para revisar la interfaz con contenido realista.

Solo lo usa scripts/seed_e2e.py (SQLite desechable) cuando SEED_DEMO_DATA=1.
El tono sigue el manual de marca: se ustedea al cliente y no se usa "problema".
"""
from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta

from sqlmodel import Session, select

from app.models.Contact import Contact
from app.models.TextAgent import TextAgent
from app.models.TextAppointment import TextAppointment
from app.models.TextConversation import TextConversation
from app.models.TextMessage import TextMessage
from app.models.User import User

CONVERSATIONS = [
    # (canal, horas atrás, escalamiento, motivo, [(rol, texto), ...])
    ("whatsapp", 0.3, "pending", "user_request", [
        ("user", "Buenas tardes, tuve un choque leve esta mañana y quiero reportarlo."),
        ("assistant", "Lamento la situación. Con gusto le ayudo: ¿me confirma la placa del vehículo y si hay personas lesionadas?"),
        ("user", "Placa KLM 482, nadie resultó herido. Prefiero hablar con un asesor."),
        ("assistant", "Entendido. Ya le pedí a un asesor de Seguros Bolívar que lo contacte en los próximos minutos."),
    ]),
    ("web", 0.8, "none", "", [
        ("user", "¿Qué cubre el seguro de hogar si hay daños por agua?"),
        ("assistant", "El seguro de hogar cubre daños por agua accidental, como una tubería rota. ¿Desea que le envíe el detalle de coberturas?"),
    ]),
    ("embed", 1.5, "none", "", [
        ("user", "Quiero cotizar un seguro para mi moto."),
        ("assistant", "Con gusto. ¿Me indica el modelo y el año de su moto para preparar la cotización?"),
        ("user", "Yamaha NMAX 2023."),
    ]),
    ("whatsapp", 2.2, "resolved", "active_claim", [
        ("user", "Tengo un siniestro abierto y no me han dado respuesta."),
        ("assistant", "Comprendo. Le comunico con la persona que lleva su caso para darle una respuesta hoy mismo."),
    ]),
    ("web", 3.0, "none", "", [
        ("user", "¿Cuándo vence mi póliza de autos?"),
        ("assistant", "Para revisarlo, ¿me confirma el número de documento del titular?"),
    ]),
    ("whatsapp", 4.1, "pending", "uncertainty_detected", [
        ("user", "¿La póliza de vida cubre enfermedades preexistentes diagnosticadas hace diez años?"),
        ("assistant", "Es una consulta que debe revisar un asesor especializado. Ya lo contacté para que le dé una respuesta precisa."),
    ]),
    ("embed", 5.0, "none", "", [
        ("user", "Necesito un certificado de mi seguro de arrendamiento."),
        ("assistant", "Claro. Le enviaré el certificado al correo registrado en su póliza. ¿Lo confirma?"),
        ("user", "Sí, por favor."),
    ]),
    ("web", 6.4, "none", "", [
        ("user", "¿Puedo pagar la póliza en cuotas?"),
        ("assistant", "Sí, puede diferir el pago hasta en 12 cuotas mensuales. ¿Le gustaría agendar una llamada con un asesor?"),
    ]),
    ("whatsapp", 7.5, "none", "", [
        ("user", "Hola, quiero agendar una cita para revisar mi seguro de salud."),
        ("assistant", "Con gusto. Tengo disponibilidad mañana a las 10:00 a. m. o a las 3:00 p. m. ¿Cuál prefiere?"),
        ("user", "Mañana a las 10."),
        ("assistant", "Listo, su cita quedó agendada para mañana a las 10:00 a. m. Le enviaremos un recordatorio."),
    ]),
    ("embed", 8.8, "resolved", "user_request", [
        ("user", "Prefiero que me llame una persona."),
        ("assistant", "Por supuesto. Un asesor lo llamará en el horario que usted indique."),
    ]),
    ("web", 10.2, "none", "", [
        ("user", "¿Qué documentos necesito para reclamar por hurto de celular?"),
        ("assistant", "Necesita la denuncia, la factura del equipo y su documento de identidad. ¿Desea iniciar la reclamación?"),
    ]),
    ("whatsapp", 11.5, "none", "", [
        ("user", "Gracias por la atención de ayer."),
        ("assistant", "Con mucho gusto. Estamos atentos a lo que necesite."),
    ]),
]

APPOINTMENTS = [
    # (días desde hoy, hora, nombre, teléfono, estado, origen, notas)
    (0, 10, "Laura Gómez", "+573001112233", "confirmed", "whatsapp", "Revisión de seguro de salud familiar."),
    (0, 15, "Andrés Pérez", "+573014445566", "scheduled", "web", "Cotización de seguro de autos."),
    (1, 9, "María Fernanda Ruiz", "+573107778899", "scheduled", "voice", "Renovación de póliza de hogar."),
    (2, 11, "Carlos Ramírez", "+573152223344", "scheduled", "whatsapp", "Asesoría sobre seguro de vida."),
    (4, 16, "Paula Herrera", "+573205556677", "confirmed", "embed", "Cotización de seguro para moto."),
    (-1, 14, "Jorge Medina", "+573008889900", "completed", "voice", "Seguimiento de reclamación por choque."),
    (-3, 10, "Natalia Castro", "+573113334455", "no_show", "web", "Consulta de pagos en cuotas."),
]

CONTACTS = [
    ("Diana", "Morales", "Seguros de autos", "+573001234567"),
    ("Felipe", "Ortiz", "Seguros de hogar", "+573012345678"),
    ("Camila", "Rojas", "Salud y vida", "+573023456789"),
    ("Julián", "Vargas", "Reclamaciones", "+573034567890"),
    ("Sara", "Jiménez", "Pymes y empresas", "+573045678901"),
]


WHATSAPP_PHONES = ["+573004567812", "+573157771234", "+573209981122", "+573114450098", "+573016672233"]


def _conversation_title(channel: str, index: int, first_message: str) -> str:
    # Mismo formato que usa el backend real para cada canal.
    if channel == "whatsapp":
        return f"whatsapp:{WHATSAPP_PHONES[index % len(WHATSAPP_PHONES)]}"
    if channel == "embed":
        return f"embed:{secrets.token_hex(8)}"
    return first_message[:80]


def seed_demo_data(session: Session, *, owner_email: str) -> None:
    owner = session.exec(select(User).where(User.email == owner_email)).one()
    now = datetime.utcnow()

    sofia = TextAgent(
        user_id=owner.id,
        name="Sofía · Atención al cliente",
        provider="openai",
        model="gpt-4o-mini",
        template_key="sofia",
        sofia_mode=True,
        sofia_config_json=json.dumps({"company_name": "Seguros Bolívar", "escalation_threshold": 4}),
        welcome_message="Hola, soy Sofía. ¿En qué le puedo ayudar hoy?",
        system_prompt="Asistente de atención al cliente para seguros. Ustedea al cliente.",
        embed_token=secrets.token_urlsafe(24),
        embed_primary_color="#006B38",
        created_at=now - timedelta(days=12),
        updated_at=now - timedelta(hours=2),
    )
    quotes = TextAgent(
        user_id=owner.id,
        name="Cotizador de autos",
        provider="openai",
        model="gpt-4o-mini",
        template_key="custom",
        welcome_message="Hola, le ayudo a cotizar el seguro de su vehículo.",
        system_prompt="Asistente de cotización de seguros de autos. Ustedea al cliente.",
        embed_token=secrets.token_urlsafe(24),
        embed_primary_color="#006B38",
        created_at=now - timedelta(days=5),
        updated_at=now - timedelta(days=1),
    )
    session.add(sofia)
    session.add(quotes)
    session.commit()

    conversations: list[TextConversation] = []
    for index, (channel, hours_ago, escalation, reason, messages) in enumerate(CONVERSATIONS):
        started = now - timedelta(hours=hours_ago)
        agent = sofia if index % 4 != 2 else quotes
        conversation = TextConversation(
            text_agent_id=agent.id,
            user_id=owner.id,
            title=_conversation_title(channel, index, messages[0][1]),
            channel=channel,
            escalation_status=escalation,
            escalation_reason=reason,
            escalated_at=started + timedelta(minutes=2) if escalation != "none" else None,
            created_at=started,
            updated_at=started + timedelta(minutes=len(messages)),
        )
        session.add(conversation)
        session.commit()
        conversations.append(conversation)
        for position, (role, content) in enumerate(messages):
            session.add(
                TextMessage(
                    conversation_id=conversation.id,
                    role=role,
                    content=content,
                    provider="openai",
                    model="gpt-4o-mini",
                    created_at=started + timedelta(seconds=40 * position),
                )
            )
    session.commit()

    embed_escalated = [c for c in conversations if c.channel != "whatsapp" and c.escalation_status != "none"]
    today = now.replace(minute=0, second=0, microsecond=0)
    for position, (days, hour_local, name, phone, status, source, notes) in enumerate(APPOINTMENTS):
        # Horas locales de Bogotá (UTC-5) guardadas en UTC.
        start = (today + timedelta(days=days)).replace(hour=0) + timedelta(hours=hour_local + 5)
        session.add(
            TextAppointment(
                text_agent_id=sofia.id,
                user_id=owner.id,
                conversation_id=embed_escalated[position].id if position < len(embed_escalated) else None,
                contact_name=name,
                contact_phone=phone,
                appointment_date=start,
                status=status,
                source=source,
                notes=notes,
            )
        )

    for name, last_name, specialty, phone in CONTACTS:
        session.add(
            Contact(
                user_id=owner.id,
                name=name,
                last_name=last_name,
                specialty=specialty,
                phone=phone,
                whatsapp=phone,
                email=f"{name.lower()}.{last_name.lower()}@asesores.test",
            )
        )
    session.commit()
