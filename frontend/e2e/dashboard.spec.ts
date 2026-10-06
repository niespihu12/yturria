import { expect, test } from '@playwright/test'
import { CLIENT, login, trackPageErrors } from './helpers'

test('el resumen se filtra por hoy, 7 días y 30 días', async ({ page }) => {
  const errors = trackPageErrors(page)
  await login(page, CLIENT)

  const period = page.getByRole('group', { name: 'Periodo' })
  // Por defecto muestra los últimos 30 días, por día.
  await expect(period.getByRole('button', { name: '30 días' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { name: 'Conversaciones por día' })).toBeVisible()

  await period.getByRole('button', { name: 'Hoy' }).click()
  await expect(page).toHaveURL(/periodo=hoy/)
  await expect(page.getByRole('heading', { name: 'Hoy en cifras' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Conversaciones por hora' })).toBeVisible()

  await period.getByRole('button', { name: '7 días' }).click()
  await expect(page).toHaveURL(/periodo=semana/)
  await expect(page.getByRole('heading', { name: 'Conversaciones por día' })).toBeVisible()

  // El periodo elegido se conserva al recargar.
  await page.reload()
  await expect(period.getByRole('button', { name: '7 días' })).toHaveAttribute('aria-pressed', 'true')

  await period.getByRole('button', { name: '30 días' }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  expect(errors).toEqual([])
})
