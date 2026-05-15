import api from '@/lib/axios'
import { isAxiosError } from 'axios'

export type CalendarConnection = {
  id: string
  provider: string
  calendar_id: string
  calendar_name: string
  is_default: boolean
  active: boolean
  created_at: string
}

function getError(error: unknown): string {
  if (isAxiosError(error) && error.response) {
    const detail = error.response.data?.detail
    if (typeof detail === 'string') return detail
    if (detail?.message) return detail.message
    return error.response.data?.error ?? 'Error al conectar'
  }
  return 'Error al conectar'
}

export async function getCalendarConnections(): Promise<{ connections: CalendarConnection[] }> {
  try {
    const { data } = await api.get('/calendars')
    return {
      connections: Array.isArray(data?.connections) ? (data.connections as CalendarConnection[]) : [],
    }
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function getGoogleAuthUrl(redirectAfter?: string): Promise<{ auth_url: string }> {
  try {
    const { data } = await api.get('/calendars/google/auth', {
      params: { redirect_after: redirectAfter || '/citas' },
    })
    return data as { auth_url: string }
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function disconnectCalendar(connectionId: string): Promise<{ deleted: boolean }> {
  try {
    const { data } = await api.delete(`/calendars/${connectionId}`)
    return data as { deleted: boolean }
  } catch (error) {
    throw new Error(getError(error))
  }
}
