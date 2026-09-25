import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  ArrowPathIcon,
  ArrowUpTrayIcon,
  DocumentTextIcon,
  GlobeAltIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import {
  computeKnowledgeBaseRagIndex,
  createKnowledgeBaseDocumentFromFile,
  createKnowledgeBaseDocumentFromText,
  createKnowledgeBaseDocumentFromUrl,
  getKnowledgeBaseRagIndexes,
  listKnowledgeBaseDocuments,
  updateAgent,
} from '@/api/VoiceRuntimeAPI'
import {
  RAG_EMBEDDING_MODELS,
  type AgentDetail,
  type KnowledgeBaseItem,
  type KnowledgeBaseUsageMode,
} from '@/types/agent'
import AdvancedSection from '@/components/ui/AdvancedSection'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { cn } from '@/lib/utils'
import { Field, SectionHeading, SliderField, SwitchField } from '../fields'
import { describeError, inputClass, textareaClass } from '../agentUi'
import { pluralize } from '@/lib/format'

type Props = {
  agentId: string
  agent: AgentDetail
  knowledgeBase: KnowledgeBaseItem[]
  onUpdate: () => void
  isClient?: boolean
}

type UploadMode = 'file' | 'url' | 'text'

type RagDraft = {
  enabled: boolean
  embedding_model: string
  max_vector_distance: number
  max_documents_length: number
  max_retrieved_rag_chunks_count: number
}

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info'

const UPLOAD_MODES: Array<{ id: UploadMode; label: string }> = [
  { id: 'file', label: 'Archivo' },
  { id: 'url', label: 'Página web' },
  { id: 'text', label: 'Texto' },
]

const TYPE_LABELS: Record<string, string> = {
  file: 'Archivo',
  url: 'Página web',
  text: 'Texto',
}

const USAGE_LABELS: Record<KnowledgeBaseUsageMode, string> = {
  auto: 'Consultar cuando haga falta',
  prompt: 'Tener siempre presente',
}

function formatBytes(value?: number) {
  if (!value) return null
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function describeStatus(status: string): { label: string; variant: BadgeVariant } {
  switch (status) {
    case 'succeeded':
      return { label: 'Listo', variant: 'success' }
    case 'processing':
      return { label: 'Procesando', variant: 'info' }
    case 'created':
      return { label: 'En cola', variant: 'info' }
    case 'failed':
      return { label: 'No se pudo procesar', variant: 'danger' }
    case 'not_indexed':
      return { label: 'Sin procesar', variant: 'default' }
    case 'disabled':
      return { label: 'Búsqueda desactivada', variant: 'default' }
    default:
      return { label: status, variant: 'default' }
  }
}

function dedupeDocuments(documents: KnowledgeBaseItem[]) {
  const seen = new Set<string>()
  return documents.filter((document) => {
    if (seen.has(document.id)) return false
    seen.add(document.id)
    return true
  })
}

function buildRagDraft(agent: AgentDetail): RagDraft {
  const rag = agent.conversation_config.agent.prompt.rag

  return {
    enabled: !!rag?.enabled || !!rag,
    embedding_model: rag?.embedding_model ?? 'e5_mistral_7b_instruct',
    max_vector_distance: rag?.max_vector_distance ?? 0.6,
    max_documents_length: rag?.max_documents_length ?? 50000,
    max_retrieved_rag_chunks_count:
      rag?.max_retrieved_rag_chunks_count ?? rag?.max_chunks_per_query ?? 6,
  }
}

function DocumentIcon({ type }: { type: string }) {
  const Icon = type === 'url' ? GlobeAltIcon : type === 'text' ? PencilSquareIcon : DocumentTextIcon
  return <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" aria-hidden="true" />
}

export default function KnowledgeBaseTab({ agentId, agent, knowledgeBase, onUpdate, isClient = false }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const [confirm, confirmDialog] = useConfirm()
  const baseId = useId()
  const [uploadMode, setUploadMode] = useState<UploadMode>('file')
  const [dragOver, setDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [busyDocId, setBusyDocId] = useState<string | null>(null)
  const [isSavingRag, setIsSavingRag] = useState(false)
  const [urlName, setUrlName] = useState('')
  const [urlValue, setUrlValue] = useState('')
  const [textName, setTextName] = useState('')
  const [textValue, setTextValue] = useState('')
  const [ragDraft, setRagDraft] = useState<RagDraft>(() => buildRagDraft(agent))

  // Track the last saved model to detect unsaved model changes
  const savedEmbeddingModel = agent.conversation_config.agent.prompt.rag?.embedding_model ?? 'e5_mistral_7b_instruct'
  const modelChanged = ragDraft.embedding_model !== savedEmbeddingModel

  useEffect(() => {
    setRagDraft(buildRagDraft(agent))
  }, [agent])

  const { data: workspaceKnowledgeBase } = useQuery({
    queryKey: ['knowledge-base-documents'],
    queryFn: listKnowledgeBaseDocuments,
    staleTime: 60_000,
  })

  const ragIndexQueries = useQueries({
    queries: knowledgeBase.map((document) => ({
      queryKey: ['knowledge-base-rag-index', document.id],
      queryFn: () => getKnowledgeBaseRagIndexes(document.id),
      enabled: knowledgeBase.length > 0,
      staleTime: 15_000,
    })),
  })

  const workspaceDocumentMap = useMemo(
    () =>
      new Map((workspaceKnowledgeBase?.documents ?? []).map((document) => [document.id, document])),
    [workspaceKnowledgeBase]
  )

  const ragIndexMap = useMemo(() => {
    return new Map(
      knowledgeBase.map((document, index) => [document.id, ragIndexQueries[index]?.data?.indexes ?? []])
    )
  }, [knowledgeBase, ragIndexQueries])

  const indexedDocsCount = knowledgeBase.filter((document) => {
    const indexes = ragIndexMap.get(document.id) ?? []
    return indexes.some((index) => index.status.toLowerCase() === 'succeeded')
  }).length

  const promptDocsCount = knowledgeBase.filter((document) => document.usage_mode === 'prompt').length

  const refreshData = async (documentIds: string[] = []) => {
    await queryClient.invalidateQueries({ queryKey: ['agent', agentId] })
    await queryClient.invalidateQueries({ queryKey: ['knowledge-base-documents'] })
    await Promise.all(
      documentIds.map((documentId) =>
        queryClient.invalidateQueries({ queryKey: ['knowledge-base-rag-index', documentId] })
      )
    )
    onUpdate()
  }

  const persistAgentKnowledge = async (
    nextKnowledgeBase: KnowledgeBaseItem[],
    nextRag: RagDraft,
    successMessage: string,
    documentIdsToRefresh: string[] = []
  ) => {
    const promptConfig = agent.conversation_config.agent.prompt

    await updateAgent(agentId, {
      conversation_config: {
        ...agent.conversation_config,
        agent: {
          ...agent.conversation_config.agent,
          prompt: {
            ...promptConfig,
            knowledge_base: dedupeDocuments(nextKnowledgeBase),
            rag: {
              ...(promptConfig.rag ?? {}),
              enabled: nextRag.enabled,
              embedding_model: nextRag.embedding_model,
              max_vector_distance: nextRag.max_vector_distance,
              max_documents_length: nextRag.max_documents_length,
              max_retrieved_rag_chunks_count: nextRag.max_retrieved_rag_chunks_count,
            },
          },
        },
      },
    })

    await refreshData(documentIdsToRefresh)
    toast.success(successMessage)
  }

  const ensureRagIndexes = async (documentIds: string[], model: string) => {
    if (!documentIds.length) return

    const results = await Promise.allSettled(
      documentIds.map((documentId) => computeKnowledgeBaseRagIndex(documentId, model))
    )

    const failed = results.filter((r) => r.status === 'rejected').length
    if (failed > 0) {
      const succeeded = results.length - failed
      toast.warn(
        succeeded > 0
          ? `Procesamiento iniciado en ${pluralize(succeeded, 'documento', 'documentos')}. ${failed === 1 ? 'Uno no se pudo procesar' : `${failed} no se pudieron procesar`}: pueden ser muy cortos o tener un formato no compatible.`
          : 'No se pudo iniciar el procesamiento. Los documentos pueden ser muy cortos o tener un formato no compatible.'
      )
    }

    await Promise.all(
      documentIds.map((documentId) =>
        queryClient.invalidateQueries({ queryKey: ['knowledge-base-rag-index', documentId] })
      )
    )
  }

  const handleAttachDocument = async (
    createdDocument: Pick<KnowledgeBaseItem, 'id' | 'name'>,
    type: KnowledgeBaseItem['type']
  ) => {
    const usageMode: KnowledgeBaseUsageMode = ragDraft.enabled ? 'auto' : 'prompt'
    const nextKnowledgeBase = [
      ...knowledgeBase,
      {
        id: createdDocument.id,
        name: createdDocument.name,
        type,
        usage_mode: usageMode,
      },
    ]

    await persistAgentKnowledge(
      nextKnowledgeBase,
      ragDraft,
      'Documento agregado al agente',
      [createdDocument.id]
    )

    if (ragDraft.enabled) {
      await ensureRagIndexes([createdDocument.id], ragDraft.embedding_model)
    }
  }

  const handleFile = async (file: File) => {
    setIsUploading(true)
    try {
      const createdDocument = await createKnowledgeBaseDocumentFromFile(
        file,
        file.name.replace(/\.[^/.]+$/, '')
      )
      await handleAttachDocument(createdDocument, 'file')
    } catch (error) {
      toast.error(describeError(error, 'No pudimos subir el archivo. Intente de nuevo.'))
    } finally {
      setIsUploading(false)
    }
  }

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (file) {
      await handleFile(file)
    }
  }

  const handleUrlSubmit = async () => {
    if (!urlValue.trim()) return
    setIsUploading(true)
    try {
      const createdDocument = await createKnowledgeBaseDocumentFromUrl(
        urlValue.trim(),
        urlName.trim() || undefined
      )
      await handleAttachDocument(createdDocument, 'url')
      setUrlName('')
      setUrlValue('')
    } catch (error) {
      toast.error(describeError(error, 'No pudimos agregar la página. Revise la dirección e intente de nuevo.'))
    } finally {
      setIsUploading(false)
    }
  }

  const handleTextSubmit = async () => {
    if (!textValue.trim()) return
    setIsUploading(true)
    try {
      const createdDocument = await createKnowledgeBaseDocumentFromText(
        textValue.trim(),
        textName.trim() || 'Documento sin título'
      )
      await handleAttachDocument(createdDocument, 'text')
      setTextName('')
      setTextValue('')
    } catch (error) {
      toast.error(describeError(error, 'No pudimos crear el documento. Intente de nuevo.'))
    } finally {
      setIsUploading(false)
    }
  }

  const handleUsageModeChange = async (
    documentId: string,
    usageMode: KnowledgeBaseUsageMode
  ) => {
    setBusyDocId(documentId)
    try {
      const nextKnowledgeBase = knowledgeBase.map((document) =>
        document.id === documentId ? { ...document, usage_mode: usageMode } : document
      )
      await persistAgentKnowledge(nextKnowledgeBase, ragDraft, 'Uso del documento actualizado', [documentId])
    } catch (error) {
      toast.error(describeError(error, 'No pudimos actualizar el documento. Intente de nuevo.'))
    } finally {
      setBusyDocId(null)
    }
  }

  const handleDetachDocument = async (document: KnowledgeBaseItem) => {
    const accepted = await confirm({
      title: `¿Quitar «${document.name}» de este agente?`,
      description:
        'El agente dejará de usar este documento para responder. El documento seguirá guardado en su cuenta y podrá volver a agregarlo.',
      confirmLabel: 'Quitar documento',
      tone: 'danger',
    })
    if (!accepted) return

    const documentId = document.id
    setBusyDocId(documentId)
    try {
      const nextKnowledgeBase = knowledgeBase.filter((item) => item.id !== documentId)
      await persistAgentKnowledge(nextKnowledgeBase, ragDraft, 'Documento retirado del agente', [
        documentId,
      ])
    } catch (error) {
      toast.error(describeError(error, 'No pudimos retirar el documento. Intente de nuevo.'))
    } finally {
      setBusyDocId(null)
    }
  }

  const handleReindexDocument = async (documentId: string) => {
    setBusyDocId(documentId)
    try {
      await computeKnowledgeBaseRagIndex(documentId, ragDraft.embedding_model)
      await queryClient.invalidateQueries({ queryKey: ['knowledge-base-rag-index', documentId] })
      toast.success('Procesamiento del documento iniciado')
    } catch (error) {
      toast.error(describeError(error, 'No pudimos procesar el documento. Intente de nuevo.'))
    } finally {
      setBusyDocId(null)
    }
  }

  const handleSaveRag = async () => {
    setIsSavingRag(true)
    try {
      await persistAgentKnowledge(knowledgeBase, ragDraft, 'Búsqueda en documentos actualizada', [])
      if (ragDraft.enabled) {
        await ensureRagIndexes(
          knowledgeBase.map((document) => document.id),
          ragDraft.embedding_model
        )
      }
    } catch (error) {
      toast.error(describeError(error, 'No pudimos guardar la configuración. Intente de nuevo.'))
    } finally {
      setIsSavingRag(false)
    }
  }

  const docsSorted = [...knowledgeBase].sort((left, right) => left.name.localeCompare(right.name))

  const summary = [
    `${knowledgeBase.length} ${knowledgeBase.length === 1 ? 'documento' : 'documentos'}`,
    ragDraft.enabled ? `${indexedDocsCount} listos para consulta` : null,
    promptDocsCount > 0 ? `${promptDocsCount} siempre presentes` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="space-y-10">
      <section aria-labelledby={`${baseId}-add`} className="space-y-5">
        <SectionHeading
          id={`${baseId}-add`}
          title="Base de conocimiento"
          description="Documentos que el agente consulta para responder. Puede subir un archivo, enlazar una página web o pegar un texto."
        />

        <div role="group" aria-label="Tipo de documento" className="inline-flex rounded-lg border border-border-default bg-surface-muted p-1">
          {UPLOAD_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              aria-pressed={uploadMode === mode.id}
              onClick={() => setUploadMode(mode.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                uploadMode === mode.id
                  ? 'bg-surface text-primary-700 shadow-sm'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {uploadMode === 'file' && (
          <>
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              tabIndex={-1}
              aria-label="Elegir archivo"
              accept=".pdf,.txt,.doc,.docx,.md"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  handleFile(file)
                }
                event.target.value = ''
              }}
            />
            <button
              type="button"
              disabled={isUploading}
              aria-describedby={`${baseId}-formats`}
              onDragOver={(event) => {
                event.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={cn(
                'flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors disabled:cursor-wait',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2',
                dragOver
                  ? 'border-primary-600 bg-primary-50'
                  : 'border-border-strong bg-surface-muted hover:border-primary-300 hover:bg-primary-50/50',
              )}
            >
              <ArrowUpTrayIcon className="h-8 w-8 text-primary-600" aria-hidden="true" />
              <span className="mt-3 text-sm font-medium text-text-primary">
                {isUploading ? 'Subiendo documento…' : 'Arrastre un archivo aquí o haga clic para elegirlo'}
              </span>
              <span id={`${baseId}-formats`} className="mt-1 text-xs text-text-tertiary">
                PDF, TXT, DOC, DOCX o MD
              </span>
            </button>
          </>
        )}

        {uploadMode === 'url' && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-end">
            <Field label="Dirección de la página">
              {(control) => (
                <input
                  {...control}
                  type="url"
                  inputMode="url"
                  value={urlValue}
                  onChange={(event) => setUrlValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      handleUrlSubmit()
                    }
                  }}
                  placeholder="https://www.ejemplo.com/preguntas-frecuentes"
                  className={inputClass}
                />
              )}
            </Field>
            <Field label="Nombre (opcional)">
              {(control) => (
                <input
                  {...control}
                  type="text"
                  value={urlName}
                  onChange={(event) => setUrlName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      handleUrlSubmit()
                    }
                  }}
                  placeholder="Preguntas frecuentes"
                  className={inputClass}
                />
              )}
            </Field>
            <Button
              type="button"
              variant="secondary"
              onClick={handleUrlSubmit}
              isLoading={isUploading}
              disabled={!urlValue.trim()}
            >
              {isUploading ? 'Agregando…' : 'Agregar página'}
            </Button>
          </div>
        )}

        {uploadMode === 'text' && (
          <div className="space-y-4">
            <Field label="Nombre del documento">
              {(control) => (
                <input
                  {...control}
                  type="text"
                  value={textName}
                  onChange={(event) => setTextName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.preventDefault()
                  }}
                  placeholder="Horarios de atención"
                  className={inputClass}
                />
              )}
            </Field>
            <Field label="Contenido">
              {(control) => (
                <textarea
                  {...control}
                  rows={7}
                  value={textValue}
                  onChange={(event) => setTextValue(event.target.value)}
                  placeholder="Pegue aquí la información que el agente debe conocer…"
                  className={textareaClass}
                />
              )}
            </Field>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={handleTextSubmit}
                isLoading={isUploading}
                disabled={!textValue.trim()}
              >
                {isUploading ? 'Creando…' : 'Crear documento'}
              </Button>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby={`${baseId}-docs`} className="space-y-4 border-t border-border-default pt-8">
        <SectionHeading
          id={`${baseId}-docs`}
          title="Documentos del agente"
          description={
            docsSorted.length > 0 ? (
              <span className="tabular-nums">{summary}</span>
            ) : undefined
          }
        />

        {docsSorted.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-strong px-6 py-10 text-center">
            <p className="text-sm font-medium text-text-primary">Aún no hay documentos</p>
            <p className="mx-auto mt-1 max-w-[55ch] text-sm text-text-secondary">
              Agregue manuales, preguntas frecuentes o condiciones de sus productos para que el
              agente responda con información de su empresa.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-xl border border-border-default bg-surface">
            {docsSorted.map((document) => {
              const workspaceDoc = workspaceDocumentMap.get(document.id)
              const supportedUsages = workspaceDoc?.supported_usages ?? ['auto', 'prompt']
              const indexes = ragIndexMap.get(document.id) ?? []
              // Use saved model for status - don't mislead with draft model changes
              const statusIndex = indexes.find((i) => i.model === savedEmbeddingModel) ?? indexes[0]
              const rawStatus = ragDraft.enabled
                ? statusIndex?.status?.toLowerCase?.() ?? 'not_indexed'
                : 'disabled'
              const status = describeStatus(rawStatus)
              const size = formatBytes(workspaceDoc?.metadata?.size_bytes)
              const isBusy = busyDocId === document.id
              const usageId = `${baseId}-usage-${document.id}`

              return (
                <li key={document.id} className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <DocumentIcon type={document.type} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-text-primary">{document.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-tertiary">
                        <span>{TYPE_LABELS[document.type] ?? document.type}</span>
                        {size && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums">{size}</span>
                          </>
                        )}
                        <Badge variant={status.variant} size="sm">
                          {status.label}
                          {statusIndex?.progress_percentage !== undefined && rawStatus === 'processing' && (
                            <span className="tabular-nums">
                              {' '}
                              {Math.round(statusIndex.progress_percentage)} %
                            </span>
                          )}
                        </Badge>
                      </div>
                      {supportedUsages.length === 1 && supportedUsages[0] === 'prompt' && (
                        <p className="mt-1.5 text-xs text-text-tertiary">
                          Este documento es muy corto para consultarse por partes; el agente lo
                          tendrá siempre presente.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
                    <label htmlFor={usageId} className="sr-only">
                      Uso de «{document.name}» en las respuestas
                    </label>
                    <select
                      id={usageId}
                      value={document.usage_mode ?? (ragDraft.enabled ? 'auto' : 'prompt')}
                      disabled={isBusy}
                      onChange={(event) =>
                        handleUsageModeChange(
                          document.id,
                          event.target.value as KnowledgeBaseUsageMode
                        )
                      }
                      className={cn(inputClass, 'w-auto min-w-56 py-2')}
                    >
                      {(['auto', 'prompt'] as KnowledgeBaseUsageMode[]).map((mode) => (
                        <option key={mode} value={mode} disabled={!supportedUsages.includes(mode)}>
                          {USAGE_LABELS[mode]}
                        </option>
                      ))}
                    </select>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleReindexDocument(document.id)}
                      disabled={isBusy || !ragDraft.enabled}
                      aria-label={`Volver a procesar «${document.name}»`}
                      leftIcon={<ArrowPathIcon className="h-4 w-4" aria-hidden="true" />}
                    >
                      Volver a procesar
                    </Button>

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDetachDocument(document)}
                      disabled={isBusy}
                      aria-label={`Quitar «${document.name}» del agente`}
                      className="hover:bg-danger-50 hover:text-danger-700"
                      leftIcon={<TrashIcon className="h-4 w-4" aria-hidden="true" />}
                    >
                      Quitar
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {!isClient && (
        <AdvancedSection
          defaultOpen
          title="Búsqueda en documentos"
          description="Cómo busca el agente dentro de documentos extensos. Configuración técnica."
        >
          <SwitchField
            label="Búsqueda inteligente en documentos"
            description="Recomendada para documentos extensos: el agente consulta solo las partes relevantes de cada documento."
            checked={ragDraft.enabled}
            onChange={(next) =>
              setRagDraft((current) => ({
                ...current,
                enabled: next,
              }))
            }
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <Field
              label="Modelo de indexación"
              help="Modelo que prepara los documentos para la búsqueda."
            >
              {(control) => (
                <>
                  <select
                    {...control}
                    value={ragDraft.embedding_model}
                    onChange={(event) =>
                      setRagDraft((current) => ({
                        ...current,
                        embedding_model: event.target.value,
                      }))
                    }
                    className={inputClass}
                  >
                    {RAG_EMBEDDING_MODELS.map((model) => (
                      <option key={model.value} value={model.value}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                  {modelChanged && (
                    <p className="mt-1.5 text-xs text-warning-700">
                      Al guardar, todos los documentos se volverán a procesar con este modelo.
                    </p>
                  )}
                </>
              )}
            </Field>

            <SliderField
              label="Fragmentos consultados por pregunta"
              description="Cuántas partes de los documentos revisa el agente antes de responder."
              displayValue={String(ragDraft.max_retrieved_rag_chunks_count)}
              minLabel="1"
              maxLabel="20"
              min={1}
              max={20}
              step={1}
              value={ragDraft.max_retrieved_rag_chunks_count}
              onChange={(event) =>
                setRagDraft((current) => ({
                  ...current,
                  max_retrieved_rag_chunks_count: Number(event.target.value || 1),
                }))
              }
            />

            <SliderField
              label="Umbral de similitud"
              description="Distancia máxima permitida. Valores bajos exigen coincidencias más cercanas a la pregunta."
              displayValue={ragDraft.max_vector_distance.toFixed(2)}
              minLabel="Estricto"
              maxLabel="Amplio"
              min={0}
              max={1}
              step={0.05}
              value={ragDraft.max_vector_distance}
              onChange={(event) =>
                setRagDraft((current) => ({
                  ...current,
                  max_vector_distance: Number(event.target.value || 0),
                }))
              }
            />

            <SliderField
              label="Longitud máxima del contexto"
              description="Cantidad máxima de caracteres de los documentos que se usan en cada respuesta."
              displayValue={ragDraft.max_documents_length.toLocaleString('es-CO')}
              minLabel="1.000"
              maxLabel="100.000"
              min={1000}
              max={100000}
              step={1000}
              value={ragDraft.max_documents_length}
              onChange={(event) =>
                setRagDraft((current) => ({
                  ...current,
                  max_documents_length: Number(event.target.value || 1000),
                }))
              }
            />
          </div>

          <p className="text-xs leading-relaxed text-text-tertiary">
            El procesamiento puede tardar unos minutos en documentos grandes. Los archivos de menos
            de 500 bytes siempre se incluyen completos. Al guardar, los documentos del agente se
            vuelven a procesar con el modelo seleccionado.
          </p>

          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={handleSaveRag} isLoading={isSavingRag}>
              {isSavingRag ? 'Guardando…' : 'Guardar búsqueda'}
            </Button>
          </div>
        </AdvancedSection>
      )}

      {confirmDialog}
    </div>
  )
}
