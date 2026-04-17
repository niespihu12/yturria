import { useRef, useState } from 'react'
import { getSignedUrl } from '@/api/VoiceRuntimeAPI'
import {
  PhoneIcon,
  PhoneXMarkIcon,
  SpeakerWaveIcon,
  MicrophoneIcon,
} from '@heroicons/react/24/solid'
import {
  ExclamationTriangleIcon,
  CloudArrowUpIcon,
} from '@heroicons/react/24/outline'

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

export default function AgentPreview({ agentId, agentName, isDirty, onSave }: Props) {
  const [status, setStatus] = useState<ConvStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [isSpeaking, setIsSpeaking] = useState(false)
  const convRef = useRef<VoiceConversationSession | null>(null)

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
        const msg = err instanceof Error ? err.message : 'Error al obtener la URL firmada'
        setErrorMsg(msg)
        setStatus('error')
        convRef.current = null
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
        onError: (msg: string) => {
          setErrorMsg(msg ?? 'Error de conexion')
          setStatus('error')
          convRef.current = null
        },
        onModeChange: ({ mode }: { mode: string }) => {
          setIsSpeaking(mode === 'speaking')
        },
      })

      convRef.current = conv
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al iniciar llamada'
      setErrorMsg(msg)
      setStatus('error')
      convRef.current = null
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

  return (
    <div className="flex h-full min-h-0 w-72 shrink-0 flex-col overflow-hidden border-l border-[#e4e0f5] bg-white">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#e4e0f5]">
        <p className="text-xs font-semibold uppercase tracking-wider text-black/50">
          Vista previa
        </p>
        <p className="text-sm text-black/85 mt-0.5 truncate font-medium">{agentName}</p>
      </div>

      {/* Unsaved changes banner */}
      {isDirty && !isActive && (
        <div className="mx-3 mt-3 flex shrink-0 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
          <ExclamationTriangleIcon className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <p className="text-xs text-amber-700 leading-tight">
            Cambios sin guardar - se guardaran antes de llamar.
          </p>
        </div>
      )}

      {/* Orb */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-5">
        <div className="relative flex items-center justify-center">
          {isActive && (
            <>
              <div
                className="absolute rounded-full bg-[#271173]/8 animate-ping"
                style={{ width: 134, height: 134 }}
              />
              <div
                className="absolute rounded-full bg-[#271173]/10 animate-pulse"
                style={{ width: 110, height: 110 }}
              />
            </>
          )}
          <div
            className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-500 ${
              isActive
                ? 'bg-[#271173] shadow-lg shadow-[#271173]/25'
                : isBusy
                ? 'bg-[#271173]/60 animate-pulse'
                : 'bg-[#ede9ff]'
            }`}
          >
            {isActive ? (
              <SpeakerWaveIcon
                className={`w-10 h-10 text-white transition-all duration-300 ${
                  isSpeaking ? 'scale-110' : 'scale-90 opacity-70'
                }`}
              />
            ) : status === 'saving' ? (
              <CloudArrowUpIcon className="w-10 h-10 text-[#271173] animate-pulse" />
            ) : (
              <PhoneIcon
                className={`w-10 h-10 transition-colors ${
                  isBusy ? 'text-[#271173]' : 'text-[#271173]/60'
                }`}
              />
            )}
          </div>
        </div>

        {/* Status label */}
        <div className="text-center space-y-1">
          {status === 'idle' && (
            <>
              <p className="text-black/80 text-sm font-medium">Listo para llamar</p>
              <p className="text-black/45 text-xs">
                {isDirty ? 'Se guardara antes de llamar' : 'Prueba el agente en tiempo real'}
              </p>
            </>
          )}
          {status === 'saving' && (
            <>
              <p className="text-[#271173] text-sm font-medium">Guardando cambios...</p>
              <p className="text-black/45 text-xs">Aplicando configuracion</p>
            </>
          )}
          {status === 'connecting' && (
            <>
              <p className="text-[#271173] text-sm font-medium">Conectando...</p>
              <p className="text-black/45 text-xs">Iniciando sesion de voz</p>
            </>
          )}
          {status === 'active' && (
            <>
              <p className="text-emerald-600 text-sm font-medium flex items-center gap-1.5 justify-center">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse inline-block" />
                En llamada
              </p>
              <p className="text-black/50 text-xs">
                {isSpeaking ? 'Agente hablando...' : 'Escuchando...'}
              </p>
            </>
          )}
          {status === 'error' && (
            <>
              <p className="text-red-500 text-sm font-medium flex items-center gap-1.5 justify-center">
                <ExclamationTriangleIcon className="w-4 h-4" />
                Error
              </p>
              <p className="text-black/50 text-xs max-w-45 text-center leading-relaxed">
                {errorMsg}
              </p>
            </>
          )}
        </div>

        {/* Mic waveform */}
        {isActive && (
          <div className="flex items-center gap-2 bg-[#f5f3ff] border border-[#e4e0f5] rounded-xl px-3 py-2">
            <MicrophoneIcon className="w-3.5 h-3.5 text-[#271173]" />
            <div className="flex items-end gap-0.5 h-4">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="w-1 bg-[#271173] rounded-full animate-pulse"
                  style={{
                    height: `${40 + i * 12}%`,
                    animationDelay: `${i * 120}ms`,
                    minHeight: '3px',
                  }}
                />
              ))}
            </div>
            <span className="text-xs text-black/50">Microfono activo</span>
          </div>
        )}
      </div>

      {/* Buttons */}
      <div className="px-5 py-5 border-t border-[#e4e0f5] space-y-2">
        {!isActive ? (
          <button
            onClick={handleCall}
            disabled={isBusy}
            className="w-full flex items-center justify-center gap-2.5 bg-[#271173] hover:bg-[#1f0d5a] text-white py-3 rounded-xl text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isBusy ? (
              <>
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                {status === 'saving' ? 'Guardando...' : 'Conectando...'}
              </>
            ) : (
              <>
                {isDirty ? (
                  <CloudArrowUpIcon className="w-4 h-4" />
                ) : (
                  <PhoneIcon className="w-4 h-4" />
                )}
                {status === 'error'
                  ? 'Reintentar'
                  : isDirty
                  ? 'Guardar y llamar'
                  : 'Llamar al agente'}
              </>
            )}
          </button>
        ) : (
          <button
            onClick={handleHangup}
            className="w-full flex items-center justify-center gap-2.5 bg-red-500 hover:bg-red-600 text-white py-3 rounded-xl text-sm font-medium transition-colors"
          >
            <PhoneXMarkIcon className="w-4 h-4" />
            Colgar
          </button>
        )}
        <p className="text-center text-xs text-black/40">Requiere microfono habilitado</p>
      </div>
    </div>
  )
}

