import { useEffect, useId, useMemo, useState } from 'react'
import type {
  UseFormRegister,
  UseFormSetValue,
  FieldErrors,
  UseFormWatch,
} from 'react-hook-form'
import type { AgentFormValues } from '@/types/agent'
import { SUPPORTED_LLMS, SUPPORTED_LANGUAGES } from '@/types/agent'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getVoiceAgentRuntimeConfig,
  getVoicePreview,
  getVoices,
  upsertVoiceAgentRuntimeConfig,
} from '@/api/VoiceRuntimeAPI'
import type { Voice } from '@/types/agent'
import { PlayIcon } from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'
import AdvancedSection from '@/components/ui/AdvancedSection'
import Button from '@/components/ui/Button'
import { Field, SectionHeading, SliderField, SwitchField } from '../fields'
import {
  describeError,
  errorClass,
  inputClass,
  readOnlyInputClass,
  subsectionTitleClass,
  textareaClass,
} from '../agentUi'

type Props = {
  agentId: string
  register: UseFormRegister<AgentFormValues>
  watch: UseFormWatch<AgentFormValues>
  setValue: UseFormSetValue<AgentFormValues>
  errors: FieldErrors<AgentFormValues>
  isClient?: boolean
}

const LLM_DESCRIPTIONS: Record<string, string> = {
  'gemini-2.5-flash': 'Rápido y eficiente para tareas generales.',
  'gemini-2.5-flash-lite': 'Versión ligera para respuestas rápidas.',
  'gpt-5-mini': 'Equilibrio entre precisión y velocidad.',
  'gpt-4.1-mini': 'Respuestas consistentes para soporte y operaciones.',
  'claude-sonnet-4': 'Razonamiento sólido para conversaciones complejas.',
  'gpt-oss-120b': 'Modelo abierto alojado por la plataforma.',
}

const TTS_MODEL_OPTIONS = [
  { value: 'eleven_turbo_v2_5', label: 'Turbo v2.5 · Latencia muy baja · Recomendado' },
  { value: 'eleven_flash_v2_5', label: 'Flash v2.5 · ~75 ms · Máxima velocidad' },
  { value: 'eleven_multilingual_v2', label: 'Multilingual v2 · Alta calidad · Varios idiomas' },
  { value: 'eleven_v3', label: 'v3 · Más expresivo · Más de 70 idiomas' },
]

export default function AgentTab({
  agentId,
  register,
  watch,
  setValue,
  errors,
  isClient = false,
}: Props) {
  const queryClient = useQueryClient()
  const voiceField = register('voice_id')
  const ttsModelField = register('tts_model_id')
  const languageField = register('language')
  const llmField = register('llm')
  const promptId = useId()
  const whatsappId = useId()

  const { data: voicesData, isLoading: loadingVoices, isError: voicesError } = useQuery({
    queryKey: ['voices'],
    queryFn: getVoices,
  })

  const { data: runtimeConfigData } = useQuery({
    queryKey: ['voice-runtime-config', agentId],
    queryFn: () => getVoiceAgentRuntimeConfig(agentId),
    enabled: Boolean(agentId),
  })

  const [runtimeForm, setRuntimeForm] = useState({
    whatsapp_enabled: false,
    default_escalation_channel: 'phone' as 'phone' | 'whatsapp',
    escalation_phone_number: '',
  })

  useEffect(() => {
    const config = runtimeConfigData?.config
    if (!config) return

    setRuntimeForm({
      whatsapp_enabled: Boolean(config.whatsapp_enabled),
      default_escalation_channel:
        config.default_escalation_channel === 'whatsapp' ? 'whatsapp' : 'phone',
      escalation_phone_number: config.escalation_phone_number || '',
    })
  }, [runtimeConfigData?.config])

  const hasRuntimeChanges = useMemo(() => {
    const config = runtimeConfigData?.config
    if (!config) return false

    return (
      runtimeForm.whatsapp_enabled !== Boolean(config.whatsapp_enabled) ||
      runtimeForm.default_escalation_channel !==
        (config.default_escalation_channel === 'whatsapp' ? 'whatsapp' : 'phone') ||
      runtimeForm.escalation_phone_number !== (config.escalation_phone_number || '')
    )
  }, [runtimeConfigData?.config, runtimeForm])

  const { mutate: saveRuntimeConfig, isPending: isSavingRuntimeConfig } = useMutation({
    mutationFn: () => upsertVoiceAgentRuntimeConfig(agentId, runtimeForm),
    onSuccess: () => {
      toast.success('Transferencia a una persona actualizada')
      queryClient.invalidateQueries({ queryKey: ['voice-runtime-config', agentId] })
    },
    onError: (error: Error) =>
      toast.error(describeError(error, 'No pudimos guardar la transferencia. Intente de nuevo.')),
  })

  const voices = useMemo<Voice[]>(() => voicesData?.voices ?? [], [voicesData])
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

  const llmDescription =
    LLM_DESCRIPTIONS[selectedLlm] ?? 'Modelo de IA que redacta las respuestas del agente.'

  const handleVoicePreview = async () => {
    const voiceId = watch('voice_id')
    if (!voiceId) return

    setPreviewing(true)
    try {
      const data = await getVoicePreview(voiceId)
      const previewUrl = data.preview_url

      if (!previewUrl) {
        throw new Error('Esta voz no tiene una muestra disponible.')
      }

      const audio = new Audio(previewUrl)
      await audio.play()
    } catch (error) {
      toast.error(describeError(error, 'No pudimos reproducir la muestra de voz.'))
    } finally {
      setPreviewing(false)
    }
  }

  const promptField = (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={promptId} className={isClient ? 'sr-only' : 'block text-sm font-medium text-text-primary'}>
          Instrucciones del agente
        </label>
        <span className="ml-auto text-xs text-text-tertiary tabular-nums">{promptLength} caracteres</span>
      </div>
      {!isClient && (
        <p id={`${promptId}-help`} className="mt-0.5 text-xs leading-relaxed text-text-tertiary">
          Describa cómo debe hablar el agente, qué puede resolver y cuándo debe pasar la llamada a
          una persona del equipo.
        </p>
      )}
      <textarea
        id={promptId}
        rows={isClient ? 8 : 12}
        placeholder="Usted es el asistente de voz de… Su objetivo es…"
        aria-describedby={!isClient ? `${promptId}-help` : undefined}
        className={`mt-2 ${textareaClass} ${isClient ? readOnlyInputClass : ''}`}
        readOnly={isClient}
        {...register('prompt')}
      />
      {errors.prompt && <p className={errorClass}>{errors.prompt.message}</p>}
    </div>
  )

  return (
    <div className="w-full space-y-10">
      <section aria-labelledby={`${promptId}-behavior`} className="space-y-6">
        <SectionHeading
          id={`${promptId}-behavior`}
          title="Comportamiento"
          description="Lo que el agente dice al contestar y la forma en que atiende cada llamada."
        />

        {isClient ? (
          <AdvancedSection
            title="Instrucciones del agente"
            description="Guía que sigue el agente en cada llamada. Solo un administrador puede modificarla."
          >
            {promptField}
          </AdvancedSection>
        ) : (
          promptField
        )}

        <Field
          label="Saludo inicial"
          help={
            isClient
              ? 'Lo primero que escucha quien llama. Solo un administrador puede modificarlo.'
              : 'Lo primero que escucha quien llama.'
          }
        >
          {(control) => (
            <textarea
              {...control}
              rows={3}
              placeholder="Hola, gracias por llamar. ¿En qué puedo ayudarle?"
              className={`${textareaClass} ${isClient ? readOnlyInputClass : ''}`}
              readOnly={isClient}
              {...register('first_message')}
            />
          )}
        </Field>
      </section>

      <section aria-labelledby={`${promptId}-handoff`} className="space-y-6 border-t border-border-default pt-8">
        <SectionHeading
          id={`${promptId}-handoff`}
          title="Transferencia a una persona"
          description="Cuando quien llama pide hablar con alguien del equipo, el agente lo transfiere por el canal que usted elija."
        />

        <div className="flex items-start gap-3">
          <input
            id={whatsappId}
            type="checkbox"
            checked={runtimeForm.whatsapp_enabled}
            onChange={(event) =>
              setRuntimeForm((prev) => ({
                ...prev,
                whatsapp_enabled: event.target.checked,
              }))
            }
            className="mt-0.5 h-4 w-4 shrink-0 accent-primary-600"
          />
          <label htmlFor={whatsappId} className="text-sm text-text-primary">
            Permitir la transferencia por WhatsApp
          </label>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Canal principal">
            {(control) => (
              <select
                {...control}
                className={inputClass}
                value={runtimeForm.default_escalation_channel}
                onChange={(event) =>
                  setRuntimeForm((prev) => ({
                    ...prev,
                    default_escalation_channel:
                      event.target.value === 'whatsapp' ? 'whatsapp' : 'phone',
                  }))
                }
              >
                <option value="phone">Llamada telefónica</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            )}
          </Field>

          <Field label="Número para transferir llamadas" help="Incluya el indicativo del país, por ejemplo +57.">
            {(control) => (
              <input
                {...control}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                className={`${inputClass} tabular-nums`}
                placeholder="+573001234567"
                value={runtimeForm.escalation_phone_number}
                onChange={(event) =>
                  setRuntimeForm((prev) => ({
                    ...prev,
                    escalation_phone_number: event.target.value,
                  }))
                }
              />
            )}
          </Field>
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={() => saveRuntimeConfig()}
            isLoading={isSavingRuntimeConfig}
            disabled={!hasRuntimeChanges}
          >
            {isSavingRuntimeConfig ? 'Guardando…' : 'Guardar transferencia'}
          </Button>
        </div>
      </section>

      <section aria-labelledby={`${promptId}-voice`} className="space-y-6 border-t border-border-default pt-8">
        <SectionHeading
          id={`${promptId}-voice`}
          title="Voz e idioma"
          description="Cómo suena el agente y en qué idioma atiende."
        />

        <Field
          label="Voz"
          help={
            voicesError
              ? 'No pudimos cargar el catálogo de voces. El servicio de voz no está disponible en este momento.'
              : undefined
          }
        >
          {(control) => (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <select
                {...control}
                className={`${inputClass} sm:flex-1`}
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
                <option value="">{loadingVoices ? 'Cargando voces…' : 'Elija una voz'}</option>
                {voices.map((v) => (
                  <option key={v.voice_id} value={v.voice_id}>
                    {v.name}
                    {v.category ? ` · ${v.category}` : ''}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                className="sm:min-w-40"
                disabled={!selectedVoiceId}
                isLoading={previewing}
                onClick={handleVoicePreview}
                leftIcon={<PlayIcon className="h-4 w-4" aria-hidden="true" />}
              >
                {previewing ? 'Reproduciendo…' : 'Escuchar muestra'}
              </Button>
            </div>
          )}
        </Field>

        <Field
          label="Idioma"
          help={
            autoLanguageDetection
              ? isClient
                ? 'El agente detecta automáticamente el idioma de quien llama.'
                : 'El agente detecta el idioma automáticamente. Desactive la detección en la configuración avanzada para fijar uno.'
              : undefined
          }
        >
          {(control) => (
            <select
              {...control}
              className={`${inputClass} md:max-w-sm`}
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
          )}
        </Field>
      </section>

      {!isClient && (
        <AdvancedSection
          defaultOpen
          description="Modelo de IA, motor de voz y tiempos de la conversación."
        >
          <div className="space-y-5">
            <h3 className={subsectionTitleClass}>Modelo de IA</h3>
            <Field label="Modelo" help={llmDescription}>
              {(control) => (
                <select
                  {...control}
                  className={`${inputClass} md:max-w-sm`}
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
              )}
            </Field>

            <SliderField
              label="Creatividad de las respuestas"
              description="Valores altos dan respuestas más variadas; valores bajos, más precisas."
              displayValue={llmTemperature.toFixed(2)}
              minLabel="Precisa"
              maxLabel="Creativa"
              min={0}
              max={1}
              step={0.05}
              {...register('llm_temperature', { valueAsNumber: true })}
            />

            <Field
              label="Longitud máxima de respuesta"
              help="Límite de extensión de cada respuesta, medido en tokens del modelo. Use -1 para no limitarla."
            >
              {(control) => (
                <input
                  {...control}
                  type="number"
                  min={-1}
                  max={8192}
                  step={256}
                  className={`${inputClass} tabular-nums md:max-w-xs`}
                  {...register('max_tokens', { valueAsNumber: true })}
                />
              )}
            </Field>
          </div>

          <div className="space-y-5 border-t border-border-default pt-5">
            <h3 className={subsectionTitleClass}>Motor de voz</h3>
            <Field label="Modelo de voz">
              {(control) => (
                <select
                  {...control}
                  className={`${inputClass} md:max-w-md`}
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
              )}
            </Field>

            <div className="grid gap-6 md:grid-cols-2">
              <SliderField
                label="Estabilidad"
                description="Más alta: voz más uniforme y menos expresiva."
                displayValue={stability.toFixed(2)}
                minLabel="Variable"
                maxLabel="Estable"
                min={0}
                max={1}
                step={0.01}
                {...register('stability', { valueAsNumber: true })}
              />
              <SliderField
                label="Fidelidad a la voz original"
                description="Qué tanto se parece a la voz de referencia."
                displayValue={similarityBoost.toFixed(2)}
                minLabel="Libre"
                maxLabel="Fiel"
                min={0}
                max={1}
                step={0.01}
                {...register('similarity_boost', { valueAsNumber: true })}
              />
              <SliderField
                label="Intensidad del estilo"
                description="Acentúa el estilo propio de la voz."
                displayValue={style.toFixed(2)}
                minLabel="Neutra"
                maxLabel="Marcada"
                min={0}
                max={1}
                step={0.01}
                {...register('style', { valueAsNumber: true })}
              />
              <SliderField
                label="Velocidad al hablar"
                displayValue={`${speed.toFixed(2)}×`}
                minLabel="Lenta"
                maxLabel="Rápida"
                min={0.7}
                max={1.2}
                step={0.05}
                {...register('speed', { valueAsNumber: true })}
              />
            </div>
          </div>

          <div className="space-y-5 border-t border-border-default pt-5">
            <h3 className={subsectionTitleClass}>Conversación</h3>
            <SwitchField
              label="Detección automática de idioma"
              description="El agente responde en el idioma de quien llama."
              checked={Boolean(autoLanguageDetection)}
              onChange={(next) =>
                setValue('auto_language_detection', next, {
                  shouldDirty: true,
                })
              }
            />
            <Field
              label="Espera de silencio antes de responder"
              help="En milisegundos. Entre 200 y 3000; valores bajos hacen que el agente responda antes."
            >
              {(control) => (
                <input
                  {...control}
                  type="number"
                  min={200}
                  max={3000}
                  step={100}
                  className={`${inputClass} tabular-nums md:max-w-xs`}
                  {...register('silence_end_timeout_ms', { valueAsNumber: true })}
                />
              )}
            </Field>
            <SwitchField
              label="Grabar llamadas"
              description="Guarda el audio de las conversaciones para revisarlas en Análisis."
              checked={Boolean(callRecordingEnabled)}
              onChange={(next) =>
                setValue('call_recording_enabled', next, {
                  shouldDirty: true,
                })
              }
            />
            <SwitchField
              label="Ignorar la personalidad predeterminada"
              description="El agente no adopta el tono amable que la plataforma aplica por defecto."
              checked={Boolean(ignorePersonality)}
              onChange={(next) =>
                setValue('ignore_default_personality', next, {
                  shouldDirty: true,
                })
              }
            />
          </div>
        </AdvancedSection>
      )}
    </div>
  )
}
