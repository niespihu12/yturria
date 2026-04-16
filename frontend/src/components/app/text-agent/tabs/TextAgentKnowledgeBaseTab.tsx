import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import {
  attachKnowledgeBaseDocument,
  createTextKnowledgeBaseDocumentFromFile,
  createTextKnowledgeBaseDocumentFromText,
  createTextKnowledgeBaseDocumentFromUrl,
  deleteTextKnowledgeBaseDocument,
  detachKnowledgeBaseDocument,
  listTextKnowledgeBaseDocuments,
} from '@/api/TextAgentsAPI'
import type { TextKnowledgeBaseDocument } from '@/types/textAgent'

type Props = {
  agentId: string
  attachedDocuments: TextKnowledgeBaseDocument[]
}

export default function TextAgentKnowledgeBaseTab({
  agentId,
  attachedDocuments,
}: Props) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [url, setUrl] = useState('')
  const [urlName, setUrlName] = useState('')
  const [textName, setTextName] = useState('')
  const [textContent, setTextContent] = useState('')

  const attachedIds = new Set(attachedDocuments.map((item) => item.id))

  const { data } = useQuery({
    queryKey: ['text-kb-documents'],
    queryFn: listTextKnowledgeBaseDocuments,
  })

  const workspaceDocuments = data?.documents ?? []
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['text-agent', agentId] })
    queryClient.invalidateQueries({ queryKey: ['text-kb-documents'] })
  }

  const { mutate: createTextDoc, isPending: isCreatingText } = useMutation({
    mutationFn: () =>
      createTextKnowledgeBaseDocumentFromText({
        name: textName.trim() || undefined,
        text: textContent.trim(),
      }),
    onSuccess: async (doc) => {
      await attachKnowledgeBaseDocument(agentId, doc.id, 'auto')
      toast.success('Documento de texto creado y adjuntado')
      setTextName('')
      setTextContent('')
      refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const { mutate: createUrlDoc, isPending: isCreatingUrl } = useMutation({
    mutationFn: () =>
      createTextKnowledgeBaseDocumentFromUrl({
        name: urlName.trim() || undefined,
        url: url.trim(),
      }),
    onSuccess: async (doc) => {
      await attachKnowledgeBaseDocument(agentId, doc.id, 'auto')
      toast.success('Documento URL creado y adjuntado')
      setUrl('')
      setUrlName('')
      refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const { mutate: attachDoc } = useMutation({
    mutationFn: ({ documentId, usageMode }: { documentId: string; usageMode: 'auto' | 'prompt' }) =>
      attachKnowledgeBaseDocument(agentId, documentId, usageMode),
    onSuccess: () => {
      toast.success('Documento adjuntado')
      refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const { mutate: detachDoc } = useMutation({
    mutationFn: (documentId: string) => detachKnowledgeBaseDocument(agentId, documentId),
    onSuccess: () => {
      toast.success('Documento retirado')
      refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const { mutate: deleteDoc } = useMutation({
    mutationFn: (documentId: string) => deleteTextKnowledgeBaseDocument(documentId),
    onSuccess: () => {
      toast.success('Documento eliminado')
      refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const { mutate: uploadFile } = useMutation({
    mutationFn: (file: File) => createTextKnowledgeBaseDocumentFromFile(file),
    onSuccess: async (doc) => {
      await attachKnowledgeBaseDocument(agentId, doc.id, 'auto')
      toast.success('Archivo subido y adjuntado')
      refresh()
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[#e4e0f5] bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-black">Crear documento por texto</h3>
        <div className="grid gap-3">
          <input
            type="text"
            value={textName}
            onChange={(event) => setTextName(event.target.value)}
            placeholder="Nombre del documento"
            className="rounded-lg border border-[#e4e0f5] bg-white px-3 py-2 text-sm text-black placeholder:text-black/50 focus:border-[#271173] focus:outline-none"
          />
          <textarea
            rows={4}
            value={textContent}
            onChange={(event) => setTextContent(event.target.value)}
            placeholder="Pega aquí el contenido de conocimiento"
            className="rounded-lg border border-[#e4e0f5] bg-white px-3 py-2 text-sm text-black placeholder:text-black/50 focus:border-[#271173] focus:outline-none"
          />
          <button
            type="button"
            disabled={isCreatingText || !textContent.trim()}
            onClick={() => createTextDoc()}
            className="w-fit rounded-lg bg-[#271173] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-60"
          >
            Crear y adjuntar
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-[#e4e0f5] bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-black">Crear documento por URL</h3>
        <div className="grid gap-3 lg:grid-cols-[1fr,2fr,auto]">
          <input
            type="text"
            value={urlName}
            onChange={(event) => setUrlName(event.target.value)}
            placeholder="Nombre (opcional)"
            className="rounded-lg border border-[#e4e0f5] bg-white px-3 py-2 text-sm text-black placeholder:text-black/50 focus:border-[#271173] focus:outline-none"
          />
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://..."
            className="rounded-lg border border-[#e4e0f5] bg-white px-3 py-2 text-sm text-black placeholder:text-black/50 focus:border-[#271173] focus:outline-none"
          />
          <button
            type="button"
            disabled={isCreatingUrl || !url.trim()}
            onClick={() => createUrlDoc()}
            className="rounded-lg bg-[#271173] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-60"
          >
            Crear
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-[#e4e0f5] bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-black">Subir archivo</h3>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.json,.csv,.html,.xml"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) uploadFile(file)
          }}
          className="block w-full text-sm text-black/85 file:mr-3 file:rounded-lg file:border-0 file:bg-[#271173] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
        />
      </section>

      <section className="overflow-hidden rounded-xl border border-[#e4e0f5] bg-white">
        <div className="border-b border-[#e4e0f5] px-5 py-3">
          <h3 className="text-sm font-semibold text-black">Documentos del workspace</h3>
        </div>

        {workspaceDocuments.length === 0 ? (
          <div className="px-5 py-6 text-sm text-black/60">No hay documentos todavía.</div>
        ) : (
          <div className="divide-y divide-[#e4e0f5]">
            {workspaceDocuments.map((doc) => {
              const attached = attachedIds.has(doc.id)
              const attachedDoc = attachedDocuments.find((item) => item.id === doc.id)

              return (
                <div key={doc.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-black">{doc.name}</p>
                      <p className="mt-0.5 text-xs text-black/60">
                        {doc.source_type.toUpperCase()} · {doc.source_value}
                      </p>
                      {doc.content_preview && (
                        <p className="mt-1 text-xs text-black/70">{doc.content_preview}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {attached && (
                        <select
                          value={attachedDoc?.usage_mode ?? 'auto'}
                          onChange={(event) =>
                            attachDoc({
                              documentId: doc.id,
                              usageMode: event.target.value as 'auto' | 'prompt',
                            })
                          }
                          className="rounded-lg border border-[#e4e0f5] bg-white px-2 py-1 text-xs text-black focus:border-[#271173] focus:outline-none"
                        >
                          <option value="auto">Auto</option>
                          <option value="prompt">Prompt</option>
                        </select>
                      )}

                      <button
                        type="button"
                        onClick={() => (attached ? detachDoc(doc.id) : attachDoc({ documentId: doc.id, usageMode: 'auto' }))}
                        className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                          attached
                            ? 'border border-amber-200 text-amber-700 hover:bg-amber-50'
                            : 'border border-[#271173]/30 text-[#271173] hover:bg-[#ede9ff]'
                        }`}
                      >
                        {attached ? 'Desadjuntar' : 'Adjuntar'}
                      </button>

                      <button
                        type="button"
                        onClick={() => deleteDoc(doc.id)}
                        className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
