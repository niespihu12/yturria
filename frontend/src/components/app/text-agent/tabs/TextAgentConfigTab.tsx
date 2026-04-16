import type { FieldErrors, UseFormRegister, UseFormWatch } from 'react-hook-form'
import {
  TEXT_PROVIDER_MODELS,
  TEXT_PROVIDER_OPTIONS,
  type TextAgentFormValues,
} from '@/types/textAgent'

type Props = {
  register: UseFormRegister<TextAgentFormValues>
  watch: UseFormWatch<TextAgentFormValues>
  errors: FieldErrors<TextAgentFormValues>
}

const inputClass =
  'w-full rounded-lg border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black placeholder:text-black/50 transition-colors focus:border-[#271173] focus:outline-none'

const textAreaClass = `${inputClass} resize-none`

export default function TextAgentConfigTab({ register, watch, errors }: Props) {
  const provider = watch('provider')
  const modelOptions = TEXT_PROVIDER_MODELS[provider] ?? TEXT_PROVIDER_MODELS.openai

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-black/85">Nombre</label>
        <input
          type="text"
          className={inputClass}
          placeholder="Ej: Agente de soporte por chat"
          {...register('name', { required: 'El nombre es requerido' })}
        />
        {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-black/85">Proveedor</label>
          <select className={inputClass} {...register('provider')}>
            {TEXT_PROVIDER_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-black/85">Modelo</label>
          <select className={inputClass} {...register('model')}>
            {modelOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-black/85">Idioma</label>
          <select className={inputClass} {...register('language')}>
            <option value="es">Español</option>
            <option value="en">English</option>
            <option value="pt">Português</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-black/85">Temperatura</label>
          <input
            type="number"
            step="0.1"
            min={0}
            max={2}
            className={inputClass}
            {...register('temperature', { valueAsNumber: true })}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-black/85">Max tokens</label>
          <input
            type="number"
            min={64}
            max={8192}
            className={inputClass}
            {...register('max_tokens', { valueAsNumber: true })}
          />
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-black/85">
          Mensaje del sistema
        </label>
        <textarea
          rows={8}
          className={textAreaClass}
          placeholder="Define el comportamiento del agente, tono, reglas y objetivos."
          {...register('system_prompt')}
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-black/85">Primer mensaje</label>
        <textarea
          rows={3}
          className={textAreaClass}
          placeholder="Hola, soy tu asistente de texto. ¿En qué te ayudo hoy?"
          {...register('welcome_message')}
        />
      </div>
    </div>
  )
}
