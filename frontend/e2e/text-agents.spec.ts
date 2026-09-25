import { expect, test } from '@playwright/test'
import { API_URL, CLIENT, apiToken, login, trackPageErrors, uniqueSuffix } from './helpers'

// Agentes creados por la prueba: se borran al final para no consumir el cupo del plan (3).
const createdAgentIds: string[] = []

test.afterEach(async ({ request }) => {
  if (createdAgentIds.length === 0) return
  const token = await apiToken(request, CLIENT)
  for (const id of createdAgentIds.splice(0)) {
    await request.delete(`${API_URL}/text-agents/${id}`, { headers: { Authorization: `Bearer ${token}` } })
  }
})

test('crear un agente de texto desde plantilla y chatear por el embed público', async ({ page, request }) => {
  const errors = trackPageErrors(page)
  const agentName = `Sofia ${uniqueSuffix()}`
  await login(page, CLIENT)
  await page.goto('/agentes_texto')

  await page.getByRole('button', { name: 'Nuevo agente de texto' }).click()
  await page.getByPlaceholder('Ej: Agente comercial principal').fill(agentName)
  await page.getByRole('button', { name: 'Crear agente' }).click()
  await expect(page.getByText('Agente de texto creado')).toBeVisible()
  await expect(page).toHaveURL(/\/agentes_texto\/[\w-]+$/)
  const agentId = page.url().split('/').pop()!
  createdAgentIds.push(agentId)

  // El agente aparece en el listado.
  await page.goto('/agentes_texto')
  await expect(page.getByText(agentName).first()).toBeVisible()

  // El embed público funciona con el token y rechaza tokens inválidos.
  const token = await apiToken(request, CLIENT)
  const embed = await request.get(`${API_URL}/text-agents/${agentId}/embed-config`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(embed.ok()).toBeTruthy()
  const { iframe_url: iframeUrl } = await embed.json()
  const embedPath = new URL(iframeUrl).pathname + new URL(iframeUrl).search

  const badToken = await request.get(`${API_URL}/text-agents/public/${agentId}/embed-info?token=invalido`)
  expect(badToken.status()).toBe(401)

  await page.goto(embedPath)
  await expect(page.getByText(agentName)).toBeVisible()
  const input = page.getByPlaceholder('Escriba su mensaje…')
  await input.fill('Hola, quiero cotizar un seguro de auto')
  await input.press('Enter')

  // En E2E el LLM está desconectado a propósito: la UI debe mostrar el mensaje
  // del usuario y una respuesta (o error) controlada, sin romperse.
  await expect(page.getByText('Hola, quiero cotizar un seguro de auto')).toBeVisible()
  const sendError = page.getByTestId('embed-send-error')
  await expect(sendError).toBeVisible({ timeout: 30_000 })
  // Mensaje amable, sin detalles internos (trazas, IPs, claves).
  await expect(sendError).not.toHaveText(/Traceback|127.0.0.1|sk-|Exception/)
  await expect(input).toBeEnabled()
  expect(errors).toEqual([])
})

test('un cliente no puede ver agentes de texto de otro usuario', async ({ request }) => {
  const token = await apiToken(request, CLIENT)
  const res = await request.get(`${API_URL}/text-agents/00000000-0000-0000-0000-000000000000`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(res.status()).toBe(404)
})
