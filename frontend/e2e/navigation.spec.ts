import { expect, test } from '@playwright/test'
import { ADMIN, API_URL, CLIENT, apiToken, login, trackPageErrors } from './helpers'

const ROUTES: Array<[string, string | RegExp]> = [
  ['/dashboard', 'Resumen'],
  ['/agentes_voz', 'Agentes de Voz'],
  ['/agentes_texto', 'Agentes de Texto'],
  ['/escalamientos', 'Bandeja de atención'],
  ['/citas', 'Citas'],
  ['/whatsapp_config', 'WhatsApp saliente'],
  ['/numeros_telefono', 'Números de teléfono'],
  ['/directorio', 'Directorio de asesores'],
  ['/configuracion', 'Configuración'],
  ['/sofia-errores', 'Respuestas por revisar'],
  ['/voice-analytics', 'Análisis de llamadas'],
  ['/admin/usuarios', 'Usuarios de la plataforma'],
]

test('el super admin recorre todos los módulos sin errores de JavaScript', async ({ page }) => {
  const errors = trackPageErrors(page)
  await login(page, ADMIN)

  for (const [path, heading] of ROUTES) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: heading }), path).toBeVisible()
  }
  expect(errors).toEqual([])
})

test('un cliente no ve ni puede usar la administración', async ({ page, request }) => {
  const errors = trackPageErrors(page)
  await login(page, CLIENT)
  await expect(page.locator('a[href="/admin/usuarios"]')).toHaveCount(0)

  await page.goto('/admin/usuarios')
  await expect(page.getByRole('heading', { name: 'Acceso restringido' })).toBeVisible()

  const token = await apiToken(request, CLIENT)
  const res = await request.get(`${API_URL}/auth/admin/users`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.status()).toBe(403)
  expect(errors).toEqual([])
})

test('rutas desconocidas vuelven al inicio de la app', async ({ page }) => {
  await login(page, CLIENT)
  await page.goto('/ruta-que-no-existe')
  await expect(page).toHaveURL(/\/dashboard$/)
})
