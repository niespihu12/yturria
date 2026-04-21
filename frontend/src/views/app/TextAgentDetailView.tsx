import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'react-toastify'
import {
  BookOpenIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  ChatBubbleLeftRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  DevicePhoneMobileIcon,
  GlobeAltIcon,
  KeyIcon,
  PencilIcon,
  SparklesIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline'
import { getTextAgent, listProviderConfigs, updateTextAgent } from '@/api/TextAgentsAPI'
import OnboardingWizard from '@/components/app/onboarding/OnboardingWizard'
import TextAgentPreview from '@/components/app/text-agent/TextAgentPreview'
import TextAgentAppointmentsTab from '@/components/app/text-agent/tabs/TextAgentAppointmentsTab'
import TextAgentAnalysisTab from '@/components/app/text-agent/tabs/TextAgentAnalysisTab'
import TextAgentConfigTab from '@/components/app/text-agent/tabs/TextAgentConfigTab'
import TextAgentIntegrationTab from '@/components/app/text-agent/tabs/TextAgentIntegrationTab'
import TextAgentKeysTab from '@/components/app/text-agent/tabs/TextAgentKeysTab'
import TextAgentKnowledgeBaseTab from '@/components/app/text-agent/tabs/TextAgentKnowledgeBaseTab'
import TextAgentSofiaTab from '@/components/app/text-agent/tabs/TextAgentSofiaTab'
import TextAgentToolsTab from '@/components/app/text-agent/tabs/TextAgentToolsTab'
import TextAgentWhatsAppTab from '@/components/app/text-agent/tabs/TextAgentWhatsAppTab'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import {
  TEXT_PROVIDER_MODELS,
  type TextAgentFormValues,
  type TextAgentTemplateCapabilities,
  type TextProvider,
} from '@/types/textAgent'

const BASE_TABS = [
  { id: 'config', label: 'Agente', icon: ChatBubbleLeftRightIcon },
  { id: 'tools', label: 'Herramientas', icon: WrenchScrewdriverIcon },
  { id: 'knowledge', label: 'Conocimiento', icon: BookOpenIcon },
  { id: 'sofia', label: 'Sofia IA', icon: SparklesIcon },
  { id: 'appointments', label: 'Citas', icon: CalendarDaysIcon },
  { id: 'whatsapp', label: 'Canal WhatsApp', icon: DevicePhoneMobileIcon },
  { id: 'integration', label: 'Integracion', icon: GlobeAltIcon },
  { id: 'analysis', label: 'Analisis', icon: ChartBarIcon },
] as const

const KEYS_TAB = { id: 'keys', label: 'API Keys', icon: KeyIcon } as const
const CORE_CLIENT_TAB_IDS: Array<(typeof BASE_TABS)[number]['id']> = [
  'config',
  'whatsapp',
  'integration',
  'analysis',
]

const EMPTY_TEMPLATE_CAPABILITIES: TextAgentTemplateCapabilities = {
  show_sofia_tab: false,
  show_knowledge_tab: false,
  show_tools_tab: false,
  show_appointments_tab: false,
  allow_prompt_edit: false,
  allow_welcome_edit: false,
  allow_model_edit: false,
  allow_runtime_tuning: false,
  launches_onboarding: false,
}

type TabId = (typeof BASE_TABS)[number]['id'] | 'keys'

function buildClientVisibleTabs(capabilities: TextAgentTemplateCapabilities) {
  const visible = new Set<(typeof BASE_TABS)[number]['id']>(CORE_CLIENT_TAB_IDS)

  if (capabilities.show_tools_tab) visible.add('tools')
  if (capabilities.show_knowledge_tab) visible.add('knowledge')
  if (capabilities.show_sofia_tab) visible.add('sofia')
  if (capabilities.show_appointments_tab) visible.add('appointments')

  return BASE_TABS.filter((tab) => visible.has(tab.id))
}

export default function TextAgentDetailView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()

  const [activeTab, setActiveTab] = useState<TabId>('config')
  const [editingName, setEditingName] = useState(false)
  const [onboardingRequested, setOnboardingRequested] = useState(() =>
    Boolean((location.state as { openOnboarding?: boolean } | null)?.openOnboarding)
  )
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)
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
  const templateCapabilities = agent?.template_capabilities ?? EMPTY_TEMPLATE_CAPABILITIES

  const tabs = useMemo(() => {
    const visible = isClient ? buildClientVisibleTabs(templateCapabilities) : [...BASE_TABS]
    return requiresUserKeys && !isClient ? [visible[0], KEYS_TAB, ...visible.slice(1)] : [...visible]
  }, [isClient, requiresUserKeys, templateCapabilities])

  const resolvedActiveTab = useMemo<TabId>(() => {
    if (!requiresUserKeys && activeTab === 'keys') return 'config'
    if (tabs.some((tab) => tab.id === activeTab)) return activeTab
    return (tabs[0]?.id as TabId) ?? 'config'
  }, [activeTab, requiresUserKeys, tabs])

  const canEditPrompt = !isClient || templateCapabilities.allow_prompt_edit
  const canEditWelcome = !isClient || templateCapabilities.allow_welcome_edit
  const canEditModel = !isClient || templateCapabilities.allow_model_edit
  const canEditRuntimeTuning = !isClient || templateCapabilities.allow_runtime_tuning

  const {
    register,
    handleSubmit,
    control,
    getValues,
    setValue,
    reset,
    formState: { isDirty, errors },
  } = useForm<TextAgentFormValues>({
    defaultValues: {
      name: '',
      model: 'gpt-4.1-mini',
      template_key: 'sofia',
      system_prompt: '',
      welcome_message: '',
      legal_notice: '',
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
      model: agent.model,
      template_key: agent.template_key,
      system_prompt: agent.system_prompt,
      welcome_message: agent.welcome_message,
      legal_notice: agent.legal_notice ?? '',
      temperature: agent.temperature,
      max_tokens: agent.max_tokens,
      sofia_mode: agent.sofia_mode ?? false,
      sofia_config_json: agent.sofia_config_json ?? '{}',
    })
  }, [agent, reset])

  const watchedModel = useWatch({ control, name: 'model' })
  const watchedName = useWatch({ control, name: 'name' })
  const watchedWelcomeMessage = useWatch({ control, name: 'welcome_message' })
  const watchedTemperature = useWatch({ control, name: 'temperature' }) ?? 0.7
  const watchedMaxTokens = useWatch({ control, name: 'max_tokens' }) ?? 512
  const watchedSofiaMode = useWatch({ control, name: 'sofia_mode' }) ?? false
  const watchedSofiaConfigJson = useWatch({ control, name: 'sofia_config_json' }) ?? '{}'

  const provider = agent?.provider as TextProvider | undefined

  useEffect(() => {
    if (!provider) return
    const available = TEXT_PROVIDER_MODELS[provider] ?? []
    const exists = available.some((model) => model.value === watchedModel)
    if (!exists && available.length > 0) {
      setValue('model', available[0].value, { shouldDirty: true })
    }
  }, [provider, setValue, watchedModel])

  useEffect(() => {
    if (!onboardingRequested) return
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, navigate, onboardingRequested])

  const { mutate: save, mutateAsync: saveAsync, isPending: isSaving } = useMutation({
    mutationFn: (values: TextAgentFormValues) =>
      updateTextAgent(id!, {
        name: values.name,
        model: values.model,
        system_prompt: values.system_prompt,
        welcome_message: values.welcome_message,
        legal_notice: values.legal_notice,
        temperature: values.temperature,
        max_tokens: values.max_tokens,
        sofia_mode: values.sofia_mode,
        sofia_config_json: values.sofia_config_json,
      }),
    onSuccess: () => {
      toast.success('Cambios guardados')
      queryClient.invalidateQueries({ queryKey: ['text-agent', id] })
      queryClient.invalidateQueries({ queryKey: ['text-agents'] })
      reset(getValues())
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const handleSaveForPreview = async () => {
    await saveAsync(getValues())
  }

  const previewWelcomeMessage = watchedWelcomeMessage?.trim()
    ? watchedWelcomeMessage
    : agent?.welcome_message ?? ''
  const shouldShowOnboarding =
    onboardingRequested &&
    !onboardingDismissed &&
    templateCapabilities.launches_onboarding &&
    Boolean(agent?.agent_id) &&
    !localStorage.getItem(`onboarding-wizard:done:${agent?.agent_id ?? ''}`)

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
          Volver
        </button>
      </div>
    )
  }

  return (
    <>
      <form onSubmit={handleSubmit((values) => save(values))} className="flex h-full">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-[#e4e0f5] px-8 py-4">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => navigate('/agentes_texto')}
                className="rounded-lg p-1 text-black/50 transition-colors hover:bg-[#f5f3ff] hover:text-[#271173]"
              >
                <ChevronLeftIcon className="h-5 w-5" />
              </button>

              <div>
                <div className="flex items-center gap-2">
                  {editingName ? (
                    <input
                      autoFocus
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') setEditingName(false)
                      }}
                      className="rounded-lg border border-[#271173]/30 bg-[#f5f3ff] px-3 py-1.5 text-sm font-semibold text-black focus:border-[#271173] focus:outline-none"
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
                    className="rounded-md p-1 text-black/40 transition-colors hover:text-black/70"
                  >
                    <PencilIcon className="h-3.5 w-3.5" />
                  </button>

                  <span className="rounded-full border border-[#d9d1ff] bg-[#f6f1ff] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#271173]">
                    {agent.template_label}
                  </span>
                </div>
                <p className="mt-1 max-w-2xl text-xs text-black/50">{agent.template_summary}</p>
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
                const active = resolvedActiveTab === tab.id
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

          <div key={resolvedActiveTab} className="section-enter flex-1 overflow-y-auto px-8 py-6">
            {resolvedActiveTab === 'config' && (
              <TextAgentConfigTab
                register={register}
                setValue={setValue}
                errors={errors}
                provider={agent.provider}
                model={watchedModel || agent.model}
                temperature={watchedTemperature}
                maxTokens={watchedMaxTokens}
                canEditPrompt={canEditPrompt}
                canEditWelcome={canEditWelcome}
                canEditModel={canEditModel}
                canEditRuntimeTuning={canEditRuntimeTuning}
              />
            )}

            {resolvedActiveTab === 'keys' && requiresUserKeys && (
              <TextAgentKeysTab providerConfigs={providerConfigs} />
            )}

            {resolvedActiveTab === 'tools' && (
              <TextAgentToolsTab agentId={id!} tools={agent.tools ?? []} />
            )}

            {resolvedActiveTab === 'knowledge' && (
              <TextAgentKnowledgeBaseTab
                agentId={id!}
                attachedDocuments={agent.knowledge_base ?? []}
              />
            )}

            {resolvedActiveTab === 'whatsapp' && <TextAgentWhatsAppTab agentId={id!} />}

            {resolvedActiveTab === 'integration' && <TextAgentIntegrationTab agentId={id!} />}

            {resolvedActiveTab === 'sofia' && (
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

            {resolvedActiveTab === 'appointments' && <TextAgentAppointmentsTab agentId={id!} />}

            {resolvedActiveTab === 'analysis' && <TextAgentAnalysisTab agentId={id!} />}
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

      {shouldShowOnboarding && (
        <OnboardingWizard
          agentId={id!}
          onComplete={() => {
            setOnboardingDismissed(true)
            setOnboardingRequested(false)
          }}
        />
      )}
    </>
  )
}
