import { queryClient } from '@/lib/queryClient'

export const AUTH_TOKEN_KEY = 'AUTH_TOKEN'

/** Drops the token and every cached query so the next user never sees stale data. */
export function clearSession() {
  localStorage.removeItem(AUTH_TOKEN_KEY)
  queryClient.cancelQueries()
  queryClient.clear()
}

export function startSession(token: string) {
  queryClient.clear()
  localStorage.setItem(AUTH_TOKEN_KEY, token)
}
