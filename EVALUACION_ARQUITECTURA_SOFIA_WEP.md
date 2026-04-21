# Evaluación de Arquitectura y Sistema - Sofía WEP

## 📊 Calificación General: **7.5/10**

---

## 1. Evaluación por Categoría

### ✅ **Fortalezas Identificadas (8-10/10)**

| Categoría | Calificación | Observaciones |
|-----------|--------------|---------------|
| **Modelo de Negocio** | 9/10 | Propuesta de valor clara, piloto concreto (Yturria), hipótesis validable |
| **Arquitectura Backend** | 8/10 | FastAPI + SQLModel bien estructurado, separación de capas clara |
| **Modo Sofía (LangGraph)** | 9/10 | Grafo de conversación bien diseñado, clasificación de intents robusta |
| **Sistema de Escalación** | 8/10 | Múltiples triggers, notificación WhatsApp al asesor, prevención de re-escalación |
| **Multi-tenant** | 8/10 | Aislamiento por usuario, configuración Sofía por agente |
| **RAG / Base de Conocimiento** | 8/10 | Chunking vectorizado, recuperación top-5, integración en contexto |
| **Cumplimiento Legal** | 9/10 | Aviso legal configurable, inyección en primer mensaje, no duplicación |
| **Suite de Pruebas** | 9/10 | 50 casos parametrizados, matriz de aceptación, umbral 90% |

### ⚠️ **Áreas de Mejora Crítica (5-7/10)**

| Categoría | Calificación | Problema | Impacto |
|-----------|--------------|----------|---------|
| **Infraestructura / Deploy** | 5/10 | No hay Docker, Kubernetes, CI/CD definido | Alto riesgo operacional |
| **Seguridad Perimetral** | 4/10 | Cloudflare Tunnel mencionado pero no implementado | Exposición directa del Mac Studio |
| **Monitoreo / Observabilidad** | 4/10 | Logs básicos, sin métricas, tracing o alertas | Cero visibilidad en producción |
| **Gestión de Secretos** | 6/10 | Fernet para API keys, pero variables de entorno en .env | Riesgo de fuga de credenciales |
| **WhatsApp Business API** | 6/10 | Meta y Twilio soportados, pero sin fallback web-first | Dependencia crítica de aprobación Meta |
| **Documentación de Operación** | 6/10 | READMEs completos, pero sin runbooks de incidentes | Difícil handover operacional |

### ❌ **Lagunas Importantes (3-5/10)**

| Categoría | Calificación | Lo que falta | Prioridad |
|-----------|--------------|--------------|-----------|
| **Frontend - Onboarding** | 5/10 | Wizard existe pero no hay flujo de "5 minutos" garantizado | Alta |
| **Widget Embed** | 6/10 | Funcional pero sin analytics de uso ni customización avanzada | Media |
| **Dashboard Métricas** | 5/10 | Métricas básicas, sin funnels de conversión ni ROI | Media |
| **Gestión de Errores IA** | 5/10 | Guard prompt existe pero sin dashboard de halluncinaciones | Alta |
| **Backup / Recovery** | 3/10 | Sin estrategia de backup de BD definida | Crítica |
| **Rate Limiting** | 4/10 | Sin protección contra abuso de API | Alta |
| **Auditoría / Compliance** | 6/10 | AuditTrailEvent existe pero sin reportes exportables | Media |

---

## 2. Gap Analysis vs Requerimientos

### ✅ **Lo que SÍ está implementado**

| Requerimiento | Estado | Ubicación |
|---------------|--------|-----------|
| System prompt base de Sofía | ✅ Completo | `sofia_prompts.py`, `client_defaults.py` |
| Respuestas máx 3 líneas | ✅ Implementado | `max_response_lines` en SofiaConfig + guard node |
| NUNCA decir que es IA | ✅ Regla absoluta | SOFIA_SYSTEM_PROMPT regla #1 |
| NUNCA precios exactos | ✅ Regla absoluta | SOFIA_SYSTEM_PROMPT regla #2 + guard checker |
| Escalar por frases clave | ✅ 40+ frases | `ESCALATION_PHRASES` + extra_escalation_phrases |
| Escalar por threshold | ✅ Configurable | `escalation_threshold` (1-20), default 4 |
| Aviso legal primer mensaje | ✅ Idempotente | `_maybe_prepend_legal_notice()` |
| Multi-canal (WhatsApp, Web, Embed) | ✅ 4 canales | Auth, Meta, Twilio, Embed público |
| Notificación al asesor | ✅ WhatsApp | `_notify_advisor_whatsapp()` |
| RAG con chunks vectorizados | ✅ Top-5 | `_retrieve_rag_context()` |
| Citas automáticas | ✅ Google Calendar | `TextAppointment`, `google_calendar.py` |
| Renovaciones scheduler | ✅ Background task | `renewal_scheduler.py` (cada 1h) |
| Tests de aceptación | ✅ 50 casos | `test_sofia_acceptance_matrix.py` |

### ❌ **Lo que NO está implementado (o está incompleto)**

| Requerimiento | Estado | Brecha | Riesgo |
|---------------|--------|--------|--------|
| **"Self-service en 5 minutos"** | ⚠️ Parcial | Wizard existe pero no hay garantía de defaults "tan buenos que funcione aunque el cliente no haga nada" | Medio |
| **Fallback web-first si Meta demora** | ❌ Ausente | Todo el sistema asume WhatsApp como canal primario; widget embed existe pero no está integrado en onboarding | Alto |
| **Dataset de 50 preguntas reales para validar alucinaciones** | ⚠️ Parcial | Tests existen pero son unitarios; no hay dataset de validación pre-lanzamiento documentado | Alto |
| **Product Owner secundario en Yturria** | ❌ No aplica código | Es un gap organizacional, no técnico | Alto |
| **Cloudflare Tunnel configurado** | ❌ Ausente | Mencionado en diagrama pero sin implementación en código | Crítico |
| **SSL/TLS automático** | ❌ Ausente | Depende de infraestructura externa no documentada | Crítico |
| **Transparencia "asistente virtual"** | ✅ Implementado | SOFIA_FIRST_MESSAGE dice "asistente virtual", nunca "humana" | Bajo |
| **Escalación agresiva ante duda técnica** | ⚠️ Parcial | Hay escalación por threshold pero no por "duda detectada" en respuesta | Medio |

---

## 3. Lista de Tareas Prioritarias (Lista para Claude Code)

### 🔴 **CRÍTICO - Antes de Producción**

```markdown
## Tarea 1: Implementar Cloudflare Tunnel
**Prioridad:** CRÍTICA  
**Archivo:** `backend/app/utils/startup_check.py` (nuevo)  
**Descripción:** 
- Integrar cloudflared tunnel para exposición segura del backend
- Configurar tunnel automático al startup si variable `CLOUDFLARE_TUNNEL_TOKEN` está presente
- Validar que el tunnel esté activo antes de aceptar tráfico
**Criterio de aceptación:**
- [ ] El backend no acepta conexiones directas si tunnel está configurado
- [ ] Health check del tunnel antes de marcar servicio como ready
- [ ] Documentación de cómo obtener tunnel token en README

## Tarea 2: Rate Limiting por IP y por Usuario
**Prioridad:** CRÍTICA  
**Archivo:** `backend/app/middlewares/rate_limiter.py` (nuevo)  
**Descripción:**
- Implementar rate limiting: 100 req/min por IP, 1000 req/hora por usuario
- Usar Redis o memoria compartida para contadores
- Retornar HTTP 429 con header `Retry-After`
**Criterio de aceptación:**
- [ ] Middleware registra IP y user_id de cada request
- [ ] Bloqueo temporal tras exceder límite
- [ ] Logs de intentos de abuso

## Tarea 3: Backup Automático de Base de Datos
**Prioridad:** CRÍTICA  
**Archivo:** `backend/scripts/backup_db.sh` (nuevo)  
**Descripción:**
- Script cron diario que dump MySQL/PostgreSQL a S3 o GCS
- Retener últimos 7 días de backups
- Alertar si backup falla
**Criterio de aceptación:**
- [ ] Backup comprimido y cifrado
- [ ] Upload automático a cloud storage
- [ ] Log de éxito/fracaso en archivo rotativo

## Tarea 4: Dockerizar Backend y Frontend
**Prioridad:** CRÍTICA  
**Archivos:** `Dockerfile.backend`, `Dockerfile.frontend`, `docker-compose.yml`  
**Descripción:**
- Crear imágenes multi-stage para producción
- docker-compose para orquestar backend + frontend + DB + Redis
- Variables de entorno via .env file
**Criterio de aceptación:**
- [ ] `docker-compose up` levanta todo el stack
- [ ] Imágenes < 500MB cada una
- [ ] Health checks en todos los servicios
```

### 🟠 **ALTO - Primer Sprint Post-Lanzamiento**

```markdown
## Tarea 5: Dashboard de Alucinaciones y Errores
**Prioridad:** ALTA  
**Archivo:** `frontend/src/views/app/sofia-errors/SofiaErrorsView.tsx` (nuevo)  
**Backend:** `backend/app/routes/sofia_errors_router.py` (nuevo)  
**Descripción:**
- Capturar respuestas marcadas como "incorrectas" por guard node
- Mostrar lista de conversaciones con posibles alucinaciones
- Permitir marcar falso positivo / verdadero positivo
**Criterio de aceptación:**
- [ ] Endpoint GET /api/text-agents/{id}/sofia-errors
- [ ] Vista con transcripción y respuesta problemática
- [ ] Exportar a CSV para análisis

## Tarea 6: Onboarding Wizard de 5 Minutos
**Prioridad:** ALTA  
**Archivo:** `frontend/src/components/app/onboarding/FiveMinuteWizard.tsx` (nuevo)  
**Descripción:**
- Flujo guiado: nombre → horario → carriers → teléfono asesor → listo
- Pre-llenar defaults de tenant (Yturria) si es primer agente
- Mostrar preview en tiempo real de cómo responde Sofía
**Criterio de aceptación:**
- [ ] Wizard completado en < 5 minutos cronometrados
- [ ] Agente funcional al finalizar sin configuración adicional
- [ ] Video tutorial embebido en cada paso

## Tarea 7: Fallback Web-First en Onboarding
**Prioridad:** ALTA  
**Archivo:** `frontend/src/components/app/onboarding/ChannelSelectionStep.tsx` (nuevo)  
**Descripción:**
- Ofrecer widget embed como canal inmediato (sin aprobación Meta)
- WhatsApp como opción secundaria con advertencia de tiempos de aprobación
- Generar snippet HTML copiable al finalizar wizard
**Criterio de aceptación:**
- [ ] Usuario puede elegir "Empezar solo con web" o "Web + WhatsApp"
- [ ] Snippet de embed funciona al copiar-pegar en sitio externo
- [ ] Guía paso-a-paso de aprobación Meta descargable en PDF

## Tarea 8: Escalación por Duda Detectada
**Prioridad:** ALTA  
**Archivo:** `backend/app/services/sofia_graph.py` (modificar node `guard`)  
**Descripción:**
- Agregar detector de "no estoy seguro", "permítame consultar", "tengo que verificar"
- Si la IA usa estas frases 2 veces en misma conversación → escalar automáticamente
- Nueva razón de escalación: `uncertainty_detected`
**Criterio de aceptación:**
- [ ] Guard node detecta frases de incertidumbre
- [ ] Contador por conversación en estado
- [ ] Test unitario con 10 variaciones de frases de duda
```

### 🟡 **MEDIO - Segundo Sprint**

```markdown
## Tarea 9: Métricas de Conversión y ROI
**Prioridad:** MEDIA  
**Archivo:** `backend/app/services/analytics_service.py` (nuevo)  
**Frontend:** `frontend/src/components/app/dashboard/ConversionFunnel.tsx` (nuevo)  
**Descripción:**
- Tracking de eventos: conversación iniciada → lead calificado → cita agendada → venta cerrada
- Calcular tasa de conversión por agente
- Estimación de ROI vs secretaria humana
**Criterio de aceptación:**
- [ ] Endpoint GET /api/text-agents/{id}/analytics/funnel
- [ ] Gráfico de embudo en dashboard
- [ ] Cálculo automático de ahorro mensual

## Tarea 10: Reportes de Auditoría Exportables
**Prioridad:** MEDIA  
**Archivo:** `backend/app/routes/audit_router.py` (nuevo)  
**Descripción:**
- Endpoint para exportar AuditTrailEvent a CSV/PDF
- Filtros por fecha, usuario, tipo de evento
- Incluir conversaciones completas en exportación
**Criterio de aceptación:**
- [ ] GET /api/audit/export?from=&to=&format=csv
- [ ] Archivo descargable con todos los eventos filtrados
- [ ] Test de exportación con 10k registros

## Tarea 11: Customización Avanzada de Widget Embed
**Prioridad:** MEDIA  
**Archivo:** `frontend/src/views/embed/TextAgentEmbedView.tsx` (modificar)  
**Descripción:**
- Permitir customizar colores, logo, posición del chat
- Generar snippet con parámetros de estilo
- Preview en tiempo real en panel
**Criterio de aceptación:**
- [ ] Selector de temas (claro/oscuro/personalizado)
- [ ] Upload de logo PNG/SVG
- [ ] Snippet actualizado refleja cambios al instante

## Tarea 12: Dataset de Validación Pre-Lanzamiento
**Prioridad:** MEDIA  
**Archivo:** `backend/tests/validation_dataset/` (nueva carpeta)  
**Descripción:**
- 50 preguntas reales de seguros con respuestas esperadas
- Script de validación automática contra el grafo Sofía
- Reporte de precisión antes de deploy a producción
**Criterio de aceptación:**
- [ ] JSON con 50 QA pairs validadas por Yturria
- [ ] Script `python validate_sofia.py --dataset=validation_dataset`
- [ ] Umbral mínimo 95% de precisión para aprobar deploy
```

### 🟢 **BAJO - Backlog Futuro**

```markdown
## Tarea 13: Multi-idioma (Inglés / Portugués)
**Prioridad:** BAJA  
**Archivos:** `backend/app/services/sofia_config.py`, `client_defaults.py`  
**Descripción:**
- Agregar campo `language` en SofiaConfig
- Traducir system prompts y escalation messages
- Detectar idioma del mensaje del usuario
**Criterio de aceptación:**
- [ ] Soporte para inglés y portugués además de español
- [ ] Detección automática de idioma en classify node
- [ ] Tests con mensajes en los 3 idiomas

## Tarea 14: Integración con CRM (HubSpot, Salesforce)
**Prioridad:** BAJA  
**Archivo:** `backend/app/services/crm_integration.py` (nuevo)  
**Descripción:**
- Push automático de leads calificados a CRM
- Sync de estado de citas y renovaciones
- Webhooks bidireccionales
**Criterio de aceptación:**
- [ ] Connector para HubSpot API
- [ ] Connector para Salesforce API
- [ ] Configurable por agente en panel

## Tarea 15: Voice Analytics Dashboard
**Prioridad:** BAJA  
**Frontend:** `frontend/src/views/app/voice-analytics/VoiceAnalyticsView.tsx` (nuevo)  
**Descripción:**
- Transcripciones de llamadas con búsqueda full-text
- Análisis de sentimiento por llamada
- Detección de palabras clave (venta, siniestro, queja)
**Criterio de aceptación:**
- [ ] Listado de llamadas con transcripción colapsable
- [ ] Filtro por sentimiento (positivo/neutro/negativo)
- [ ] Exportar transcripciones a TXT
```

---

## 4. Recomendaciones Estratégicas

### 🎯 **Enfoque Inmediato (Próximas 2 semanas)**

1. **Implementar Cloudflare Tunnel ANTES de exponer el sistema** - Es un riesgo crítico de seguridad tener el Mac Studio expuesto directamente.

2. **Completar el onboarding de 5 minutos con fallback web-first** - La hipótesis central del producto depende de esto. Si el cliente no puede configurar solo en 5 minutos, el modelo de negocio se rompe.

3. **Validar con dataset de 50 preguntas REALES de Yturria** - No lanzar sin haber probado Sofía con preguntas que los clientes realmente hacen. Las alucinaciones en seguros pueden tener consecuencias legales.

4. **Designar PO secundario en Yturria** - Esto no es código, pero es crítico. Si Enrique se enferma o pierde interés, el proyecto muere sin un sponsor alternativo.

### 📈 **Métricas de Éxito a Monitorear**

| Métrica | Target | Cómo medir |
|---------|--------|------------|
| Tiempo de onboarding | < 5 minutos | Analytics del wizard |
| Tasa de alucinaciones | < 2% | Dashboard de errores Sofía |
| Leads escalados → venta | > 15% | CRM integration o tracking manual |
| Uptime del sistema | > 99.5% | Uptime monitoring (UptimeRobot, Pingdom) |
| CSAT de clientes finales | > 4.5/5 | Encuesta post-conversación opcional |

### ⚠️ **Riesgos No Mitigados**

1. **Dependencia de Meta/WhatsApp** - Si Meta rechaza el número o cambia políticas, el canal principal desaparece. **Mitigación:** Fallback web-first desde día 1.

2. **Single Point of Failure (Mac Studio)** - Si el Mac se cae, todo el sistema se cae. **Mitigación:** Migrar a cloud (AWS/GCP/Azure) con auto-scaling.

3. **Responsabilidad legal por respuestas incorrectas** - Si Sofía da información errónea sobre cobertura y un cliente sufre pérdida, ¿quién es liable? **Mitigación:** Aviso legal más explícito, términos de servicio revisados por abogado.

4. **Fuga de datos sensibles** - Conversaciones de seguros contienen información personal. **Mitigación:** Encriptación en reposo, PII redaction en logs, compliance LFPDPPP.

---

## 5. Conclusión

**El sistema está 75% listo para un piloto controlado con Yturria**, pero necesita trabajo crítico en infraestructura y seguridad antes de exponerse a internet públicamente.

**Lo que SÍ puedes hacer ya:**
- Demo interno con Yturria en red local
- Pruebas de estrés con dataset de validación
- Refinar prompts y thresholds de escalación

**Lo que NO debes hacer todavía:**
- Exponer el backend directamente a internet sin Cloudflare Tunnel
- Prometer SLA de disponibilidad sin monitoreo ni backup
- Lanzar a múltiples clientes sin Dockerizar el deploy

**Veredicto:** Arquitectura sólida, producto validable, pero **infraestructura insuficiente para producción**. Prioriza las tareas CRÍTICAS antes del lanzamiento público.
