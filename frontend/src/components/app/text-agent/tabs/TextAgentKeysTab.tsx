import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  deleteProviderConfig,
  saveProviderConfig,
} from '@/api/TextAgentsAPI'
import type { ProviderConfig, TextProvider } from '@/types/textAgent'
import { TEXT_PROVIDER_OPTIONS } from '@/types/textAgent'

type Props = {
  providerConfigs: ProviderConfig[]
}

export default function TextAgentKeysTab({ providerConfigs }: Props) {
  const queryClient = useQueryClient()
  const [draftKeys, setDraftKeys] = useState<Record<TextProvider, string>>({
    openai: '',
    gemini: '',
  })

  const { mutate: saveKey, isPending: isSaving } = useMutation({
    mutationFn: ({ provider, apiKey }: { provider: TextProvider; apiKey: string }) =>
      saveProviderConfig(provider, apiKey),
    onSuccess: () => {
      toast.success('API key guardada')
      queryClient.invalidateQueries({ queryKey: ['text-provider-configs'] })
      setDraftKeys({ openai: '', gemini: '' })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const { mutate: removeKey, isPending: isDeleting } = useMutation({
    mutationFn: (provider: TextProvider) => deleteProviderConfig(provider),
    onSuccess: () => {
      toast.success('API key eliminada')
      queryClient.invalidateQueries({ queryKey: ['text-provider-configs'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const configMap = new Map(providerConfigs.map((item) => [item.provider, item]))

  return (
    <div className="max-w-4xl space-y-4">
      {TEXT_PROVIDER_OPTIONS.map((option) => {
        const provider = option.value
        const config = configMap.get(provider)

        return (
          <div
            key={provider}
            className="rounded-xl border border-[#e4e0f5] bg-white p-5"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-black">{option.label}</p>
                <p className="text-xs text-black/60">
                  {config?.has_api_key
                    ? `Configurada: ${config.api_key_masked}`
                    : 'Sin API key configurada'}
                </p>
              </div>

              {config?.has_api_key && (
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => removeKey(provider)}
                  className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-60"
                >
                  Eliminar key
                </button>
              )}
            </div>

            <div className="flex gap-3">
              <input
                type="password"
                value={draftKeys[provider]}
                onChange={(event) =>
                  setDraftKeys((prev) => ({ ...prev, [provider]: event.target.value }))
                }
                className="flex-1 rounded-lg border border-[#e4e0f5] bg-white px-3 py-2 text-sm text-black placeholder:text-black/50 focus:border-[#271173] focus:outline-none"
                placeholder={`Pega tu API key de ${option.label}`}
              />
              <button
                type="button"
                disabled={isSaving || !draftKeys[provider].trim()}
                onClick={() =>
                  saveKey({
                    provider,
                    apiKey: draftKeys[provider].trim(),
                  })
                }
                className="rounded-xl bg-[#271173] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-60"
              >
                Guardar
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
