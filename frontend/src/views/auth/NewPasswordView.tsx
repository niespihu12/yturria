import { useState } from 'react'
import type { ConfirmToken } from '@/types/index'
import NewPasswordToken from '@/components/auth/NewPasswordToken'
import NewPasswordForm from '@/components/auth/NewPasswordForm'
import { AuthHeader } from '@/components/auth/AuthParts'

export default function NewPasswordView() {
  const [token, setToken] = useState<ConfirmToken['token']>('')
  const [isValidToken, setIsValidToken] = useState(false)

  return (
    <>
      <AuthHeader
        title="Restablecer contraseña"
        description={
          isValidToken
            ? 'Defina su nueva contraseña.'
            : 'Ingrese el código de 6 dígitos que enviamos a su correo.'
        }
      />
      <div className="mt-8">
        {isValidToken ? (
          <NewPasswordForm token={token} />
        ) : (
          <NewPasswordToken token={token} setToken={setToken} setIsValidToken={setIsValidToken} />
        )}
      </div>
    </>
  )
}
