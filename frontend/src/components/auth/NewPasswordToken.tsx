import { validateToken } from '@/api/AuthAPI'
import type { ConfirmToken } from '@/types/index'
import { PinInput, PinInputField } from '@chakra-ui/pin-input'
import { useMutation } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { toast } from 'react-toastify'

type NewPasswordTokenProps = {
  token: ConfirmToken['token']
  setToken: React.Dispatch<React.SetStateAction<string>>
  setIsValidToken: React.Dispatch<React.SetStateAction<boolean>>
}

export default function NewPasswordToken({ token, setToken, setIsValidToken }: NewPasswordTokenProps) {
  const { mutate } = useMutation({
    mutationFn: validateToken,
    onError: (error) => toast.error(error.message),
    onSuccess: (data) => { toast.success(data); setIsValidToken(true) },
  })

  return (
    <>
      <div className="rounded-2xl border border-[#e4e0f5] bg-white p-8 shadow-sm">
        <label className="block text-sm font-medium text-black/80 text-center mb-4">
          Código de 6 dígitos
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
          to="/auth/forgot-password"
          className="text-sm text-black/60 hover:text-[#271173] transition-colors"
        >
          Solicitar un nuevo código
        </Link>
      </nav>
    </>
  )
}
