import {
  ArrowTrendingUpIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  PhoneIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'
import type { AgentListItem, Conversation, PhoneNumber } from '@/types/agent'
import type { TextAgentSummary, TextConversation, UpcomingRenewal } from '@/types/textAgent'

type DashboardDataset = {
  voiceAgents: AgentListItem[]
  textAgents: TextAgentSummary[]
  phoneNumbers: PhoneNumber[]
  voiceConversations: Conversation[]
  textConversations: TextConversation[]
  upcomingRenewals: UpcomingRenewal[]
}

type QueueItem = {
  conversationId: string
  channel: string
  agentName: string
  reason: string
  priority: 'alta' | 'media'
  updatedAt: number
  summary: string
}

type Props = {
  data: DashboardDataset
  loadedAtText: string
}

const QUOTE_RE = /cotiz|precio|costo|contratar|interesa|llam(en|ame)/i
const CLAIM_RE = /siniestro|accidente|robo|choque|reclamo|dan[o\u00f1]/i

function asUnix(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return 0
  return Math.floor(value)
}

function formatClock(unix: number): string {
  if (!unix) return '--:--'
  return new Date(unix * 1000).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDate(unix: number): string {
  if (!unix) return '--'
  return new Date(unix * 1000).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: 'short',
  })
}

function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function buildQueue(data: DashboardDataset): QueueItem[] {
  const textAgentNames = new Map(data.textAgents.map((agent) => [agent.agent_id, agent.name]))
  const sorted = data.textConversations
    .slice()
    .sort((a, b) => asUnix(b.updated_at_unix_secs) - asUnix(a.updated_at_unix_secs))

  const queue: QueueItem[] = []
  const seen = new Set<string>()

  for (const conversation of sorted) {
    if (seen.has(conversation.conversation_id)) continue

    const status = String(conversation.escalation_status ?? 'none').toLowerCase()
    const preview = String(conversation.last_message_preview ?? '')
    const messageCount = Number(conversation.message_count ?? 0)

    let reason = ''
    let priority: 'alta' | 'media' = 'media'

    if (status === 'pending' || status === 'in_progress') {
      reason = status === 'pending' ? 'Escalacion pendiente' : 'Escalacion en progreso'
      priority = 'alta'
    } else if (CLAIM_RE.test(preview)) {
      reason = 'Posible siniestro reportado'
      priority = 'alta'
    } else if (QUOTE_RE.test(preview)) {
      reason = 'Lead con intencion de compra'
      priority = 'media'
    } else if (messageCount >= 4) {
      reason = '4+ mensajes sin resolver'
      priority = 'media'
    }

    if (!reason) continue

    queue.push({
      conversationId: conversation.conversation_id,
      channel: conversation.channel,
      agentName: textAgentNames.get(conversation.agent_id) ?? conversation.agent_id,
      reason,
      priority,
      updatedAt: asUnix(conversation.updated_at_unix_secs),
      summary: preview || 'Sin resumen disponible.',
    })

    seen.add(conversation.conversation_id)
    if (queue.length >= 8) break
  }

  return queue
}

export default function SecretaryDashboard({ data, loadedAtText }: Props) {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayStartUnix = Math.floor(todayStart.getTime() / 1000)

  const queue = buildQueue(data)
  const openEscalations = data.textConversations.filter((conversation) => {
    const status = String(conversation.escalation_status ?? 'none').toLowerCase()
    return status === 'pending' || status === 'in_progress'
  }).length

  const pendingToday = queue.filter((item) => item.updatedAt >= todayStartUnix).length
  const callsToday = data.voiceConversations.filter(
    (conversation) => asUnix(conversation.start_time_unix_secs) >= todayStartUnix
  ).length
  const renewals = data.upcomingRenewals
    .slice()
    .sort((a, b) => a.renewal_date_unix_secs - b.renewal_date_unix_secs)

  const renewalsDue7Days = renewals.filter((item) => item.days_until_renewal <= 7).length
  const renewalsDue30Days = renewals.length

  const recentCalls = data.voiceConversations
    .slice()
    .sort(
      (a, b) => asUnix(b.start_time_unix_secs) - asUnix(a.start_time_unix_secs)
    )
    .slice(0, 6)

  const voiceAgentNames = new Map(data.voiceAgents.map((agent) => [agent.agent_id, agent.name]))

  const recommendation =
    renewalsDue7Days > 0
      ? 'Prioriza renovaciones que vencen en los próximos 7 días y agenda contacto inmediato.'
      : openEscalations > 0
      ? 'Prioriza escalaciones abiertas antes de nuevas cotizaciones para no perder leads calientes.'
      : queue.length > 0
        ? 'Procesa la bandeja por prioridad: siniestros, luego intencion de compra y finalmente seguimientos.'
        : 'Bandeja limpia. Este es buen momento para validar renovaciones y hacer llamadas preventivas.'

  return (
    <>
      <section className="section-enter relative overflow-hidden rounded-[30px] border border-[#d8d3ee] bg-white p-8 shadow-sm">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#271173]/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-1.5 rounded-full border border-[#d8d3ee] bg-[#f7f5ff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#271173]">
              <SparklesIcon className="h-3.5 w-3.5" />
              Secretaria Digital
            </p>
            <h1 className="mt-4 text-4xl font-semibold leading-tight text-[#1a1a2f]">
              Panel operativo para gestionar
              <span className="text-[#271173]"> llamadas, leads y escalaciones</span>
            </h1>
            <p className="mt-3 text-sm leading-6 text-[#23233d]/70">
              Vista simple orientada a accion inmediata. Ultima carga: {loadedAtText}
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.12em] text-[#1a1a2f]/45">Pendientes hoy</p>
          <p className="mt-3 text-3xl font-semibold text-[#1a1a2f]">{pendingToday}</p>
          <p className="mt-2 text-xs text-[#1a1a2f]/60">Conversaciones que requieren accion</p>
        </article>

        <article className="rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.12em] text-[#1a1a2f]/45">Escalaciones abiertas</p>
          <p className="mt-3 text-3xl font-semibold text-[#1a1a2f]">{openEscalations}</p>
          <p className="mt-2 inline-flex items-center gap-1 text-xs text-rose-600">
            <ExclamationTriangleIcon className="h-3.5 w-3.5" />
            Prioridad alta de seguimiento
          </p>
        </article>

        <article className="rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.12em] text-[#1a1a2f]/45">Llamadas hoy</p>
          <p className="mt-3 text-3xl font-semibold text-[#1a1a2f]">{callsToday}</p>
          <p className="mt-2 text-xs text-[#1a1a2f]/60">Actividad de voz del dia</p>
        </article>

        <article className="rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.12em] text-[#1a1a2f]/45">Renovaciones 30 días</p>
          <p className="mt-3 text-3xl font-semibold text-[#1a1a2f]">{renewalsDue30Days}</p>
          <p className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-600">
            <CheckCircleIcon className="h-3.5 w-3.5" />
            {renewalsDue7Days} vencen en la próxima semana
          </p>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.5fr,1fr]">
        <article className="rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.12em] text-[#1a1a2f]/45">Bandeja prioritaria</p>
              <h2 className="mt-1 text-xl font-semibold text-[#1a1a2f]">Que atender ahora</h2>
            </div>
            <span className="rounded-full border border-[#d8d3ee] bg-[#f7f5ff] px-3 py-1 text-xs font-semibold text-[#271173]">
              {queue.length} en cola
            </span>
          </div>

          <div className="space-y-3">
            {queue.length === 0 && (
              <div className="rounded-xl border border-[#ece8fb] bg-[#faf9ff] p-4 text-sm text-[#1a1a2f]/60">
                No hay pendientes urgentes en este momento.
              </div>
            )}

            {queue.map((item) => (
              <div key={item.conversationId} className="rounded-xl border border-[#ece8fb] bg-[#faf9ff] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#1a1a2f]">{item.agentName}</p>
                  <div className="inline-flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        item.priority === 'alta'
                          ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
                          : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                      }`}
                    >
                      {item.priority}
                    </span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#1a1a2f]/65 ring-1 ring-[#e0dbf5]">
                      {item.channel}
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-xs font-medium text-[#271173]">{item.reason}</p>
                <p className="mt-1 text-xs leading-5 text-[#1a1a2f]/65">{item.summary}</p>
                <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-[#1a1a2f]/50">
                  <ClockIcon className="h-3.5 w-3.5" />
                  Actualizado {formatClock(item.updatedAt)}
                </p>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.12em] text-[#1a1a2f]/45">Siguiente mejor accion</p>
          <h2 className="mt-2 text-xl font-semibold text-[#1a1a2f]">Plan recomendado</h2>
          <p className="mt-4 text-sm leading-6 text-[#1a1a2f]/75">{recommendation}</p>

          <div className="mt-5 rounded-xl border border-[#ece8fb] bg-[#faf9ff] p-4 text-sm text-[#1a1a2f]/70">
            <p className="inline-flex items-center gap-2 font-semibold text-[#271173]">
              <ArrowTrendingUpIcon className="h-4 w-4" />
              Orden sugerido de trabajo
            </p>
            <ol className="mt-2 space-y-1 text-xs leading-5 text-[#1a1a2f]/70">
              <li>1. Resolver escalaciones pendientes.</li>
              <li>2. Llamar leads con intencion de compra.</li>
              <li>3. Confirmar renovaciones próximas y registrar estatus.</li>
            </ol>
          </div>

          <div className="mt-4 rounded-xl border border-[#ece8fb] bg-[#faf9ff] p-4 text-sm text-[#1a1a2f]/70">
            <p className="inline-flex items-center gap-2 font-semibold text-[#271173]">
              <CalendarDaysIcon className="h-4 w-4" />
              Calendario de renovaciones
            </p>

            <div className="mt-3 space-y-2">
              {renewals.length === 0 && (
                <p className="text-xs text-[#1a1a2f]/55">
                  No hay renovaciones cargadas para los próximos 30 días.
                </p>
              )}

              {renewals.slice(0, 5).map((renewal) => (
                <div
                  key={renewal.conversation_id}
                  className="rounded-lg border border-[#e8e3fb] bg-white px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-[#1a1a2f]">{renewal.agent_name}</p>
                    <span className="rounded-full bg-[#f5f3ff] px-2 py-0.5 text-[10px] font-semibold text-[#271173]">
                      {formatDate(renewal.renewal_date_unix_secs)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-[#1a1a2f]/70">
                    {renewal.days_until_renewal === 0
                      ? 'Vence hoy'
                      : `Vence en ${renewal.days_until_renewal} día(s)`}
                    {' · '}
                    {renewal.renewal_status}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-[#1a1a2f]/45">Historial reciente</p>
            <h2 className="mt-1 text-xl font-semibold text-[#1a1a2f]">Ultimas llamadas</h2>
          </div>
          <PhoneIcon className="h-5 w-5 text-[#271173]" />
        </div>

        <div className="space-y-2">
          {recentCalls.length === 0 && (
            <div className="rounded-xl border border-[#ece8fb] bg-[#faf9ff] p-4 text-sm text-[#1a1a2f]/60">
              Aun no hay llamadas registradas para mostrar.
            </div>
          )}

          {recentCalls.map((call) => {
            const startedAt = asUnix(call.start_time_unix_secs)
            const duration = Number(call.call_duration_secs ?? 0)
            const agentName = voiceAgentNames.get(call.agent_id) ?? call.agent_id

            return (
              <div
                key={call.conversation_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#ece8fb] bg-[#faf9ff] px-4 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-[#1a1a2f]">{agentName}</p>
                  <p className="text-xs text-[#1a1a2f]/60">Estado: {call.status}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-[#1a1a2f]">{formatDuration(duration)}</p>
                  <p className="text-xs text-[#1a1a2f]/60">{formatClock(startedAt)}</p>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </>
  )
}
