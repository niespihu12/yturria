import NewPasswordToken from '@/components/auth/NewPasswordToken'
import NewPasswordForm from '@/components/auth/NewPasswordForm'
import { useState } from 'react'
import type { ConfirmToken } from '@/types/index'

export default function NewPasswordView() {
  const [token, setToken] = useState<ConfirmToken['token']>('')
  const [isValidToken, setIsValidToken] = useState(false)

  return (
    <div className="section-enter w-full max-w-sm">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold text-black">Reestablecer contraseña</h1>
        <p className="mt-1 text-sm text-black/60">
          {isValidToken ? 'Define tu nueva contraseña' : 'Ingresa el código que recibiste por email'}
        </p>
      </div>

      {!isValidToken
        ? <NewPasswordToken token={token} setToken={setToken} setIsValidToken={setIsValidToken} />
        : <NewPasswordForm token={token} />
      }
    </div>
  )
}
