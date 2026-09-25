/**
 * Absolute API base URL (with /api). VITE_API_URL may be relative ("/api") when
 * nginx serves SPA and API from the same origin, but webhook URLs shown to Meta,
 * Twilio or ElevenLabs must always be absolute.
 */
export function absoluteApiBaseUrl(): string {
  const raw = String(import.meta.env.VITE_API_URL ?? '').trim() || '/api'
  return new URL(raw, window.location.origin).toString().replace(/\/$/, '')
}
