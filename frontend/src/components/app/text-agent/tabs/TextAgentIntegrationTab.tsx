import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowTopRightOnSquareIcon,
  ClipboardDocumentIcon,
  CodeBracketIcon,
  GlobeAltIcon,
} from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'

import { getTextAgentEmbedConfig } from '@/api/TextAgentsAPI'

type Props = {
  agentId: string
}

async function copySnippet(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label} copiado al portapapeles`)
  } catch {
    toast.error('No se pudo copiar el snippet')
  }
}

export default function TextAgentIntegrationTab({ agentId }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['text-agent-embed-config', agentId],
    queryFn: () => getTextAgentEmbedConfig(agentId),
    enabled: !!agentId,
  })

  const iframeUrl = useMemo(() => data?.iframe_url ?? '', [data])
  const iframeSnippet = useMemo(() => data?.iframe_snippet ?? '', [data])
  const scriptSnippet = useMemo(() => data?.script_snippet ?? '', [data])

  return (
    <div className="max-w-5xl space-y-5">
      <section className="rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm">
        <p className="inline-flex items-center gap-2 rounded-full border border-[#d8d3ee] bg-[#f7f5ff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#271173]">
          <GlobeAltIcon className="h-3.5 w-3.5" />
          Integración embebible
        </p>
        <h2 className="mt-3 text-xl font-semibold text-[#1a1a2f]">Integrar en tu sitio</h2>
        <p className="mt-2 text-sm leading-6 text-[#1a1a2f]/70">
          Usa el iframe o snippet para insertar este agente de texto en cualquier página web.
        </p>
      </section>

      {isLoading && (
        <section className="rounded-2xl border border-[#e4e0f5] bg-white p-5 text-sm text-black/60 shadow-sm">
          Cargando configuración de integración...
        </section>
      )}

      {isError && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 shadow-sm">
          No se pudo generar la configuración embebible del agente de texto.
        </section>
      )}

      {!isLoading && !isError && data && data.embed_enabled === false && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800 shadow-sm">
          La integración embebible está deshabilitada para este agente.
        </section>
      )}

      {!isLoading && !isError && data && data.embed_enabled !== false && iframeUrl && (
        <>
          <section className="rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#1a1a2f]/55">
                Vista previa rápida
              </h3>
              <a
                href={iframeUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#271173] hover:text-[#1f0d5a]"
              >
                Abrir en pestaña nueva
                <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
              </a>
            </div>

            <div className="overflow-hidden rounded-xl border border-[#ece8fb] bg-[#faf9ff] p-2">
              <iframe
                src={iframeUrl}
                title="Vista previa del chat embebido"
                className="h-130 w-full rounded-lg border-0 bg-white"
              />
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <article className="rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-[#1a1a2f]">
                  <CodeBracketIcon className="h-4 w-4 text-[#271173]" />
                  Snippet iframe
                </h3>
                <button
                  type="button"
                  onClick={() => copySnippet(iframeSnippet, 'Snippet iframe')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#d8d3ee] bg-[#f7f5ff] px-2.5 py-1 text-xs font-semibold text-[#271173] hover:bg-[#ede9ff]"
                >
                  <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                  Copiar
                </button>
              </div>
              <textarea
                readOnly
                value={iframeSnippet}
                className="h-56 w-full resize-none rounded-xl border border-[#ece8fb] bg-[#faf9ff] p-3 font-mono text-xs text-[#1a1a2f] focus:outline-none"
              />
            </article>

            <article className="rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-[#1a1a2f]">
                  <CodeBracketIcon className="h-4 w-4 text-[#271173]" />
                  Snippet script
                </h3>
                <button
                  type="button"
                  onClick={() => copySnippet(scriptSnippet, 'Snippet script')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#d8d3ee] bg-[#f7f5ff] px-2.5 py-1 text-xs font-semibold text-[#271173] hover:bg-[#ede9ff]"
                >
                  <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                  Copiar
                </button>
              </div>
              <textarea
                readOnly
                value={scriptSnippet}
                className="h-56 w-full resize-none rounded-xl border border-[#ece8fb] bg-[#faf9ff] p-3 font-mono text-xs text-[#1a1a2f] focus:outline-none"
              />
            </article>
          </section>

          <section className="rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-[#1a1a2f]/55">
              Guía rápida
            </h3>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-[#ece8fb] bg-[#faf9ff] p-3">
                <p className="text-xs font-semibold text-[#271173]">HTML estático</p>
                <p className="mt-1 text-xs leading-5 text-[#1a1a2f]/70">
                  Pega el snippet iframe donde quieres mostrar el chat de texto.
                </p>
              </div>
              <div className="rounded-xl border border-[#ece8fb] bg-[#faf9ff] p-3">
                <p className="text-xs font-semibold text-[#271173]">WordPress</p>
                <p className="mt-1 text-xs leading-5 text-[#1a1a2f]/70">
                  Usa un bloque HTML personalizado y pega el snippet iframe.
                </p>
              </div>
              <div className="rounded-xl border border-[#ece8fb] bg-[#faf9ff] p-3">
                <p className="text-xs font-semibold text-[#271173]">Webflow</p>
                <p className="mt-1 text-xs leading-5 text-[#1a1a2f]/70">
                  Inserta un elemento Embed y pega el snippet iframe o script.
                </p>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
