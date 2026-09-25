import { useId } from 'react'
import type { FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form'
import {
  TEXT_PROVIDER_MODELS,
  TEXT_PROVIDER_OPTIONS,
  type TextAgentFormValues,
  type TextProvider,
} from '@/types/textAgent'
import AdvancedSection from '@/components/ui/AdvancedSection'
import { useCurrentUser } from '@/hooks/useCurrentUser'

type Props = {
  register: UseFormRegister<TextAgentFormValues>
  setValue: UseFormSetValue<TextAgentFormValues>
  errors: FieldErrors<TextAgentFormValues>
  provider: TextProvider
  model: string
  temperature: number
  maxTokens: number
  canEditPrompt: boolean
  canEditWelcome: boolean
  canEditModel: boolean
  canEditRuntimeTuning: boolean
}

const inputClass =
  'w-full rounded-lg border border-border-default bg-surface px-3 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary transition-colors focus:border-primary-600 read-only:cursor-default read-only:bg-surface-muted read-only:text-text-secondary'

const textAreaClass = `${inputClass} resize-y leading-relaxed`

const labelClass = 'mb-1.5 block text-sm font-medium text-text-primary'
const hintClass = 'mt-1.5 text-xs leading-relaxed text-text-tertiary'

const sliderClass =
  'h-1.5 w-full cursor-pointer appearance-none rounded-full bg-primary-100 accent-primary-700 ' +
  '[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none ' +
  '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-surface ' +
  '[&::-webkit-slider-thumb]:bg-primary-700 [&::-webkit-slider-thumb]:shadow'

export default function TextAgentConfigTab({
  register,
  setValue,
  errors,
  provider,
  model,
  temperature,
  maxTokens,
  canEditPrompt,
  canEditWelcome,
  canEditModel,
  canEditRuntimeTuning,
}: Props) {
  const { isSuperAdmin } = useCurrentUser()
  const ids = {
    name: useId(),
    nameError: useId(),
    welcome: useId(),
    legal: useId(),
    model: useId(),
    temperature: useId(),
    maxTokens: useId(),
    prompt: useId(),
  }
  const modelOptions = TEXT_PROVIDER_MODELS[provider] ?? TEXT_PROVIDER_MODELS.openai
  const providerLabel = TEXT_PROVIDER_OPTIONS.find((option) => option.value === provider)?.label ?? provider
  const modelLabel = modelOptions.find((item) => item.value === model)?.label ?? model

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <label htmlFor={ids.name} className={labelClass}>
          Nombre
        </label>
        <input
          id={ids.name}
          type="text"
          className={inputClass}
          placeholder="Ej: Agente de atención por chat"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? ids.nameError : undefined}
          {...register('name', { required: 'Escriba un nombre para el agente' })}
        />
        {errors.name && (
          <p id={ids.nameError} className="mt-1.5 text-sm text-danger-700">
            {errors.name.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor={ids.welcome} className={labelClass}>
          Mensaje de bienvenida
        </label>
        <textarea
          id={ids.welcome}
          rows={3}
          className={textAreaClass}
          readOnly={!canEditWelcome}
          placeholder="Hola, soy su asistente virtual. ¿En qué le puedo ayudar hoy?"
          {...register('welcome_message')}
        />
        <p className={hintClass}>
          {canEditWelcome
            ? 'Es lo primero que ve el cliente al abrir el chat.'
            : 'Es lo primero que ve el cliente al abrir el chat. Lo define la plantilla del agente.'}
        </p>
      </div>

      <div>
        <label htmlFor={ids.legal} className={labelClass}>
          Aviso legal
        </label>
        <textarea
          id={ids.legal}
          rows={3}
          className={textAreaClass}
          placeholder="Ej: Los valores son orientativos y no constituyen una oferta formal."
          {...register('legal_notice')}
        />
        <p className={hintClass}>
          Se muestra una sola vez, al inicio de cada conversación, en el sitio web y en WhatsApp. Si
          lo deja vacío, se usa el aviso predeterminado de la cuenta.
        </p>
      </div>

      <AdvancedSection
        key={isSuperAdmin ? 'admin' : 'client'}
        defaultOpen={isSuperAdmin}
        description="Motor de IA, instrucciones del asistente y estilo de respuesta. Normalmente no necesita cambiarlos."
      >
        <dl className="grid gap-4 @lg:grid-cols-2">
          <div>
            <dt className="text-sm font-medium text-text-primary">Proveedor de IA</dt>
            <dd className="mt-1 text-sm text-text-secondary">
              {providerLabel}
              <span className="block text-xs text-text-tertiary">No se puede cambiar después de crear el agente.</span>
            </dd>
          </div>
          {!canEditModel && (
            <div>
              <dt className="text-sm font-medium text-text-primary">Modelo</dt>
              <dd className="mt-1 text-sm text-text-secondary">{modelLabel}</dd>
            </div>
          )}
        </dl>

        {canEditModel && (
          <div>
            <label htmlFor={ids.model} className={labelClass}>
              Modelo
            </label>
            <select id={ids.model} className={inputClass} {...register('model')}>
              {modelOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {canEditRuntimeTuning && (
          <div className="grid gap-5 @lg:grid-cols-2">
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <label htmlFor={ids.temperature} className="text-sm font-medium text-text-primary">
                  Creatividad
                </label>
                <span className="text-sm font-semibold tabular-nums text-primary-700">
                  {temperature.toFixed(1)}
                </span>
              </div>
              <input
                id={ids.temperature}
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                className={sliderClass}
                aria-valuetext={`${temperature.toFixed(1)} de 2`}
                onChange={(e) =>
                  setValue('temperature', parseFloat(e.target.value), {
                    shouldDirty: true,
                    shouldTouch: true,
                  })}
              />
              <p className={hintClass}>Bajo: respuestas precisas y constantes. Alto: más variadas.</p>
            </div>

            <div>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <label htmlFor={ids.maxTokens} className="text-sm font-medium text-text-primary">
                  Extensión máxima
                </label>
                <span className="text-sm font-semibold tabular-nums text-primary-700">
                  {maxTokens.toLocaleString('es-CO')}
                </span>
              </div>
              <input
                id={ids.maxTokens}
                type="range"
                min={64}
                max={8192}
                step={64}
                value={maxTokens}
                className={sliderClass}
                aria-valuetext={`${maxTokens} tokens`}
                onChange={(e) =>
                  setValue('max_tokens', parseInt(e.target.value, 10), {
                    shouldDirty: true,
                    shouldTouch: true,
                  })}
              />
              <p className={hintClass}>Límite de longitud de cada respuesta, en tokens.</p>
            </div>
          </div>
        )}

        <div>
          <label htmlFor={ids.prompt} className={labelClass}>
            Instrucciones del asistente
          </label>
          <textarea
            id={ids.prompt}
            rows={9}
            className={textAreaClass}
            readOnly={!canEditPrompt}
            placeholder="Describa cómo debe comportarse el asistente: tono, temas que atiende, qué evitar y cuándo pasar el caso a una persona."
            {...register('system_prompt')}
          />
          {!canEditPrompt && (
            <p className={hintClass}>Estas instrucciones vienen definidas por la plantilla del agente.</p>
          )}
        </div>
      </AdvancedSection>
    </div>
  )
}
