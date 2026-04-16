import type { FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form'
import { TEXT_PROVIDER_MODELS, type TextAgentFormValues, type TextProvider } from '@/types/textAgent'

type Props = {
  register: UseFormRegister<TextAgentFormValues>
  setValue: UseFormSetValue<TextAgentFormValues>
  errors: FieldErrors<TextAgentFormValues>
  provider: TextProvider
  temperature: number
  maxTokens: number
}

const inputClass =
  'w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black placeholder:text-black/50 transition-colors focus:border-[#271173] focus:outline-none'

const textAreaClass = `${inputClass} resize-none`

const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-black/50'

const sliderClass =
  'w-full h-1.5 rounded-full appearance-none bg-[#e4e0f5] cursor-pointer ' +
  '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 ' +
  '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#271173] ' +
  '[&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md ' +
  '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white'

export default function TextAgentConfigTab({ register, setValue, errors, provider, temperature, maxTokens }: Props) {
  const modelOptions = TEXT_PROVIDER_MODELS[provider] ?? TEXT_PROVIDER_MODELS.openai

  const providerBadge: Record<string, { label: string; color: string }> = {
    openai: { label: 'OpenAI', color: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
    gemini: { label: 'Google Gemini', color: 'bg-blue-50 text-blue-700 border border-blue-200' },
  }
  const badge = providerBadge[provider] ?? { label: provider, color: 'bg-[#ede9ff] text-[#271173] border border-[#d4cfee]' }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Name */}
      <div>
        <label className={labelClass}>Nombre</label>
        <input
          type="text"
          className={inputClass}
          placeholder="Ej: Agente de soporte por chat"
          {...register('name', { required: 'El nombre es requerido' })}
        />
        {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
      </div>

      {/* Provider (readonly) + Model */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Proveedor</label>
          <div className="flex h-10.5 items-center gap-2 rounded-xl border border-[#e4e0f5] bg-[#fafafa] px-3">
            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${badge.color}`}>
              {badge.label}
            </span>
            <span className="text-xs text-black/40">No editable después de crear</span>
          </div>
        </div>

        <div>
          <label className={labelClass}>Modelo</label>
          <select className={inputClass} {...register('model')}>
            {modelOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Sliders */}
      <div className="rounded-xl border border-[#e4e0f5] bg-[#fafafa] p-5 space-y-5">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className={labelClass}>Temperatura</label>
            <span className="rounded-lg bg-[#ede9ff] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[#271173]">
              {temperature.toFixed(1)}
            </span>
          </div>
          <input
            type="range" min={0} max={2} step={0.1}
            value={temperature}
            className={sliderClass}
            onChange={(e) => setValue('temperature', parseFloat(e.target.value), { shouldDirty: true, shouldTouch: true })}
          />
          <div className="mt-1 flex justify-between text-[10px] text-black/40">
            <span>0</span><span>2</span>
          </div>
        </div>

        <div className="border-t border-[#e4e0f5]" />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className={labelClass}>Máx. tokens</label>
            <span className="rounded-lg bg-[#ede9ff] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[#271173]">
              {maxTokens.toLocaleString()}
            </span>
          </div>
          <input
            type="range" min={64} max={8192} step={64}
            value={maxTokens}
            className={sliderClass}
            onChange={(e) => setValue('max_tokens', parseInt(e.target.value, 10), { shouldDirty: true, shouldTouch: true })}
          />
          <div className="mt-1 flex justify-between text-[10px] text-black/40">
            <span>64</span><span>8 192</span>
          </div>
        </div>
      </div>

      {/* System prompt */}
      <div>
        <label className={labelClass}>Prompt del sistema</label>
        <textarea
          rows={9}
          className={textAreaClass}
          placeholder="Define el comportamiento del agente, tono, idioma, reglas y objetivos."
          {...register('system_prompt')}
        />
      </div>

      {/* Welcome message */}
      <div>
        <label className={labelClass}>Primer mensaje</label>
        <textarea
          rows={3}
          className={textAreaClass}
          placeholder="Hola, soy tu asistente. ¿En qué te puedo ayudar hoy?"
          {...register('welcome_message')}
        />
        <p className="mt-1.5 text-xs text-black/40">
          Mensaje inicial que el agente muestra al abrir el chat.
        </p>
      </div>
    </div>
  )
}
