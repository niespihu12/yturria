import { authenticateUser, verifyMfaLogin } from "@/api/AuthAPI";
import ErrorMessage from "@/components/ErrorMessage";
import type { ConfirmToken, MfaChallenge, UserLoginForm } from "@/types/index";
import { PinInput, PinInputField } from '@chakra-ui/pin-input'
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

const inputClass =
  "w-full rounded-xl border border-[#e4e0f5] bg-white px-4 py-2.5 text-sm text-black placeholder:text-black/40 transition-colors focus:border-[#271173] focus:outline-none"

const labelClass = "block text-sm font-medium text-black/80 mb-1.5"

export default function LoginView() {
  const navigate = useNavigate()
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
      toast.error(error.message);
    },
    onSuccess: (data) => {
      if (typeof data === 'string') {
        toast.success('Inicio de sesion completado')
        reset()
        navigate('/agentes_voz', { replace: true })
        return
      }

      setMfaChallenge(data)
      setMfaCode('')
      toast.success(data.message)
    }
  })

  const { mutate: verifyMfaMutate } = useMutation({
    mutationFn: verifyMfaLogin,
    onError: (error) => {
      toast.error(error.message)
    },
    onSuccess: () => {
      toast.success('Inicio de sesion completado')
      setMfaChallenge(null)
      setMfaCode('')
      reset()
      navigate('/agentes_voz', { replace: true })
    }
  })

  const handleLogin = (formData: UserLoginForm) => {
    loginMutate(formData)
  }

  const handleMfaChange = (token: ConfirmToken['token']) => {
    setMfaCode(token)
  }

  const handleCompleteMfa = (token: ConfirmToken['token']) => {
    if (!mfaChallenge) return
    verifyMfaMutate({
      mfa_token: mfaChallenge.mfa_token,
      code: token
    })
  }

  return (
    <>
      <h1 className="text-3xl font-bold text-black text-center mt-8">
        {mfaChallenge ? 'Verifica tu Acceso' : 'Iniciar Sesion'}
      </h1>
      <p className="text-center text-sm text-black/50 mt-1.5">
        {mfaChallenge ? 'Ingresa el codigo enviado a tu correo' : 'Bienvenido de nuevo'}
      </p>

      {!mfaChallenge ? (
        <>
          <form
            onSubmit={handleSubmit(handleLogin)}
            className="mt-8 space-y-4 rounded-2xl border border-[#e4e0f5] bg-white p-8 shadow-sm"
            noValidate
          >
            <div>
              <label className={labelClass}>Email</label>
              <input
                id="email"
                type="email"
                placeholder="correo@empresa.com"
                className={inputClass}
                {...register("email", {
                  required: "El Email es obligatorio",
                  pattern: {
                    value: /\S+@\S+\.\S+/,
                    message: "E-mail no valido",
                  },
                })}
              />
              {errors.email && (
                <ErrorMessage>{errors.email.message}</ErrorMessage>
              )}
            </div>

            <div>
              <label className={labelClass}>Password</label>
              <input
                type="password"
                placeholder="••••••••"
                className={inputClass}
                {...register("password", {
                  required: "El Password es obligatorio",
                })}
              />
              {errors.password && (
                <ErrorMessage>{errors.password.message}</ErrorMessage>
              )}
            </div>

            <div className="pt-1">
              <input
                type="submit"
                value={isLoginPending ? 'Validando...' : 'Iniciar Sesion'}
                className="w-full cursor-pointer rounded-xl bg-[#271173] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-60"
                disabled={isLoginPending}
              />
            </div>
          </form>

          <nav className="mt-5 flex flex-col space-y-3">
            <Link
              to="/auth/register"
              className="text-center text-sm text-black/60 transition-colors hover:text-[#271173]"
            >
              No tienes cuenta? Crear una
            </Link>
            <Link
              to="/auth/forgot-password"
              className="text-center text-sm text-black/60 transition-colors hover:text-[#271173]"
            >
              Olvidaste tu contrasena? Reestablecer
            </Link>
          </nav>
        </>
      ) : (
        <>
          <form className="mt-8 rounded-2xl border border-[#e4e0f5] bg-white p-8 shadow-sm">
            <label className="block text-sm font-medium text-black/80 text-center mb-5">
              Codigo de 6 digitos
            </label>
            <div className="flex justify-center gap-3">
              <PinInput value={mfaCode} onChange={handleMfaChange} onComplete={handleCompleteMfa}>
                {[...Array(6)].map((_, i) => (
                  <PinInputField
                    key={i}
                    className="w-10! h-10! rounded-xl border border-[#e4e0f5] text-center text-sm font-semibold text-black focus:border-[#271173] focus:outline-none"
                  />
                ))}
              </PinInput>
            </div>
          </form>

          <button
            type="button"
            onClick={() => {
              setMfaChallenge(null)
              setMfaCode('')
            }}
            className="mt-5 w-full text-center text-sm text-black/60 transition-colors hover:text-[#271173]"
          >
            ← Volver al login
          </button>
        </>
      )}
    </>
  )
}
