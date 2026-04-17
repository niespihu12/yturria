import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  ArrowPathIcon,
  CheckCircleIcon,
  CloudArrowUpIcon,
  DocumentTextIcon,
  ExclamationCircleIcon,
  TrashIcon,
  ClockIcon,
} from '@heroicons/react/24/outline'
import {
  attachKnowledgeBaseDocument,
  createTextKnowledgeBaseDocumentFromFile,
  deleteTextKnowledgeBaseDocument,
  detachKnowledgeBaseDocument,
  listTextKnowledgeBaseDocuments,
  reindexKnowledgeBaseDocument,
} from '@/api/TextAgentsAPI'
import type { TextKnowledgeBaseDocument } from '@/types/textAgent'

type Props = {
  agentId: string
  attachedDocuments: TextKnowledgeBaseDocument[]
}

const ACCEPTED = '.txt,.md,.json,.csv,.html,.xml'
const ACCEPTED_LABEL = 'TXT · MD · JSON · CSV · HTML · XML'

function IndexStatusBadge({ status }: { status: TextKnowledgeBaseDocument['index_status'] }) {
  if (status === 'indexed')
    return (
      <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
        <CheckCircleIcon className="h-3 w-3" />
        Indexado
      </span>
    )
  if (status === 'indexing')
    return (
      <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
        <ClockIcon className="h-3 w-3 animate-pulse" />
        Indexando...
      </span>
    )
  return (
    <span className="flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
      <ExclamationCircleIcon className="h-3 w-3" />
      Error
    </span>
  )
}



export default function TextAgentKnowledgeBaseTab({ agentId, attachedDocuments }: Props) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState<string[]>([])

  const attachedIds = new Set(attachedDocuments.map((d) => d.id))

  const { data } = useQuery({
    queryKey: ['text-kb-documents'],
    queryFn: listTextKnowledgeBaseDocuments,
  })

  const workspaceDocs = data?.documents ?? []

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['text-agent', agentId] })
    queryClient.invalidateQueries({ queryKey: ['text-kb-documents'] })
  }

  const { mutate: attachDoc } = useMutation({
    mutationFn: ({ docId, mode }: { docId: string; mode: 'auto' | 'prompt' }) =>
      attachKnowledgeBaseDocument(agentId, docId, mode),
    onSuccess: () => {
      toast.success('Documento adjuntado al agente')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const { mutate: detachDoc } = useMutation({
    mutationFn: (docId: string) => detachKnowledgeBaseDocument(agentId, docId),
    onSuccess: () => {
      toast.success('Documento retirado del agente')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const { mutate: deleteDoc } = useMutation({
    mutationFn: (docId: string) => deleteTextKnowledgeBaseDocument(docId),
    onSuccess: () => {
      toast.success('Documento eliminado')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const { mutate: reindex } = useMutation({
    mutationFn: (docId: string) => reindexKnowledgeBaseDocument(docId),
    onSuccess: () => {
      toast.success('Documento re-indexado')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  async function uploadFile(file: File) {
    const key = file.name + Date.now()
    setUploading((prev) => [...prev, key])
    try {
      const doc = await createTextKnowledgeBaseDocumentFromFile(file, file.name)
      await attachKnowledgeBaseDocument(agentId, doc.id, 'auto')
      toast.success(`"${file.name}" subido e indexado`)
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al subir archivo')
    } finally {
      setUploading((prev) => prev.filter((k) => k !== key))
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return
    for (const file of Array.from(files)) {
      await uploadFile(file)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  const isUploading = uploading.length > 0

  return (
    <div className="max-w-4xl space-y-6">
      {/* Explanation banner */}
      <div className="rounded-2xl border border-[#e4e0f5] bg-linear-to-br from-[#f5f3ff] to-white p-5">
        <div className="flex gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#271173]">
            <DocumentTextIcon className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-black">Base de conocimiento RAG</p>
            <p className="mt-1 text-xs leading-relaxed text-black/60">
              Los documentos subidos se procesan, dividen en fragmentos semánticos y se indexan.
              Durante el chat, el agente recupera automáticamente el contexto más relevante para
              cada pregunta.
            </p>
          </div>
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed py-12 text-center transition-colors duration-200 ease-out ${
          isDragging
            ? 'border-[#271173] bg-[#ede9ff]'
            : 'border-[#d4cfee] bg-[#fafafa] hover:border-[#271173] hover:bg-[#f5f3ff]'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED}
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        {isUploading ? (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#271173]">
              <ArrowPathIcon className="h-6 w-6 animate-spin text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-black">
                Subiendo y procesando {uploading.length} archivo{uploading.length > 1 ? 's' : ''}...
              </p>
              <p className="mt-0.5 text-xs text-black/50">El archivo se indexará automáticamente</p>
            </div>
          </>
        ) : (
          <>
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-2xl transition-colors ${
                isDragging ? 'bg-[#271173]' : 'bg-[#ede9ff]'
              }`}
            >
              <CloudArrowUpIcon
                className={`h-6 w-6 transition-colors ${isDragging ? 'text-white' : 'text-[#271173]'}`}
              />
            </div>
            <div>
              <p className="text-sm font-semibold text-black">
                Arrastra archivos aquí o haz clic para seleccionar
              </p>
              <p className="mt-0.5 text-xs text-black/50">{ACCEPTED_LABEL}</p>
            </div>
          </>
        )}
      </div>

      {/* Documents list */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-black">
            Documentos del workspace
            {workspaceDocs.length > 0 && (
              <span className="ml-2 rounded-full bg-[#ede9ff] px-2 py-0.5 text-xs font-semibold text-[#271173]">
                {workspaceDocs.length}
              </span>
            )}
          </h3>
        </div>

        {workspaceDocs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#d4cfee] bg-[#fafafa] py-10 text-center">
            <p className="text-sm text-black/50">No hay documentos todavía. Sube el primero.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {workspaceDocs.map((doc) => {
              const attached = attachedIds.has(doc.id)
              const attachedDoc = attachedDocuments.find((d) => d.id === doc.id)

              return (
                <div
                  key={doc.id}
                  className={`overflow-hidden rounded-xl border bg-white transition-colors ${
                    attached ? 'border-[#271173]/30' : 'border-[#e4e0f5]'
                  }`}
                >
                  <div className="flex flex-wrap items-start gap-3 px-5 py-4">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        attached ? 'bg-[#271173]' : 'bg-[#ede9ff]'
                      }`}
                    >
                      <DocumentTextIcon
                        className={`h-4 w-4 ${attached ? 'text-white' : 'text-[#271173]'}`}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-black">{doc.name}</p>
                        <IndexStatusBadge status={doc.index_status} />
                        {doc.chunk_count > 0 && (
                          <span className="text-[10px] text-black/40">
                            {doc.chunk_count} fragmento{doc.chunk_count !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-black/40">{doc.source_value}</p>
                      {doc.content_preview && (
                        <p className="mt-1 line-clamp-2 text-xs text-black/60">
                          {doc.content_preview}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {attached && (
                        <select
                          value={attachedDoc?.usage_mode ?? 'auto'}
                          onChange={(e) =>
                            attachDoc({
                              docId: doc.id,
                              mode: e.target.value as 'auto' | 'prompt',
                            })
                          }
                          className="rounded-lg border border-[#e4e0f5] bg-white px-2 py-1 text-xs text-black focus:border-[#271173] focus:outline-none"
                        >
                          <option value="auto">Auto RAG</option>
                          <option value="prompt">En prompt</option>
                        </select>
                      )}

                      {doc.index_status === 'failed' && (
                        <button
                          type="button"
                          onClick={() => reindex(doc.id)}
                          className="rounded-lg border border-amber-200 p-1.5 text-amber-600 transition-colors hover:bg-amber-50"
                          title="Re-indexar"
                        >
                          <ArrowPathIcon className="h-3.5 w-3.5" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() =>
                          attached
                            ? detachDoc(doc.id)
                            : attachDoc({ docId: doc.id, mode: 'auto' })
                        }
                        className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                          attached
                            ? 'border-[#271173]/30 bg-[#ede9ff] text-[#271173] hover:bg-[#d4cfee]'
                            : 'border-[#e4e0f5] text-black/60 hover:border-[#271173]/30 hover:bg-[#f5f3ff] hover:text-[#271173]'
                        }`}
                      >
                        {attached ? 'Adjunto ✓' : 'Adjuntar'}
                      </button>

                      <button
                        type="button"
                        onClick={() => deleteDoc(doc.id)}
                        className="rounded-lg border border-rose-200 p-1.5 text-rose-500 transition-colors hover:bg-rose-50"
                        title="Eliminar"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
