import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { ArrowLeftIcon } from '@heroicons/react/20/solid'
import { authenticateUser, verifyMfaLogin } from '@/api/AuthAPI'
import type { ConfirmToken, MfaChallenge, UserLoginForm } from '@/types/index'
import Button from '@/components/ui/Button'
import FormField, { inputClass } from '@/components/app/shell/FormField'
import { AuthHeader, PinCodeField, authLinkClass } from '@/components/auth/AuthParts'

const LANDING_PATH = '/dashboard'

export default function LoginView() {
  const navigate = useNavigate()
  const location = useLocation()

  // Aviso de flujos que cierran la sesión a propósito (p. ej. cambio de contraseña).
  useEffect(() => {
    const notice = (location.state as { notice?: string } | null)?.notice
    if (!notice) return
    toast.success(notice)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, navigate])

  const initialValues: UserLoginForm = {
    email: '',
    password: '',
  }

  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge | null>(null)
  const [mfaCode, setMfaCode] = useState<ConfirmToken['token']>('')
  const { register, handleSubmit, formState: { errors }, reset } = useForm<UserLoginForm>({ defaultValues: initialValues })

  const { mutate: loginMutate, isPending: isLoginPending } = useMutation({
    mutationFn: authenticateUser,
    onError: (error) => {
      toast.error(error.message)
    },
    onSuccess: (data) => {
      if (typeof data === 'string') {
        toast.success('Sesión iniciada')
        reset()
        navigate(LANDING_PATH, { replace: true })
        return
      }

      setMfaChallenge(data)
      setMfaCode('')
      toast.success(data.message)
    },
  })

  const { mutate: verifyMfaMutate, isPending: isVerifyingMfa } = useMutation({
    mutationFn: verifyMfaLogin,
    onError: (error) => {
      toast.error(error.message)
    },
    onSuccess: () => {
      toast.success('Sesión iniciada')
      setMfaChallenge(null)
      setMfaCode('')
      reset()
      navigate(LANDING_PATH, { replace: true })
    },
  })

  const handleLogin = (formData: UserLoginForm) => {
    loginMutate(formData)
  }

  const handleCompleteMfa = (token: ConfirmToken['token']) => {
    if (!mfaChallenge) return
    verifyMfaMutate({
      mfa_token: mfaChallenge.mfa_token,
      code: token,
    })
  }

  if (mfaChallenge) {
    return (
      <>
        <AuthHeader
          title="Verifique su acceso"
          description="Ingrese el código de 6 dígitos que enviamos a su correo."
        />
        <form
          className="mt-8"
          onSubmit={(event) => {
            event.preventDefault()
            if (mfaCode.length === 6) handleCompleteMfa(mfaCode)
          }}
        >
          <PinCodeField
            legend="Código de verificación"
            value={mfaCode}
            onChange={setMfaCode}
            onComplete={handleCompleteMfa}
            disabled={isVerifyingMfa}
          />
          <p aria-live="polite" className="mt-3 min-h-5 text-sm text-text-tertiary">
            {isVerifyingMfa ? 'Verificando el código…' : ''}
          </p>
        </form>

        <button
          type="button"
          onClick={() => {
            setMfaChallenge(null)
            setMfaCode('')
          }}
          className={`mt-6 inline-flex items-center gap-1.5 text-sm ${authLinkClass}`}
        >
          <ArrowLeftIcon aria-hidden="true" className="h-4 w-4" />
          Volver a iniciar sesión
        </button>
      </>
    )
  }

  return (
    <>
      <AuthHeader
        title="Iniciar sesión"
        description="Ingrese con el correo y la contraseña de su cuenta."
      />

      <form onSubmit={handleSubmit(handleLogin)} className="mt-8 space-y-5" noValidate>
        <FormField label="Correo electrónico" error={errors.email?.message}>
          {(control) => (
            <input
              {...control}
              type="email"
              autoComplete="email"
              placeholder="correo@empresa.com"
              className={inputClass}
              {...register('email', {
                required: 'Ingrese su correo electrónico',
                pattern: {
                  value: /\S+@\S+\.\S+/,
                  message: 'Revise el correo; debe tener la forma nombre@empresa.com',
                },
              })}
            />
          )}
        </FormField>

        <FormField label="Contraseña" error={errors.password?.message}>
          {(control) => (
            <input
              {...control}
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              className={inputClass}
              {...register('password', {
                required: 'Ingrese su contraseña',
              })}
            />
          )}
        </FormField>

        <Button type="submit" size="lg" className="w-full" isLoading={isLoginPending}>
          Iniciar sesión
        </Button>
      </form>

      <div className="mt-8 space-y-3 text-sm text-text-secondary">
        <p>
          <Link to="/auth/forgot-password" className={authLinkClass}>
            ¿Olvidó su contraseña?
          </Link>
        </p>
        <p>
          ¿No tiene cuenta?{' '}
          <Link to="/auth/register" className={authLinkClass}>
            Crear una cuenta
          </Link>
        </p>
      </div>
    </>
  )
}
