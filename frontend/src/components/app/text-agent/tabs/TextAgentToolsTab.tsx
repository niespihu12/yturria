import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  createTextAgentTool,
  deleteTextAgentTool,
  updateTextAgentTool,
} from '@/api/TextAgentsAPI'
import type { TextAgentTool } from '@/types/textAgent'

type Props = {
  agentId: string
  tools: TextAgentTool[]
}

type ToolForm = {
  name: string
  description: string
  endpoint_url: string
  http_method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
}

const emptyForm: ToolForm = {
  name: '',
  description: '',
  endpoint_url: '',
  http_method: 'POST',
}

export default function TextAgentToolsTab({ agentId, tools }: Props) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ToolForm>(emptyForm)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['text-agent', agentId] })

  const { mutate: createTool, isPending: isCreating } = useMutation({
    mutationFn: () =>
      createTextAgentTool(agentId, {
        name: form.name,
        description: form.description,
        endpoint_url: form.endpoint_url,
        http_method: form.http_method,
      }),
    onSuccess: () => {
      toast.success('Herramienta creada')
      setForm(emptyForm)
      refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const { mutate: removeTool } = useMutation({
    mutationFn: (toolId: string) => deleteTextAgentTool(agentId, toolId),
    onSuccess: () => {
      toast.success('Herramienta eliminada')
      refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const { mutate: toggleTool } = useMutation({
    mutationFn: ({ toolId, enabled }: { toolId: string; enabled: boolean }) =>
      updateTextAgentTool(agentId, toolId, { enabled }),
    onSuccess: () => refresh(),
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[#e4e0f5] bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-black">Nueva herramienta</h3>

        <div className="grid gap-3 lg:grid-cols-2">
          <input
            type="text"
            value={form.name}
            onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="Nombre"
            className="rounded-lg border border-[#e4e0f5] bg-white px-3 py-2 text-sm text-black placeholder:text-black/50 focus:border-[#271173] focus:outline-none"
          />
          <input
            type="text"
            value={form.endpoint_url}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, endpoint_url: event.target.value }))
            }
            placeholder="https://api.tu-servicio.com/action"
            className="rounded-lg border border-[#e4e0f5] bg-white px-3 py-2 text-sm text-black placeholder:text-black/50 focus:border-[#271173] focus:outline-none"
          />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <select
            value={form.http_method}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, http_method: event.target.value as ToolForm['http_method'] }))
            }
            className="rounded-lg border border-[#271173]/22 bg-white px-3 py-2 text-sm text-black focus:border-[#271173] focus:outline-none"
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
          </select>
          <input
            type="text"
            value={form.description}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, description: event.target.value }))
            }
            placeholder="Descripcion funcional"
            className="rounded-lg border border-[#e4e0f5] bg-white px-3 py-2 text-sm text-black placeholder:text-black/50 focus:border-[#271173] focus:outline-none"
          />
        </div>

        <div className="mt-4">
          <button
            type="button"
            disabled={isCreating || !form.name.trim() || !form.endpoint_url.trim()}
            onClick={() => createTool()}
            className="rounded-xl bg-[#271173] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-60"
          >
            Crear herramienta
          </button>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-[#e4e0f5] bg-white">
        <div className="border-b border-[#e4e0f5] px-5 py-3">
          <h3 className="text-sm font-semibold text-black">Herramientas configuradas</h3>
        </div>

        {tools.length === 0 ? (
          <div className="px-5 py-6 text-sm text-black/60">Aun no hay herramientas para este agente.</div>
        ) : (
          <div className="divide-y divide-[#e4e0f5]">
            {tools.map((tool) => (
              <div key={tool.id} className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-black">{tool.name}</p>
                    <p className="text-xs text-black/60">{tool.http_method} {tool.endpoint_url}</p>
                    {tool.description && (
                      <p className="mt-1 text-xs text-black/70">{tool.description}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleTool({ toolId: tool.id, enabled: !tool.enabled })}
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                        tool.enabled
                          ? 'border border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                          : 'border border-[#e4e0f5] text-black/60 hover:bg-[#f5f3ff]'
                      }`}
                    >
                      {tool.enabled ? 'Activa' : 'Inactiva'}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTool(tool.id)}
                      className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
