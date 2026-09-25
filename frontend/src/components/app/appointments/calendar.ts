import type { TextAppointment, TextAppointmentStatus } from '@/types/textAgent'
import { capitalize } from '@/lib/format'

export type AgentKind = 'text' | 'voice'

export type AgentOption = {
  id: string
  name: string
  kind: AgentKind
}

export type CalendarAppointment = TextAppointment & {
  agentKind: AgentKind
  agent_id: string
  agent_name: string
}

export type CalendarCell = {
  key: string
  date: Date
  inCurrentMonth: boolean
  isToday: boolean
}

/* ─── Estados ──────────────────────────────────────────────────────────── */

export const STATUS_OPTIONS: Array<{ value: TextAppointmentStatus; label: string }> = [
  { value: 'scheduled', label: 'Programada' },
  { value: 'confirmed', label: 'Confirmada' },
  { value: 'completed', label: 'Completada' },
  { value: 'cancelled', label: 'Cancelada' },
  { value: 'no_show', label: 'No asistió' },
]

export const STATUS_BADGE: Record<TextAppointmentStatus, 'default' | 'primary' | 'info' | 'warning'> = {
  scheduled: 'info',
  confirmed: 'primary',
  completed: 'default',
  cancelled: 'default',
  no_show: 'warning',
}

export function statusLabel(status: TextAppointmentStatus): string {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status
}

/** Citas que ya no ocupan el horario: se muestran atenuadas. */
export function isInactiveStatus(status: TextAppointmentStatus): boolean {
  return status === 'cancelled' || status === 'no_show'
}

/* ─── Canales reales (origen de la cita) ───────────────────────────────── */

export type ChannelKey = 'whatsapp' | 'web' | 'embed' | 'call' | 'agent' | 'manual'

export const CHANNEL_ORDER: ChannelKey[] = ['whatsapp', 'web', 'embed', 'call', 'agent', 'manual']

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  whatsapp: 'WhatsApp',
  web: 'Chat web',
  embed: 'Sitio web',
  call: 'Llamada',
  agent: 'Chat',
  manual: 'Registro manual',
}

export function appointmentChannel(appointment: CalendarAppointment): ChannelKey {
  switch (String(appointment.source ?? '').toLowerCase()) {
    case 'whatsapp':
      return 'whatsapp'
    case 'web':
      return 'web'
    case 'embed':
      return 'embed'
    case 'voice':
    case 'phone':
      return 'call'
    case 'agent':
      return 'agent'
    case 'manual':
      return 'manual'
    default:
      return appointment.agentKind === 'voice' ? 'call' : 'manual'
  }
}

/* ─── Fechas ───────────────────────────────────────────────────────────── */

export const WEEKDAYS = [
  { short: 'Lun', initial: 'L' },
  { short: 'Mar', initial: 'M' },
  { short: 'Mié', initial: 'M' },
  { short: 'Jue', initial: 'J' },
  { short: 'Vie', initial: 'V' },
  { short: 'Sáb', initial: 'S' },
  { short: 'Dom', initial: 'D' },
]

export function toInputDateValue(date: Date): string {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return adjusted.toISOString().slice(0, 16)
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map((part) => Number.parseInt(part || '', 10))
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date()
  }
  return new Date(year, month - 1, day)
}

export function toMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function isSameMonth(left: Date, right: Date): boolean {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth()
}

/** Semanas de lunes a domingo; solo las filas que el mes necesita (5 o 6, rara vez 4). */
export function buildMonthCells(monthStart: Date): CalendarCell[] {
  const firstDayIndex = monthStart.getDay()
  const leadingDays = firstDayIndex === 0 ? 6 : firstDayIndex - 1
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate()
  const totalCells = Math.ceil((leadingDays + daysInMonth) / 7) * 7

  const firstCellDate = new Date(monthStart)
  firstCellDate.setDate(monthStart.getDate() - leadingDays)
  const todayKey = toDateKey(new Date())

  return Array.from({ length: totalCells }, (_, index) => {
    const date = new Date(firstCellDate)
    date.setDate(firstCellDate.getDate() + index)
    const key = toDateKey(date)
    return {
      key,
      date,
      inCurrentMonth: date.getMonth() === monthStart.getMonth(),
      isToday: key === todayKey,
    }
  })
}

export function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

/** "Jueves 25 de septiembre" */
export function formatDayTitle(date: Date): string {
  const weekday = date.toLocaleDateString('es-CO', { weekday: 'long' })
  const month = date.toLocaleDateString('es-CO', { month: 'long' })
  return capitalize(`${weekday} ${date.getDate()} de ${month}`)
}

/** "Septiembre de 2026" */
export function formatMonthTitle(date: Date): string {
  return capitalize(date.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }))
}

export function contactLabel(appointment: TextAppointment): string {
  return (
    appointment.contact_name?.trim() ||
    appointment.contact_phone?.trim() ||
    appointment.contact_email?.trim() ||
    'Cliente sin nombre'
  )
}

/* ─── Agentes ──────────────────────────────────────────────────────────── */

export function normalizeAgents(raw: unknown, kind: AgentKind): AgentOption[] {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { agents?: unknown[] }).agents)) {
    return []
  }

  const normalized: AgentOption[] = []
  for (const agent of (raw as { agents: Array<Record<string, unknown>> }).agents) {
    const id = String(agent.agent_id ?? '').trim()
    if (!id) continue
    const name = String(agent.name ?? id).trim() || id
    normalized.push({ id, name, kind })
  }
  return normalized
}

export function agentKey(kind: AgentKind, id: string): string {
  return `${kind}:${id}`
}

export function splitAgentKey(key: string): { kind: AgentKind; id: string } {
  const separator = key.indexOf(':')
  const kind = key.slice(0, separator) === 'voice' ? 'voice' : 'text'
  return { kind, id: separator >= 0 ? key.slice(separator + 1) : '' }
}
