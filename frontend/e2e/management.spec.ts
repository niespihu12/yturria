import { expect, test } from '@playwright/test'
import { ADMIN, CLIENT, PASSWORD, login, trackPageErrors, uniqueSuffix } from './helpers'

test('CRUD de contactos del directorio', async ({ page }) => {
  const errors = trackPageErrors(page)
  const name = `Asesor${uniqueSuffix()}`
  await login(page, CLIENT)
  await page.goto('/directorio')

  await page.getByRole('button', { name: 'Nuevo contacto' }).click()
  await page.locator('input[name="name"]').fill(name)
  await page.locator('input[name="last_name"]').fill('Prueba')
  await page.locator('input[name="specialty"]').fill('Seguros de auto')
  await page.locator('input[name="phone"]').fill('+573001234567')
  await page.locator('input[name="email"]').fill(`${name.toLowerCase()}@e2e.test`)
  await page.getByRole('button', { name: 'Crear contacto' }).click()
  await expect(page.getByText('Contacto creado')).toBeVisible()
  const row = page.getByRole('row').filter({ hasText: name })
  await expect(row).toBeVisible()

  await row.getByTitle('Editar').click()
  await page.locator('input[name="specialty"]').fill('Gastos médicos')
  await page.locator('form button[type="submit"]').click()
  await expect(page.getByText('Contacto actualizado')).toBeVisible()
  await expect(row.getByText('Gastos médicos')).toBeVisible()

  page.once('dialog', (dialog) => dialog.accept())
  await row.getByTitle('Eliminar').click()
  await expect(page.getByText('Contacto eliminado')).toBeVisible()
  await expect(row).toHaveCount(0)
  expect(errors).toEqual([])
})

test('el super admin crea un usuario que puede iniciar sesión', async ({ page }) => {
  const email = `nuevo${uniqueSuffix()}@e2e.test`
  await login(page, ADMIN)
  await page.goto('/admin/usuarios')

  await page.getByRole('button', { name: 'Crear usuario' }).first().click()
  await page.locator('input[name="name"]').fill('Usuario Nuevo')
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(PASSWORD)
  await page.locator('select[name="role"]').selectOption('agent')
  await page.locator('form').getByRole('button', { name: 'Crear usuario' }).click()
  await expect(page.getByText('Usuario creado correctamente')).toBeVisible()
  await expect(page.getByText(email)).toBeVisible()

  await page.getByRole('button', { name: 'Cerrar sesión' }).click()
  await login(page, { email, password: PASSWORD })
  await expect(page.locator('a[href="/admin/usuarios"]')).toHaveCount(0)
})

test('actualizar el nombre del perfil persiste tras recargar', async ({ page }) => {
  const newName = `Cliente ${uniqueSuffix()}`
  await login(page, CLIENT)
  await page.goto('/configuracion')
  // El formulario se rellena con los datos del usuario al cargar; esperar evita la carrera.
  await expect(page.locator('input[name="email"]')).toHaveValue(CLIENT.email)

  await page.locator('input[name="name"]').fill(newName)
  await page.getByRole('button', { name: 'Guardar perfil' }).click()
  await expect(page.getByText(/Perfil Actualizado/i)).toBeVisible()

  await page.reload()
  await expect(page.locator('input[name="name"]')).toHaveValue(newName)
})

test('una contraseña actual incorrecta no cierra la sesión', async ({ page }) => {
  await login(page, CLIENT)
  await page.goto('/configuracion')
  await page.locator('input[name="current_password"]').fill('ClaveEquivocada1')
  await page.locator('input[name="password"]').fill('NuevaClave12345')
  await page.locator('input[name="password_confirmation"]').fill('NuevaClave12345')
  await page.getByRole('button', { name: 'Actualizar password' }).click()
  await expect(page.getByText('El password actual es incorrecto')).toBeVisible()
  await expect(page).toHaveURL(/\/configuracion$/)
  expect(await page.evaluate(() => localStorage.getItem('AUTH_TOKEN'))).not.toBeNull()
})

test('cambiar el password cierra la sesión con aviso y permite entrar con el nuevo', async ({ page }) => {
  const email = `clave${uniqueSuffix()}@e2e.test`
  const newPassword = 'OtraClave12345'
  // Usuario propio para no alterar las credenciales compartidas de la suite.
  await login(page, ADMIN)
  await page.goto('/admin/usuarios')
  await page.getByRole('button', { name: 'Crear usuario' }).first().click()
  await page.locator('input[name="name"]').fill('Cambio Clave')
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(PASSWORD)
  await page.locator('form').getByRole('button', { name: 'Crear usuario' }).click()
  await expect(page.getByText('Usuario creado correctamente')).toBeVisible()
  await page.getByRole('button', { name: 'Cerrar sesión' }).click()

  await login(page, { email, password: PASSWORD })
  await page.goto('/configuracion')
  await page.locator('input[name="current_password"]').fill(PASSWORD)
  await page.locator('input[name="password"]').fill(newPassword)
  await page.locator('input[name="password_confirmation"]').fill(newPassword)
  await page.getByRole('button', { name: 'Actualizar password' }).click()
  await expect(page).toHaveURL(/\/auth\/login$/)
  await expect(page.getByText(/Inicia sesion de nuevo/)).toBeVisible()

  await login(page, { email, password: newPassword })
})
