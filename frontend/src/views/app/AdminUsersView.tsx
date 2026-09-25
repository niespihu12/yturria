import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldCheckIcon, UsersIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { getAdminUsers, getAuthenticatedUser, adminCreateUser } from '@/api/AuthAPI'
import type { AdminUserSummary } from '@/types/index'
import { useForm } from 'react-hook-form'
import { toast } from 'react-toastify'

function formatDate(unixSecs: number) {
  return new Date(unixSecs * 1000).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function roleLabel(role: AdminUserSummary['role']) {
  if (role === 'super_admin') return 'Super Admin'
  if (role === 'admin') return 'Admin'
  if (role === 'supervisor') return 'Supervisor'
  return 'Agente'
}

type CreateUserForm = {
  name: string
  email: string
  password: string
  role: string
}

export default function AdminUsersView() {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)

  const {
    data: currentUser,
    isLoading: isLoadingUser,
    isError: isCurrentUserError,
  } = useQuery({
    queryKey: ['auth-user'],
    queryFn: getAuthenticatedUser,
  })

  const isSuperAdmin = currentUser?.role === 'super_admin'

  const {
    data,
    isLoading,
    isError,
  } = useQuery({
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
  } = useForm<CreateUserForm>({
    defaultValues: { name: '', email: '', password: '', role: 'agent' },
  })

  const createMutation = useMutation({
    mutationFn: adminCreateUser,
    onSuccess: (data) => {
      toast.success(data.message)
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setShowModal(false)
      reset()
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
      { voice: 0, text: 0, phone: 0 }
    )
  }, [users])

  if (isLoadingUser) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="w-full p-8">
          <div className="flex h-52 items-center justify-center rounded-3xl border border-border-default bg-surface text-text-secondary shadow-sm">
            Cargando permisos...
          </div>
        </div>
      </div>
    )
  }

  if (isCurrentUserError || !isSuperAdmin) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="w-full p-8">
          <div className="flex h-56 flex-col items-center justify-center gap-3 rounded-3xl border border-border-default bg-surface text-center shadow-sm">
            <ShieldCheckIcon className="h-10 w-10 text-amber-500" />
            <h1 className="text-xl font-semibold text-text-primary">Acceso restringido</h1>
            <p className="max-w-xl text-sm text-text-secondary">
              Este panel solo esta disponible para la cuenta super admin de la plataforma.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full p-8">
        <section className="section-enter mb-8 overflow-hidden rounded-3xl border border-border-default bg-surface px-6 py-6 shadow-sm">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary-600">
                Admin
              </p>
              <h1 className="mt-2 text-3xl font-bold text-text-primary">Panel por usuario</h1>
              <p className="mt-2 max-w-2xl text-sm text-text-secondary">
                Gestiona todas las cuentas de la plataforma y entra directo a los recursos de cada
                usuario.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowModal(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#3a1d9e] transition-colors"
              >
                <PlusIcon className="h-4 w-4" />
                Crear usuario
              </button>
              <div className="inline-flex items-center gap-2 rounded-xl bg-primary-50 px-3 py-2 text-sm font-medium text-primary-600">
                <UsersIcon className="h-4 w-4" />
                {users.length} usuarios
              </div>
            </div>
          </div>
        </section>

        <div className="mb-6 grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-border-default bg-surface p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.16em] text-text-tertiary">Usuarios</p>
            <p className="mt-2 text-2xl font-semibold text-text-primary">{users.length}</p>
          </div>
          <div className="rounded-2xl border border-border-default bg-surface p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.16em] text-text-tertiary">Agentes de voz</p>
            <p className="mt-2 text-2xl font-semibold text-text-primary">{totals.voice}</p>
          </div>
          <div className="rounded-2xl border border-border-default bg-surface p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.16em] text-text-tertiary">Agentes de texto</p>
            <p className="mt-2 text-2xl font-semibold text-text-primary">{totals.text}</p>
          </div>
          <div className="rounded-2xl border border-border-default bg-surface p-4 shadow-sm">
            <p className="text-xs uppercase tracking-[0.16em] text-text-tertiary">Numeros</p>
            <p className="mt-2 text-2xl font-semibold text-text-primary">{totals.phone}</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl border border-border-default bg-surface shadow-sm">
          {isLoading ? (
            <div className="flex h-48 items-center justify-center text-text-secondary">
              Cargando usuarios...
            </div>
          ) : isError ? (
            <div className="flex h-48 items-center justify-center px-6 text-center text-text-secondary">
              No fue posible cargar el panel administrativo de usuarios.
            </div>
          ) : users.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-text-secondary">
              No hay usuarios registrados.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                    Usuario
                  </th>
                  <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                    Rol
                  </th>
                  <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                    Estado
                  </th>
                  <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                    Seguridad
                  </th>
                  <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                    Recursos
                  </th>
                  <th className="px-6 py-3.5 text-right text-xs font-medium uppercase tracking-wider text-text-tertiary">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e4e0f5]">
                {users.map((user) => (
                  <tr key={user._id}>
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-text-primary">{user.name}</p>
                      <p className="text-sm text-text-secondary">{user.email}</p>
                      <p className="mt-1 text-xs text-text-muted">
                        Alta: {formatDate(user.created_at_unix_secs)}
                      </p>
                    </td>
                    <td className="px-6 py-4 text-sm text-black/70">{roleLabel(user.role)}</td>
                    <td className="px-6 py-4 text-sm text-black/70">
                      {user.confirmed ? 'Confirmado' : 'Pendiente'}
                    </td>
                    <td className="px-6 py-4 text-sm text-black/70">
                      MFA: {user.mfa_enabled ? 'Activo' : 'Inactivo'}
                    </td>
                    <td className="px-6 py-4 text-sm text-black/70">
                      Voz {user.voice_agents_count} · Texto {user.text_agents_count} · Numeros{' '}
                      {user.phone_numbers_count}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex justify-end gap-2">
                        <Link
                          to={`/agentes_voz?user_id=${encodeURIComponent(user._id)}`}
                          className="rounded-lg bg-[#f5f3ff] px-2.5 py-1.5 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-50"
                        >
                          Voz
                        </Link>
                        <Link
                          to={`/agentes_texto?user_id=${encodeURIComponent(user._id)}`}
                          className="rounded-lg bg-[#f5f3ff] px-2.5 py-1.5 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-50"
                        >
                          Texto
                        </Link>
                        <Link
                          to={`/numeros_telefono?user_id=${encodeURIComponent(user._id)}`}
                          className="rounded-lg bg-[#f5f3ff] px-2.5 py-1.5 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-50"
                        >
                          Numeros
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-bold text-primary-600">Crear nuevo usuario</h2>
                <button onClick={() => { setShowModal(false); reset() }} className="rounded-lg p-1 text-text-muted hover:bg-black/5">
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-secondary">Nombre completo *</label>
                  <input {...register('name', { required: 'El nombre es requerido' })} className="w-full rounded-xl border border-border-default bg-surface px-4 py-2.5 text-sm outline-none focus:border-primary-500 focus:ring-1 focus:ring-[#271173]" placeholder="Ej: Enrique Yturria" />
                  {errors.name && <p className="mt-1 text-xs text-rose-500">{errors.name.message}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-secondary">Email *</label>
                  <input {...register('email', { required: 'El email es requerido' })} type="email" className="w-full rounded-xl border border-border-default bg-surface px-4 py-2.5 text-sm outline-none focus:border-primary-500 focus:ring-1 focus:ring-[#271173]" placeholder="correo@ejemplo.com" />
                  {errors.email && <p className="mt-1 text-xs text-rose-500">{errors.email.message}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-secondary">Contraseña temporal *</label>
                  <input {...register('password', { required: 'La contraseña es requerida', minLength: { value: 8, message: 'Mínimo 8 caracteres' } })} type="password" className="w-full rounded-xl border border-border-default bg-surface px-4 py-2.5 text-sm outline-none focus:border-primary-500 focus:ring-1 focus:ring-[#271173]" placeholder="Mínimo 8 caracteres" />
                  {errors.password && <p className="mt-1 text-xs text-rose-500">{errors.password.message}</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text-secondary">Rol</label>
                  <select {...register('role')} className="w-full rounded-xl border border-border-default bg-surface px-4 py-2.5 text-sm outline-none focus:border-primary-500 focus:ring-1 focus:ring-[#271173]">
                    <option value="agent">Agente</option>
                    <option value="supervisor">Supervisor</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="pt-2 flex justify-end gap-3">
                  <button type="button" onClick={() => { setShowModal(false); reset() }} className="rounded-xl border border-border-default px-4 py-2.5 text-sm font-medium text-text-secondary hover:bg-primary-50/60">Cancelar</button>
                  <button type="submit" disabled={createMutation.isPending} className="rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-[#3a1d9e] disabled:opacity-50">Crear usuario</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
