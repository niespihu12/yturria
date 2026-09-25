import { useEffect, useId, useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-toastify'
import {
  disableMfa,
  enableMfa,
  getAuthenticatedUser,
  updateCurrentUserPassword,
  updateProfile,
} from '@/api/AuthAPI'
import type { UpdateCurrentUserPasswordForm, UserProfileForm } from '@/types/index'
import { clearSession } from '@/lib/session'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import FormField, { inputClass } from '@/components/app/shell/FormField'

function SettingsSection({
  title,
  description,
  aside,
  children,
}: {
  title: string
  description: ReactNode
  aside?: ReactNode
  children: ReactNode
}) {
  const headingId = useId()
  return (
    <section
      aria-labelledby={headingId}
      className="grid gap-5 border-t border-border-default py-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-10"
    >
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={headingId} className="text-base font-semibold text-text-primary">
            {title}
          </h2>
          {aside}
        </div>
        <p className="mt-1 max-w-[45ch] text-sm leading-relaxed text-text-secondary">{description}</p>
      </div>
      <div>{children}</div>
    </section>
  )
}

export default function SettingsView() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [confirm, confirmDialog] = useConfirm()
  const [mfaPassword, setMfaPassword] = useState('')
  const mfaPasswordId = useId()

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
        state: { notice: 'Contraseña actualizada. Ingrese de nuevo con su nueva contraseña.' },
      })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const { mutate: toggleMfa, isPending: isTogglingMfa } = useMutation({
    mutationFn: async (currentPassword: string) => {
      if (!user) throw new Error('No pudimos cargar su usuario. Recargue la página.')
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

  const handleToggleMfa = async () => {
    const currentPassword = mfaPassword.trim()
    if (!user || !currentPassword) return
    if (user.mfa_enabled) {
      const accepted = await confirm({
        title: '¿Desactivar la verificación en dos pasos?',
        description:
          'Su cuenta quedará protegida solo con la contraseña. Puede activarla de nuevo cuando quiera.',
        confirmLabel: 'Desactivar verificación',
      })
      if (!accepted) return
    }
    toggleMfa(currentPassword)
  }

  if (isLoading) {
    return (
      <div role="status" className="flex h-full items-center justify-center gap-2.5 text-sm text-text-secondary">
        <span
          aria-hidden="true"
          className="h-5 w-5 animate-spin rounded-full border-2 border-primary-700 border-t-transparent"
        />
        Cargando configuración…
      </div>
    )
  }

  if (isError || !user) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <p className="max-w-sm text-center text-sm text-text-secondary">
          No pudimos cargar su configuración. Recargue la página para intentarlo de nuevo.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <PageHeader
          title="Configuración"
          description="Sus datos de acceso y la seguridad de su cuenta."
        />

        <SettingsSection
          title="Perfil"
          description="Nombre y correo con los que ingresa a la consola."
        >
          <form
            onSubmit={handleProfileSubmit((values) => saveProfile(values))}
            className="space-y-5"
            noValidate
          >
            <FormField label="Nombre" error={profileErrors.name?.message}>
              {(control) => (
                <input
                  {...control}
                  type="text"
                  autoComplete="name"
                  className={inputClass}
                  {...registerProfile('name', {
                    required: 'Ingrese su nombre',
                  })}
                />
              )}
            </FormField>

            <FormField label="Correo electrónico" error={profileErrors.email?.message}>
              {(control) => (
                <input
                  {...control}
                  type="email"
                  autoComplete="email"
                  className={inputClass}
                  {...registerProfile('email', {
                    required: 'Ingrese su correo electrónico',
                    pattern: {
                      value: /\S+@\S+\.\S+/,
                      message: 'Revise el correo; debe tener la forma nombre@empresa.com',
                    },
                  })}
                />
              )}
            </FormField>

            <div className="flex justify-end">
              <Button type="submit" isLoading={isSavingProfile} disabled={!isProfileDirty}>
                Guardar perfil
              </Button>
            </div>
          </form>
        </SettingsSection>

        <SettingsSection
          title="Contraseña"
          description="Al cambiarla se cerrará la sesión en todos sus dispositivos y deberá ingresar de nuevo."
        >
          <form
            onSubmit={handlePasswordSubmit((values) => savePassword(values))}
            className="space-y-5"
            noValidate
          >
            <FormField label="Contraseña actual" error={passwordErrors.current_password?.message}>
              {(control) => (
                <input
                  {...control}
                  type="password"
                  autoComplete="current-password"
                  className={inputClass}
                  {...registerPassword('current_password', {
                    required: 'Ingrese su contraseña actual',
                  })}
                />
              )}
            </FormField>

            <FormField
              label="Nueva contraseña"
              hint="Mínimo 8 caracteres."
              error={passwordErrors.password?.message}
            >
              {(control) => (
                <input
                  {...control}
                  type="password"
                  autoComplete="new-password"
                  className={inputClass}
                  {...registerPassword('password', {
                    required: 'Ingrese la nueva contraseña',
                    minLength: {
                      value: 8,
                      message: 'La contraseña debe tener al menos 8 caracteres',
                    },
                  })}
                />
              )}
            </FormField>

            <FormField
              label="Confirmar nueva contraseña"
              error={passwordErrors.password_confirmation?.message}
            >
              {(control) => (
                <input
                  {...control}
                  type="password"
                  autoComplete="new-password"
                  className={inputClass}
                  {...registerPassword('password_confirmation', {
                    required: 'Escriba de nuevo la nueva contraseña',
                    validate: (value) =>
                      value === getPasswordValues('password') || 'Las contraseñas no coinciden',
                  })}
                />
              )}
            </FormField>

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="secondary"
                isLoading={isSavingPassword}
                disabled={!isPasswordDirty}
              >
                Cambiar contraseña
              </Button>
            </div>
          </form>
        </SettingsSection>

        <SettingsSection
          title="Verificación en dos pasos"
          aside={
            <Badge variant={user.mfa_enabled ? 'success' : 'default'} size="sm">
              {user.mfa_enabled ? 'Activada' : 'Desactivada'}
            </Badge>
          }
          description="Al iniciar sesión le pediremos, además de la contraseña, un código que enviamos a su correo."
        >
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void handleToggleMfa()
            }}
            className="space-y-5"
          >
            <div className="space-y-1.5">
              <label htmlFor={mfaPasswordId} className="block text-sm font-medium text-text-primary">
                Contraseña actual
              </label>
              <input
                id={mfaPasswordId}
                type="password"
                autoComplete="current-password"
                value={mfaPassword}
                onChange={(event) => setMfaPassword(event.target.value)}
                aria-describedby={`${mfaPasswordId}-hint`}
                className={inputClass}
              />
              <p id={`${mfaPasswordId}-hint`} className="text-xs text-text-tertiary">
                La pedimos para confirmar que es usted quien hace el cambio.
              </p>
            </div>

            <div className="flex justify-end">
              <Button
                type="submit"
                variant="outline"
                isLoading={isTogglingMfa}
                disabled={!mfaPassword.trim()}
              >
                {user.mfa_enabled ? 'Desactivar verificación' : 'Activar verificación'}
              </Button>
            </div>
          </form>
        </SettingsSection>
      </div>
      {confirmDialog}
    </div>
  )
}
