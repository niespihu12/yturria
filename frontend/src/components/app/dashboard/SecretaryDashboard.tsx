import { useId, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRightIcon } from '@heroicons/react/24/outline'
import type { AgentListItem, Conversation, PhoneNumber } from '@/types/agent'
import type { TextAgentSummary, TextConversation, UpcomingRenewal } from '@/types/textAgent'
import { cn } from '@/lib/utils'
import {
  channelLabel,
  describeEscalationReason,
  escalationHref,
  formatElapsed,
  formatPhone,
  isOpenEscalation,
  phoneFromTitle,
  timeAgo,
} from '@/lib/escalations'
import { ActivityChart, ChannelBreakdown, type ChannelRow } from '@/components/app/dashboard/ActivityCharts'
import { buildActivityBuckets, periodWindow, type DashboardPeriod } from '@/lib/dashboardPeriod'

export type DashboardDataset = {
  voiceAgents: AgentListItem[]
  textAgents: TextAgentSummary[]
  phoneNumbers: PhoneNumber[]
  voiceConversations: Conversation[]
  textConversations: TextConversation[]
  upcomingRenewals: UpcomingRenewal[]
  /** Momento de la carga (ms); sirve de "ahora" para los tiempos relativos. */
  loadedAt: number
}

type Props = {
  data: DashboardDataset
  isSuperAdmin: boolean
  period: DashboardPeriod
}

type Stat = {
  label: string
  value: string
  suffix?: string
  detail?: string
}

const QUEUE_LIMIT = 5

const LINK_BUTTON =
  'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2'

const RENEWAL_STATUS: Record<UpcomingRenewal['renewal_status'], string> = {
  none: 'Sin gestionar',
  scheduled: 'Programada',
  reminder_due: 'Recordatorio por enviar',
  reminder_sent: 'Recordatorio enviado',
  contacted: 'Cliente contactado',
  renewed: 'Renovada',
  expired: 'Vencida',
  cancelled: 'Cancelada',
}

function asUnix(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) return 0
  return Math.floor(value)
}

function formatClock(unix: number): string {
  if (!unix) return '--:--'
  return new Date(unix * 1000).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}

/** Hora si fue hoy; si no, fecha y hora ("3 oct · 04:08 p. m."). */
function formatWhen(unix: number, todayStart: number): string {
  if (!unix) return '--:--'
  if (unix >= todayStart) return formatClock(unix)
  return `${formatShortDate(unix).replace('.', '')} · ${formatClock(unix)}`
}

function formatShortDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function callStatusLabel(status: unknown): string {
  const value = String(status ?? '').toLowerCase()
  if (value === 'done' || value === 'completed') return 'Finalizada'
  if (value === 'failed') return 'No se completó'
  if (['in-progress', 'in_progress', 'processing', 'initiated', 'active', 'ringing'].includes(value)) {
    return 'En curso'
  }
  return 'Registrada'
}

export default function SecretaryDashboard({ data, isSuperAdmin, period }: Props) {
  const nowMs = data.loadedAt
  const todayDate = new Date(nowMs)
  todayDate.setHours(0, 0, 0, 0)
  const todayStart = Math.floor(todayDate.getTime() / 1000)
  const range = periodWindow(period, nowMs)

  const textAgentNames = new Map(data.textAgents.map((agent) => [agent.agent_id, agent.name]))
  const voiceAgentNames = new Map(data.voiceAgents.map((agent) => [agent.agent_id, agent.name]))

  // ── Quién necesita a una persona ──────────────────────────────────────────
  const waiting = data.textConversations
    .filter((conversation) => isOpenEscalation(conversation.escalation_status))
    .map((conversation) => ({
      conversation,
      since:
        asUnix(conversation.escalated_at_unix_secs) || asUnix(conversation.updated_at_unix_secs),
    }))
    .sort((a, b) => a.since - b.since)

  // ── Cifras del periodo ────────────────────────────────────────────────────
  const startOf = (item: { start_time_unix_secs?: number }) => asUnix(item.start_time_unix_secs)
  const inPeriod = (item: { start_time_unix_secs?: number }) => startOf(item) >= range.start
  const inPrevious = (item: { start_time_unix_secs?: number }) =>
    startOf(item) >= range.previousStart && startOf(item) < range.start
  const textInPeriod = data.textConversations.filter(inPeriod)
  const voiceInPeriod = data.voiceConversations.filter(inPeriod)
  const conversationsBefore =
    data.textConversations.filter(inPrevious).length + data.voiceConversations.filter(inPrevious).length
  const handedInPeriod = textInPeriod.filter(
    (item) => item.escalation_status && item.escalation_status !== 'none',
  ).length

  const callDurations = voiceInPeriod
    .map((call) => call.call_duration_secs)
    .filter((value): value is number => typeof value === 'number' && value > 0)
  const avgCall = callDurations.length
    ? callDurations.reduce((sum, value) => sum + value, 0) / callDurations.length
    : 0

  const renewals = data.upcomingRenewals
    .slice()
    .sort((a, b) => a.renewal_date_unix_secs - b.renewal_date_unix_secs)
  const renewalsThisWeek = renewals.filter((item) => item.days_until_renewal <= 7).length

  const stats: Stat[] = [
    {
      label: 'Conversaciones',
      value: String(textInPeriod.length + voiceInPeriod.length),
      detail: `${range.previousLabel}: ${conversationsBefore}`,
    },
  ]
  if (textInPeriod.length > 0) {
    stats.push({
      label: 'Chats resueltos por los agentes',
      value: String(textInPeriod.length - handedInPeriod),
      suffix: `de ${textInPeriod.length}`,
      detail:
        handedInPeriod === 0
          ? 'Ninguno necesitó a una persona'
          : `${handedInPeriod} ${handedInPeriod === 1 ? 'pasó' : 'pasaron'} a una persona del equipo`,
    })
  }
  if (data.voiceAgents.length > 0 || voiceInPeriod.length > 0) {
    stats.push({
      label: 'Llamadas',
      value: String(voiceInPeriod.length),
      detail: avgCall ? `Duración media: ${formatDuration(avgCall)} min` : `Sin llamadas ${range.emptyPhrase}`,
    })
  }
  if (renewals.length > 0) {
    stats.push({
      label: 'Renovaciones en 30 días',
      value: String(renewals.length),
      detail:
        renewalsThisWeek > 0
          ? `${renewalsThisWeek} en los próximos 7 días`
          : 'Ninguna en los próximos 7 días',
    })
  }
  if (isSuperAdmin && data.phoneNumbers.length > 0) {
    const assigned = data.phoneNumbers.filter((phone) => phone.assigned_agent?.agent_id).length
    stats.push({
      label: 'Números con agente asignado',
      value: String(assigned),
      suffix: `de ${data.phoneNumbers.length}`,
    })
  }

  // ── Actividad y canales ───────────────────────────────────────────────────
  const activityBuckets = buildActivityBuckets(
    [...textInPeriod.map(startOf), ...voiceInPeriod.map(startOf)],
    range,
    nowMs,
  )

  const channelCounts = new Map<string, number>()
  if (voiceInPeriod.length > 0) channelCounts.set('voice', voiceInPeriod.length)
  for (const chat of textInPeriod) {
    const key = String(chat.channel ?? 'web')
    channelCounts.set(key, (channelCounts.get(key) ?? 0) + 1)
  }
  const channelRows: ChannelRow[] = Array.from(channelCounts, ([key, count]) => ({
    key,
    label: key === 'voice' ? 'Llamadas' : channelLabel(key),
    count,
  })).sort((a, b) => b.count - a.count)

  const recentCalls = voiceInPeriod
    .slice()
    .sort((a, b) => startOf(b) - startOf(a))
    .slice(0, 5)

  return (
    <div className="space-y-10">
      <AttentionQueue
        waiting={waiting}
        nowMs={nowMs}
        textAgentNames={textAgentNames}
        showAgent={data.textAgents.length > 1}
      />

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-8">
        <div className="space-y-10">
          <PeriodStats
            stats={stats}
            title={period === 'day' ? 'Hoy en cifras' : 'En cifras'}
            aside={period === 'day' ? undefined : range.label}
          />
          <ChannelBreakdown rows={channelRows} periodLabel={range.label} />
        </div>

        <div className="space-y-10">
          <ActivityChart
            buckets={activityBuckets}
            unit={period === 'day' ? 'hour' : 'day'}
            rangeLabel={range.label}
            emptyPhrase={range.emptyPhrase}
          />

          {renewals.length > 0 && (
            <ListSection title="Renovaciones próximas" aside="Próximos 30 días">
              {renewals.slice(0, 5).map((renewal) => {
                const phone = phoneFromTitle(renewal.title)
                const who = phone ? formatPhone(phone) : renewal.title?.trim() || 'Conversación sin título'
                return (
                  <li key={renewal.conversation_id} className="flex items-start justify-between gap-4 px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text-primary">{who}</p>
                      <p className="mt-0.5 text-xs text-text-tertiary">
                        {renewal.agent_name} · {RENEWAL_STATUS[renewal.renewal_status] ?? 'Sin gestionar'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-sm tabular-nums">
                      <p className="text-text-primary">
                        {renewal.days_until_renewal <= 0
                          ? 'Vence hoy'
                          : renewal.days_until_renewal === 1
                            ? 'Mañana'
                            : `En ${renewal.days_until_renewal} días`}
                      </p>
                      <p className="text-xs text-text-tertiary">{formatShortDate(renewal.renewal_date_unix_secs)}</p>
                    </div>
                  </li>
                )
              })}
            </ListSection>
          )}

          {recentCalls.length > 0 && (
            <ListSection title="Últimas llamadas" aside={range.label}>
              {recentCalls.map((call) => (
                <li key={call.conversation_id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-primary">
                      {voiceAgentNames.get(call.agent_id) ?? 'Agente de voz'}
                    </p>
                    <p className="mt-0.5 text-xs text-text-tertiary">{callStatusLabel(call.status)}</p>
                  </div>
                  <div className="shrink-0 text-right text-sm tabular-nums">
                    <p className="text-text-primary">{formatDuration(Number(call.call_duration_secs ?? 0))} min</p>
                    <p className="text-xs text-text-tertiary">{formatWhen(startOf(call), todayStart)}</p>
                  </div>
                </li>
              ))}
            </ListSection>
          )}
        </div>
      </div>
    </div>
  )
}

function AttentionQueue({
  waiting,
  nowMs,
  textAgentNames,
  showAgent,
}: {
  waiting: Array<{ conversation: TextConversation; since: number }>
  nowMs: number
  textAgentNames: Map<string, string>
  showAgent: boolean
}) {
  const headingId = useId()
  const count = waiting.length
  const oldest = waiting[0]
  const waitedFor = oldest?.since ? formatElapsed(nowMs / 1000 - oldest.since) : null

  const headline =
    count === 0
      ? 'Nadie está esperando a una persona del equipo'
      : `${count} ${count === 1 ? 'conversación espera' : 'conversaciones esperan'} a una persona del equipo`
  const detail =
    count === 0
      ? 'Los agentes están atendiendo todas las conversaciones. Aquí verá cuando alguien necesite a una persona.'
      : waitedFor
        ? count === 1
          ? `Lleva ${waitedFor} esperando.`
          : `La más antigua lleva ${waitedFor} esperando.`
        : 'Revíselas en la bandeja.'

  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-xl border border-border-default bg-surface">
      <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className={cn('mt-2 h-2.5 w-2.5 shrink-0 rounded-full', count ? 'bg-warning-500' : 'bg-success-500')}
          />
          <div className="min-w-0">
            <h2 id={headingId} className="text-lg font-semibold text-text-primary">
              {headline}
            </h2>
            <p className="mt-0.5 max-w-[65ch] text-sm text-text-secondary">{detail}</p>
          </div>
        </div>
        <Link
          to="/escalamientos"
          className={cn(
            LINK_BUTTON,
            count
              ? 'bg-primary-600 text-text-inverse shadow-sm hover:bg-primary-700'
              : 'border border-border-strong text-text-primary hover:bg-neutral-50',
          )}
        >
          {count ? 'Abrir la bandeja' : 'Ver la bandeja'}
        </Link>
      </div>

      {count > 0 && (
        <div className="border-t border-border-default">
          <h3 className="px-5 pb-1 pt-4 text-sm font-semibold text-text-primary sm:px-6">Qué atender ahora</h3>
          <ul className="divide-y divide-border-subtle">
            {waiting.slice(0, QUEUE_LIMIT).map(({ conversation, since }) => {
              const preview = conversation.last_message_preview?.trim()
              return (
                <li key={conversation.conversation_id}>
                  <Link
                    to={escalationHref(conversation.conversation_id, conversation.agent_id)}
                    className="group flex items-start gap-4 px-5 py-3.5 transition-colors hover:bg-surface-muted focus-visible:outline-offset-[-2px] sm:px-6"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-text-primary">
                        {describeEscalationReason(conversation.escalation_reason)}
                      </span>
                      {preview && (
                        <span className="mt-0.5 block truncate text-sm text-text-secondary">
                          Último mensaje: “{preview}”
                        </span>
                      )}
                      <span className="mt-1 block text-xs text-text-tertiary">
                        {channelLabel(conversation.channel)}
                        {showAgent && textAgentNames.get(conversation.agent_id)
                          ? ` · ${textAgentNames.get(conversation.agent_id)}`
                          : ''}
                        {conversation.escalation_status === 'in_progress' ? ' · En atención' : ''}
                        <span className="tabular-nums sm:hidden"> · {timeAgo(since, nowMs)}</span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 pt-0.5 text-xs tabular-nums text-text-tertiary">
                      <span className="hidden sm:inline">{timeAgo(since, nowMs)}</span>
                      <ChevronRightIcon
                        aria-hidden="true"
                        className="h-4 w-4 text-text-muted transition-colors group-hover:text-text-secondary"
                      />
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
          {count > QUEUE_LIMIT && (
            <div className="border-t border-border-subtle px-5 py-3 sm:px-6">
              <Link to="/escalamientos" className="text-sm font-medium text-text-link hover:underline">
                Ver las {count} conversaciones en la bandeja
              </Link>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function PeriodStats({ stats, title, aside }: { stats: Stat[]; title: string; aside?: string }) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={titleId} className="text-base font-semibold text-text-primary">
          {title}
        </h2>
        {aside && <p className="text-sm text-text-tertiary">{aside}</p>}
      </div>
      <dl className="mt-3 divide-y divide-border-subtle rounded-xl border border-border-default bg-surface">
        {stats.map((stat) => (
          <div key={stat.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 px-5 py-4">
            <dt className="text-sm text-text-secondary">{stat.label}</dt>
            <dd className="row-span-2 text-right tabular-nums">
              <span className="text-2xl font-semibold leading-none text-text-primary">{stat.value}</span>
              {stat.suffix && <span className="text-sm text-text-secondary"> {stat.suffix}</span>}
            </dd>
            {stat.detail && <dd className="mt-0.5 text-xs text-text-tertiary">{stat.detail}</dd>}
          </div>
        ))}
      </dl>
    </section>
  )
}

function ListSection({
  title,
  aside,
  children,
}: {
  title: string
  aside?: string
  children: ReactNode
}) {
  const titleId = useId()
  return (
    <section aria-labelledby={titleId}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={titleId} className="text-base font-semibold text-text-primary">
          {title}
        </h2>
        {aside && <p className="text-sm text-text-tertiary">{aside}</p>}
      </div>
      <ul className="mt-3 divide-y divide-border-subtle rounded-xl border border-border-default bg-surface">
        {children}
      </ul>
    </section>
  )
}
