export const inputClass =
  'block w-full rounded-lg border border-border-default bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:border-primary-500 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-tertiary'

export const readOnlyInputClass = 'bg-surface-muted text-text-secondary'

export const textareaClass = `${inputClass} resize-y leading-relaxed`

export const labelClass = 'block text-sm font-medium text-text-primary'

export const helpClass = 'mt-0.5 text-xs leading-relaxed text-text-tertiary'

export const errorClass = 'mt-1.5 text-sm text-danger-700'

export const sectionTitleClass = 'text-base font-semibold text-text-primary'

export const subsectionTitleClass = 'text-sm font-semibold text-text-primary'

export const sectionDescriptionClass = 'mt-1 max-w-[65ch] text-sm leading-relaxed text-text-secondary'

export const VOICE_SERVICE_UNAVAILABLE =
  'El servicio de voz no está disponible en este momento. Intente de nuevo más tarde o comuníquese con su administrador.'

const SERVICE_UNAVAILABLE_PATTERN =
  /no configurad|elevenlabs|api[_ ]?key|\b503\b|service unavailable/i

const NETWORK_PATTERN = /^error al conectar$|network error|failed to fetch/i

export function isVoiceServiceUnavailable(error: unknown): boolean {
  return error instanceof Error && SERVICE_UNAVAILABLE_PATTERN.test(error.message)
}

/** Convierte errores técnicos del backend en un mensaje claro para el usuario. */
export function describeError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : ''
  if (!message) return fallback
  if (SERVICE_UNAVAILABLE_PATTERN.test(message)) return VOICE_SERVICE_UNAVAILABLE
  if (NETWORK_PATTERN.test(message)) {
    return 'No pudimos comunicarnos con el servidor. Revise su conexión e intente de nuevo.'
  }
  return message
}
