import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowPathIcon,
  ArrowTrendingDownIcon,
  ArrowTrendingUpIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ClockIcon,
  SparklesIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline'
import {
  getAgents,
  getConversations,
  getPhoneNumbers,
} from '@/api/VoiceRuntimeAPI'
import { getTextAgents, getTextConversations } from '@/api/TextAgentsAPI'
import type { AgentListItem, Conversation, PhoneNumber } from '@/types/agent'
import type { TextAgentSummary, TextConversation } from '@/types/textAgent'

type KpiCard = {
  label: string
  value: string
  delta: string
  trend: 'up' | 'down' | 'stable'
  subtitle: string
}

type HealthMetric = {
  label: string
  value: number
  detail: string
  tone: string
}

type TimelineItem = {
  time: string
  title: string
  detail: string
  tag: string
}

type ActivityPoint = {
  kind: 'voice' | 'text'
  agentId: string
  timestamp: number
  status: string
  channel: string
  durationSecs?: number
  messageCount?: number
}

type DashboardData = {
  voiceAgents: AgentListItem[]
  textAgents: TextAgentSummary[]
  phoneNumbers: PhoneNumber[]
  voiceConversations: Conversation[]
  textConversations: TextConversation[]
  loadedAt: number
}

const VOICE_PAGE_SIZE = 100
const VOICE_PAGES_LIMIT = 5

function asUnix(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return 0
  return Math.floor(value)
}

function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
      seconds
    ).padStart(2, '0')}`
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatClock(unix: number): string {
  if (!unix) return '--:--'
  return new Date(unix * 1000).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function toPercent(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((part / total) * 100)
}

function buildDeltaLabel(current: number, previous: number): string {
  const delta = current - previous
  if (delta > 0) return `+${delta} vs ayer`
  if (delta < 0) return `${delta} vs ayer`
  return 'Sin cambio vs ayer'
}

function buildLinePath(values: number[], width: number, height: number, padding: number) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(max - min, 1)
  const step = (width - padding * 2) / Math.max(values.length - 1, 1)

  const points = values.map((value, index) => {
    const x = padding + step * index
    const normalized = (value - min) / range
    const y = height - padding - normalized * (height - padding * 2)
    return { x, y }
  })

  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ')

  const area = `${line} L ${points[points.length - 1].x.toFixed(2)} ${(height - padding).toFixed(
    2
  )} L ${points[0].x.toFixed(2)} ${(height - padding).toFixed(2)} Z`

  return { points, line, area }
}

async function getAllVoiceConversations(agentId: string): Promise<Conversation[]> {
  const all: Conversation[] = []
  let cursor: string | null = null

  for (let page = 0; page < VOICE_PAGES_LIMIT; page += 1) {
    const response = await getConversations(agentId, {
      cursor,
      page_size: VOICE_PAGE_SIZE,
    })
    const conversations = Array.isArray(response.conversations)
      ? response.conversations
      : []

    all.push(...conversations)

    const nextCursor = response.next_cursor ?? response.cursor ?? null
    const hasMore =
      typeof response.has_more === 'boolean' ? response.has_more : Boolean(nextCursor)

    if (!hasMore || !nextCursor) {
      break
    }

    cursor = nextCursor
  }

  return all
}

async function fetchDashboardData(): Promise<DashboardData> {
  const [voiceAgentsResult, textAgentsResult, phoneNumbersResult] =
    await Promise.allSettled([getAgents(), getTextAgents(), getPhoneNumbers()])

  const voiceAgents: AgentListItem[] =
    voiceAgentsResult.status === 'fulfilled' &&
    Array.isArray(voiceAgentsResult.value?.agents)
      ? (voiceAgentsResult.value.agents as AgentListItem[])
      : []

  const textAgents: TextAgentSummary[] =
    textAgentsResult.status === 'fulfilled' && Array.isArray(textAgentsResult.value?.agents)
      ? textAgentsResult.value.agents
      : []

  const phoneNumbers: PhoneNumber[] =
    phoneNumbersResult.status === 'fulfilled' && Array.isArray(phoneNumbersResult.value)
      ? phoneNumbersResult.value
      : []

  if (voiceAgents.length === 0 && textAgents.length === 0 && phoneNumbers.length === 0) {
    throw new Error('No fue posible cargar datos del dashboard')
  }

  const [voiceConversationResults, textConversationResults] = await Promise.all([
    Promise.allSettled(
      voiceAgents.map((agent) => getAllVoiceConversations(agent.agent_id))
    ),
    Promise.allSettled(
      textAgents.map((agent) => getTextConversations(agent.agent_id))
    ),
  ])

  const voiceConversations = voiceConversationResults.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : []
  )

  const textConversations = textConversationResults.flatMap((result) =>
    result.status === 'fulfilled' && Array.isArray(result.value.conversations)
      ? result.value.conversations
      : []
  )

  return {
    voiceAgents,
    textAgents,
    phoneNumbers,
    voiceConversations,
    textConversations,
    loadedAt: Date.now(),
  }
}

export default function DashboardView() {
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['dashboard-real-data'],
    queryFn: fetchDashboardData,
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  })

  const computed = useMemo(() => {
    if (!data) {
      return {
        kpis: [] as KpiCard[],
        liveSeries: Array.from({ length: 12 }, () => 0),
        channelLegend: [{ label: 'Sin trafico', pct: 100, color: '#e4e0f5', count: 0 }],
        channelGradient: 'conic-gradient(#e4e0f5 0 100%)',
        channelHighlight: { label: 'Sin trafico', pct: 0 },
        healthMetrics: [] as HealthMetric[],
        timeline: [] as TimelineItem[],
        recommendation:
          'Conecta al menos una fuente de conversaciones para empezar a recibir metricas.',
        recommendationBadge: 'Sin datos operativos',
        snapshotSummary: 'Sin datos cargados',
        loadedAtText: '--:--',
      }
    }

    const nowUnix = Math.floor(Date.now() / 1000)
    const todayStartDate = new Date()
    todayStartDate.setHours(0, 0, 0, 0)
    const todayStart = Math.floor(todayStartDate.getTime() / 1000)
    const yesterdayStart = todayStart - 86400

    const voiceAgentNames = new Map(
      data.voiceAgents.map((agent) => [agent.agent_id, agent.name])
    )
    const textAgentNames = new Map(
      data.textAgents.map((agent) => [agent.agent_id, agent.name])
    )

    const activityPoints: ActivityPoint[] = [
      ...data.voiceConversations.map((conversation) => ({
        kind: 'voice' as const,
        agentId: conversation.agent_id,
        timestamp: asUnix(conversation.start_time_unix_secs),
        status: String(conversation.status ?? 'unknown'),
        channel: 'voice',
        durationSecs:
          typeof conversation.call_duration_secs === 'number'
            ? conversation.call_duration_secs
            : undefined,
      })),
      ...data.textConversations.map((conversation) => ({
        kind: 'text' as const,
        agentId: conversation.agent_id,
        timestamp: asUnix(conversation.start_time_unix_secs),
        status: String(conversation.status ?? 'unknown'),
        channel: String(conversation.channel ?? 'web'),
        messageCount: conversation.message_count,
      })),
    ].filter((item) => item.timestamp > 0)

    const totalConversations = activityPoints.length
    const conversationsToday = activityPoints.filter(
      (item) => item.timestamp >= todayStart
    ).length
    const conversationsYesterday = activityPoints.filter(
      (item) => item.timestamp >= yesterdayStart && item.timestamp < todayStart
    ).length

    const activeVoiceStatuses = new Set([
      'active',
      'in_progress',
      'queued',
      'ringing',
      'processing',
    ])
    const activeVoiceCalls = data.voiceConversations.filter((conversation) =>
      activeVoiceStatuses.has(String(conversation.status ?? '').toLowerCase())
    ).length

    const voiceDurations = data.voiceConversations
      .map((conversation) => conversation.call_duration_secs)
      .filter((value): value is number => typeof value === 'number' && value > 0)

    const avgVoiceDuration =
      voiceDurations.length > 0
        ? voiceDurations.reduce((sum, value) => sum + value, 0) / voiceDurations.length
        : 0

    const textMessageCounts = data.textConversations
      .map((conversation) => conversation.message_count)
      .filter((value): value is number => typeof value === 'number' && value >= 0)

    const avgTextMessages =
      textMessageCounts.length > 0
        ? textMessageCounts.reduce((sum, value) => sum + value, 0) / textMessageCounts.length
        : 0

    const todayDelta = conversationsToday - conversationsYesterday
    const kpis: KpiCard[] = [
      {
        label: 'Conversaciones hoy',
        value: `${conversationsToday}`,
        delta: buildDeltaLabel(conversationsToday, conversationsYesterday),
        trend: todayDelta > 0 ? 'up' : todayDelta < 0 ? 'down' : 'stable',
        subtitle: `Ayer: ${conversationsYesterday}`,
      },
      {
        label: 'Llamadas activas',
        value: `${activeVoiceCalls}`,
        delta: `${data.voiceConversations.length} totales`,
        trend: activeVoiceCalls > 0 ? 'up' : 'stable',
        subtitle: 'Estado actual de conversaciones de voz',
      },
      {
        label: 'Duracion media voz',
        value: formatDuration(avgVoiceDuration),
        delta: `${voiceDurations.length} con duracion`,
        trend: 'stable',
        subtitle: 'Promedio real en llamadas registradas',
      },
      {
        label: 'Mensajes por chat',
        value: avgTextMessages.toFixed(1),
        delta: `${data.textConversations.length} conversaciones`,
        trend: 'stable',
        subtitle: 'Promedio de mensajes en texto',
      },
    ]

    const liveSeries = Array.from({ length: 12 }, () => 0)
    const windowStart = nowUnix - 11 * 3600

    for (const item of activityPoints) {
      if (item.timestamp < windowStart) continue
      const index = Math.min(11, Math.max(0, Math.floor((item.timestamp - windowStart) / 3600)))
      liveSeries[index] += 1
    }

    const voiceCount = data.voiceConversations.length
    const whatsappCount = data.textConversations.filter(
      (conversation) => conversation.channel === 'whatsapp'
    ).length
    const webCount = data.textConversations.filter(
      (conversation) => conversation.channel === 'web'
    ).length
    const otherCount = Math.max(0, data.textConversations.length - whatsappCount - webCount)

    const channelRaw = [
      { label: 'Voz', count: voiceCount, color: '#271173' },
      { label: 'WhatsApp', count: whatsappCount, color: '#0ea5e9' },
      { label: 'Web', count: webCount, color: '#14b8a6' },
      { label: 'Otros', count: otherCount, color: '#f97316' },
    ].filter((segment) => segment.count > 0)

    const channelLegend =
      channelRaw.length === 0
        ? [{ label: 'Sin trafico', count: 0, pct: 100, color: '#e4e0f5' }]
        : (() => {
            const total = channelRaw.reduce((sum, segment) => sum + segment.count, 0)
            let usedPct = 0

            return channelRaw.map((segment, index) => {
              const pct =
                index === channelRaw.length - 1
                  ? Math.max(0, Number((100 - usedPct).toFixed(1)))
                  : Number(((segment.count / total) * 100).toFixed(1))

              usedPct += pct
              return {
                ...segment,
                pct,
              }
            })
          })()

    let currentPct = 0
    const channelGradient =
      channelLegend.length > 0
        ? `conic-gradient(${channelLegend
            .map((segment) => {
              const from = currentPct
              const to = Number((currentPct + segment.pct).toFixed(1))
              currentPct = to
              return `${segment.color} ${from}% ${to}%`
            })
            .join(', ')})`
        : 'conic-gradient(#e4e0f5 0 100%)'

    const primaryChannel = channelLegend[0] ?? { label: 'Sin trafico', pct: 0 }

    const totalPhones = data.phoneNumbers.length
    const assignedPhones = data.phoneNumbers.filter(
      (phoneNumber) => phoneNumber.assigned_agent?.agent_id
    ).length
    const inboundReady = data.phoneNumbers.filter(
      (phoneNumber) => phoneNumber.supports_inbound !== false
    ).length
    const outboundReady = data.phoneNumbers.filter(
      (phoneNumber) => phoneNumber.supports_outbound !== false
    ).length

    const resolvedStatuses = new Set(['done', 'completed', 'resolved', 'success'])
    const resolvedConversations = activityPoints.filter((item) =>
      resolvedStatuses.has(item.status.toLowerCase())
    ).length

    const healthMetrics: HealthMetric[] = [
      {
        label: 'Numeros asignados',
        value: toPercent(assignedPhones, totalPhones),
        detail: `${assignedPhones}/${totalPhones}`,
        tone: 'bg-[#271173]',
      },
      {
        label: 'Inbound disponible',
        value: toPercent(inboundReady, totalPhones),
        detail: `${inboundReady}/${totalPhones}`,
        tone: 'bg-[#0ea5e9]',
      },
      {
        label: 'Outbound disponible',
        value: toPercent(outboundReady, totalPhones),
        detail: `${outboundReady}/${totalPhones}`,
        tone: 'bg-[#14b8a6]',
      },
      {
        label: 'Conversaciones resueltas',
        value: toPercent(resolvedConversations, totalConversations),
        detail: `${resolvedConversations}/${totalConversations}`,
        tone: 'bg-[#f97316]',
      },
    ]

    const timeline: TimelineItem[] = activityPoints
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 4)
      .map((item) => {
        const isVoice = item.kind === 'voice'
        const agentName = isVoice
          ? voiceAgentNames.get(item.agentId)
          : textAgentNames.get(item.agentId)

        return {
          time: formatClock(item.timestamp),
          title: `${agentName ?? item.agentId} Â· ${isVoice ? 'Voz' : 'Texto'}`,
          detail: isVoice
            ? `Estado: ${item.status}${
                typeof item.durationSecs === 'number' && item.durationSecs > 0
                  ? ` Â· Duracion ${formatDuration(item.durationSecs)}`
                  : ''
              }`
            : `Canal: ${item.channel}${
                typeof item.messageCount === 'number' ? ` Â· ${item.messageCount} mensajes` : ''
              }`,
          tag: isVoice ? 'Voz' : item.channel,
        }
      })

    const assignmentRate = toPercent(assignedPhones, totalPhones)
    const resolutionRate = toPercent(resolvedConversations, totalConversations)

    const recommendation =
      assignmentRate < 100
        ? 'Asigna todos los numeros pendientes a un agente para no perder trafico entrante.'
        : resolutionRate < 85
          ? 'Revisa conversaciones no resueltas y ajusta prompt o herramientas para mejorar cierres.'
          : 'Manten la configuracion actual y monitorea los picos por hora para reaccion temprana.'

    const recommendationBadge =
      assignmentRate < 100
        ? `Foco: cobertura de numeros (${assignedPhones}/${totalPhones})`
        : `Foco: resolucion (${resolvedConversations}/${totalConversations})`

    return {
      kpis,
      liveSeries,
      channelLegend,
      channelGradient,
      channelHighlight: {
        label: primaryChannel.label,
        pct: primaryChannel.pct,
      },
      healthMetrics,
      timeline,
      recommendation,
      recommendationBadge,
      snapshotSummary: `${data.voiceAgents.length} agentes de voz Â· ${data.textAgents.length} agentes de texto Â· ${data.phoneNumbers.length} numeros`,
      loadedAtText: formatClock(Math.floor(data.loadedAt / 1000)),
    }
  }, [data])

  const chart = buildLinePath(computed.liveSeries, 760, 280, 28)

  return (
    <div
      className="h-full overflow-y-auto no-visible-scrollbar"
      style={{ fontFamily: "'Sora', sans-serif" }}
    >
      <div className="mx-auto w-full max-w-360 space-y-6 px-8 py-8">
        <section className="section-enter relative overflow-hidden rounded-[30px] border border-[#d8d3ee] bg-white p-8 shadow-sm">
          <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#271173]/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 left-1/3 h-72 w-72 rounded-full bg-[#0ea5e9]/10 blur-3xl" />

          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="inline-flex items-center gap-1.5 rounded-full border border-[#d8d3ee] bg-[#f7f5ff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#271173]">
                <SparklesIcon className="h-3.5 w-3.5" />
                Pulse Control Center
              </p>
              <h1 className="mt-4 text-4xl font-semibold leading-tight text-[#1a1a2f]">
                Dashboard operativo con data real,
                <span className="text-[#271173]"> en voz, texto y telefonia</span>
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#23233d]/70">
                {computed.snapshotSummary}. Actualizacion automatica cada 45 segundos para
                seguimiento continuo del estado operativo.
              </p>
            </div>

            <div className="grid w-full gap-3 sm:grid-cols-2 lg:w-auto lg:grid-cols-1">
              <button
                onClick={() => refetch()}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#271173] px-4 py-2.5 text-sm font-semibold text-white transition-transform duration-200 ease-(--ease-out-strong) hover:-translate-y-px hover:bg-[#1f0d5a]"
              >
                <ArrowPathIcon className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                Refrescar metricas
              </button>
              <div className="inline-flex items-center justify-center rounded-xl border border-[#d8d3ee] bg-white px-4 py-2.5 text-sm font-semibold text-[#1a1a2f]">
                Ultima carga: {computed.loadedAtText}
              </div>
            </div>
          </div>
        </section>

        {isLoading && (
          <section className="rounded-2xl border border-[#e4e0f5] bg-white p-10 text-center text-sm text-[#1a1a2f]/60 shadow-sm">
            Cargando metricas reales del workspace...
          </section>
        )}

        {isError && (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 shadow-sm">
            {error instanceof Error
              ? error.message
              : 'No fue posible cargar el dashboard con data real.'}
          </section>
        )}

        {!isLoading && !isError && (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {computed.kpis.map((item, index) => (
                <article
                  key={item.label}
                  className="stagger-item rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <p className="text-xs uppercase tracking-[0.12em] text-[#1a1a2f]/45">
                    {item.label}
                  </p>
                  <p className="mt-3 text-3xl font-semibold text-[#1a1a2f]">{item.value}</p>
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-[#1a1a2f] ring-1 ring-inset ring-[#d8d3ee]">
                    {item.trend === 'up' && (
                      <ArrowTrendingUpIcon className="h-3.5 w-3.5 text-emerald-600" />
                    )}
                    {item.trend === 'down' && (
                      <ArrowTrendingDownIcon className="h-3.5 w-3.5 text-rose-600" />
                    )}
                    {item.trend === 'stable' && (
                      <ArrowPathIcon className="h-3.5 w-3.5 text-[#271173]" />
                    )}
                    {item.delta}
                  </p>
                  <p className="mt-2 text-xs text-[#1a1a2f]/55">{item.subtitle}</p>
                </article>
              ))}
            </section>

            <section className="grid gap-4 xl:grid-cols-3">
              <article className="stagger-item rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm xl:col-span-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.12em] text-[#1a1a2f]/45">
                      Actividad en tiempo real
                    </p>
                    <h2 className="mt-1 text-xl font-semibold text-[#1a1a2f]">
                      Conversaciones por hora (ultimas 12 horas)
                    </h2>
                  </div>
                  <span className="rounded-full border border-[#d8d3ee] bg-[#f7f5ff] px-3 py-1 text-xs font-semibold text-[#271173]">
                    Ventana movil
                  </span>
                </div>

                <div className="mt-5 overflow-hidden rounded-xl border border-[#ece8fb] bg-[#faf9ff] p-3">
                  <svg
                    viewBox="0 0 760 280"
                    className="h-70 w-full"
                    role="img"
                    aria-label="Serie de conversaciones por hora"
                  >
                    <defs>
                      <linearGradient id="pulse-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#271173" stopOpacity="0.28" />
                        <stop offset="100%" stopColor="#271173" stopOpacity="0" />
                      </linearGradient>
                    </defs>

                    {[0, 1, 2, 3].map((line) => {
                      const y = 28 + line * 56
                      return (
                        <line
                          key={line}
                          x1="28"
                          y1={y}
                          x2="732"
                          y2={y}
                          stroke="#e6e1f8"
                          strokeWidth="1"
                          strokeDasharray="6 6"
                        />
                      )
                    })}

                    <path d={chart.area} fill="url(#pulse-fill)" />
                    <path
                      d={chart.line}
                      fill="none"
                      stroke="#271173"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />

                    {chart.points.map((point, index) => (
                      <circle
                        key={index}
                        cx={point.x}
                        cy={point.y}
                        r={index === chart.points.length - 1 ? 5 : 3.5}
                        fill={
                          index === chart.points.length - 1 ? '#f97316' : '#271173'
                        }
                      />
                    ))}
                  </svg>
                </div>
              </article>

              <article className="stagger-item rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm">
                <p className="text-xs uppercase tracking-[0.12em] text-[#1a1a2f]/45">
                  Distribucion de canales
                </p>
                <h2 className="mt-1 text-xl font-semibold text-[#1a1a2f]">Mix de origen real</h2>

                <div className="mt-5 flex items-center justify-center">
                  <div
                    className="relative h-48 w-48 rounded-full"
                    style={{ background: computed.channelGradient }}
                  >
                    <div className="absolute inset-5 rounded-full bg-white" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <p className="text-3xl font-semibold text-[#1a1a2f]">
                        {computed.channelHighlight.pct.toFixed(1)}%
                      </p>
                      <p className="text-xs uppercase tracking-[0.12em] text-[#1a1a2f]/55">
                        {computed.channelHighlight.label}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 space-y-2.5 text-sm">
                  {computed.channelLegend.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between rounded-xl bg-[#faf9ff] px-3 py-2"
                    >
                      <p className="inline-flex items-center gap-2 text-[#1a1a2f]/75">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        {item.label}
                      </p>
                      <span className="font-semibold text-[#1a1a2f]">
                        {item.pct.toFixed(1)}% ({item.count})
                      </span>
                    </div>
                  ))}
                </div>
              </article>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <article className="stagger-item rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.12em] text-[#1a1a2f]/45">
                      Salud operativa
                    </p>
                    <h2 className="mt-1 text-xl font-semibold text-[#1a1a2f]">
                      Cobertura y resolucion
                    </h2>
                  </div>
                  <UserGroupIcon className="h-5 w-5 text-[#271173]" />
                </div>

                <div className="mt-5 space-y-3.5">
                  {computed.healthMetrics.map((item) => (
                    <div key={item.label}>
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <p className="font-medium text-[#1a1a2f]/80">{item.label}</p>
                        <p className="font-semibold text-[#1a1a2f]">
                          {item.value}% Â· {item.detail}
                        </p>
                      </div>
                      <div className="h-2.5 rounded-full bg-[#f1eefc]">
                        <div
                          className={`h-full rounded-full ${item.tone} transition-[width] duration-500 ease-(--ease-out-strong)`}
                          style={{ width: `${item.value}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className="stagger-item rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.12em] text-[#1a1a2f]/45">
                      Bitacora operativa
                    </p>
                    <h2 className="mt-1 text-xl font-semibold text-[#1a1a2f]">
                      Ultima actividad
                    </h2>
                  </div>
                  <CalendarDaysIcon className="h-5 w-5 text-[#271173]" />
                </div>

                <div className="mt-5 space-y-4">
                  {computed.timeline.length === 0 && (
                    <div className="rounded-xl border border-[#ece8fb] bg-[#faf9ff] p-3.5 text-sm text-[#1a1a2f]/60">
                      Todavia no hay conversaciones para mostrar en timeline.
                    </div>
                  )}

                  {computed.timeline.map((item) => (
                    <div
                      key={`${item.time}-${item.title}`}
                      className="relative rounded-xl border border-[#ece8fb] bg-[#faf9ff] p-3.5"
                    >
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-[#271173]">
                          <ClockIcon className="h-3.5 w-3.5" />
                          {item.time}
                        </p>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#1a1a2f]/65 ring-1 ring-[#e0dbf5]">
                          {item.tag}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-[#1a1a2f]">{item.title}</p>
                      <p className="mt-1 text-xs leading-5 text-[#1a1a2f]/60">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </article>
            </section>

            <section className="stagger-item rounded-2xl border border-[#d8d3ee] bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.12em] text-[#1a1a2f]/45">
                    Recomendacion inmediata
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-[#1a1a2f]">
                    {computed.recommendation}
                  </h2>
                </div>
                <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
                  <CheckCircleIcon className="h-4 w-4" />
                  {computed.recommendationBadge}
                </p>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

