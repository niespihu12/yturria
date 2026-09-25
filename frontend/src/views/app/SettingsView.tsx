import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  CheckIcon,
  KeyIcon,
  ShieldCheckIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline'
import {
  disableMfa,
  enableMfa,
  getAuthenticatedUser,
  updateCurrentUserPassword,
  updateProfile,
} from '@/api/AuthAPI'
import type {
  UpdateCurrentUserPasswordForm,
  UserProfileForm,
} from '@/types/index'
import { useNavigate } from 'react-router-dom'
import { clearSession } from '@/lib/session'

const inputClass =
  'rounded-xl border border-border-default bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted transition-all duration-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none'

export default function SettingsView() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [mfaPassword, setMfaPassword] = useState('')

  const { data: user, isLoading, isError } = useQuery({
    queryKey: ['auth-user'],
    queryFn: getAuthenticatedUser,
  })

  const {
    register: registerProfile,
    handleSubmit: handleProfileSubmit,
    reset: resetProfile,
    formState: { errors: profileErrors, isDirty: isProfileDirty },
  } = useForm<UserProfileForm>({
    defaultValues: {
      name: '',
      email: '',
    },
  })

  useEffect(() => {
    if (!user) return
    resetProfile({
      name: user.name,
      email: user.email,
    })
  }, [user, resetProfile])

  const {
    register: registerPassword,
    handleSubmit: handlePasswordSubmit,
    getValues: getPasswordValues,
    formState: { errors: passwordErrors, isDirty: isPasswordDirty },
  } = useForm<UpdateCurrentUserPasswordForm>({
    defaultValues: {
      current_password: '',
      password: '',
      password_confirmation: '',
    },
  })

  const { mutate: saveProfile, isPending: isSavingProfile } = useMutation({
    mutationFn: updateProfile,
    onSuccess: (message: string) => {
      toast.success(message)
      queryClient.invalidateQueries({ queryKey: ['auth-user'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const { mutate: savePassword, isPending: isSavingPassword } = useMutation({
    mutationFn: updateCurrentUserPassword,
    onSuccess: () => {
      // Changing the password revokes every session (including this one) on the backend.
      clearSession()
      // The app layout (and its toast container) unmounts here; the login view shows the notice.
      navigate('/auth/login', {
        replace: true,
        state: { notice: 'Password actualizado. Inicia sesion de nuevo con tu nuevo password.' },
      })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const { mutate: toggleMfa, isPending: isTogglingMfa } = useMutation({
    mutationFn: async (currentPassword: string) => {
      if (!user) throw new Error('No se pudo cargar el usuario')
      if (user.mfa_enabled) {
        return disableMfa({ current_password: currentPassword })
      }
      return enableMfa({ current_password: currentPassword })
    },
    onSuccess: (message: string) => {
      toast.success(message)
      setMfaPassword('')
      queryClient.invalidateQueries({ queryKey: ['auth-user'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2.5 text-text-secondary">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#271173] border-t-transparent" />
        Cargando configuracion...
      </div>
    )
  }

  if (isError || !user) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-text-secondary">No se pudo cargar tu configuracion.</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-8 py-8">
      <div className="section-enter">
        <h1 className="text-2xl font-semibold text-text-primary">Configuracion</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Administra tu perfil, tu acceso y las medidas de seguridad de tu cuenta.
        </p>
      </div>

      <section className="rounded-2xl border border-border-default bg-surface p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2.5 text-text-primary">
          <UserCircleIcon className="h-5 w-5 text-primary-600" />
          <h2 className="text-lg font-semibold">Perfil</h2>
        </div>

        <form
          onSubmit={handleProfileSubmit((values) => saveProfile(values))}
          className="grid gap-4 md:grid-cols-2"
          noValidate
        >
          <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
            Nombre
            <input
              type="text"
              className={inputClass}
              placeholder="Tu nombre"
              {...registerProfile('name', {
                required: 'El nombre es obligatorio',
              })}
            />
            {profileErrors.name && (
              <span className="text-xs text-red-500">{profileErrors.name.message}</span>
            )}
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
            Email
            <input
              type="email"
              className={inputClass}
              placeholder="correo@ejemplo.com"
              {...registerProfile('email', {
                required: 'El email es obligatorio',
                pattern: {
                  value: /\S+@\S+\.\S+/,
                  message: 'E-mail no valido',
                },
              })}
            />
            {profileErrors.email && (
              <span className="text-xs text-red-500">{profileErrors.email.message}</span>
            )}
          </label>

          <div className="md:col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={isSavingProfile || !isProfileDirty}
              className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
            >
              {isSavingProfile ? (
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <CheckIcon className="h-4 w-4" />
              )}
              {isSavingProfile ? 'Guardando...' : 'Guardar perfil'}
            </button>
          </div>
        </form>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-border-default bg-surface p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2.5 text-text-primary">
            <KeyIcon className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold">Password</h2>
          </div>

          <form
            onSubmit={handlePasswordSubmit((values) => savePassword(values))}
            className="space-y-4"
            noValidate
          >
            <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
              Password actual
              <input
                type="password"
                className={inputClass}
                placeholder="••••••••"
                {...registerPassword('current_password', {
                  required: 'El password actual es obligatorio',
                })}
              />
              {passwordErrors.current_password && (
                <span className="text-xs text-red-500">
                  {passwordErrors.current_password.message}
                </span>
              )}
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
              Nuevo password
              <input
                type="password"
                className={inputClass}
                placeholder="Minimo 8 caracteres"
                {...registerPassword('password', {
                  required: 'El nuevo password es obligatorio',
                  minLength: {
                    value: 8,
                    message: 'El password es muy corto, minimo 8 caracteres',
                  },
                })}
              />
              {passwordErrors.password && (
                <span className="text-xs text-red-500">{passwordErrors.password.message}</span>
              )}
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium text-text-primary">
              Confirmar nuevo password
              <input
                type="password"
                className={inputClass}
                placeholder="Repite el nuevo password"
                {...registerPassword('password_confirmation', {
                  required: 'Debes confirmar el nuevo password',
                  validate: (value) =>
                    value === getPasswordValues('password') || 'Los Passwords no son iguales',
                })}
              />
              {passwordErrors.password_confirmation && (
                <span className="text-xs text-red-500">
                  {passwordErrors.password_confirmation.message}
                </span>
              )}
            </label>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSavingPassword || !isPasswordDirty}
                className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
              >
                {isSavingPassword ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <CheckIcon className="h-4 w-4" />
                )}
                {isSavingPassword ? 'Actualizando...' : 'Actualizar password'}
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-2xl border border-border-default bg-surface p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2.5 text-text-primary">
            <ShieldCheckIcon className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold">Seguridad</h2>
          </div>

          <div className="rounded-xl border border-border-default bg-[#f5f3ff] p-4">
            <p className="text-sm text-text-primary">
              Estado MFA:{' '}
              <span
                className={user.mfa_enabled ? 'font-semibold text-accent-600' : 'font-semibold text-amber-600'}
              >
                {user.mfa_enabled ? 'Activado' : 'Desactivado'}
              </span>
            </p>
            <p className="mt-2 text-xs text-text-tertiary">
              MFA por correo solicita un codigo adicional al iniciar sesion.
            </p>

            <div className="mt-4 space-y-3">
              <input
                type="password"
                value={mfaPassword}
                onChange={(event) => setMfaPassword(event.target.value)}
                className={inputClass + ' w-full'}
                placeholder="Confirma tu password actual"
              />

              <button
                type="button"
                onClick={() => toggleMfa(mfaPassword.trim())}
                disabled={isTogglingMfa || !mfaPassword.trim()}
                className="inline-flex w-full items-center justify-center rounded-xl border border-[#271173]/25 bg-primary-50 px-4 py-2 text-sm font-semibold text-primary-600 transition-colors hover:bg-[#e0d9ff] disabled:opacity-50"
              >
                {isTogglingMfa
                  ? 'Procesando...'
                  : user.mfa_enabled
                    ? 'Desactivar MFA'
                    : 'Activar MFA'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
    </div>
  )
}
