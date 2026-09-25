import { expect, test } from '@playwright/test'
import { ADMIN, CLIENT, login } from './helpers'

test.describe('Autenticación', () => {
  test('sin sesión, las rutas privadas redirigen al login', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/auth\/login$/)
  })

  test('credenciales inválidas muestran un error genérico', async ({ page }) => {
    await page.goto('/auth/login')
    await page.getByPlaceholder('correo@empresa.com').fill(ADMIN.email)
    await page.getByPlaceholder('••••••••').fill('ClaveIncorrecta1')
    await page.getByRole('button', { name: 'Iniciar Sesion' }).click()
    await expect(page.getByText('Email o password incorrectos')).toBeVisible()
    await expect(page).toHaveURL(/\/auth\/login$/)
  })

  test('los mensajes de validación se actualizan en cada envío', async ({ page }) => {
    await page.goto('/auth/login')
    await page.getByRole('button', { name: 'Iniciar Sesion' }).click()
    await expect(page.getByText(/email es obligatorio/i)).toBeVisible()

    await page.getByPlaceholder('correo@empresa.com').fill(ADMIN.email)
    await page.getByRole('button', { name: 'Iniciar Sesion' }).click()
    await expect(page.getByText(/email es obligatorio/i)).toHaveCount(0)
    await expect(page.getByText(/password es obligatorio/i)).toBeVisible()
  })

  test('login y logout limpian la sesión', async ({ page }) => {
    await login(page, CLIENT)
    await page.getByRole('button', { name: 'Cerrar sesión' }).click()
    await expect(page).toHaveURL(/\/auth\/login$/)
    expect(await page.evaluate(() => localStorage.getItem('AUTH_TOKEN'))).toBeNull()

    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/auth\/login$/)
  })

  test('un token inválido o expirado devuelve al login y se descarta', async ({ page }) => {
    await page.goto('/auth/login')
    await page.evaluate(() => localStorage.setItem('AUTH_TOKEN', 'token.invalido.firma'))
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/auth\/login$/)
    expect(await page.evaluate(() => localStorage.getItem('AUTH_TOKEN'))).toBeNull()
  })

  test('olvidé mi contraseña no revela si la cuenta existe', async ({ page }) => {
    await page.goto('/auth/forgot-password')
    await page.getByRole('textbox').first().fill('no-existe@e2e.test')
    await page.getByRole('button').filter({ hasText: /enviar|instrucciones|restablecer/i }).first().click()
    await expect(page.getByText(/Si el email esta registrado/)).toBeVisible()
  })
})
