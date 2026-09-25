import { useId, useRef, useState, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  ArrowPathIcon,
  CloudArrowUpIcon,
  DocumentTextIcon,
  TrashIcon,
  XMarkIcon,
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
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { KNOWLEDGE_ACCEPT, KNOWLEDGE_ACCEPT_LABEL, friendlyUploadError } from '../copy'

type Props = {
  agentId: string
  attachedDocuments: TextKnowledgeBaseDocument[]
}

type UploadIssue = { key: string; fileName: string; message: string }

function StatusBadge({ status }: { status: TextKnowledgeBaseDocument['index_status'] }) {
  if (status === 'indexed')
    return (
      <Badge variant="success" size="sm">
        Listo
      </Badge>
    )
  if (status === 'indexing')
    return (
      <Badge variant="info" size="sm">
        Procesando…
      </Badge>
    )
  return (
    <Badge variant="warning" size="sm">
      No se pudo procesar
    </Badge>
  )
}

export default function TextAgentKnowledgeBaseTab({ agentId, attachedDocuments }: Props) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileInputId = useId()
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState<string[]>([])
  const [issues, setIssues] = useState<UploadIssue[]>([])
  const [confirm, confirmDialog] = useConfirm()
  const { isSuperAdmin } = useCurrentUser()

  const attachedIds = new Set(attachedDocuments.map((d) => d.id))

  const { data, isLoading } = useQuery({
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
      toast.success('Documento actualizado en este agente')
      refresh()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const { mutate: detachDoc } = useMutation({
    mutationFn: (docId: string) => detachKnowledgeBaseDocument(agentId, docId),
    onSuccess: () => {
      toast.success('El agente ya no usará este documento')
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
      toast.success('Estamos procesando el documento de nuevo')
      refresh()
    },
    onError: (e: Error) => toast.error(friendlyUploadError(e)),
  })

  async function uploadFile(file: File) {
    const key = `${file.name}-${Date.now()}`
    setUploading((prev) => [...prev, key])
    try {
      const doc = await createTextKnowledgeBaseDocumentFromFile(file, file.name)
      await attachKnowledgeBaseDocument(agentId, doc.id, 'auto')
      toast.success(`«${file.name}» ya está disponible para el agente`)
      refresh()
    } catch (e) {
      setIssues((prev) => [...prev, { key, fileName: file.name, message: friendlyUploadError(e) }])
    } finally {
      setUploading((prev) => prev.filter((k) => k !== key))
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return
    setIssues([])
    for (const file of Array.from(files)) {
      await uploadFile(file)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    void handleFiles(e.dataTransfer.files)
  }

  const handleDelete = async (doc: TextKnowledgeBaseDocument) => {
    const accepted = await confirm({
      title: `¿Eliminar «${doc.name}»?`,
      description:
        'El documento se borrará de la biblioteca y ningún agente podrá consultarlo. Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar documento',
      tone: 'danger',
    })
    if (accepted) deleteDoc(doc.id)
  }

  const isUploading = uploading.length > 0

  return (
    <div className="max-w-3xl space-y-8">
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Base de conocimiento</h2>
          <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-text-secondary">
            Suba los documentos con los que el agente debe responder: condiciones de pólizas,
            preguntas frecuentes, tarifas o procesos. En cada conversación, el agente consulta la
            parte del documento que responde la pregunta del cliente.
          </p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors duration-200 ease-out ${
            isDragging ? 'border-primary-600 bg-primary-50' : 'border-border-strong bg-surface'
          }`}
        >
          {isUploading ? (
            <>
              <ArrowPathIcon className="h-7 w-7 animate-spin text-primary-600" aria-hidden="true" />
              <p className="text-sm font-medium text-text-primary" role="status">
                Cargando {uploading.length} {uploading.length === 1 ? 'archivo' : 'archivos'}…
              </p>
            </>
          ) : (
            <>
              <CloudArrowUpIcon className="h-7 w-7 text-primary-600" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-text-primary">
                  Arrastre sus archivos aquí o
                </p>
                <p className="mt-1 text-xs text-text-tertiary">{KNOWLEDGE_ACCEPT_LABEL}</p>
              </div>
              <label htmlFor={fileInputId} className="sr-only">
                Seleccionar documentos para la base de conocimiento
              </label>
              <input
                ref={fileInputRef}
                id={fileInputId}
                type="file"
                accept={KNOWLEDGE_ACCEPT}
                multiple
                className="sr-only"
                onChange={(e) => void handleFiles(e.target.files)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                Seleccionar archivos
              </Button>
            </>
          )}
        </div>

        {issues.length > 0 && (
          <div role="alert" className="rounded-lg bg-danger-50 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <ul className="space-y-1 text-sm text-danger-700">
                {issues.map((issue) => (
                  <li key={issue.key}>
                    <span className="font-medium">«{issue.fileName}»:</span> {issue.message}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setIssues([])}
                aria-label="Cerrar aviso"
                className="-mr-1 rounded-md p-1 text-danger-700 transition-colors hover:bg-danger-100"
              >
                <XMarkIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="flex items-baseline gap-2 text-base font-semibold text-text-primary">
          Documentos disponibles
          {workspaceDocs.length > 0 && (
            <span className="text-sm font-normal tabular-nums text-text-tertiary">{workspaceDocs.length}</span>
          )}
        </h3>

        {isLoading ? (
          <div className="space-y-2">
            <div className="skeleton h-16" />
            <div className="skeleton h-16" />
          </div>
        ) : workspaceDocs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-strong px-6 py-8 text-center text-sm text-text-tertiary">
            Aún no hay documentos. Suba el primero para que el agente responda con su información.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle rounded-xl border border-border-default bg-surface">
            {workspaceDocs.map((doc) => {
              const attached = attachedIds.has(doc.id)
              const attachedDoc = attachedDocuments.find((d) => d.id === doc.id)
              const checkboxId = `kb-use-${doc.id}`

              return (
                <li key={doc.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:px-5">
                  <DocumentTextIcon
                    className={`hidden h-5 w-5 shrink-0 sm:block ${attached ? 'text-primary-600' : 'text-text-muted'}`}
                    aria-hidden="true"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-all text-sm font-semibold text-text-primary">{doc.name}</p>
                      <StatusBadge status={doc.index_status} />
                      {isSuperAdmin && doc.chunk_count > 0 && (
                        <span className="text-xs tabular-nums text-text-tertiary">
                          {doc.chunk_count} {doc.chunk_count === 1 ? 'fragmento' : 'fragmentos'}
                        </span>
                      )}
                    </div>
                    {doc.content_preview && (
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-secondary">
                        {doc.content_preview}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                      <label htmlFor={checkboxId} className="inline-flex cursor-pointer items-center gap-2 text-sm text-text-primary">
                        <input
                          id={checkboxId}
                          type="checkbox"
                          checked={attached}
                          onChange={() =>
                            attached ? detachDoc(doc.id) : attachDoc({ docId: doc.id, mode: 'auto' })
                          }
                          className="h-4 w-4 accent-primary-700"
                        />
                        Usar en este agente
                      </label>

                      {attached && (
                        <select
                          aria-label={`Cómo usa el agente «${doc.name}»`}
                          value={attachedDoc?.usage_mode ?? 'auto'}
                          onChange={(e) =>
                            attachDoc({
                              docId: doc.id,
                              mode: e.target.value as 'auto' | 'prompt',
                            })
                          }
                          className="h-8 rounded-lg border border-border-default bg-surface px-2 text-xs text-text-primary focus:border-primary-600"
                        >
                          <option value="auto">Lo consulta cuando lo necesita</option>
                          <option value="prompt">Lo tiene siempre presente</option>
                        </select>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1 sm:self-start">
                    {doc.index_status === 'failed' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        leftIcon={<ArrowPathIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                        onClick={() => reindex(doc.id)}
                      >
                        Reintentar
                      </Button>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleDelete(doc)}
                      aria-label={`Eliminar ${doc.name}`}
                      title="Eliminar"
                      className="rounded-lg p-2 text-text-tertiary transition-colors hover:bg-danger-50 hover:text-danger-700"
                    >
                      <TrashIcon className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {confirmDialog}
    </div>
  )
}
