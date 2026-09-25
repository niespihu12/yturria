import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import type { ConfirmToken, NewPasswordForm } from '@/types/index'
import { updatePasswordWithToken } from '@/api/AuthAPI'
import Button from '@/components/ui/Button'
import FormField, { inputClass } from '@/components/app/shell/FormField'

type NewPasswordFormProps = {
  token: ConfirmToken['token']
}

export default function NewPasswordForm({ token }: NewPasswordFormProps) {
  const navigate = useNavigate()
  const initialValues: NewPasswordForm = { password: '', password_confirmation: '' }
  const { register, handleSubmit, getValues, reset, formState: { errors } } = useForm({ defaultValues: initialValues })

  const { mutate, isPending } = useMutation({
    mutationFn: updatePasswordWithToken,
    onError: (error) => toast.error(error.message),
    onSuccess: (data) => {
      toast.success(data)
      reset()
      navigate('/auth/login')
    },
  })

  const handleNewPassword = (formData: NewPasswordForm) => mutate({ formData, token })

  return (
    <form onSubmit={handleSubmit(handleNewPassword)} className="space-y-5" noValidate>
      <FormField label="Nueva contraseña" hint="Mínimo 8 caracteres." error={errors.password?.message}>
        {(control) => (
          <input
            {...control}
            type="password"
            autoComplete="new-password"
            className={inputClass}
            {...register('password', {
              required: 'Ingrese la nueva contraseña',
              minLength: { value: 8, message: 'La contraseña debe tener al menos 8 caracteres' },
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
        Guardar contraseña
      </Button>
    </form>
  )
}
