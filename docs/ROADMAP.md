# Roadmap de Producto y Tecnologia

Producto: Yturria AI Platform  
Fecha: Abril 2026  
Objetivo macro: evolucionar de consola operativa a producto usable por cliente final.

## 1. Punto de partida real

### Ya implementado

- Consola web privada para auth, agentes de voz, agentes de texto, knowledge base, tools y settings.
- Integracion de voz con ElevenLabs (gestion de agentes, conversaciones, preview).
- Integracion de texto con OpenAI/Gemini y chat persistente.
- Integracion WhatsApp para texto (Meta y Twilio webhooks).
- Dashboard operacional con data real agregada.

### Deuda activa

- Frontend no compila en limpio por errores TS en tabs de text-agent.
- CORS backend en modo abierto.
- Falta plantilla formal de entorno y despliegue en docs del repo.

### Gap de negocio

La solucion hoy es principalmente para operador/admin. El cliente final todavia no tiene un journey propio en web.

## 2. Resultado esperado (vision)

En 6 meses, la plataforma debe ofrecer:

1. Consola interna robusta (ops).
2. Experiencia cliente final (canal web + WhatsApp + voz).
3. Onboarding y configuracion guiada por negocio.
4. Modelo tenant explicito, metrica por cuenta y facturacion.

## 3. Fases del roadmap

### Fase 0 - Estabilizacion tecnica (0 a 2 semanas)

Objetivo: dejar la base en verde para iterar rapido sin deuda bloqueante.

### Entregables

- Corregir errores TS que rompen npm run build.
- Resolver warning de baseUrl deprecado en tsconfig.
- Endurecer CORS segun FRONTEND_URL (quitar allow_origins = ["*"]).
- Publicar .env.example para backend y frontend con variables minimas.
- Agregar README de arranque local en docs (ya actualizado).

### Criterio de salida

- Build frontend y backend pasan sin errores bloqueantes.
- Equipo puede levantar entorno local en menos de 30 minutos.

### Fase 1 - MVP cliente final en texto (2 a 6 semanas)

Objetivo: habilitar el primer canal cliente final real, empezando por texto.

### Entregables

- Endpoint publico controlado para chat web de agentes de texto.
- Widget embebible minimo para sitios de clientes.
- Session handling de cliente final separado del operador.
- Mejoras de handoff: estado de conversacion y derivacion a humano.
- Baseline de observabilidad: latencia, tasa de error, volumen por canal.

### Criterio de salida

- Al menos 1 flujo end-to-end de cliente final funcionando sin entrar a consola.
- SLA operativo inicial definido (por ejemplo, p95 respuesta texto < 4s).

### Fase 2 - Tenant real y onboarding (1 a 2 meses)

Objetivo: pasar de aislamiento por user_id a modelo de negocio multi-cuenta.

### Entregables

- Modelo Organization/Tenant en base de datos.
- Asociacion usuarios-tenant con roles por tenant.
- Scope de datos por tenant en todos los endpoints de negocio.
- Onboarding guiado para crear primer agente sin soporte tecnico.
- Plantillas de prompt/config por vertical inicial.

### Criterio de salida

- 2 cuentas distintas operando sin fuga de datos.
- Onboarding funcional para crear un agente en menos de 10 minutos.

### Fase 3 - Productizacion de voz (2 a 3 meses)

Objetivo: llevar el modulo de voz de consola a experiencia consistente para cliente final.

### Entregables

- Flujo inbound/outbound de voz con trazabilidad completa.
- Asignacion de numeros y rutas de fallback por tenant.
- Etiquetado de resultados de llamada (resuelta, escalar, no contacto).
- Dashboard unificado voz + texto orientado a conversion.

### Criterio de salida

- Flujo de voz con metricas operativas y de negocio por tenant.

### Fase 4 - Monetizacion y escala inicial (3 a 6 meses)

Objetivo: habilitar crecimiento comercial sostenible.

### Entregables

- Metering de uso por tenant (mensajes, llamadas, tokens).
- Planes y limites por cuenta.
- Facturacion (primer proveedor de pagos).
- Reportes ejecutivos para cliente final.
- Hardening de seguridad y auditoria de cambios.

### Criterio de salida

- Primer tenant de pago operando con limites y facturacion activa.

## 4. Backlog priorizado inmediato

### Prioridad P0

1. Corregir 5 errores TS del build.
2. Cerrar CORS abierto.
3. Documentar variables de entorno faltantes.

### Prioridad P1

1. Definir contrato API para canal cliente final web.
2. Implementar widget chat minimo.
3. Medicion base de latencia y errores por endpoint.

### Prioridad P2

1. Diseno de modelo tenant/organization.
2. Plan de migracion de datos desde user_id-centric.
3. Flujo de onboarding guiado.

## 5. KPIs de seguimiento

### Tecnicos

- Build success rate de frontend y backend.
- p95 latencia de respuestas texto.
- Error rate en webhooks WhatsApp.
- Disponibilidad de endpoints criticos.

### Producto

- Tiempo para primer valor (crear y probar primer agente).
- Conversaciones de cliente final atendidas por canal.
- Tasa de escalacion a humano.
- Conversion a resultado de negocio definido por cliente.

## 6. Riesgos y mitigaciones

### Riesgo

La plataforma se queda como consola interna y no llega a experiencia cliente final.

### Mitigacion

Bloquear roadmap en Fase 1 hasta tener canal cliente final web operativo.

### Riesgo

Deuda tecnica del frontend frena releases.

### Mitigacion

Ejecutar Fase 0 completa antes de nuevas features mayores.

### Riesgo

Fuga de datos entre cuentas cuando crezca la base de clientes.

### Mitigacion

Introducir tenant explicito en Fase 2 con pruebas de aislamiento.

## 7. Lo que NO haremos por ahora

Para mantener foco, se pospone hasta despues de Fase 2:

- Reescribir backend a otro framework.
- Replantear base de datos sin necesidad real de negocio.
- Sobredisenar infraestructura de escala antes de tener tenants activos.
