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
  DevicePhoneMobileIcon,
  KeyIcon,
  WrenchScrewdriverIcon,
  ChartBarIcon,
  PencilIcon,
  SparklesIcon,
  GlobeAltIcon,
  CalendarDaysIcon,
} from '@heroicons/react/24/outline'
import { getTextAgent, listProviderConfigs, updateTextAgent } from '@/api/TextAgentsAPI'
import TextAgentPreview from '@/components/app/text-agent/TextAgentPreview'
import TextAgentConfigTab from '@/components/app/text-agent/tabs/TextAgentConfigTab'
import TextAgentKeysTab from '@/components/app/text-agent/tabs/TextAgentKeysTab'
import TextAgentToolsTab from '@/components/app/text-agent/tabs/TextAgentToolsTab'
import TextAgentKnowledgeBaseTab from '@/components/app/text-agent/tabs/TextAgentKnowledgeBaseTab'
import TextAgentAnalysisTab from '@/components/app/text-agent/tabs/TextAgentAnalysisTab'
import TextAgentWhatsAppTab from '@/components/app/text-agent/tabs/TextAgentWhatsAppTab'
import TextAgentSofiaTab from '@/components/app/text-agent/tabs/TextAgentSofiaTab'
import TextAgentIntegrationTab from '@/components/app/text-agent/tabs/TextAgentIntegrationTab'
import TextAgentAppointmentsTab from '@/components/app/text-agent/tabs/TextAgentAppointmentsTab'
import { TEXT_PROVIDER_MODELS, type TextAgentFormValues, type TextProvider } from '@/types/textAgent'
import { useCurrentUser } from '@/hooks/useCurrentUser'

const BASE_TABS = [
  { id: 'config', label: 'Agente', icon: ChatBubbleLeftRightIcon },
  { id: 'tools', label: 'Herramientas', icon: WrenchScrewdriverIcon },
  { id: 'knowledge', label: 'Conocimiento', icon: BookOpenIcon },
  { id: 'sofia', label: 'Sofía IA', icon: SparklesIcon },
  { id: 'appointments', label: 'Citas', icon: CalendarDaysIcon },
  { id: 'whatsapp', label: 'WhatsApp', icon: DevicePhoneMobileIcon },
  { id: 'integration', label: 'Integración', icon: GlobeAltIcon },
  { id: 'analysis', label: 'Análisis', icon: ChartBarIcon },
] as const

const KEYS_TAB = { id: 'keys', label: 'API Keys', icon: KeyIcon } as const

type TabId = (typeof BASE_TABS)[number]['id'] | 'keys'

const CLIENT_VISIBLE_TAB_IDS: Array<(typeof BASE_TABS)[number]['id']> = [
  'config',
  'sofia',
  'whatsapp',
  'integration',
  'analysis',
]

export default function TextAgentDetailView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState<TabId>('config')
  const [editingName, setEditingName] = useState(false)
  const { isSuperAdmin } = useCurrentUser()
  const isClient = !isSuperAdmin

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

  const visibleBaseTabs = isClient
    ? BASE_TABS.filter((tab) => CLIENT_VISIBLE_TAB_IDS.includes(tab.id))
    : [...BASE_TABS]

  const tabs = requiresUserKeys && !isClient
    ? [visibleBaseTabs[0], KEYS_TAB, ...visibleBaseTabs.slice(1)]
    : [...visibleBaseTabs]

  useEffect(() => {
    if (!requiresUserKeys && activeTab === 'keys') {
      setActiveTab('config')
      return
    }

    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab((tabs[0]?.id as TabId) ?? 'config')
    }
  }, [activeTab, requiresUserKeys, tabs])

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
      model: 'gpt-4.1-mini',
      system_prompt: '',
      welcome_message: '',
      temperature: 0.7,
      max_tokens: 512,
      sofia_mode: false,
      sofia_config_json: '{}',
    },
  })

  useEffect(() => {
    if (!agent) return
    reset({
      name: agent.name,
      model: isClient ? 'gpt-4.1-mini' : agent.model,
      system_prompt: agent.system_prompt,
      welcome_message: agent.welcome_message,
      temperature: isClient ? 0.7 : agent.temperature,
      max_tokens: isClient ? 512 : agent.max_tokens,
      sofia_mode: agent.sofia_mode ?? false,
      sofia_config_json: agent.sofia_config_json ?? '{}',
    })
  }, [agent, isClient, reset])

  const watchedModel = watch('model')
  const provider = agent?.provider as TextProvider | undefined

  useEffect(() => {
    if (isClient && watchedModel !== 'gpt-4.1-mini') {
      setValue('model', 'gpt-4.1-mini', { shouldDirty: false })
      return
    }

    if (!provider) return
    const available = TEXT_PROVIDER_MODELS[provider] ?? []
    const exists = available.some((m) => m.value === watchedModel)
    if (!exists && available.length > 0) {
      setValue('model', available[0].value, { shouldDirty: true })
    }
  }, [isClient, watchedModel, provider, setValue])

  const { mutate: save, mutateAsync: saveAsync, isPending: isSaving } = useMutation({
    mutationFn: (values: TextAgentFormValues) =>
      updateTextAgent(id!, {
        name: values.name,
        model: isClient ? 'gpt-4.1-mini' : values.model,
        system_prompt: values.system_prompt,
        welcome_message: values.welcome_message,
        temperature: isClient ? 0.7 : values.temperature,
        max_tokens: isClient ? 512 : values.max_tokens,
        sofia_mode: values.sofia_mode,
        sofia_config_json: values.sofia_config_json,
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
    await saveAsync(watch())
  }

  const watchedName = watch('name')
  const watchedWelcomeMessage = watch('welcome_message')
  const watchedTemperature = watch('temperature') ?? 0.7
  const watchedMaxTokens = watch('max_tokens') ?? 512
  const watchedSofiaMode = watch('sofia_mode') ?? false
  const watchedSofiaConfigJson = watch('sofia_config_json') ?? '{}'
  const previewWelcomeMessage = watchedWelcomeMessage?.trim()
    ? watchedWelcomeMessage
    : agent?.welcome_message ?? ''

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-black/60">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#271173] border-t-transparent" />
        Cargando agente...
      </div>
    )
  }

  if (isError || !agent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-black/60">No se pudo cargar el agente de texto.</p>
        <button
          onClick={() => navigate('/agentes_texto')}
          className="text-sm text-[#271173] transition-colors hover:text-[#1f0d5a]"
        >
          ← Volver
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit((values) => save(values))} className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#e4e0f5] px-8 py-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate('/agentes_texto')}
              className="rounded-lg p-1 text-black/50 transition-colors hover:bg-[#f5f3ff] hover:text-[#271173]"
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-2">
              {editingName ? (
                <input
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') setEditingName(false) }}
                  className="rounded-lg border border-[#271173]/30 bg-[#f5f3ff] px-3 py-1.5 text-sm font-semibold text-black focus:outline-none focus:border-[#271173]"
                  {...register('name', {
                    required: true,
                    onBlur: () => setEditingName(false),
                  })}
                />
              ) : (
                <h1 className="text-lg font-semibold text-black">
                  {watchedName || agent.name}
                </h1>
              )}
              <button
                type="button"
                onClick={() => setEditingName((p) => !p)}
                className="rounded-md p-1 text-black/40 transition-colors hover:text-black/70"
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

        {/* Tabs */}
        <div className="shrink-0 border-b border-[#e4e0f5] px-8">
          <div className="flex gap-0 overflow-x-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as TabId)}
                  className={`flex items-center gap-1.5 border-b-2 px-4 py-3.5 text-sm font-medium whitespace-nowrap transition-all ${
                    active
                      ? 'border-[#271173] text-[#271173]'
                      : 'border-transparent text-black/50 hover:text-black/80'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Tab content */}
        <div key={activeTab} className="section-enter flex-1 overflow-y-auto px-8 py-6">
          {activeTab === 'config' && (
            <TextAgentConfigTab
              register={register}
              setValue={setValue}
              errors={errors}
              provider={agent.provider}
              temperature={watchedTemperature}
              maxTokens={watchedMaxTokens}
              isClient={isClient}
            />
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

          {activeTab === 'whatsapp' && (
            <TextAgentWhatsAppTab agentId={id!} />
          )}

          {activeTab === 'integration' && (
            <TextAgentIntegrationTab agentId={id!} />
          )}

          {activeTab === 'sofia' && (
            <TextAgentSofiaTab
              agentId={id!}
              sofiaMode={watchedSofiaMode}
              sofiaConfigJson={watchedSofiaConfigJson}
              onSofiaChange={(mode, configJson) => {
                setValue('sofia_mode', mode, { shouldDirty: true })
                setValue('sofia_config_json', configJson, { shouldDirty: true })
              }}
            />
          )}

          {activeTab === 'appointments' && (
            <TextAgentAppointmentsTab agentId={id!} />
          )}

          {activeTab === 'analysis' && <TextAgentAnalysisTab agentId={id!} />}
        </div>
      </div>

      {/* Preview panel */}
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
