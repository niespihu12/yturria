import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  CheckCircleIcon,
  ArrowUpTrayIcon,
  BookOpenIcon,
  CircleStackIcon,
  CloudArrowUpIcon,
  DocumentTextIcon,
  LinkIcon,
  SparklesIcon,
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
} from '@/api/ElevenLabsAPI'
import {
  RAG_EMBEDDING_MODELS,
  type AgentDetail,
  type KnowledgeBaseItem,
  type KnowledgeBaseUsageMode,
} from '@/types/agent'

type Props = {
  agentId: string
  agent: AgentDetail
  knowledgeBase: KnowledgeBaseItem[]
  onUpdate: () => void
}

type UploadMode = 'file' | 'url' | 'text'

type RagDraft = {
  enabled: boolean
  embedding_model: string
  max_vector_distance: number
  max_documents_length: number
  max_retrieved_rag_chunks_count: number
}

const inputClass =
  'w-full rounded-xl border border-[#e4e0f5] bg-white px-3.5 py-2.5 text-sm text-black placeholder:text-black/40 focus:border-[#271173] focus:outline-none transition-colors'

const sliderClass =
  'w-full h-1.5 rounded-full appearance-none bg-[#e4e0f5] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#271173] [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-md'

function formatBytes(value?: number) {
  if (!value) return 'Tamano no disponible'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function statusTone(status: string) {
  switch (status) {
    case 'succeeded':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700'
    case 'processing':
    case 'created':
      return 'border-amber-200 bg-amber-50 text-amber-700'
    case 'failed':
      return 'border-red-200 bg-red-50 text-red-700'
    case 'disabled':
      return 'border-gray-200 bg-gray-50 text-black/50'
    default:
      return 'border-[#e4e0f5] bg-[#ede9ff] text-[#271173]'
  }
}

function typeTone(type: string) {
  switch (type) {
    case 'file':
      return 'bg-blue-50 text-blue-700 border-blue-200'
    case 'url':
      return 'bg-purple-50 text-purple-700 border-purple-200'
    case 'text':
      return 'bg-amber-50 text-amber-700 border-amber-200'
    default:
      return 'bg-[#f5f3ff] text-black/60 border-[#e4e0f5]'
  }
}

function normalizeStatusLabel(status: string) {
  if (status === 'not_indexed') return 'Sin indice'
  if (status === 'disabled') return 'RAG apagado'
  if (status === 'processing') return 'Indexando'
  if (status === 'succeeded') return 'Listo'
  if (status === 'created') return 'Creado'
  if (status === 'failed') return 'Fallo'
  return status
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

function TogglePill({
  enabled,
  onClick,
}: {
  enabled: boolean
  onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`relative h-5 w-10 cursor-pointer rounded-full transition-colors duration-200 ${
        enabled ? 'bg-[#271173]' : 'bg-black/20'
      }`}
    >
      <div
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
          enabled ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </div>
  )
}

export default function KnowledgeBaseTab({ agentId, agent, knowledgeBase, onUpdate }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
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
          ? `Indexacion iniciada en ${succeeded} documento(s). ${failed} no pudieron indexarse (pueden ser muy pequenos o estar en formato no soportado).`
          : 'No se pudo iniciar la indexacion. Los documentos pueden ser muy pequenos o estar en formato no soportado por RAG.'
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
      const message = error instanceof Error ? error.message : 'No se pudo subir el archivo'
      toast.error(message)
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
      const message = error instanceof Error ? error.message : 'No se pudo agregar la URL'
      toast.error(message)
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
        textName.trim() || 'Documento sin titulo'
      )
      await handleAttachDocument(createdDocument, 'text')
      setTextName('')
      setTextValue('')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo crear el documento'
      toast.error(message)
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
      await persistAgentKnowledge(nextKnowledgeBase, ragDraft, 'Modo de uso actualizado', [documentId])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo actualizar el documento'
      toast.error(message)
    } finally {
      setBusyDocId(null)
    }
  }

  const handleDetachDocument = async (documentId: string) => {
    setBusyDocId(documentId)
    try {
      const nextKnowledgeBase = knowledgeBase.filter((document) => document.id !== documentId)
      await persistAgentKnowledge(nextKnowledgeBase, ragDraft, 'Documento retirado del agente', [
        documentId,
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo retirar el documento'
      toast.error(message)
    } finally {
      setBusyDocId(null)
    }
  }

  const handleReindexDocument = async (documentId: string) => {
    setBusyDocId(documentId)
    try {
      await computeKnowledgeBaseRagIndex(documentId, ragDraft.embedding_model)
      await queryClient.invalidateQueries({ queryKey: ['knowledge-base-rag-index', documentId] })
      toast.success('Indexacion RAG iniciada')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo indexar el documento'
      toast.error(message)
    } finally {
      setBusyDocId(null)
    }
  }

  const handleSaveRag = async () => {
    setIsSavingRag(true)
    try {
      await persistAgentKnowledge(knowledgeBase, ragDraft, 'Configuracion RAG actualizada', [])
      if (ragDraft.enabled) {
        await ensureRagIndexes(
          knowledgeBase.map((document) => document.id),
          ragDraft.embedding_model
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar RAG'
      toast.error(message)
    } finally {
      setIsSavingRag(false)
    }
  }

  const docsSorted = [...knowledgeBase].sort((left, right) => left.name.localeCompare(right.name))

  return (
    <div className="space-y-5">
      {/* Header stats */}
      <section className="overflow-hidden rounded-[28px] border border-[#e4e0f5] bg-white shadow-sm">
        <div className="flex flex-col gap-6 px-6 py-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#e4e0f5] bg-[#ede9ff] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#271173]">
              <SparklesIcon className="h-3.5 w-3.5" />
              Knowledge Base
            </div>
            <h2 className="text-xl font-semibold text-black">Documentos listos para respuestas con contexto</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-black/60">
              Segun la documentacion oficial de ElevenLabs, los documentos se crean primero en la
              knowledge base del workspace y luego se vinculan al agente.
            </p>
          </div>

          <div className="grid w-full gap-3 sm:grid-cols-3 lg:w-95">
            {[
              {
                label: 'Documentos',
                value: knowledgeBase.length,
                sub: 'Adjuntos al agente',
                icon: BookOpenIcon,
              },
              {
                label: 'RAG listo',
                value: indexedDocsCount,
                sub: 'Documentos indexados',
                icon: SparklesIcon,
              },
              {
                label: 'Prompt fijo',
                value: promptDocsCount,
                sub: 'Modo prompt',
                icon: CircleStackIcon,
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="relative overflow-hidden rounded-2xl border border-[#e4e0f5] bg-linear-to-br from-[#f5f3ff] to-white p-4"
              >
                <stat.icon className="pointer-events-none absolute -bottom-3 -right-3 h-16 w-16 text-[#271173] opacity-5" />
                <p className="text-xs uppercase tracking-[0.18em] text-black/50">{stat.label}</p>
                <p className="mt-2 text-3xl font-bold text-[#271173]">{stat.value}</p>
                <p className="mt-1 text-xs text-black/50">{stat.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Upload section */}
      <section className="rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-black">Agregar conocimiento</h3>
            <p className="mt-1 text-xs text-black/50">
              Puedes montar archivos, URLs o texto libre y adjuntarlo al agente.
            </p>
          </div>
          <div className="inline-flex rounded-xl border border-[#e4e0f5] bg-[#f5f3ff] p-1">
            {(['file', 'url', 'text'] as UploadMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setUploadMode(mode)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  uploadMode === mode
                    ? 'bg-[#271173] text-white shadow-sm'
                    : 'text-black/60 hover:text-[#271173]'
                }`}
              >
                {mode === 'file' ? (
                  <ArrowUpTrayIcon className="h-3.5 w-3.5" />
                ) : mode === 'url' ? (
                  <LinkIcon className="h-3.5 w-3.5" />
                ) : (
                  <DocumentTextIcon className="h-3.5 w-3.5" />
                )}
                {mode === 'file' ? 'Archivo' : mode === 'url' ? 'URL' : 'Texto'}
              </button>
            ))}
          </div>
        </div>

        {uploadMode === 'file' && (
          <div
            onDragOver={(event) => {
              event.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all ${
              dragOver
                ? 'border-[#271173] bg-[#ede9ff] ring-2 ring-[#271173] ring-offset-2'
                : 'border-[#e4e0f5] bg-[#f5f3ff] hover:border-[#271173]/40 hover:bg-[#ede9ff]/50'
            }`}
          >
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".pdf,.txt,.doc,.docx,.md"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) {
                  handleFile(file)
                }
                event.target.value = ''
              }}
            />
            <ArrowUpTrayIcon
              className={`mx-auto h-10 w-10 text-[#271173]/50 ${dragOver ? 'animate-bounce' : ''}`}
            />
            <p className="mt-3 text-sm font-medium text-black">
              {isUploading ? 'Subiendo documento...' : 'Arrastra un archivo o haz clic para abrir'}
            </p>
            <p className="mt-1 text-xs text-black/45">PDF, TXT, DOC, DOCX o MD</p>
          </div>
        )}

        {uploadMode === 'url' && (
          <div className="grid gap-3 md:grid-cols-[1.3fr_0.8fr_auto]">
            <input
              type="url"
              value={urlValue}
              onChange={(event) => setUrlValue(event.target.value)}
              placeholder="https://docs.tuempresa.com/manual"
              className={inputClass}
            />
            <input
              type="text"
              value={urlName}
              onChange={(event) => setUrlName(event.target.value)}
              placeholder="Nombre opcional"
              className={inputClass}
            />
            <button
              type="button"
              onClick={handleUrlSubmit}
              disabled={isUploading || !urlValue.trim()}
              className="rounded-xl bg-[#271173] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isUploading ? 'Agregando...' : 'Agregar URL'}
            </button>
          </div>
        )}

        {uploadMode === 'text' && (
          <div className="space-y-3">
            <input
              type="text"
              value={textName}
              onChange={(event) => setTextName(event.target.value)}
              placeholder="Nombre del documento"
              className={inputClass}
            />
            <textarea
              rows={7}
              value={textValue}
              onChange={(event) => setTextValue(event.target.value)}
              placeholder="Pega aqui el contenido que quieres que el agente recuerde..."
              className={`${inputClass} resize-none`}
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleTextSubmit}
                disabled={isUploading || !textValue.trim()}
                className="rounded-xl bg-[#271173] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isUploading ? 'Creando...' : 'Crear documento'}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Documents list */}
      <section className="rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-black">Documentos vinculados al agente</h3>
            <p className="mt-1 text-xs text-black/50">
              Administra el modo de uso y el estado de indexacion sin salir del detalle del agente.
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#e4e0f5] bg-[#f5f3ff] px-3 py-1.5 text-xs text-black/60">
            <CircleStackIcon className="h-3.5 w-3.5 text-[#271173]" />
            Workspace docs: {workspaceKnowledgeBase?.documents?.length ?? 0}
          </div>
        </div>

        {docsSorted.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#e4e0f5] bg-[#f5f3ff] px-6 py-10 text-center">
            <BookOpenIcon className="mx-auto h-10 w-10 text-black/30" />
            <p className="mt-3 text-sm font-medium text-black">Todavia no hay documentos montados</p>
            <p className="mt-1 text-xs text-black/45">
              Sube el primero y luego activa RAG si quieres respuestas por recuperacion semantica.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {docsSorted.map((document) => {
              const workspaceDoc = workspaceDocumentMap.get(document.id)
              const supportedUsages = workspaceDoc?.supported_usages ?? ['auto', 'prompt']
              const indexes = ragIndexMap.get(document.id) ?? []
              // Use saved model for status — don't mislead with draft model changes
              const statusIndex = indexes.find((i) => i.model === savedEmbeddingModel) ?? indexes[0]
              const rawStatus = ragDraft.enabled
                ? statusIndex?.status?.toLowerCase?.() ?? 'not_indexed'
                : 'disabled'

              return (
                <div
                  key={document.id}
                  className="rounded-2xl border border-[#e4e0f5] bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-start gap-3">
                        <div className="rounded-xl bg-[#ede9ff] p-2">
                          {document.type === 'url' ? (
                            <LinkIcon className="h-5 w-5 text-[#271173]" />
                          ) : document.type === 'text' ? (
                            <CloudArrowUpIcon className="h-5 w-5 text-[#271173]" />
                          ) : (
                            <DocumentTextIcon className="h-5 w-5 text-[#271173]" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-black">{document.name}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-black/50">
                            <span
                              className={`rounded-full border px-2 py-1 uppercase tracking-[0.16em] ${typeTone(document.type)}`}
                            >
                              {document.type}
                            </span>
                            <span>{formatBytes(workspaceDoc?.metadata?.size_bytes)}</span>
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-1 ${statusTone(rawStatus)}`}
                            >
                              {rawStatus === 'succeeded' && (
                                <span className="relative mr-1 inline-flex h-3 w-3 items-center justify-center">
                                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/70 animate-[ping_1s_ease-in-out_1]" />
                                  <CheckCircleIcon className="relative h-3 w-3 text-emerald-700" />
                                </span>
                              )}
                              {normalizeStatusLabel(rawStatus)}
                            </span>
                            {statusIndex?.progress_percentage !== undefined &&
                              rawStatus === 'processing' && (
                                <span>{Math.round(statusIndex.progress_percentage)}%</span>
                              )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 lg:min-w-[320px]">
                      <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
                        <select
                          value={document.usage_mode ?? (ragDraft.enabled ? 'auto' : 'prompt')}
                          disabled={busyDocId === document.id}
                          onChange={(event) =>
                            handleUsageModeChange(
                              document.id,
                              event.target.value as KnowledgeBaseUsageMode
                            )
                          }
                          className={inputClass}
                        >
                          {(['auto', 'prompt'] as KnowledgeBaseUsageMode[]).map((mode) => (
                            <option
                              key={mode}
                              value={mode}
                              disabled={!supportedUsages.includes(mode)}
                            >
                              {mode === 'auto' ? 'Auto / RAG' : 'Prompt fijo'}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          onClick={() => handleReindexDocument(document.id)}
                          disabled={busyDocId === document.id || !ragDraft.enabled}
                          className="rounded-xl border border-[#e4e0f5] bg-[#ede9ff] px-3 py-2.5 text-sm font-medium text-[#271173] transition-colors hover:bg-[#e0d9ff] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Reindexar
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDetachDocument(document.id)}
                          disabled={busyDocId === document.id}
                          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <TrashIcon className="h-4 w-4" />
                            Quitar
                          </span>
                        </button>
                      </div>

                      {supportedUsages.length === 1 && supportedUsages[0] === 'prompt' && (
                        <p className="text-xs text-amber-600">
                          Este documento solo admite modo prompt. ElevenLabs no lo puede indexar
                          para RAG en su estado actual.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* RAG Config */}
      <section className="rounded-2xl border border-[#e4e0f5] bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-black">Configuracion RAG</h3>
            <p className="mt-1 text-xs text-black/50">
              ElevenLabs recomienda RAG para bases grandes y deja el modo prompt para contexto
              critico o documentos pequenos.
            </p>
          </div>

          <div className="inline-flex items-center gap-3 rounded-xl border border-[#e4e0f5] bg-white px-3 py-2">
            <div>
              <p className="text-xs font-semibold text-black">
                {ragDraft.enabled ? 'RAG activado' : 'RAG desactivado'}
              </p>
              <p className="text-[11px] text-black/45">Activa recuperacion semantica en respuestas</p>
            </div>
            <TogglePill
              enabled={ragDraft.enabled}
              onClick={() =>
                setRagDraft((current) => ({
                  ...current,
                  enabled: !current.enabled,
                }))
              }
            />
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-black/60">
              Embedding model
            </label>
            <select
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
              <p className="mt-1.5 text-xs text-amber-600">
                Al guardar, todos los documentos seran reindexados con este modelo.
              </p>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-black">Chunks recuperados</p>
                <p className="text-xs text-black/50">Numero de bloques recuperados por consulta</p>
              </div>
              <span className="min-w-12 rounded-lg bg-[#ede9ff] px-2.5 py-1 text-center text-sm font-semibold text-[#271173]">
                {ragDraft.max_retrieved_rag_chunks_count}
              </span>
            </div>
            <input
              type="range"
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
              className={sliderClass}
            />
            <div className="mt-1 flex justify-between text-xs text-black/40">
              <span>1</span>
              <span>20</span>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-black">Distancia vectorial maxima</p>
                <p className="text-xs text-black/50">Umbral de distancia para recuperar contexto</p>
              </div>
              <span className="min-w-12 rounded-lg bg-[#ede9ff] px-2.5 py-1 text-center text-sm font-semibold text-[#271173]">
                {ragDraft.max_vector_distance.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
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
              className={sliderClass}
            />
            <div className="mt-1 flex justify-between text-xs text-black/40">
              <span>0.00</span>
              <span>1.00</span>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-black">Longitud maxima del contexto</p>
                <p className="text-xs text-black/50">Limite de caracteres del contexto recuperado</p>
              </div>
              <span className="min-w-16 rounded-lg bg-[#ede9ff] px-2.5 py-1 text-center text-sm font-semibold text-[#271173]">
                {ragDraft.max_documents_length}
              </span>
            </div>
            <input
              type="range"
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
              className={sliderClass}
            />
            <div className="mt-1 flex justify-between text-xs text-black/40">
              <span>1000</span>
              <span>100000</span>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-[#e4e0f5] bg-[#f5f3ff] px-4 py-3 text-xs leading-6 text-black/50">
          Indexing no es instantaneo. ElevenLabs indica que puede tardar unos minutos en documentos
          grandes, y los archivos menores a 500 bytes se quedan en modo prompt.
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-black/50">
            Al guardar, tambien se intentan reindexar los documentos del agente con el modelo
            seleccionado.
          </p>
          <button
            type="button"
            onClick={handleSaveRag}
            disabled={isSavingRag}
            className="rounded-xl bg-[#271173] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSavingRag ? 'Guardando...' : 'Guardar configuracion RAG'}
          </button>
        </div>
      </section>
    </div>
  )
}
