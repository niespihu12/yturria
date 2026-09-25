import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import type { ConfirmToken } from '@/types/index'
import { confirmAccount } from '@/api/AuthAPI'
import { AuthHeader, PinCodeField, authLinkClass } from '@/components/auth/AuthParts'

export default function ConfirmAccountView() {
  const [token, setToken] = useState<ConfirmToken['token']>('')

  const { mutate, isPending } = useMutation({
    mutationFn: confirmAccount,
    onError: (error) => toast.error(error.message),
    onSuccess: (data) => toast.success(data),
  })

  return (
    <>
      <AuthHeader
        title="Confirme su cuenta"
        description="Ingrese el código de 6 dígitos que enviamos a su correo."
      />

      <div className="mt-8">
        <PinCodeField
          legend="Código de confirmación"
          value={token}
          onChange={setToken}
          onComplete={(value) => mutate({ token: value })}
          disabled={isPending}
        />
      </div>

      <div className="mt-8 space-y-3 text-sm text-text-secondary">
        <p>
          ¿No le llegó el código?{' '}
          <Link to="/auth/request-code" className={authLinkClass}>
            Solicitar uno nuevo
          </Link>
        </p>
        <p>
          <Link to="/auth/login" className={authLinkClass}>
            Volver a iniciar sesión
          </Link>
        </p>
      </div>
    </>
  )
}
