import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import type { UserRegistrationForm } from '@/types/index'
import { createAccount } from '@/api/AuthAPI'
import Button from '@/components/ui/Button'
import FormField, { inputClass } from '@/components/app/shell/FormField'
import { AuthHeader, authLinkClass } from '@/components/auth/AuthParts'

export default function RegisterView() {
  const initialValues: UserRegistrationForm = {
    name: '',
    email: '',
    password: '',
    password_confirmation: '',
  }

  const { register, handleSubmit, getValues, reset, formState: { errors } } = useForm<UserRegistrationForm>({ defaultValues: initialValues })

  const { mutate, isPending } = useMutation({
    mutationFn: createAccount,
    onError: (error) => {
      toast.error(error.message)
    },
    onSuccess: (data) => {
      toast.success(data)
      reset()
    },
  })

  const handleRegister = (formData: UserRegistrationForm) => mutate(formData)

  return (
    <>
      <AuthHeader title="Crear cuenta" description="Complete sus datos para registrarse." />

      <form onSubmit={handleSubmit(handleRegister)} className="mt-8 space-y-5" noValidate>
        <FormField label="Nombre completo" error={errors.name?.message}>
          {(control) => (
            <input
              {...control}
              type="text"
              autoComplete="name"
              className={inputClass}
              {...register('name', {
                required: 'Ingrese su nombre',
              })}
            />
          )}
        </FormField>

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

        <FormField label="Contraseña" hint="Mínimo 8 caracteres." error={errors.password?.message}>
          {(control) => (
            <input
              {...control}
              type="password"
              autoComplete="new-password"
              className={inputClass}
              {...register('password', {
                required: 'Ingrese una contraseña',
                minLength: {
                  value: 8,
                  message: 'La contraseña debe tener al menos 8 caracteres',
                },
              })}
            />
          )}
        </FormField>

        <FormField label="Confirmar contraseña" error={errors.password_confirmation?.message}>
          {(control) => (
            <input
              {...control}
              type="password"
              autoComplete="new-password"
              className={inputClass}
              {...register('password_confirmation', {
                required: 'Escriba de nuevo la contraseña',
                validate: (value) => value === getValues('password') || 'Las contraseñas no coinciden',
              })}
            />
          )}
        </FormField>

        <Button type="submit" size="lg" className="w-full" isLoading={isPending}>
          Crear cuenta
        </Button>
      </form>

      <p className="mt-8 text-sm text-text-secondary">
        ¿Ya tiene cuenta?{' '}
        <Link to="/auth/login" className={authLinkClass}>
          Iniciar sesión
        </Link>
      </p>
    </>
  )
}
