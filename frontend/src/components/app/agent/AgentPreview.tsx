import { useId, useRef, useState } from 'react'
import { getSignedUrl } from '@/api/VoiceRuntimeAPI'
import {
  CloudArrowUpIcon,
  PhoneIcon,
  PhoneXMarkIcon,
  SpeakerWaveIcon,
} from '@heroicons/react/24/outline'
import Button from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { describeError } from './agentUi'

type Props = {
  agentId: string
  agentName: string
  isDirty: boolean
  onSave: () => Promise<void>
}

type ConvStatus = 'idle' | 'saving' | 'connecting' | 'active' | 'error'

type VoiceConversationSession = {
  endSession: () => Promise<void> | void
}

type VoiceSdkModule = {
  VoiceConversation: {
    startSession: (options: Record<string, unknown>) => Promise<VoiceConversationSession>
  }
}

async function loadVoiceSdk(): Promise<VoiceSdkModule> {
  return (await import('@elevenlabs/client')) as unknown as VoiceSdkModule
}

const CONNECTION_LOST = 'Se interrumpió la conexión con el agente. Intente de nuevo en unos segundos.'

function describeCallError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return 'Permita el uso del micrófono en su navegador e intente de nuevo.'
    }
    if (error.name === 'NotFoundError') {
      return 'No encontramos un micrófono conectado a este equipo.'
    }
  }
  return describeError(error, 'No pudimos iniciar la llamada de prueba. Intente de nuevo.')
}

export default function AgentPreview({ agentId, agentName, isDirty, onSave }: Props) {
  const [status, setStatus] = useState<ConvStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [isSpeaking, setIsSpeaking] = useState(false)
  const convRef = useRef<VoiceConversationSession | null>(null)
  const headingId = useId()

  const failWith = (message: string) => {
    setErrorMsg(message)
    setStatus('error')
    convRef.current = null
  }

  const handleCall = async () => {
    try {
      setErrorMsg('')

      if (isDirty) {
        setStatus('saving')
        await onSave()
      }

      setStatus('connecting')
      await navigator.mediaDevices.getUserMedia({ audio: true })

      let signedUrl: string
      try {
        signedUrl = await getSignedUrl(agentId)
      } catch (err) {
        failWith(describeError(err, 'No pudimos preparar la llamada de prueba. Intente de nuevo.'))
        return
      }

      const sdk = await loadVoiceSdk()
      const conv = await sdk.VoiceConversation.startSession({
        signedUrl,
        connectionType: 'websocket',
        onConnect: () => setStatus('active'),
        onDisconnect: () => {
          setStatus('idle')
          setIsSpeaking(false)
          convRef.current = null
        },
        onError: () => failWith(CONNECTION_LOST),
        onModeChange: ({ mode }: { mode: string }) => {
          setIsSpeaking(mode === 'speaking')
        },
      })

      convRef.current = conv
    } catch (err) {
      failWith(describeCallError(err))
    }
  }

  const handleHangup = async () => {
    if (convRef.current) {
      await convRef.current.endSession()
      convRef.current = null
    }
    setStatus('idle')
    setIsSpeaking(false)
  }

  const isActive = status === 'active'
  const isBusy = status === 'connecting' || status === 'saving'

  const callLabel =
    status === 'saving'
      ? 'Guardando…'
      : status === 'connecting'
        ? 'Conectando…'
        : status === 'error'
          ? 'Intentar de nuevo'
          : isDirty
            ? 'Guardar y llamar'
            : 'Llamar al agente'

  return (
    <aside
      aria-labelledby={headingId}
      className="flex w-full shrink-0 flex-col border-t border-border-default bg-surface lg:h-full lg:min-h-0 lg:w-72 lg:border-l lg:border-t-0 xl:w-80"
    >
      <div className="border-b border-border-subtle px-5 py-4">
        <h2 id={headingId} className="text-sm font-semibold text-text-primary">
          Prueba de llamada
        </h2>
        <p className="mt-0.5 truncate text-sm text-text-secondary">{agentName}</p>
      </div>

      {isDirty && !isActive && (
        <p className="mx-5 mt-4 rounded-lg bg-warning-50 px-3 py-2 text-xs leading-relaxed text-warning-700">
          Hay cambios sin guardar. Se guardarán antes de iniciar la llamada.
        </p>
      )}

      <div className="flex flex-col items-center justify-center gap-4 px-5 py-8 lg:min-h-0 lg:flex-1">
        <div
          aria-hidden="true"
          className={cn(
            'flex h-20 w-20 items-center justify-center rounded-full transition-colors duration-300',
            isActive
              ? 'bg-primary-600 text-text-inverse'
              : isBusy
                ? 'bg-primary-100 text-primary-700'
                : 'bg-primary-50 text-primary-600',
          )}
        >
          {isActive ? (
            <SpeakerWaveIcon
              className={cn(
                'h-9 w-9 transition-transform duration-300 motion-reduce:transition-none',
                isSpeaking ? 'scale-110' : 'scale-95 opacity-80',
              )}
            />
          ) : status === 'saving' ? (
            <CloudArrowUpIcon className="h-9 w-9" />
          ) : (
            <PhoneIcon className="h-9 w-9" />
          )}
        </div>

        <div role="status" aria-live="polite" className="max-w-60 space-y-1 text-center">
          {status === 'idle' && (
            <>
              <p className="text-sm font-medium text-text-primary">Listo para probar</p>
              <p className="text-xs leading-relaxed text-text-tertiary">
                {isDirty
                  ? 'Guardaremos sus cambios antes de llamar.'
                  : 'Hable con el agente como lo haría uno de sus clientes.'}
              </p>
            </>
          )}
          {status === 'saving' && (
            <>
              <p className="text-sm font-medium text-primary-700">Guardando cambios…</p>
              <p className="text-xs text-text-tertiary">Un momento, por favor.</p>
            </>
          )}
          {status === 'connecting' && (
            <>
              <p className="text-sm font-medium text-primary-700">Conectando…</p>
              <p className="text-xs text-text-tertiary">Preparando la llamada de prueba.</p>
            </>
          )}
          {status === 'active' && (
            <>
              <p className="flex items-center justify-center gap-1.5 text-sm font-medium text-success-700">
                <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-success-500" />
                En llamada
              </p>
              <p className="text-xs text-text-tertiary">
                {isSpeaking ? 'El agente está hablando.' : 'El agente le escucha.'}
              </p>
            </>
          )}
          {status === 'error' && (
            <>
              <p className="text-sm font-medium text-danger-700">No se pudo iniciar la llamada</p>
              <p className="text-xs leading-relaxed text-text-secondary">{errorMsg}</p>
            </>
          )}
        </div>
      </div>

      <div className="space-y-2 border-t border-border-subtle px-5 py-4">
        {!isActive ? (
          <Button
            type="button"
            className="w-full"
            onClick={handleCall}
            isLoading={isBusy}
            leftIcon={
              isDirty ? (
                <CloudArrowUpIcon className="h-4 w-4" aria-hidden="true" />
              ) : (
                <PhoneIcon className="h-4 w-4" aria-hidden="true" />
              )
            }
          >
            {callLabel}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleHangup}
            leftIcon={<PhoneXMarkIcon className="h-4 w-4" aria-hidden="true" />}
          >
            Terminar llamada
          </Button>
        )}
        <p className="text-center text-xs text-text-tertiary">
          Su navegador le pedirá permiso para usar el micrófono.
        </p>
      </div>
    </aside>
  )
}
