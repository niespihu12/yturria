import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'react-toastify'
import { ChevronLeftIcon, ChevronRightIcon, PencilIcon } from '@heroicons/react/24/outline'
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
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { getTemplateCopy } from '@/components/app/text-agent/copy'
import {
  TEXT_PROVIDER_MODELS,
  type TextAgentFormValues,
  type TextAgentTemplateCapabilities,
  type TextProvider,
} from '@/types/textAgent'

// Primero lo que el equipo de negocio usa a diario; al final, lo técnico.
const BASE_TABS = [
  { id: 'config', label: 'Agente' },
  { id: 'sofia', label: 'Sofía' },
  { id: 'knowledge', label: 'Conocimiento' },
  { id: 'appointments', label: 'Citas' },
  { id: 'analysis', label: 'Conversaciones' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'integration', label: 'Sitio web' },
  { id: 'tools', label: 'Herramientas' },
] as const

const KEYS_TAB = { id: 'keys', label: 'Claves de IA' } as const
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
    const visible: Array<{ id: TabId; label: string }> = isClient
      ? buildClientVisibleTabs(templateCapabilities)
      : [...BASE_TABS]
    return requiresUserKeys && !isClient ? [...visible, KEYS_TAB] : visible
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

  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({})
  const tabListRef = useRef<HTMLDivElement | null>(null)
  const [tabOverflow, setTabOverflow] = useState({ left: false, right: false })

  const updateTabOverflow = useCallback(() => {
    const list = tabListRef.current
    if (!list) return
    const left = list.scrollLeft > 4
    const right = list.scrollLeft + list.clientWidth < list.scrollWidth - 4
    setTabOverflow((prev) => (prev.left === left && prev.right === right ? prev : { left, right }))
  }, [])

  // Con pantallas estrechas las pestañas se desplazan; las flechas indican que hay más.
  const attachTabList = useCallback(
    (list: HTMLDivElement | null) => {
      tabListRef.current = list
      if (!list) return
      const observer = new ResizeObserver(updateTabOverflow)
      observer.observe(list)
      return () => observer.disconnect()
    },
    [updateTabOverflow],
  )

  useEffect(() => {
    const frame = requestAnimationFrame(updateTabOverflow)
    return () => cancelAnimationFrame(frame)
  }, [tabs, updateTabOverflow])

  const scrollTabs = (direction: 1 | -1) => {
    tabListRef.current?.scrollBy({ left: direction * 200, behavior: 'smooth' })
  }

  const selectTab = (tabId: TabId, focus = false) => {
    setActiveTab(tabId)
    const element = tabRefs.current[tabId]
    element?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    if (focus) element?.focus()
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.findIndex((tab) => tab.id === resolvedActiveTab)
    let next = -1
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    if (next < 0) return
    event.preventDefault()
    selectTab(tabs[next].id, true)
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-text-secondary">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
        Cargando agente…
      </div>
    )
  }

  if (isError || !agent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-text-secondary">No pudimos cargar este agente. Es posible que ya no exista.</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/agentes_texto')}>
          Volver a agentes de texto
        </Button>
      </div>
    )
  }

  const templateCopy = getTemplateCopy(agent.template_key, {
    label: agent.template_label,
    summary: agent.template_summary,
  })
  const displayName = watchedName || agent.name

  return (
    <>
      <form
        onSubmit={handleSubmit((values) => save(values))}
        className="flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden"
      >
        <div className="flex min-w-0 flex-1 flex-col lg:overflow-hidden">
          <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 px-4 pt-5 sm:px-8 sm:pt-6">
            <div className="flex min-w-0 items-start gap-2">
              <button
                type="button"
                onClick={() => navigate('/agentes_texto')}
                aria-label="Volver a agentes de texto"
                className="-ml-2 mt-0.5 rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-neutral-100 hover:text-text-primary"
              >
                <ChevronLeftIcon className="h-5 w-5" aria-hidden="true" />
              </button>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {editingName ? (
                    <input
                      autoFocus
                      aria-label="Nombre del agente"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          setEditingName(false)
                        }
                        if (event.key === 'Escape') setEditingName(false)
                      }}
                      className="h-9 min-w-0 rounded-lg border border-primary-300 bg-surface px-3 text-base font-semibold text-text-primary focus:border-primary-600"
                      {...register('name', {
                        required: true,
                        onBlur: () => setEditingName(false),
                      })}
                    />
                  ) : (
                    <h1 className="min-w-0 truncate font-display text-xl leading-tight text-primary-800 sm:text-2xl">
                      {displayName}
                    </h1>
                  )}

                  {!editingName && (
                    <button
                      type="button"
                      onClick={() => setEditingName(true)}
                      aria-label="Cambiar el nombre del agente"
                      title="Cambiar nombre"
                      className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-neutral-100 hover:text-text-primary"
                    >
                      <PencilIcon className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}

                  <Badge size="sm">{templateCopy.label}</Badge>
                </div>
                {templateCopy.summary && (
                  <p className="mt-1 max-w-2xl text-sm text-text-secondary">{templateCopy.summary}</p>
                )}
              </div>
            </div>

            {isDirty && (
              <div className="flex items-center gap-3">
                <span className="hidden text-xs text-text-tertiary sm:inline">Cambios sin guardar</span>
                <Button type="submit" isLoading={isSaving}>
                  {isSaving ? 'Guardando…' : 'Guardar cambios'}
                </Button>
              </div>
            )}
          </header>

          <div className="relative mt-4 shrink-0 border-b border-border-default px-4 sm:px-8">
            {tabOverflow.left && (
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                onClick={() => scrollTabs(-1)}
                className="absolute inset-y-0 left-0 z-10 flex w-9 items-center justify-center border-r border-border-subtle bg-bg-secondary text-text-tertiary hover:text-text-primary"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
            )}
            {tabOverflow.right && (
              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                onClick={() => scrollTabs(1)}
                className="absolute inset-y-0 right-0 z-10 flex w-9 items-center justify-center border-l border-border-subtle bg-bg-secondary text-text-tertiary hover:text-text-primary"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            )}
            <div
              ref={attachTabList}
              role="tablist"
              aria-label="Secciones del agente"
              onScroll={updateTabOverflow}
              className="no-visible-scrollbar -mb-px flex gap-1 overflow-x-auto scroll-px-9"
            >
              {tabs.map((tab) => {
                const active = resolvedActiveTab === tab.id
                return (
                  <button
                    key={tab.id}
                    ref={(element) => {
                      tabRefs.current[tab.id] = element
                    }}
                    id={`text-agent-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls="text-agent-tabpanel"
                    tabIndex={active ? 0 : -1}
                    onClick={() => selectTab(tab.id)}
                    onKeyDown={handleTabKeyDown}
                    className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                      active
                        ? 'border-primary-600 text-primary-700'
                        : 'border-transparent text-text-secondary hover:border-border-strong hover:text-text-primary'
                    }`}
                  >
                    {tab.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div
            key={resolvedActiveTab}
            id="text-agent-tabpanel"
            role="tabpanel"
            aria-labelledby={`text-agent-tab-${resolvedActiveTab}`}
            className="section-enter @container px-4 py-6 sm:px-8 lg:flex-1 lg:overflow-y-auto"
          >
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
          agentName={displayName}
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
