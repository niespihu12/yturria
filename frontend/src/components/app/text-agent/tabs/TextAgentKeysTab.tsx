import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  deleteProviderConfig,
  saveProviderConfig,
} from '@/api/TextAgentsAPI'
import type { ProviderConfig, TextProvider } from '@/types/textAgent'
import { TEXT_PROVIDER_OPTIONS } from '@/types/textAgent'
import Button from '@/components/ui/Button'
import { useConfirm } from '@/components/ui/ConfirmDialog'

type Props = {
  providerConfigs: ProviderConfig[]
}

export default function TextAgentKeysTab({ providerConfigs }: Props) {
  const queryClient = useQueryClient()
  const baseId = useId()
  const [confirm, confirmDialog] = useConfirm()
  const [draftKeys, setDraftKeys] = useState<Record<TextProvider, string>>({
    openai: '',
    gemini: '',
  })

  const { mutate: saveKey, isPending: isSaving } = useMutation({
    mutationFn: ({ provider, apiKey }: { provider: TextProvider; apiKey: string }) =>
      saveProviderConfig(provider, apiKey),
    onSuccess: () => {
      toast.success('Clave guardada')
      queryClient.invalidateQueries({ queryKey: ['text-provider-configs'] })
      setDraftKeys({ openai: '', gemini: '' })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const { mutate: removeKey, isPending: isDeleting } = useMutation({
    mutationFn: (provider: TextProvider) => deleteProviderConfig(provider),
    onSuccess: () => {
      toast.success('Clave eliminada')
      queryClient.invalidateQueries({ queryKey: ['text-provider-configs'] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const configMap = new Map(providerConfigs.map((item) => [item.provider, item]))

  const handleRemove = async (provider: TextProvider, label: string) => {
    const accepted = await confirm({
      title: `¿Eliminar la clave de ${label}?`,
      description: `Los agentes que usan ${label} dejarán de responder hasta que registre una clave nueva.`,
      confirmLabel: 'Eliminar clave',
      tone: 'danger',
    })
    if (accepted) removeKey(provider)
  }

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm leading-relaxed text-text-secondary">
        Claves de acceso a los proveedores de inteligencia artificial. Se guardan cifradas y solo se
        muestran los últimos caracteres.
      </p>

      <div className="divide-y divide-border-subtle rounded-xl border border-border-default bg-surface">
        {TEXT_PROVIDER_OPTIONS.map((option) => {
          const provider = option.value
          const config = configMap.get(provider)
          const inputId = `${baseId}-${provider}`

          return (
            <div key={provider} className="space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <label htmlFor={inputId} className="text-sm font-semibold text-text-primary">
                    {option.label}
                  </label>
                  <p className="text-xs text-text-tertiary">
                    {config?.has_api_key
                      ? `Clave registrada: ${config.api_key_masked}`
                      : 'Sin clave registrada'}
                  </p>
                </div>

                {config?.has_api_key && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isDeleting}
                    onClick={() => void handleRemove(provider, option.label)}
                    className="text-danger-700 hover:bg-danger-50 hover:text-danger-700"
                  >
                    Eliminar clave
                  </Button>
                )}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id={inputId}
                  type="password"
                  autoComplete="off"
                  value={draftKeys[provider]}
                  onChange={(event) =>
                    setDraftKeys((prev) => ({ ...prev, [provider]: event.target.value }))
                  }
                  className="h-10 min-w-0 flex-1 rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary-600"
                  placeholder={config?.has_api_key ? 'Pegue una clave nueva para reemplazarla' : 'Pegue la clave aquí'}
                />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isSaving || !draftKeys[provider].trim()}
                  onClick={() =>
                    saveKey({
                      provider,
                      apiKey: draftKeys[provider].trim(),
                    })
                  }
                >
                  Guardar clave
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {confirmDialog}
    </div>
  )
}
