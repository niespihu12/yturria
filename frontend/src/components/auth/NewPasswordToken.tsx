import type { Dispatch, SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { validateToken } from '@/api/AuthAPI'
import type { ConfirmToken } from '@/types/index'
import { PinCodeField, authLinkClass } from '@/components/auth/AuthParts'

type NewPasswordTokenProps = {
  token: ConfirmToken['token']
  setToken: Dispatch<SetStateAction<string>>
  setIsValidToken: Dispatch<SetStateAction<boolean>>
}

export default function NewPasswordToken({ token, setToken, setIsValidToken }: NewPasswordTokenProps) {
  const { mutate, isPending } = useMutation({
    mutationFn: validateToken,
    onError: (error) => toast.error(error.message),
    onSuccess: (data) => {
      toast.success(data)
      setIsValidToken(true)
    },
  })

  return (
    <>
      <PinCodeField
        legend="Código de verificación"
        value={token}
        onChange={setToken}
        onComplete={(value) => mutate({ token: value })}
        disabled={isPending}
      />

      <p className="mt-8 text-sm text-text-secondary">
        ¿No le llegó el código?{' '}
        <Link to="/auth/forgot-password" className={authLinkClass}>
          Solicitar uno nuevo
        </Link>
      </p>
    </>
  )
}
