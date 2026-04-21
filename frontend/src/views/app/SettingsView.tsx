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

const inputClass =
  'rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black placeholder:text-black/40 transition-colors focus:border-[#271173] focus:outline-none'

export default function SettingsView() {
  const queryClient = useQueryClient()
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
    reset: resetPassword,
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
    onSuccess: (message: string) => {
      toast.success(message)
      resetPassword({
        current_password: '',
        password: '',
        password_confirmation: '',
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
      <div className="flex h-full items-center justify-center gap-2.5 text-black/60">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#271173] border-t-transparent" />
        Cargando configuracion...
      </div>
    )
  }

  if (isError || !user) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-black/60">No se pudo cargar tu configuracion.</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-8 py-8">
      <div className="section-enter">
        <h1 className="text-2xl font-semibold text-black">Configuracion</h1>
        <p className="mt-1 text-sm text-black/60">
          Administra tu perfil, tu acceso y las medidas de seguridad de tu cuenta.
        </p>
      </div>

      <section className="rounded-2xl border border-[#e4e0f5] bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2.5 text-black">
          <UserCircleIcon className="h-5 w-5 text-[#271173]" />
          <h2 className="text-lg font-semibold">Perfil</h2>
        </div>

        <form
          onSubmit={handleProfileSubmit((values) => saveProfile(values))}
          className="grid gap-4 md:grid-cols-2"
          noValidate
        >
          <label className="flex flex-col gap-1.5 text-sm font-medium text-black/80">
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

          <label className="flex flex-col gap-1.5 text-sm font-medium text-black/80">
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
              className="inline-flex items-center gap-2 rounded-xl bg-[#271173] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-50"
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
        <section className="rounded-2xl border border-[#e4e0f5] bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2.5 text-black">
            <KeyIcon className="h-5 w-5 text-[#271173]" />
            <h2 className="text-lg font-semibold">Password</h2>
          </div>

          <form
            onSubmit={handlePasswordSubmit((values) => savePassword(values))}
            className="space-y-4"
            noValidate
          >
            <label className="flex flex-col gap-1.5 text-sm font-medium text-black/80">
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

            <label className="flex flex-col gap-1.5 text-sm font-medium text-black/80">
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

            <label className="flex flex-col gap-1.5 text-sm font-medium text-black/80">
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
                className="inline-flex items-center gap-2 rounded-xl bg-[#271173] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-50"
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

        <section className="rounded-2xl border border-[#e4e0f5] bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2.5 text-black">
            <ShieldCheckIcon className="h-5 w-5 text-[#271173]" />
            <h2 className="text-lg font-semibold">Seguridad</h2>
          </div>

          <div className="rounded-xl border border-[#e4e0f5] bg-[#f5f3ff] p-4">
            <p className="text-sm text-black/80">
              Estado MFA:{' '}
              <span
                className={user.mfa_enabled ? 'font-semibold text-emerald-600' : 'font-semibold text-amber-600'}
              >
                {user.mfa_enabled ? 'Activado' : 'Desactivado'}
              </span>
            </p>
            <p className="mt-2 text-xs text-black/50">
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
                className="inline-flex w-full items-center justify-center rounded-xl border border-[#271173]/25 bg-[#ede9ff] px-4 py-2 text-sm font-semibold text-[#271173] transition-colors hover:bg-[#e0d9ff] disabled:opacity-50"
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
