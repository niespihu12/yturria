import { useId } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowTopRightOnSquareIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'

import { getTextAgentEmbedConfig } from '@/api/TextAgentsAPI'
import AdvancedSection from '@/components/ui/AdvancedSection'
import Button from '@/components/ui/Button'
import { useCurrentUser } from '@/hooks/useCurrentUser'

type Props = {
  agentId: string
}

async function copyCode(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Código copiado. Ya puede pegarlo en su sitio web.')
  } catch {
    toast.error('No se pudo copiar. Seleccione el código y cópielo manualmente.')
  }
}

function CodeBlock({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const id = useId()
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <label htmlFor={id} className="text-sm font-medium text-text-primary">
            {label}
          </label>
          {hint && <p className="mt-0.5 text-xs text-text-tertiary">{hint}</p>}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          leftIcon={<ClipboardDocumentIcon className="h-4 w-4" aria-hidden="true" />}
          onClick={() => void copyCode(value)}
        >
          Copiar código
        </Button>
      </div>
      <textarea
        id={id}
        readOnly
        value={value}
        rows={7}
        onFocus={(event) => event.currentTarget.select()}
        className="w-full resize-none rounded-lg border border-border-default bg-surface-muted p-3 font-mono text-xs leading-relaxed text-text-secondary focus:border-primary-600"
      />
    </div>
  )
}

export default function TextAgentIntegrationTab({ agentId }: Props) {
  const { isSuperAdmin } = useCurrentUser()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['text-agent-embed-config', agentId],
    queryFn: () => getTextAgentEmbedConfig(agentId),
    enabled: !!agentId,
  })

  const iframeUrl = data?.iframe_url ?? ''
  const iframeSnippet = data?.iframe_snippet ?? ''
  const scriptSnippet = data?.script_snippet ?? ''

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h2 className="text-base font-semibold text-text-primary">Chat en su sitio web</h2>
        <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-text-secondary">
          Copie el código y péguelo en la página de su sitio donde quiera mostrar el chat. Sus
          clientes podrán conversar con el agente sin salir de su sitio.
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3" aria-label="Cargando el código del chat">
          <div className="skeleton h-40" />
          <div className="skeleton h-24" />
        </div>
      )}

      {isError && (
        <p role="alert" className="text-sm text-danger-700">
          No pudimos preparar el código del chat. Recargue la página o intente más tarde.
        </p>
      )}

      {!isLoading && !isError && data && data.embed_enabled === false && (
        <p className="rounded-lg bg-warning-50 px-4 py-3 text-sm text-warning-700">
          El chat para sitios web está desactivado para este agente.
        </p>
      )}

      {!isLoading && !isError && data && data.embed_enabled !== false && iframeUrl && (
        <>
          <section className="space-y-5">
            <CodeBlock
              label="Código para su sitio web"
              hint="Funciona en cualquier página HTML, WordPress o Webflow."
              value={iframeSnippet}
            />

            <div>
              <h3 className="text-sm font-medium text-text-primary">Dónde pegarlo</h3>
              <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="font-medium text-text-secondary">WordPress</dt>
                <dd className="text-text-secondary">Agregue un bloque «HTML personalizado» y pegue el código.</dd>
                <dt className="font-medium text-text-secondary">Webflow</dt>
                <dd className="text-text-secondary">Inserte un elemento «Embed» y pegue el código.</dd>
                <dt className="font-medium text-text-secondary">Sitio propio</dt>
                <dd className="text-text-secondary">Pídale a su equipo web que lo ubique en la página deseada.</dd>
              </dl>
            </div>

            <AdvancedSection
              key={isSuperAdmin ? 'admin' : 'client'}
              title="Más opciones de instalación"
              description="Versión con script, para equipos técnicos."
              defaultOpen={isSuperAdmin}
            >
              <CodeBlock label="Código con script" value={scriptSnippet} />
            </AdvancedSection>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-text-primary">Así lo verán sus clientes</h3>
              <a
                href={iframeUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm font-semibold text-primary-700 hover:text-primary-800"
              >
                Abrir en una pestaña nueva
                <ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
            <iframe
              src={iframeUrl}
              title="Vista previa del chat para su sitio web"
              className="h-130 w-full rounded-xl border border-border-default bg-surface"
            />
          </section>
        </>
      )}
    </div>
  )
}
