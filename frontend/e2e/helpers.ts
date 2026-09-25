import { expect, type APIRequestContext, type Page } from '@playwright/test'

// Usuarios sembrados por backend/scripts/seed_e2e.py
export const PASSWORD = 'E2eClave123!'
export const ADMIN = { email: 'admin@e2e.test', password: PASSWORD, name: 'Admin E2E' }
export const CLIENT = { email: 'cliente@e2e.test', password: PASSWORD, name: 'Cliente E2E' }

export const API_URL = `http://localhost:${process.env.E2E_BACKEND_PORT ?? '8002'}/api`

type Credentials = { email: string; password: string }

export function uniqueSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`
}

export async function login(page: Page, user: Credentials) {
  await page.goto('/auth/login')
  await page.getByPlaceholder('correo@empresa.com').fill(user.email)
  await page.getByPlaceholder('••••••••').fill(user.password)
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
}

export async function apiToken(request: APIRequestContext, user: Credentials) {
  const res = await request.post(`${API_URL}/auth/login`, { data: user })
  expect(res.ok()).toBeTruthy()
  return res.text()
}

/** Collects uncaught JS errors so a test can assert the page never crashed. */
export function trackPageErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}
