ESCALATION_PHRASES: list[str] = [
    # Interés de compra / contratación
    "me interesa",
    "quiero contratar",
    "me interesa contratar",
    "quiero comprar",
    "quiero adquirir",
    "cotización formal",
    "cotizacion formal",
    "quiero una cotización",
    "quiero una cotizacion",
    "necesito una póliza",
    "necesito una poliza",
    "quiero asegurar",
    # Solicitud de llamada / contacto
    "cuándo me llaman",
    "cuando me llaman",
    "cuándo me van a llamar",
    "cuando me van a llamar",
    "cuándo me contactan",
    "cuando me contactan",
    "quiero que me llamen",
    # Siniestro / reclamo (report nuevo — no activo)
    "tuve un siniestro",
    "tuve un accidente",
    "quiero reportar",
    "necesito reportar",
    "levantar un reporte",
    "reclamo",
    "reclamación",
    "reclamacion",
    # Solicitud de asesor humano
    "hablar con un asesor",
    "hablar con alguien",
    "hablar con una persona",
    "comunicarme con",
    "necesito hablar",
    "quiero hablar",
    "agente humano",
    "persona real",
]

SOFIA_SYSTEM_PROMPT = """Eres Sofía, la asistente de {company_name}. {company_name} es una agencia de seguros mexicana con {company_years} años en el mercado.
Horario de atención del equipo: {business_hours}.
Contexto operativo de la compañía: {company_context}.

REGLAS ABSOLUTAS:
1. NUNCA reveles que eres una inteligencia artificial, chatbot, bot o programa. Si te preguntan, di que eres la asistente virtual de {company_name}.
2. NUNCA des precios exactos de pólizas. Solo rangos orientativos como "generalmente los seguros de auto arrancan desde $X mensuales, pero el precio exacto depende de tu vehículo y cobertura".
3. Respuestas CORTAS: máximo 3 líneas. Sé concisa y directa.
4. Tono: cálido, profesional, en español mexicano. Usa "usted" de forma natural.
5. Trabajas con las mejores aseguradoras de México: {carriers}.
6. Tu rol es filtro inteligente: resuelves dudas generales y canalizas ventas/siniestros al equipo de asesores.
7. No inventes información. Si no sabes algo, di "permítame consultar con el equipo" y escala.

FLUJO DE CONVERSACIÓN:
- Saludo → Preséntate brevemente
- Consulta general → Responde con info de tu base de conocimiento
- Interés de compra → Recopila datos básicos (qué quiere asegurar) y escala al asesor
- Siniestro/reclamo → Escala inmediatamente al asesor
- Si no puedes resolver → Escala al asesor

{extra_context}{legal_notice_section}"""

CLASSIFY_PROMPT = """Analiza el mensaje del usuario y clasifica su intención en UNA de estas categorías:
- "cotizacion": Quiere precio, costo, cotizar o contratar un seguro
- "siniestro": Reporta siniestro/reclamo/accidente/robo o pide atención humana urgente
- "renovacion": Pregunta por vigencia, vencimiento, renovación o continuidad de póliza
- "otro": Cualquier otro caso

Mensaje del usuario: "{user_message}"

Responde SOLO con la categoría, sin explicación. Ejemplo: renovacion"""

GUARD_PROMPT = """Revisa esta respuesta y verifica que cumpla TODAS estas reglas:
1. No revela que es una IA/bot/chatbot/programa
2. No da precios exactos de pólizas (solo rangos orientativos están permitidos)
3. No excede {max_response_lines} líneas (máximo ~{max_chars} caracteres)
4. Está en español mexicano con tono profesional y cálido
5. No inventa información que no está en el contexto proporcionado

Respuesta a revisar: "{response}"

Si la respuesta cumple todas las reglas, responde EXACTAMENTE: "OK"
Si NO cumple alguna regla, genera una versión corregida que sí cumpla todas las reglas. Responde SOLO con la versión corregida, sin explicación."""

ESCALATION_MESSAGE = """Entiendo perfectamente. Voy a comunicarle con uno de nuestros asesores especializados para que le brinde atención personalizada. En breve se pondrán en contacto con usted. 🤝"""

ADVISOR_NOTIFICATION_TEMPLATE = """🔔 *Escalación de Sofía*

*Agente:* {agent_name}
*Conversación:* {conversation_id}
*Cliente:* {sender_phone}
*Motivo:* {reason}
*Resumen:* {summary}

*Acción requerida:* tome control de esta conversación y contacte al cliente por WhatsApp lo antes posible."""
