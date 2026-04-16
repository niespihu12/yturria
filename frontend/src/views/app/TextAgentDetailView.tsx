import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { toast } from 'react-toastify'
import {
  BookOpenIcon,
  ChatBubbleLeftRightIcon,
  ChevronLeftIcon,
  CheckIcon,
  KeyIcon,
  WrenchScrewdriverIcon,
  ChartBarIcon,
  PencilIcon,
} from '@heroicons/react/24/outline'
import {
  getTextAgent,
  listProviderConfigs,
  updateTextAgent,
} from '@/api/TextAgentsAPI'
import TextAgentPreview from '@/components/app/text-agent/TextAgentPreview'
import TextAgentConfigTab from '@/components/app/text-agent/tabs/TextAgentConfigTab'
import TextAgentKeysTab from '@/components/app/text-agent/tabs/TextAgentKeysTab'
import TextAgentToolsTab from '@/components/app/text-agent/tabs/TextAgentToolsTab'
import TextAgentKnowledgeBaseTab from '@/components/app/text-agent/tabs/TextAgentKnowledgeBaseTab'
import TextAgentAnalysisTab from '@/components/app/text-agent/tabs/TextAgentAnalysisTab'
import {
  TEXT_PROVIDER_MODELS,
  type TextAgentFormValues,
  type TextProvider,
} from '@/types/textAgent'

const BASE_TABS = [
  { id: 'config', label: 'Agente', icon: ChatBubbleLeftRightIcon },
  { id: 'tools', label: 'Herramientas', icon: WrenchScrewdriverIcon },
  { id: 'knowledge', label: 'Base de conocimiento', icon: BookOpenIcon },
  { id: 'analysis', label: 'Analisis', icon: ChartBarIcon },
] as const

const KEYS_TAB = { id: 'keys', label: 'API keys', icon: KeyIcon } as const

type TabId = (typeof BASE_TABS)[number]['id'] | 'keys'

export default function TextAgentDetailView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState<TabId>('config')
  const [editingName, setEditingName] = useState(false)

  const { data: agent, isLoading, isError } = useQuery({
    queryKey: ['text-agent', id],
    queryFn: () => getTextAgent(id!),
    enabled: !!id,
  })

  const { data: providerConfigsData } = useQuery({
    queryKey: ['text-provider-configs'],
    queryFn: listProviderConfigs,
  })

  const providerConfigs = providerConfigsData?.providers ?? []
  const requiresUserKeys = providerConfigsData?.requires_user_keys ?? true
  const tabs = requiresUserKeys
    ? [BASE_TABS[0], KEYS_TAB, ...BASE_TABS.slice(1)]
    : BASE_TABS

  useEffect(() => {
    if (!requiresUserKeys && activeTab === 'keys') {
      setActiveTab('config')
    }
  }, [activeTab, requiresUserKeys])

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { isDirty, errors },
  } = useForm<TextAgentFormValues>({
    defaultValues: {
      name: '',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      language: 'es',
      system_prompt: '',
      welcome_message: '',
      temperature: 0.7,
      max_tokens: 512,
    },
  })

  useEffect(() => {
    if (!agent) return

    reset({
      name: agent.name,
      provider: agent.provider,
      model: agent.model,
      language: agent.language,
      system_prompt: agent.system_prompt,
      welcome_message: agent.welcome_message,
      temperature: agent.temperature,
      max_tokens: agent.max_tokens,
    })
  }, [agent, reset])

  const watchedProvider = watch('provider')
  const watchedModel = watch('model')

  useEffect(() => {
    const provider = watchedProvider as TextProvider
    const available = TEXT_PROVIDER_MODELS[provider] ?? []
    const exists = available.some((item) => item.value === watchedModel)
    if (!exists && available.length > 0) {
      setValue('model', available[0].value, { shouldDirty: true })
    }
  }, [watchedModel, watchedProvider, setValue])

  const { mutate: save, mutateAsync: saveAsync, isPending: isSaving } = useMutation({
    mutationFn: (values: TextAgentFormValues) =>
      updateTextAgent(id!, {
        name: values.name,
        provider: values.provider,
        model: values.model,
        language: values.language,
        system_prompt: values.system_prompt,
        welcome_message: values.welcome_message,
        temperature: values.temperature,
        max_tokens: values.max_tokens,
      }),
    onSuccess: () => {
      toast.success('Cambios guardados')
      queryClient.invalidateQueries({ queryKey: ['text-agent', id] })
      queryClient.invalidateQueries({ queryKey: ['text-agents'] })
      reset(watch())
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const handleSaveForPreview = async () => {
    const values = watch()
    await saveAsync(values)
  }

  const watchedName = watch('name')
  const watchedWelcomeMessage = watch('welcome_message')
  const previewWelcomeMessage = watchedWelcomeMessage?.trim()
    ? watchedWelcomeMessage
    : agent?.welcome_message ?? ''

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-black/70">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#271173] border-t-transparent" />
        Cargando agente de texto...
      </div>
    )
  }

  if (isError || !agent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-black/70">No se pudo cargar el agente de texto.</p>
        <button
          onClick={() => navigate('/agentes_texto')}
          className="text-[#271173] hover:text-[#1f0d5a] text-sm transition-colors"
        >
          ← Volver
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit((values) => save(values))} className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between border-b border-[#e4e0f5] px-8 py-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate('/agentes_texto')}
              className="text-black/60 transition-colors hover:text-[#271173]"
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-2">
              {editingName ? (
                <input
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setEditingName(false)
                  }}
                  className="rounded-lg border border-[#271173]/30 bg-[#f5f3ff] px-3 py-1.5 text-sm font-semibold text-black focus:outline-none focus:border-[#271173]"
                  {...register('name', {
                    required: true,
                    onBlur: () => setEditingName(false),
                  })}
                />
              ) : (
                <h1 className="text-lg font-semibold text-black">{watchedName || agent.name}</h1>
              )}
              <button
                type="button"
                onClick={() => setEditingName((prev) => !prev)}
                className="text-black/50 transition-colors hover:text-black/70"
              >
                <PencilIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {isDirty && (
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 rounded-xl bg-[#271173] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-60"
            >
              {isSaving ? (
                <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <CheckIcon className="h-4 w-4" />
              )}
              {isSaving ? 'Guardando...' : 'Guardar cambios'}
            </button>
          )}
        </div>

        <div className="shrink-0 border-b border-[#e4e0f5] px-8">
          <div className="flex gap-0 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 border-b-2 px-4 py-3.5 text-sm font-medium transition-all ${
                    active
                      ? 'border-[#271173] text-[#271173]'
                      : 'border-transparent text-black/60 hover:text-black/85'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          {activeTab === 'config' && (
            <TextAgentConfigTab register={register} watch={watch} errors={errors} />
          )}

          {activeTab === 'keys' && requiresUserKeys && (
            <TextAgentKeysTab providerConfigs={providerConfigs} />
          )}

          {activeTab === 'tools' && (
            <TextAgentToolsTab agentId={id!} tools={agent.tools ?? []} />
          )}

          {activeTab === 'knowledge' && (
            <TextAgentKnowledgeBaseTab
              agentId={id!}
              attachedDocuments={agent.knowledge_base ?? []}
            />
          )}

          {activeTab === 'analysis' && <TextAgentAnalysisTab agentId={id!} />}
        </div>
      </div>

      <TextAgentPreview
        agentId={id!}
        agentName={watchedName || agent.name}
        welcomeMessage={previewWelcomeMessage}
        isDirty={isDirty}
        onSave={handleSaveForPreview}
      />
    </form>
  )
}
