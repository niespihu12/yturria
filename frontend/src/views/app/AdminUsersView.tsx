import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { toast } from 'react-toastify'
import { LockClosedIcon, PlusIcon } from '@heroicons/react/24/outline'
import { getAdminUsers, adminCreateUser } from '@/api/AuthAPI'
import type { AdminUserSummary } from '@/types/index'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import FormField, { inputClass } from '@/components/app/shell/FormField'

function formatDate(unixSecs: number) {
  return new Date(unixSecs * 1000).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function roleLabel(role: AdminUserSummary['role']) {
  if (role === 'super_admin') return 'Super administrador'
  if (role === 'admin') return 'Administrador'
  if (role === 'supervisor') return 'Supervisor'
  return 'Agente'
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

type CreateUserForm = {
  name: string
  email: string
  password: string
  role: string
}

const EMPTY_FORM: CreateUserForm = { name: '', email: '', password: '', role: 'agent' }

const resourceLinkClass =
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border-default px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-800'

const headerCellClass = 'px-4 py-3 text-left text-xs font-medium text-text-tertiary first:pl-5 last:pr-5'
const cellClass = 'px-4 py-4 align-top text-sm text-text-secondary first:pl-5 last:pr-5'
// La primera columna queda fija al desplazar la tabla en pantallas angostas.
const stickyCellClass =
  'sticky left-0 z-10 shadow-[1px_0_0_0_var(--color-border-subtle)] xl:shadow-none'

function ResourceLinks({ user }: { user: AdminUserSummary }) {
  const query = `?user_id=${encodeURIComponent(user._id)}`
  const links = [
    { to: `/agentes_voz${query}`, label: 'Voz', count: user.voice_agents_count, full: 'Agentes de voz' },
    { to: `/agentes_texto${query}`, label: 'Texto', count: user.text_agents_count, full: 'Agentes de texto' },
    { to: `/numeros_telefono${query}`, label: 'Números', count: user.phone_numbers_count, full: 'Números de teléfono' },
  ]
  return (
    <div className="flex gap-2">
      {links.map((link) => (
        <Link
          key={link.label}
          to={link.to}
          aria-label={`${link.full} de ${user.name}: ${link.count}`}
          className={resourceLinkClass}
        >
          {link.label}
          <span className="font-semibold tabular-nums text-text-primary">{link.count}</span>
        </Link>
      ))}
    </div>
  )
}

export default function AdminUsersView() {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const { isSuperAdmin, isLoading: isLoadingUser } = useCurrentUser()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-users'],
    queryFn: getAdminUsers,
    enabled: isSuperAdmin,
  })

  const users = useMemo(() => data?.users ?? [], [data])

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateUserForm>({ defaultValues: EMPTY_FORM })

  const closeModal = useCallback(() => {
    setShowModal(false)
    reset()
  }, [reset])

  const createMutation = useMutation({
    mutationFn: adminCreateUser,
    onSuccess: (result) => {
      toast.success(result.message)
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      closeModal()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const onSubmit = (form: CreateUserForm) => {
    createMutation.mutate({
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
      role: form.role,
    })
  }

  const totals = useMemo(() => {
    return users.reduce(
      (acc, row) => {
        acc.voice += row.voice_agents_count
        acc.text += row.text_agents_count
        acc.phone += row.phone_numbers_count
        return acc
      },
      { voice: 0, text: 0, phone: 0 },
    )
  }, [users])

  if (isLoadingUser) {
    return (
      <div role="status" className="flex h-full items-center justify-center text-sm text-text-secondary">
        Cargando permisos…
      </div>
    )
  }

  if (!isSuperAdmin) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 px-4 py-16 sm:px-6">
          <LockClosedIcon aria-hidden="true" className="h-8 w-8 text-text-tertiary" />
          <h1 className="font-display text-2xl text-primary-800">Acceso restringido</h1>
          <p className="text-sm leading-relaxed text-text-secondary">
            Esta sección solo está disponible para la cuenta de super administrador de la plataforma.
          </p>
          <Link
            to="/dashboard"
            className="text-sm font-medium text-primary-700 underline-offset-4 hover:text-primary-800 hover:underline"
          >
            Volver al Dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <PageHeader
          title="Usuarios de la plataforma"
          description="Cuentas con acceso a la consola. Desde aquí puede crear una cuenta o revisar los agentes y números de cada usuario."
          actions={
            <Button leftIcon={<PlusIcon aria-hidden="true" className="h-4 w-4" />} onClick={() => setShowModal(true)}>
              Crear usuario
            </Button>
          }
        />

        {!isLoading && !isError && users.length > 0 && (
          <p className="mb-4 text-sm tabular-nums text-text-secondary">
            <span className="font-semibold text-text-primary">{plural(users.length, 'usuario', 'usuarios')}</span>
            <span aria-hidden="true" className="px-2 text-text-muted">·</span>
            {plural(totals.voice, 'agente de voz', 'agentes de voz')}
            <span aria-hidden="true" className="px-2 text-text-muted">·</span>
            {plural(totals.text, 'agente de texto', 'agentes de texto')}
            <span aria-hidden="true" className="px-2 text-text-muted">·</span>
            {plural(totals.phone, 'número', 'números')}
          </p>
        )}

        <div className="overflow-hidden rounded-xl border border-border-default bg-surface">
          {isLoading ? (
            <p role="status" className="px-6 py-16 text-center text-sm text-text-secondary">
              Cargando usuarios…
            </p>
          ) : isError ? (
            <p className="px-6 py-16 text-center text-sm text-text-secondary">
              No pudimos cargar la lista de usuarios. Recargue la página para intentarlo de nuevo.
            </p>
          ) : users.length === 0 ? (
            <p className="px-6 py-16 text-center text-sm text-text-secondary">
              Aún no hay usuarios. Use «Crear usuario» para dar acceso a la primera persona.
            </p>
          ) : (
            <div
              role="region"
              aria-label="Usuarios de la plataforma"
              tabIndex={0}
              className="custom-scrollbar overflow-x-auto focus-visible:outline-offset-[-2px]"
            >
              <table className="w-full min-w-[46rem]">
                <thead className="bg-surface-muted">
                  <tr className="border-b border-border-default">
                    <th scope="col" className={`${headerCellClass} ${stickyCellClass} bg-surface-muted`}>
                      Usuario
                    </th>
                    <th scope="col" className={headerCellClass}>Rol</th>
                    <th scope="col" className={headerCellClass}>Estado</th>
                    <th scope="col" className={headerCellClass}>Verificación</th>
                    <th scope="col" className={headerCellClass}>Recursos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {users.map((user) => (
                    <tr key={user._id}>
                      <th scope="row" className={`${cellClass} ${stickyCellClass} bg-surface text-left font-normal`}>
                        <p className="font-medium text-text-primary">{user.name}</p>
                        <p className="whitespace-nowrap">{user.email}</p>
                        <p className="mt-1 whitespace-nowrap text-xs text-text-tertiary">
                          Desde el {formatDate(user.created_at_unix_secs)}
                        </p>
                      </th>
                      <td className={`${cellClass} whitespace-nowrap`}>{roleLabel(user.role)}</td>
                      <td className={cellClass}>
                        <Badge variant={user.confirmed ? 'success' : 'warning'} size="sm">
                          {user.confirmed ? 'Confirmado' : 'Pendiente'}
                        </Badge>
                      </td>
                      <td className={cellClass}>{user.mfa_enabled ? 'Activada' : 'Desactivada'}</td>
                      <td className={cellClass}>
                        <ResourceLinks user={user} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={showModal}
        onClose={closeModal}
        title="Crear usuario"
        description="La persona ingresará con una contraseña temporal que podrá cambiar en Configuración."
        dismissOnBackdrop={false}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          <FormField label="Nombre completo" error={errors.name?.message}>
            {(control) => (
              <input
                {...control}
                type="text"
                autoComplete="off"
                placeholder="Ej.: Laura Gómez"
                className={inputClass}
                {...register('name', { required: 'Ingrese el nombre de la persona' })}
              />
            )}
          </FormField>
          <FormField label="Correo electrónico" error={errors.email?.message}>
            {(control) => (
              <input
                {...control}
                type="email"
                autoComplete="off"
                placeholder="correo@empresa.com"
                className={inputClass}
                {...register('email', {
                  required: 'Ingrese el correo de la persona',
                  pattern: {
                    value: /\S+@\S+\.\S+/,
                    message: 'Revise el correo; debe tener la forma nombre@empresa.com',
                  },
                })}
              />
            )}
          </FormField>
          <FormField label="Contraseña temporal" hint="Mínimo 8 caracteres." error={errors.password?.message}>
            {(control) => (
              <input
                {...control}
                type="password"
                autoComplete="new-password"
                className={inputClass}
                {...register('password', {
                  required: 'Ingrese una contraseña temporal',
                  minLength: { value: 8, message: 'La contraseña debe tener al menos 8 caracteres' },
                })}
              />
            )}
          </FormField>
          <FormField label="Rol">
            {(control) => (
              <select {...control} className={inputClass} {...register('role')}>
                <option value="agent">Agente</option>
                <option value="supervisor">Supervisor</option>
                <option value="admin">Administrador</option>
              </select>
            )}
          </FormField>
          <div className="flex flex-col-reverse gap-2 border-t border-border-subtle pt-5 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={closeModal}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={createMutation.isPending}>
              Crear usuario
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
