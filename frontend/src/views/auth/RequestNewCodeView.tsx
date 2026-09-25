import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import type { RequestConfirmationCodeForm } from '@/types/index'
import { requestConfirmationCode } from '@/api/AuthAPI'
import Button from '@/components/ui/Button'
import FormField, { inputClass } from '@/components/app/shell/FormField'
import { AuthHeader, authLinkClass } from '@/components/auth/AuthParts'

export default function RequestNewCodeView() {
  const initialValues: RequestConfirmationCodeForm = { email: '' }
  const { register, handleSubmit, formState: { errors } } = useForm({ defaultValues: initialValues })

  const { mutate, isPending } = useMutation({
    mutationFn: requestConfirmationCode,
    onError: (error) => toast.error(error.message),
    onSuccess: (data) => toast.success(data),
  })

  return (
    <>
      <AuthHeader
        title="Solicitar un código nuevo"
        description="Ingrese su correo y le enviaremos un código para confirmar su cuenta."
      />

      <form onSubmit={handleSubmit((data) => mutate(data))} className="mt-8 space-y-5" noValidate>
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

        <Button type="submit" size="lg" className="w-full" isLoading={isPending}>
          Enviar código
        </Button>
      </form>

      <p className="mt-8 text-sm text-text-secondary">
        <Link to="/auth/login" className={authLinkClass}>
          Volver a iniciar sesión
        </Link>
      </p>
    </>
  )
}
