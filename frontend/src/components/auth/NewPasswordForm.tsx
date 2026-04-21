import type { ConfirmToken, NewPasswordForm } from '../../types'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import ErrorMessage from '@/components/ErrorMessage'
import { useMutation } from '@tanstack/react-query'
import { updatePasswordWithToken } from '@/api/AuthAPI'
import { toast } from 'react-toastify'

type NewPasswordFormProps = {
  token: ConfirmToken['token']
}

const inputClass =
  'w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black placeholder:text-black/40 transition-colors focus:border-[#271173] focus:outline-none'

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
    <form
      onSubmit={handleSubmit(handleNewPassword)}
      className="rounded-2xl border border-[#e4e0f5] bg-white p-8 shadow-sm space-y-5"
      noValidate
    >
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-black/80">Contraseña</label>
        <input
          type="password"
          placeholder="Mínimo 8 caracteres"
          className={inputClass}
          {...register('password', {
            required: 'La contraseña es obligatoria',
            minLength: { value: 8, message: 'Mínimo 8 caracteres' },
          })}
        />
        {errors.password && <ErrorMessage>{errors.password.message}</ErrorMessage>}
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-black/80">Repetir contraseña</label>
        <input
          type="password"
          placeholder="Repite la contraseña"
          className={inputClass}
          {...register('password_confirmation', {
            required: 'Confirma la contraseña',
            validate: (value) => value === getValues('password') || 'Las contraseñas no coinciden',
          })}
        />
        {errors.password_confirmation && <ErrorMessage>{errors.password_confirmation.message}</ErrorMessage>}
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-xl bg-[#271173] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-60"
      >
        {isPending ? 'Guardando...' : 'Establecer contraseña'}
      </button>
    </form>
  )
}
