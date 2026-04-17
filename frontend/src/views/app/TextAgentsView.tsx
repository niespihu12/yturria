import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { toast } from 'react-toastify'
import {
  ChatBubbleLeftRightIcon,
  PencilSquareIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline'
import { createTextAgent, deleteTextAgent, getTextAgents } from '@/api/TextAgentsAPI'
import { TEXT_PROVIDER_OPTIONS, type TextAgentSummary, type TextProvider } from '@/types/textAgent'

type CreateForm = {
  name: string
  provider: TextProvider
}

function formatDate(unixSecs: number) {
  return new Date(unixSecs * 1000).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function TextAgentsView() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const scopedUserId = searchParams.get('user_id') || undefined

  const { data, isLoading, isError } = useQuery({
    queryKey: ['text-agents', scopedUserId ?? 'all'],
    queryFn: () => getTextAgents({ userId: scopedUserId }),
  })

  const agents: TextAgentSummary[] = data?.agents ?? []

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateForm>({
    defaultValues: {
      provider: 'openai',
      name: '',
    },
  })

  const { mutate: create, isPending: isCreating } = useMutation({
    mutationFn: (values: CreateForm) => createTextAgent(values),
    onSuccess: (newAgent) => {
      toast.success('Agente de texto creado')
      queryClient.invalidateQueries({ queryKey: ['text-agents'] })
      setShowModal(false)
      reset()
      navigate(`/agentes_texto/${newAgent.agent_id}`)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const { mutate: remove } = useMutation({
    mutationFn: deleteTextAgent,
    onSuccess: () => {
      toast.success('Agente eliminado')
      queryClient.invalidateQueries({ queryKey: ['text-agents'] })
      setDeletingId(null)
    },
    onError: (error: Error) => {
      toast.error(error.message)
      setDeletingId(null)
    },
  })

  const handleDelete = (agentId: string, event: React.MouseEvent) => {
    event.stopPropagation()
    if (confirm('Eliminar este agente de texto?')) {
      setDeletingId(agentId)
      remove(agentId)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
    <div className="w-full p-8">
      <section className="section-enter mb-8 overflow-hidden rounded-[28px] border border-[#e4e0f5] bg-white px-6 py-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#271173]">
              Workspace
            </p>
            <h1 className="mt-2 text-3xl font-bold text-black">Agentes de Texto</h1>
            <p className="mt-2 max-w-2xl text-sm text-black/60">
              Crea y administra agentes de texto con OpenAI o Gemini, configuración por usuario,
              herramientas y base de conocimiento integrada.
            </p>
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#271173] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a]"
          >
            <PlusIcon className="h-4 w-4" />
            Nuevo agente de texto
          </button>
        </div>
      </section>

      <div className="mb-5">
        <h2 className="text-lg font-semibold text-black">Listado</h2>
        <p className="mt-1 text-sm text-black/60">
          {scopedUserId
            ? 'Vista filtrada por usuario para supervision del super admin.'
            : 'Cada agente usa un proveedor activo y toma sus API keys desde tu perfil.'}
        </p>
      </div>

      <div className="overflow-hidden rounded-3xl border border-[#e4e0f5] bg-white shadow-sm">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center text-black/60">
            <div className="flex items-center gap-2.5">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#271173] border-t-transparent" />
              Cargando agentes de texto...
            </div>
          </div>
        ) : isError ? (
          <div className="flex h-48 items-center justify-center px-6 text-center text-black/60">
            Error al cargar agentes de texto. Verifica tu sesión e intenta nuevamente.
          </div>
        ) : agents.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#ede9ff]">
              <ChatBubbleLeftRightIcon className="h-6 w-6 text-[#271173]" />
            </div>
            <p className="text-sm text-black/60">No hay agentes de texto todavía</p>
            <button
              onClick={() => setShowModal(true)}
              className="text-sm font-medium text-[#271173] transition-colors hover:text-[#1f0d5a]"
            >
              Crea tu primer agente
            </button>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e4e0f5]">
                <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-black/50">
                  Nombre
                </th>
                <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-black/50">
                  Provider
                </th>
                <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-black/50">
                  Propietario
                </th>
                <th className="px-6 py-3.5 text-left text-xs font-medium uppercase tracking-wider text-black/50">
                  Actualizado
                </th>
                <th className="px-6 py-3.5 text-right text-xs font-medium uppercase tracking-wider text-black/50">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e4e0f5]">
              {agents.map((agent) => (
                <tr
                  key={agent.agent_id}
                  onClick={() => navigate(`/agentes_texto/${agent.agent_id}`)}
                  className="group cursor-pointer transition-colors duration-100 hover:bg-[#f5f3ff]"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#ede9ff]">
                        <ChatBubbleLeftRightIcon className="h-4 w-4 text-[#271173]" />
                      </div>
                      <span className="text-sm font-medium text-black transition-colors group-hover:text-[#271173]">
                        {agent.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-black/60">{agent.provider}</td>
                  <td className="px-6 py-4 text-sm text-black/60">
                    {agent.owner_email ?? '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-black/60">
                    {formatDate(agent.updated_at_unix_secs)}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                          navigate(`/agentes_texto/${agent.agent_id}`)
                        }}
                        className="rounded-lg p-1.5 text-black/50 transition-colors hover:bg-[#ede9ff] hover:text-[#271173]"
                        title="Editar"
                      >
                        <PencilSquareIcon className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(event) => handleDelete(agent.agent_id, event)}
                        disabled={deletingId === agent.agent_id}
                        className="rounded-lg p-1.5 text-black/50 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                        title="Eliminar"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="modal-content mx-4 w-full max-w-md rounded-2xl border border-[#e4e0f5] bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-black">Nuevo agente de texto</h2>
              <button
                onClick={() => {
                  setShowModal(false)
                  reset()
                }}
                className="rounded-lg p-1.5 text-black/50 transition-colors hover:bg-[#f5f3ff] hover:text-black"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit((values) => create(values))} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-black/80">Nombre</label>
                <input
                  type="text"
                  placeholder="Ej: Agente de soporte"
                  className="w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black placeholder:text-black/40 transition-colors focus:border-[#271173] focus:outline-none"
                  {...register('name', { required: 'El nombre es requerido' })}
                />
                {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-black/80">Proveedor</label>
                <select
                  className="w-full rounded-xl border border-[#e4e0f5] bg-white px-3 py-2.5 text-sm text-black transition-colors focus:border-[#271173] focus:outline-none"
                  {...register('provider')}
                >
                  {TEXT_PROVIDER_OPTIONS.map((provider) => (
                    <option key={provider.value} value={provider.value}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    reset()
                  }}
                  className="flex-1 rounded-xl bg-[#f5f3ff] px-4 py-2.5 text-sm font-medium text-black/80 transition-colors hover:bg-[#ede9ff]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#271173] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-60"
                >
                  {isCreating && (
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  )}
                  Crear agente
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    </div>
  )
}
