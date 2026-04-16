import { Link } from 'react-router-dom'
import { PinInput, PinInputField } from '@chakra-ui/pin-input'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import type { ConfirmToken } from '@/types/index'
import { confirmAccount } from '@/api/AuthAPI'
import { toast } from 'react-toastify'

export default function ConfirmAccountView() {
  const [token, setToken] = useState<ConfirmToken['token']>('')

  const { mutate } = useMutation({
    mutationFn: confirmAccount,
    onError: (error) => toast.error(error.message),
    onSuccess: (data) => toast.success(data),
  })

  return (
    <div className="section-enter w-full max-w-sm">
      <div className="mb-6 text-center">
        <h1 className="text-xl font-semibold text-black">Confirma tu cuenta</h1>
        <p className="mt-1 text-sm text-black/60">
          Ingresa el código de 6 dígitos que recibiste por email
        </p>
      </div>

      <div className="rounded-2xl border border-[#e4e0f5] bg-white p-8 shadow-sm">
        <label className="block text-sm font-medium text-black/80 text-center mb-4">
          Código de verificación
        </label>
        <div className="flex justify-center gap-3">
          <PinInput value={token} onChange={setToken} onComplete={(token) => mutate({ token })}>
            <PinInputField className="w-10! h-10! p-3 rounded-xl border-[#e4e0f5] border text-center focus:border-[#271173] focus:outline-none" />
            <PinInputField className="w-10! h-10! p-3 rounded-xl border-[#e4e0f5] border text-center focus:border-[#271173] focus:outline-none" />
            <PinInputField className="w-10! h-10! p-3 rounded-xl border-[#e4e0f5] border text-center focus:border-[#271173] focus:outline-none" />
            <PinInputField className="w-10! h-10! p-3 rounded-xl border-[#e4e0f5] border text-center focus:border-[#271173] focus:outline-none" />
            <PinInputField className="w-10! h-10! p-3 rounded-xl border-[#e4e0f5] border text-center focus:border-[#271173] focus:outline-none" />
            <PinInputField className="w-10! h-10! p-3 rounded-xl border-[#e4e0f5] border text-center focus:border-[#271173] focus:outline-none" />
          </PinInput>
        </div>
      </div>

      <nav className="mt-5 text-center">
        <Link
          to="/auth/request-code"
          className="text-sm text-black/60 hover:text-[#271173] transition-colors"
        >
          Solicitar un nuevo código
        </Link>
      </nav>
    </div>
  )
}
