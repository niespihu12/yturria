import { useMemo, useState } from 'react'
import type {
  UseFormRegister,
  UseFormSetValue,
  FieldErrors,
  UseFormWatch,
} from 'react-hook-form'
import type { AgentFormValues } from '@/types/agent'
import { SUPPORTED_LLMS, SUPPORTED_LANGUAGES } from '@/types/agent'
import { useQuery } from '@tanstack/react-query'
import { getVoicePreview, getVoices } from '@/api/VoiceRuntimeAPI'
import type { Voice } from '@/types/agent'
import {
  ChatBubbleLeftRightIcon,
  CpuChipIcon,
  LanguageIcon,
  SpeakerWaveIcon,
} from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'

type Props = {
  register: UseFormRegister<AgentFormValues>
  watch: UseFormWatch<AgentFormValues>
  setValue: UseFormSetValue<AgentFormValues>
  errors: FieldErrors<AgentFormValues>
  isClient?: boolean
}

const inputClass =
  'w-full bg-white border border-[#e4e0f5] text-black rounded-xl px-3 py-2.5 text-sm placeholder:text-black/40 focus:outline-none focus:border-[#271173] transition-colors resize-none'

const labelClass = 'block text-sm font-medium text-black/80 mb-1.5'

const selectClass =
  'w-full bg-white border border-[#e4e0f5] text-black rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-[#271173] transition-colors appearance-none'

const LLM_DESCRIPTIONS: Record<string, string> = {
  'gemini-2.5-flash': 'Rapido y eficiente para tareas generales.',
  'gemini-2.5-flash-lite': 'Version ligera para respuestas rapidas.',
  'gpt-5-mini': 'Balance entre precision y velocidad.',
  'gpt-4.1-mini': 'Respuesta consistente para soporte y operaciones.',
  'claude-sonnet-4': 'Razonamiento fuerte para conversaciones complejas.',
  'gpt-oss-120b': 'Modelo open-source hospedado por la plataforma.',
}

const TTS_MODEL_OPTIONS = [
  {
    value: 'eleven_turbo_v2_5',
    label: 'Turbo v2.5 · Ultra baja latencia · Recomendado',
  },
  {
    value: 'eleven_flash_v2_5',
    label: 'Flash v2.5 · ~75ms · Maxima velocidad',
  },
  {
    value: 'eleven_multilingual_v2',
    label: 'Multilingual v2 · Alta calidad · Multiidioma',
  },
  {
    value: 'eleven_v3',
    label: 'v3 · Mas expresivo · 70+ idiomas',
  },
]

const TTS_MODEL_DESCRIPTION: Record<string, string> = {
  eleven_turbo_v2_5: 'Turbo v2.5 · Ultra baja latencia · Recomendado',
  eleven_flash_v2_5: 'Flash v2.5 · ~75ms · Maxima velocidad',
  eleven_multilingual_v2: 'Multilingual v2 · Alta calidad · Multiidioma',
  eleven_v3: 'v3 · Mas expresivo · 70+ idiomas',
}

const ChevronDown = () => (
  <svg className="w-4 h-4 text-black/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
)

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  title: string
  description: string
}) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <div className="rounded-lg border border-[#e4e0f5] bg-[#f5f3ff] p-2">
        <Icon className="h-4 w-4 text-[#271173]" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-black">{title}</h3>
        <p className="mt-1 text-xs text-black/55">{description}</p>
      </div>
    </div>
  )
}

function TogglePill({
  enabled,
  onClick,
}: {
  enabled: boolean
  onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`relative h-5 w-10 cursor-pointer rounded-full transition-colors duration-200 ${
        enabled ? 'bg-[#271173]' : 'bg-black/20'
      }`}
    >
      <div
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
          enabled ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </div>
  )
}

export default function AgentTab({ register, watch, setValue, errors, isClient = false }: Props) {
  const voiceField = register('voice_id')
  const ttsModelField = register('tts_model_id')
  const languageField = register('language')
  const llmField = register('llm')

  const { data: voicesData, isLoading: loadingVoices } = useQuery({
    queryKey: ['voices'],
    queryFn: getVoices,
  })

  const voices: Voice[] = voicesData?.voices ?? []
  const [previewing, setPreviewing] = useState(false)

  const selectedVoiceId = watch('voice_id')
  const selectedTtsModel = watch('tts_model_id')
  const selectedLlm = watch('llm')
  const promptLength = watch('prompt')?.length ?? 0

  const stability = watch('stability') ?? 0.5
  const similarityBoost = watch('similarity_boost') ?? 0.75
  const style = watch('style') ?? 0
  const speed = watch('speed') ?? 1
  const llmTemperature = watch('llm_temperature') ?? 0.7

  const ignorePersonality = watch('ignore_default_personality') ?? false
  const autoLanguageDetection = watch('auto_language_detection') ?? true
  const callRecordingEnabled = watch('call_recording_enabled') ?? false

  const selectedVoice = useMemo(
    () => voices.find((voice) => voice.voice_id === selectedVoiceId),
    [voices, selectedVoiceId]
  )

  const llmDescription =
    LLM_DESCRIPTIONS[selectedLlm] ?? 'Modelo configurable para conversaciones del agente'

  const selectedTtsDescription =
    TTS_MODEL_DESCRIPTION[selectedTtsModel] ??
    'Modelo de voz configurable para el agente.'

  const handleVoicePreview = async () => {
    const voiceId = watch('voice_id')
    if (!voiceId) return

    setPreviewing(true)
    try {
      const data = await getVoicePreview(voiceId)
      const previewUrl = data.preview_url

      if (!previewUrl) {
        throw new Error('Esta voz no tiene preview disponible.')
      }

      const audio = new Audio(previewUrl)
      await audio.play()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo reproducir el preview')
    } finally {
      setPreviewing(false)
    }
  }

  return (
    <div className="w-full space-y-8">
      <section>
        <SectionHeader
          icon={CpuChipIcon}
          title="Comportamiento"
          description="Define personalidad, saludo inicial y comportamiento base del agente."
        />

        <div className="space-y-5">
          <div>
            <label className={labelClass}>
              Mensaje del sistema
              <span className="ml-1.5 text-xs text-black/45 font-normal">
                Define la personalidad y contexto del agente
              </span>
            </label>
            <textarea
              rows={10}
              placeholder="Eres un asistente de voz amigable y profesional. Tu objetivo es..."
              className={`${inputClass} ${
                isClient ? 'cursor-not-allowed bg-[#fafafa] text-black/65' : ''
              }`}
              readOnly={isClient}
              {...register('prompt')}
            />
            {isClient && (
              <p className="mt-1 text-xs text-black/45">
                Este campo está bloqueado por política para cliente final.
              </p>
            )}
            <p className="mt-1 text-right text-xs text-black/40">{promptLength} caracteres</p>
            {errors.prompt && (
              <p className="text-red-500 text-xs mt-1">{errors.prompt.message}</p>
            )}
          </div>

          <div>
            <label className={labelClass}>
              Primer mensaje
              <span className="ml-1.5 text-xs text-black/45 font-normal">
                Lo primero que dira el agente al iniciar la conversacion
              </span>
            </label>
            <textarea
              rows={3}
              placeholder="Hola, en que puedo ayudarte hoy?"
              className={`${inputClass} ${
                isClient ? 'cursor-not-allowed bg-[#fafafa] text-black/65' : ''
              }`}
              readOnly={isClient}
              {...register('first_message')}
            />
            {isClient && (
              <p className="mt-1 text-xs text-black/45">
                Este saludo está bloqueado por política para cliente final.
              </p>
            )}
          </div>

          {!isClient && (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-[#e4e0f5] bg-white p-4">
              <div>
                <p className="text-sm font-medium text-black">Ignorar personalidad por defecto</p>
                <p className="mt-1 text-xs text-black/50">
                  El agente no adoptara la personalidad amigable predeterminada de la plataforma
                </p>
              </div>
              <TogglePill
                enabled={Boolean(ignorePersonality)}
                onClick={() =>
                  setValue('ignore_default_personality', !ignorePersonality, {
                    shouldDirty: true,
                  })
                }
              />
            </div>
          )}
        </div>
      </section>

      <section className="border-t border-[#e4e0f5] pt-8">
        <SectionHeader
          icon={SpeakerWaveIcon}
          title="Voz"
          description="Configura la voz, su modelo TTS y los parametros finos de expresividad."
        />

        <div className="space-y-6">
          <div>
            <p className="mb-2 text-sm font-medium text-black">Seleccion de voz</p>
            <div className="flex items-start gap-3">
              <div className="relative flex-1">
                <select
                  className={selectClass}
                  disabled={loadingVoices}
                  name={voiceField.name}
                  ref={voiceField.ref}
                  onBlur={voiceField.onBlur}
                  value={selectedVoiceId ?? ''}
                  onChange={(e) => {
                    voiceField.onChange(e)
                    setValue('voice_id', e.target.value, { shouldDirty: true })
                  }}
                >
                  <option value="">
                    {loadingVoices ? 'Cargando voces...' : 'Seleccionar voz'}
                  </option>
                  {voices.map((v) => (
                    <option key={v.voice_id} value={v.voice_id}>
                      {v.name}
                      {v.category ? ` · ${v.category}` : ''}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                  <ChevronDown />
                </div>
              </div>
              <button
                type="button"
                disabled={!selectedVoiceId || previewing}
                onClick={handleVoicePreview}
                className="inline-flex h-10.5 min-w-35 items-center justify-center gap-2 rounded-xl border border-[#271173]/30 bg-white px-3 text-sm font-medium text-[#271173] transition-colors hover:bg-[#f5f3ff] disabled:cursor-not-allowed disabled:opacity-55"
              >
                {previewing ? (
                  <>
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#271173]/30 border-t-[#271173]" />
                    Reproduciendo...
                  </>
                ) : (
                  'Previsualizar'
                )}
              </button>
            </div>
            {selectedVoice && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[#e4e0f5] bg-[#f5f3ff] px-2.5 py-1 text-xs text-black/70">
                <SpeakerWaveIcon className="h-3 w-3 text-[#271173]" />
                <span>{selectedVoice.name}</span>
              </div>
            )}
          </div>

          {!isClient && (
            <div>
              <label className={labelClass}>Modelo TTS</label>
              <div className="relative">
                <select
                  className={selectClass}
                  name={ttsModelField.name}
                  ref={ttsModelField.ref}
                  onBlur={ttsModelField.onBlur}
                  value={selectedTtsModel ?? 'eleven_turbo_v2_5'}
                  onChange={(e) => {
                    ttsModelField.onChange(e)
                    setValue('tts_model_id', e.target.value, { shouldDirty: true })
                  }}
                >
                  {TTS_MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                  <ChevronDown />
                </div>
              </div>
              <div className="mt-2 inline-flex rounded-full bg-[#ede9ff] px-2 py-1 text-xs text-[#271173]">
                {selectedTtsDescription}
              </div>
            </div>
          )}

          {!isClient && (
          <div className="space-y-5 rounded-xl border border-[#e4e0f5] bg-white p-4">
            <p className="text-sm font-medium text-black">Parametros de voz</p>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-black">Estabilidad</p>
                  <p className="text-xs text-black/50">Mayor = mas uniforme, menos expresivo</p>
                </div>
                <span className="min-w-12 rounded-lg bg-[#ede9ff] px-2.5 py-1 text-center text-sm font-semibold text-[#271173]">
                  {stability.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                className="w-full h-1.5 rounded-full appearance-none bg-[#e4e0f5] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#271173] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
                {...register('stability', { valueAsNumber: true })}
              />
              <div className="mt-1 flex justify-between text-xs text-black/40">
                <span>Variable</span>
                <span>Estable</span>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-black">Claridad y similitud</p>
                  <p className="text-xs text-black/50">Que tanto adherirse a la voz original</p>
                </div>
                <span className="min-w-12 rounded-lg bg-[#ede9ff] px-2.5 py-1 text-center text-sm font-semibold text-[#271173]">
                  {similarityBoost.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                className="w-full h-1.5 rounded-full appearance-none bg-[#e4e0f5] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#271173] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
                {...register('similarity_boost', { valueAsNumber: true })}
              />
              <div className="mt-1 flex justify-between text-xs text-black/40">
                <span>Libre</span>
                <span>Fiel</span>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-black">Exageracion de estilo</p>
                  <p className="text-xs text-black/50">Amplifica el estilo del hablante</p>
                </div>
                <span className="min-w-12 rounded-lg bg-[#ede9ff] px-2.5 py-1 text-center text-sm font-semibold text-[#271173]">
                  {style.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                className="w-full h-1.5 rounded-full appearance-none bg-[#e4e0f5] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#271173] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
                {...register('style', { valueAsNumber: true })}
              />
              <div className="mt-1 flex justify-between text-xs text-black/40">
                <span>Neutro</span>
                <span>Exagerado</span>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-black">Velocidad de habla</p>
                  <p className="text-xs text-black/50">Velocidad del agente al hablar</p>
                </div>
                <span className="min-w-12 rounded-lg bg-[#ede9ff] px-2.5 py-1 text-center text-sm font-semibold text-[#271173]">
                  {speed.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0.7}
                max={1.2}
                step={0.05}
                className="w-full h-1.5 rounded-full appearance-none bg-[#e4e0f5] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#271173] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
                {...register('speed', { valueAsNumber: true })}
              />
              <div className="mt-1 flex justify-between text-xs text-black/40">
                <span>Lento</span>
                <span>Rapido</span>
              </div>
            </div>

          </div>
          )}
        </div>
      </section>

      <section className="border-t border-[#e4e0f5] pt-8">
        <SectionHeader
          icon={LanguageIcon}
          title="Idioma y LLM"
          description="Configura idioma principal, modelo de lenguaje y parametros de generacion."
        />

        <div className="space-y-5">
          <div className={isClient ? '' : 'grid grid-cols-1 gap-4 md:grid-cols-2'}>
            <div>
              <label className={labelClass}>Idioma</label>
              <div className="relative">
                <select
                  className={`${selectClass} ${autoLanguageDetection ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={Boolean(autoLanguageDetection)}
                  name={languageField.name}
                  ref={languageField.ref}
                  onBlur={languageField.onBlur}
                  value={watch('language') ?? 'es'}
                  onChange={(e) => {
                    languageField.onChange(e)
                    setValue('language', e.target.value, { shouldDirty: true })
                  }}
                >
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.value} value={lang.value}>
                      {lang.label}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                  <ChevronDown />
                </div>
              </div>
              {autoLanguageDetection && !isClient && (
                <p className="mt-1 text-xs text-black/45">
                  Desactiva la deteccion automatica para fijar un idioma.
                </p>
              )}
            </div>

            {!isClient && (
              <div>
                <label className={labelClass}>Modelo de lenguaje (LLM)</label>
                <div className="relative">
                  <select
                    className={selectClass}
                    name={llmField.name}
                    ref={llmField.ref}
                    onBlur={llmField.onBlur}
                    value={selectedLlm ?? 'gemini-2.5-flash'}
                    onChange={(e) => {
                      llmField.onChange(e)
                      setValue('llm', e.target.value, { shouldDirty: true })
                    }}
                  >
                    {SUPPORTED_LLMS.map((llm) => (
                      <option key={llm.value} value={llm.value}>
                        {llm.label}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                    <ChevronDown />
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-black/50">{llmDescription}</p>
              </div>
            )}
          </div>

          {!isClient && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-black">Temperatura</p>
                  <p className="text-xs text-black/50">Mayor = respuestas mas creativas y variadas</p>
                </div>
                <span className="min-w-12 rounded-lg bg-[#ede9ff] px-2.5 py-1 text-center text-sm font-semibold text-[#271173]">
                  {llmTemperature.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                className="w-full h-1.5 rounded-full appearance-none bg-[#e4e0f5] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#271173] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md"
                {...register('llm_temperature', { valueAsNumber: true })}
              />
              <div className="mt-1 flex justify-between text-xs text-black/40">
                <span>Preciso</span>
                <span>Creativo</span>
              </div>
            </div>
          )}

          {!isClient && (
            <div>
              <label className={labelClass}>Maximo de tokens</label>
              <p className="mb-2 text-xs text-black/50">Limite de tokens por respuesta del LLM</p>
              <input
                type="number"
                min={-1}
                max={8192}
                step={256}
                className={inputClass}
                {...register('max_tokens', { valueAsNumber: true })}
              />
            </div>
          )}
        </div>
      </section>

      {!isClient && (
      <section className="border-t border-[#e4e0f5] pt-8">
        <SectionHeader
          icon={ChatBubbleLeftRightIcon}
          title="Conversacion"
          description="Ajusta deteccion de idioma, tiempos de respuesta y grabacion de llamadas."
        />

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-[#e4e0f5] bg-white p-4">
            <div>
              <p className="text-sm font-medium text-black">Deteccion de idioma automatica</p>
              <p className="mt-1 text-xs text-black/50">
                El agente detecta el idioma del usuario automaticamente
              </p>
            </div>
            <TogglePill
              enabled={Boolean(autoLanguageDetection)}
              onClick={() =>
                setValue('auto_language_detection', !autoLanguageDetection, {
                  shouldDirty: true,
                })
              }
            />
          </div>

          <div>
            <label className={labelClass}>Silencio maximo (ms)</label>
            <p className="mb-2 text-xs text-black/50">
              Tiempo de silencio tras el cual el agente responde
            </p>
            <input
              type="number"
              min={200}
              max={3000}
              step={100}
              className={inputClass}
              {...register('silence_end_timeout_ms', { valueAsNumber: true })}
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border border-[#e4e0f5] bg-white p-4">
            <div>
              <p className="text-sm font-medium text-black">Grabacion de llamadas</p>
              <p className="mt-1 text-xs text-black/50">
                Guarda el audio de las conversaciones en la plataforma
              </p>
            </div>
            <TogglePill
              enabled={Boolean(callRecordingEnabled)}
              onClick={() =>
                setValue('call_recording_enabled', !callRecordingEnabled, {
                  shouldDirty: true,
                })
              }
            />
          </div>
        </div>
      </section>
      )}
    </div>
  )
}


