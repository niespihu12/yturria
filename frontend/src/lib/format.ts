/** Solo dígitos y un "+" inicial: el valor que entienden los enlaces tel: y wa.me. */
export function normalizePhone(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim()
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return ''
  return trimmed.startsWith('+') ? `+${digits}` : digits
}

/** Quita espacios, guiones y paréntesis sin tocar el "+" inicial (formato E.164). */
export function compactPhone(raw: string): string {
  return raw.trim().replace(/[\s().-]/g, '')
}

function groupColombian(local: string): string {
  return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`
}

/**
 * Número legible: +573001234567 → +57 300 123 4567.
 * Los formatos que no reconoce se devuelven tal como se escribieron.
 */
export function formatPhone(raw: string | null | undefined): string {
  const value = (raw ?? '').trim()
  if (!value) return ''
  const normalized = normalizePhone(value)
  const digits = normalized.replace('+', '')

  if (digits.length === 12 && digits.startsWith('57')) {
    return `+57 ${groupColombian(digits.slice(2))}`
  }
  if (!normalized.startsWith('+') && digits.length === 10) {
    return groupColombian(digits)
  }
  return value
}

export function phoneHref(raw: string | null | undefined): string {
  return `tel:${normalizePhone(raw)}`
}

export function whatsappHref(raw: string | null | undefined): string {
  return `https://wa.me/${normalizePhone(raw).replace('+', '')}`
}

export function isSamePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizePhone(a).replace('+', '')
  const right = normalizePhone(b).replace('+', '')
  return Boolean(left) && left === right
}

/** "1 cita" / "7 citas", con separador de miles colombiano. */
export function pluralize(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString('es-CO')} ${count === 1 ? singular : plural}`
}

export function capitalize(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase('es-CO') + text.slice(1) : text
}
