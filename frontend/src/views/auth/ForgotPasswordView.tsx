import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import type { ForgotPasswordForm } from '../../types'
import ErrorMessage from '@/components/ErrorMessage'
import { useMutation } from '@tanstack/react-query'
import { forgotPasword } from '@/api/AuthAPI'
import { toast } from 'react-toastify'

export default function ForgotPasswordView() {
  const initialValues: ForgotPasswordForm = { email: '' }
  const { register, handleSubmit, reset, formState: { errors } } = useForm({ defaultValues: initialValues })

  const { mutate, isPending } = useMutation({
    mutationFn: forgotPasword,
    onError: (error) => toast.error(error.message),
    onSuccess: (data) => { toast.success(data); reset() },
  })

  return (
    <div className="section-enter w-full max-w-sm">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold text-black">Reestablecer contraseña</h1>
        <p className="mt-1 text-sm text-black/60">
          Ingresa tu email y te enviaremos las instrucciones
        </p>
      </div>

      <form
        onSubmit={handleSubmit((data) => mutate(data))}
        className="rounded-2xl border border-[#e4e0f5] bg-white p-8 shadow-sm space-y-5"
        noValidate
      >
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-black/80" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            placeholder="tu@email.com"
            className="w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black placeholder:text-black/40 transition-colors focus:border-[#271173] focus:outline-none"
            {...register('email', {
              required: 'El email es obligatorio',
              pattern: { value: /\S+@\S+\.\S+/, message: 'Email no válido' },
            })}
          />
          {errors.email && <ErrorMessage>{errors.email.message}</ErrorMessage>}
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-xl bg-[#271173] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-60"
        >
          {isPending ? 'Enviando...' : 'Enviar instrucciones'}
        </button>
      </form>

      <nav className="mt-5 flex flex-col gap-3 text-center">
        <Link to="/auth/login" className="text-sm text-black/60 hover:text-[#271173] transition-colors">
          ¿Ya tienes cuenta? Iniciar sesión
        </Link>
        <Link to="/auth/register" className="text-sm text-black/60 hover:text-[#271173] transition-colors">
          ¿No tienes cuenta? Crear una
        </Link>
      </nav>
    </div>
  )
}
