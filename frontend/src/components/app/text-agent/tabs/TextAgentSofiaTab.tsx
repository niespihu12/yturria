import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  SparklesIcon,
  BellAlertIcon,
  ClockIcon,
  UserIcon,
  PhoneIcon,
  BuildingOffice2Icon,
  ChatBubbleLeftEllipsisIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline'
import { getEscalations, updateEscalation } from '@/api/TextAgentsAPI'
import type { EscalationStatus, SofiaConfig } from '@/types/textAgent'

type Props = {
  agentId: string
  sofiaMode: boolean
  sofiaConfigJson: string
  onSofiaChange: (mode: boolean, configJson: string) => void
}

const inputClass =
  'w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black placeholder:text-black/50 transition-colors focus:border-[#271173] focus:outline-none'

const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-black/50'

const DEFAULT_CONFIG: SofiaConfig = {
  advisor_phone: '',
  advisor_name: '',
  business_name: 'Yturria Seguros',
  business_hours: 'Lun-Vie 9:00-18:00',
  escalation_phrases: [
    'quiero hablar con alguien',
    'necesito un asesor',
    'quiero cotizar',
    'hablar con una persona',
  ],
  max_response_lines: 3,
}

const STATUS_CONFIG: Record<EscalationStatus, { label: string; color: string; icon: typeof CheckCircleIcon }> = {
  pending: { label: 'Pendiente', color: 'bg-amber-50 text-amber-700 border-amber-200', icon: ExclamationTriangleIcon },
  in_progress: { label: 'En progreso', color: 'bg-blue-50 text-blue-700 border-blue-200', icon: ArrowPathIcon },
  resolved: { label: 'Resuelto', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircleIcon },
}

export default function TextAgentSofiaTab({ agentId, sofiaMode, sofiaConfigJson, onSofiaChange }: Props) {
  const queryClient = useQueryClient()

  const [config, setConfig] = useState<SofiaConfig>(() => {
    try {
      const parsed = JSON.parse(sofiaConfigJson || '{}')
      return { ...DEFAULT_CONFIG, ...parsed }
    } catch {
      return DEFAULT_CONFIG
    }
  })

  const [newPhrase, setNewPhrase] = useState('')

  useEffect(() => {
    try {
      const parsed = JSON.parse(sofiaConfigJson || '{}')
      setConfig({ ...DEFAULT_CONFIG, ...parsed })
    } catch {
      setConfig(DEFAULT_CONFIG)
    }
  }, [sofiaConfigJson])

  const updateConfig = (partial: Partial<SofiaConfig>) => {
    const next = { ...config, ...partial }
    setConfig(next)
    onSofiaChange(sofiaMode, JSON.stringify(next))
  }

  const handleToggle = () => {
    onSofiaChange(!sofiaMode, JSON.stringify(config))
  }

  const addPhrase = () => {
    const trimmed = newPhrase.trim()
    if (!trimmed || config.escalation_phrases.includes(trimmed)) return
    updateConfig({ escalation_phrases: [...config.escalation_phrases, trimmed] })
    setNewPhrase('')
  }

  const removePhrase = (idx: number) => {
    updateConfig({ escalation_phrases: config.escalation_phrases.filter((_: string, i: number) => i !== idx) })
  }

  // ── Escalations ──
  const { data: escalationsData, isLoading: loadingEscalations } = useQuery({
    queryKey: ['escalations', agentId],
    queryFn: () => getEscalations(agentId),
    enabled: sofiaMode,
    refetchInterval: 30_000,
  })

  const escalations = escalationsData?.escalations ?? []

  const { mutate: patchEscalation, isPending: patchingEscalation } = useMutation({
    mutationFn: (vars: { convId: string; status: EscalationStatus }) =>
      updateEscalation(agentId, vars.convId, { status: vars.status }),
    onSuccess: () => {
      toast.success('Escalación actualizada')
      queryClient.invalidateQueries({ queryKey: ['escalations', agentId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div className="max-w-3xl space-y-6">
      {/* Toggle Sofia Mode */}
      <div className="flex items-center justify-between rounded-2xl border border-[#e4e0f5] bg-gradient-to-r from-[#f5f3ff] to-[#ede9ff] p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#271173] shadow-md">
            <SparklesIcon className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-black">Modo Sofía</h3>
            <p className="text-xs text-black/50">
              Activa la secretaria digital con IA para este agente
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleToggle}
          className={`relative h-7 w-12 rounded-full transition-all duration-300 ${
            sofiaMode ? 'bg-[#271173]' : 'bg-[#e4e0f5]'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-300 ${
              sofiaMode ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {sofiaMode && (
        <>
          {/* Business Info */}
          <div className="space-y-4 rounded-xl border border-[#e4e0f5] bg-white p-5">
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-black/50">
              <BuildingOffice2Icon className="h-4 w-4" />
              Información del Negocio
            </h4>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Nombre del negocio</label>
                <input
                  type="text"
                  className={inputClass}
                  value={config.business_name}
                  onChange={(e) => updateConfig({ business_name: e.target.value })}
                  placeholder="Yturria Seguros"
                />
              </div>
              <div>
                <label className={labelClass}>
                  <ClockIcon className="inline h-3.5 w-3.5 mr-1" />
                  Horario de atención
                </label>
                <input
                  type="text"
                  className={inputClass}
                  value={config.business_hours}
                  onChange={(e) => updateConfig({ business_hours: e.target.value })}
                  placeholder="Lun-Vie 9:00-18:00"
                />
              </div>
            </div>
          </div>

          {/* Advisor Info */}
          <div className="space-y-4 rounded-xl border border-[#e4e0f5] bg-white p-5">
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-black/50">
              <UserIcon className="h-4 w-4" />
              Asesor Asignado
            </h4>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Nombre del asesor</label>
                <input
                  type="text"
                  className={inputClass}
                  value={config.advisor_name}
                  onChange={(e) => updateConfig({ advisor_name: e.target.value })}
                  placeholder="Juan Pérez"
                />
              </div>
              <div>
                <label className={labelClass}>
                  <PhoneIcon className="inline h-3.5 w-3.5 mr-1" />
                  Teléfono WhatsApp
                </label>
                <input
                  type="text"
                  className={inputClass}
                  value={config.advisor_phone}
                  onChange={(e) => updateConfig({ advisor_phone: e.target.value })}
                  placeholder="+5218123456789"
                />
              </div>
            </div>
          </div>

          {/* Response Settings */}
          <div className="space-y-4 rounded-xl border border-[#e4e0f5] bg-[#fafafa] p-5">
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-black/50">
              <ChatBubbleLeftEllipsisIcon className="h-4 w-4" />
              Configuración de Respuestas
            </h4>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className={labelClass}>Máx. líneas por respuesta</label>
                <span className="rounded-lg bg-[#ede9ff] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[#271173]">
                  {config.max_response_lines}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={config.max_response_lines}
                onChange={(e) => updateConfig({ max_response_lines: parseInt(e.target.value, 10) })}
                className="w-full h-1.5 rounded-full appearance-none bg-[#e4e0f5] cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#271173] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white"
              />
              <div className="mt-1 flex justify-between text-[10px] text-black/40">
                <span>1</span><span>10</span>
              </div>
            </div>
          </div>

          {/* Escalation Phrases */}
          <div className="space-y-4 rounded-xl border border-[#e4e0f5] bg-white p-5">
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-black/50">
              <BellAlertIcon className="h-4 w-4" />
              Frases de Escalación
            </h4>
            <p className="text-xs text-black/40">
              Cuando el usuario diga algo similar a estas frases, se notificará al asesor.
            </p>

            <div className="flex flex-wrap gap-2">
              {config.escalation_phrases.map((phrase: string, idx: number) => (
                <span
                  key={idx}
                  className="group flex items-center gap-1.5 rounded-lg border border-[#e4e0f5] bg-[#f5f3ff] px-3 py-1.5 text-xs text-[#271173]"
                >
                  {phrase}
                  <button
                    type="button"
                    onClick={() => removePhrase(idx)}
                    className="ml-0.5 text-[#271173]/40 transition-colors hover:text-red-500"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                className={inputClass}
                value={newPhrase}
                onChange={(e) => setNewPhrase(e.target.value)}
                placeholder="Agregar nueva frase..."
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPhrase() } }}
              />
              <button
                type="button"
                onClick={addPhrase}
                disabled={!newPhrase.trim()}
                className="shrink-0 rounded-xl bg-[#271173] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-40"
              >
                Agregar
              </button>
            </div>
          </div>

          {/* Escalation Dashboard */}
          <div className="space-y-4 rounded-xl border border-[#e4e0f5] bg-white p-5">
            <div className="flex items-center justify-between">
              <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-black/50">
                <BellAlertIcon className="h-4 w-4" />
                Escalaciones Activas
              </h4>
              {escalations.length > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-700">
                  {escalations.filter((e) => e.escalation_status === 'pending').length}
                </span>
              )}
            </div>

            {loadingEscalations ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-black/40">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#271173] border-t-transparent" />
                Cargando escalaciones...
              </div>
            ) : escalations.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#e4e0f5] bg-[#fafafa] py-8 text-center text-sm text-black/40">
                No hay escalaciones activas
              </div>
            ) : (
              <div className="space-y-3">
                {escalations.map((esc) => {
                  const cfg = STATUS_CONFIG[esc.escalation_status]
                  const StatusIcon = cfg.icon
                  const date = esc.escalated_at_unix_secs
                    ? new Date(esc.escalated_at_unix_secs * 1000).toLocaleString('es-MX', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'

                  return (
                    <div
                      key={esc.conversation_id}
                      className="flex items-center justify-between rounded-xl border border-[#e4e0f5] bg-[#fafafa] p-4 transition-colors hover:bg-[#f5f3ff]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${cfg.color}`}>
                            <StatusIcon className="h-3 w-3" />
                            {cfg.label}
                          </span>
                          <span className="text-[10px] text-black/40">{date}</span>
                        </div>
                        <p className="mt-1.5 truncate text-xs text-black/70">
                          {esc.escalation_reason || esc.last_message_preview || 'Sin detalle'}
                        </p>
                      </div>

                      <div className="ml-3 flex shrink-0 gap-1.5">
                        {esc.escalation_status === 'pending' && (
                          <button
                            type="button"
                            disabled={patchingEscalation}
                            onClick={() => patchEscalation({ convId: esc.conversation_id, status: 'in_progress' })}
                            className="rounded-lg bg-blue-50 px-3 py-1.5 text-[11px] font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
                          >
                            Atender
                          </button>
                        )}
                        {(esc.escalation_status === 'pending' || esc.escalation_status === 'in_progress') && (
                          <button
                            type="button"
                            disabled={patchingEscalation}
                            onClick={() => patchEscalation({ convId: esc.conversation_id, status: 'resolved' })}
                            className="rounded-lg bg-emerald-50 px-3 py-1.5 text-[11px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
                          >
                            Resolver
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
