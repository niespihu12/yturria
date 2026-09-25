import { useEffect, useState } from 'react'
import type { EscalatedConversation, EscalationStatus } from '@/types/textAgent'

/** Fila de la bandeja tal como la entrega la API (trae campos que el tipo base no declara). */
export type EscalationRow = EscalatedConversation & {
  title?: string
  last_user_message?: string
  created_at_unix_secs?: number
}

/** Contrato de URL para abrir una conversación de la bandeja: /escalamientos?conversacion=…&agente=… */
export const ESCALATION_QUERY_PARAMS = { conversation: 'conversacion', agent: 'agente' } as const

export function escalationHref(conversationId: string, agentId?: string): string {
  const params = new URLSearchParams({ [ESCALATION_QUERY_PARAMS.conversation]: conversationId })
  if (agentId) params.set(ESCALATION_QUERY_PARAMS.agent, agentId)
  return `/escalamientos?${params.toString()}`
}

const REASON_LABELS: Record<string, string> = {
  user_request: 'Pidió hablar con una persona',
  active_claim: 'Reclamación en curso',
  uncertainty_detected: 'Sofía no estaba segura de la respuesta',
  auto_threshold: 'Conversación larga sin resolver',
  specific_policy: 'Consulta sobre su póliza',
}

export function describeEscalationReason(reason?: string | null): string {
  const value = String(reason ?? '').trim()
  if (!value) return 'Necesita a una persona del equipo'
  const known = REASON_LABELS[value.toLowerCase()]
  if (known) return known
  if (/^[a-z0-9_]+$/.test(value)) return 'Necesita a una persona del equipo'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function isOpenEscalation(status?: string | null): boolean {
  return status === 'pending' || status === 'in_progress'
}

export const ESCALATION_STATUS_LABELS: Record<EscalationStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En atención',
  resolved: 'Resuelta',
}

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  web: 'Chat web',
  embed: 'Sitio web',
  voice: 'Llamada',
}

export function channelLabel(channel?: string | null): string {
  const value = String(channel ?? '').trim().toLowerCase()
  return CHANNEL_LABELS[value] ?? 'Otro canal'
}

export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  if (seconds < 60) return 'menos de un minuto'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return minutes === 1 ? '1 minuto' : `${minutes} minutos`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hora' : `${hours} horas`
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 día' : `${days} días`
}

export function timeAgo(unixSecs: number | null | undefined, nowMs: number): string {
  if (!unixSecs) return 'Sin fecha'
  const elapsed = nowMs / 1000 - unixSecs
  if (elapsed < 60) return 'hace un momento'
  return `hace ${formatElapsed(elapsed)}`
}

export function formatDateTime(unixSecs: number | null | undefined): string {
  if (!unixSecs) return ''
  return new Date(unixSecs * 1000).toLocaleString('es-CO', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Reloj que avanza cada minuto para los tiempos relativos ("hace 5 minutos"). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

// ── Contacto del cliente ─────────────────────────────────────────────────────

/** Devuelve solo dígitos con indicativo de país, o null si no parece un teléfono. */
export function normalizePhone(raw?: string | null): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length === 10 && digits.startsWith('3')) return `57${digits}`
  if (digits.length >= 8 && digits.length <= 15) return digits
  return null
}

export function formatPhone(digits: string): string {
  if (digits.length === 12 && digits.startsWith('57')) {
    return `+57 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`
  }
  return `+${digits}`
}

/** Las conversaciones de WhatsApp se guardan con el título "whatsapp:+57…". */
export function phoneFromTitle(title?: string | null): string | null {
  const value = String(title ?? '').trim()
  if (!/^whatsapp:/i.test(value)) return null
  return normalizePhone(value)
}

const MOBILE_IN_TEXT = /(?<!\d)(?:\+?57[\s.-]?)?3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/

/** Busca un celular colombiano que el cliente haya escrito en la conversación. */
export function phoneFromTranscript(transcript: Array<{ role: string; message: string }>): string | null {
  for (const entry of transcript) {
    if (entry.role !== 'user') continue
    const match = entry.message.match(MOBILE_IN_TEXT)
    const phone = match ? normalizePhone(match[0]) : null
    if (phone) return phone
  }
  return null
}

export function customerLabel(channel?: string | null, phone?: string | null): string {
  if (phone) return formatPhone(phone)
  switch (String(channel ?? '').toLowerCase()) {
    case 'whatsapp':
      return 'Cliente de WhatsApp'
    case 'embed':
      return 'Visitante del sitio web'
    case 'web':
      return 'Visitante del chat web'
    default:
      return 'Cliente'
  }
}

export const telHref = (digits: string) => `tel:+${digits}`
export const whatsappHref = (digits: string) => `https://wa.me/${digits}`
