import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { toast } from 'react-toastify'
import {
  ChevronLeftIcon,
  CheckIcon,
  CpuChipIcon,
  BookOpenIcon,
  ChartBarIcon,
  WrenchScrewdriverIcon,
  PencilIcon,
} from '@heroicons/react/24/outline'
import { getAgent, updateAgent } from '@/api/VoiceRuntimeAPI'
import type { AgentDetail, AgentFormValues, KnowledgeBaseItem } from '@/types/agent'
import AgentTab from '@/components/app/agent/tabs/AgentTab'
import KnowledgeBaseTab from '@/components/app/agent/tabs/KnowledgeBaseTab'
import AnalysisTab from '@/components/app/agent/tabs/AnalysisTab'
import ToolsTab from '@/components/app/agent/tabs/ToolsTab'
import AgentPreview from '@/components/app/agent/AgentPreview'

const TABS = [
  { id: 'agent', label: 'Agente', icon: CpuChipIcon },
  { id: 'knowledge', label: 'Bases de conocimiento', icon: BookOpenIcon },
  { id: 'analysis', label: 'AnÃ¡lisis', icon: ChartBarIcon },
  { id: 'tools', label: 'Herramientas', icon: WrenchScrewdriverIcon },
] as const

type TabId = (typeof TABS)[number]['id']
type SystemToolParamsMap = Record<string, Record<string, unknown>>

function getEnabledSystemToolNames(agent: AgentDetail): string[] {
  const prompt = agent.conversation_config.agent.prompt as Record<string, unknown>
  const toolNames = new Set<string>()

  if (Array.isArray(prompt.tools)) {
    for (const tool of prompt.tools) {
      if (!isRecord(tool)) continue
      if (tool.type !== 'system') continue
      if (typeof tool.name !== 'string' || !tool.name) continue
      toolNames.add(tool.name)
    }
  }

  const builtInToolsRaw = prompt.built_in_tools
  if (Array.isArray(builtInToolsRaw)) {
    for (const toolName of builtInToolsRaw) {
      if (typeof toolName === 'string' && toolName) {
        toolNames.add(toolName)
      }
    }
  } else if (isRecord(builtInToolsRaw)) {
    for (const [toolName, config] of Object.entries(builtInToolsRaw)) {
      if (!toolName) continue

      if (typeof config === 'boolean') {
        if (config) toolNames.add(toolName)
        continue
      }

      if (isRecord(config)) {
        if (typeof config.enabled === 'boolean') {
          if (config.enabled) toolNames.add(toolName)
        } else {
          toolNames.add(toolName)
        }
        continue
      }

      if (config) {
        toolNames.add(toolName)
      }
    }
  }

  return [...toolNames]
}

function hasSystemToolConfigurationSource(agent: AgentDetail): boolean {
  const prompt = agent.conversation_config.agent.prompt as Record<string, unknown>
  return (
    Array.isArray(prompt.tools) ||
    Array.isArray(prompt.built_in_tools) ||
    isRecord(prompt.built_in_tools)
  )
}

function hasSystemToolEnabled(
  agent: AgentDetail,
  toolName: string,
  fallback?: boolean
): boolean {
  if (getEnabledSystemToolNames(agent).includes(toolName)) {
    return true
  }

  // If the response carries explicit system-tool config and the tool is absent,
  // treat it as disabled. Otherwise keep previous UI value as fallback.
  if (hasSystemToolConfigurationSource(agent)) {
    return false
  }

  if (typeof fallback === 'boolean') {
    return fallback
  }

  return false
}

function getCallRecordingEnabled(agent: AgentDetail, fallback?: boolean): boolean {
  const platformSettings = (agent.platform_settings ?? {}) as Record<string, unknown>
  const privacySettings = isRecord(platformSettings.privacy)
    ? (platformSettings.privacy as Record<string, unknown>)
    : undefined

  const fromPrivacySnakeCase = privacySettings?.record_voice
  if (typeof fromPrivacySnakeCase === 'boolean') {
    return fromPrivacySnakeCase
  }

  const fromPrivacyCamelCase = privacySettings?.recordVoice
  if (typeof fromPrivacyCamelCase === 'boolean') {
    return fromPrivacyCamelCase
  }

  const fromPlatform = platformSettings.call_recording_enabled
  if (typeof fromPlatform === 'boolean') {
    return fromPlatform
  }

  const fromPlatformCamel = platformSettings.callRecordingEnabled
  if (typeof fromPlatformCamel === 'boolean') {
    return fromPlatformCamel
  }

  const conversationConfig = agent.conversation_config as AgentDetail['conversation_config'] & {
    conversation?: {
      call_recording_enabled?: boolean
      callRecordingEnabled?: boolean
    }
  }

  const fromConversation = conversationConfig.conversation?.call_recording_enabled
  if (typeof fromConversation === 'boolean') {
    return fromConversation
  }

  const fromConversationCamel = conversationConfig.conversation?.callRecordingEnabled
  if (typeof fromConversationCamel === 'boolean') {
    return fromConversationCamel
  }

  if (typeof fallback === 'boolean') {
    return fallback
  }

  return false
}

function getIgnoreDefaultPersonalityEnabled(agent: AgentDetail, fallback?: boolean): boolean {
  const prompt = agent.conversation_config.agent.prompt as Record<string, unknown>

  const fromPromptSnakeCase = prompt.ignore_default_personality
  if (typeof fromPromptSnakeCase === 'boolean') {
    return fromPromptSnakeCase
  }

  const fromPromptCamelCase = prompt.ignoreDefaultPersonality
  if (typeof fromPromptCamelCase === 'boolean') {
    return fromPromptCamelCase
  }

  const platformSettings = (agent.platform_settings ?? {}) as Record<string, unknown>

  const fromSnakeCase = platformSettings.ignore_default_personality
  if (typeof fromSnakeCase === 'boolean') {
    return fromSnakeCase
  }

  const fromCamelCase = platformSettings.ignoreDefaultPersonality
  if (typeof fromCamelCase === 'boolean') {
    return fromCamelCase
  }

  if (typeof fallback === 'boolean') {
    return fallback
  }

  return false
}

function buildDefaultValues(
  agent: AgentDetail,
  fallbackValues?: Partial<AgentFormValues>
): AgentFormValues {
  const cfg = agent.conversation_config
  const promptCfg = cfg.agent.prompt
  const tts = cfg.tts

  return {
    name: agent.name,
    prompt: promptCfg.prompt ?? '',
    first_message: cfg.agent.first_message ?? '',
    language: cfg.agent.language ?? 'es',
    llm: promptCfg.llm ?? 'gemini-2.5-flash',
    voice_id: tts?.voice_id ?? '',
    tts_model_id: tts?.model_id ?? 'eleven_turbo_v2_5',
    stability: tts?.voice_settings?.stability ?? tts?.stability ?? 0.5,
    similarity_boost: tts?.voice_settings?.similarity_boost ?? tts?.similarity_boost ?? 0.75,
    style: tts?.voice_settings?.style ?? tts?.style ?? 0,
    speed: tts?.voice_settings?.speed ?? tts?.speed ?? 1.0,
    llm_temperature: promptCfg.temperature ?? 0.7,
    max_tokens: promptCfg.max_tokens ?? 2048,
    silence_end_timeout_ms: cfg.turn?.silence_end_timeout_ms ?? 700,
    call_recording_enabled: getCallRecordingEnabled(
      agent,
      fallbackValues?.call_recording_enabled
    ),
    ignore_default_personality: getIgnoreDefaultPersonalityEnabled(
      agent,
      fallbackValues?.ignore_default_personality
    ),
    auto_language_detection: hasSystemToolEnabled(
      agent,
      'language_detection',
      fallbackValues?.auto_language_detection
    ),
    system_tools: [],
    rag_enabled: !!promptCfg.rag?.enabled || !!promptCfg.rag,
    rag_top_k:
      promptCfg.rag?.max_retrieved_rag_chunks_count ?? promptCfg.rag?.max_chunks_per_query ?? 3,
  }
}

function buildSystemTools(agent: AgentDetail): string[] {
  return getEnabledSystemToolNames(agent)
}

function buildToolIds(agent: AgentDetail): string[] {
  return Array.isArray(agent.conversation_config.agent.prompt.tool_ids)
    ? agent.conversation_config.agent.prompt.tool_ids
    : []
}

const SYSTEM_TOOL_TYPE_BY_NAME: Record<string, string> = {
  end_call: 'end_call',
  language_detection: 'language_detection',
  skip_turn: 'skip_turn',
  transfer_to_agent: 'transfer_to_agent',
  transfer_to_number: 'transfer_to_number',
  dtmf: 'play_keypad_touch_tone',
  voicemail_detection: 'voicemail_detection',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const E164_PHONE_PATTERN = /^\+[1-9]\d{7,15}$/

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  if (isRecord(value)) {
    const sortedKeys = Object.keys(value).sort()
    return `{${sortedKeys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

function normalizeSystemToolParams(
  toolName: string,
  rawParams?: Record<string, unknown>
): Record<string, unknown> {
  const base = isRecord(rawParams) ? { ...rawParams } : {}
  const systemToolTypeRaw = base.system_tool_type
  const systemToolType =
    (typeof systemToolTypeRaw === 'string' && systemToolTypeRaw) ||
    SYSTEM_TOOL_TYPE_BY_NAME[toolName] ||
    toolName

  const params: Record<string, unknown> = {
    ...base,
    system_tool_type: systemToolType,
  }

  // Normaliza alias camelCase eventualmente devuelto por SDKs.
  delete params.systemToolType

  if (systemToolType === 'transfer_to_agent' || systemToolType === 'transfer_to_number') {
    params.transfers = Array.isArray(params.transfers)
      ? params.transfers.filter(isRecord).map((item) => ({ ...item }))
      : []

    if (typeof params.enable_client_message !== 'boolean') {
      params.enable_client_message = true
    }
  }

  if (systemToolType === 'play_keypad_touch_tone') {
    if (typeof params.use_out_of_band_dtmf !== 'boolean') {
      params.use_out_of_band_dtmf = true
    }
    if (typeof params.suppress_turn_after_dtmf !== 'boolean') {
      params.suppress_turn_after_dtmf = false
    }
  }

  return params
}

function buildSystemToolParamsMap(agent: AgentDetail): SystemToolParamsMap {
  const prompt = agent.conversation_config.agent.prompt as Record<string, unknown>
  const tools = Array.isArray(prompt.tools) ? (prompt.tools as Array<Record<string, unknown>>) : []
  const builtInToolsRaw = prompt.built_in_tools

  const map: SystemToolParamsMap = {}

  if (isRecord(builtInToolsRaw)) {
    for (const [toolName, config] of Object.entries(builtInToolsRaw)) {
      if (!toolName) continue

      if (typeof config === 'boolean') {
        if (!config) continue
        map[toolName] = normalizeSystemToolParams(toolName)
        continue
      }

      if (!isRecord(config)) continue
      if (typeof config.enabled === 'boolean' && !config.enabled) continue

      const params = isRecord(config.params)
        ? (config.params as Record<string, unknown>)
        : config

      map[toolName] = normalizeSystemToolParams(toolName, params)
    }
  }

  for (const tool of tools) {
    if (tool.type !== 'system' || typeof tool.name !== 'string') continue
    map[tool.name] = normalizeSystemToolParams(
      tool.name,
      isRecord(tool.params) ? (tool.params as Record<string, unknown>) : undefined
    )
  }

  return map
}

function cloneSystemToolParamsMap(map: SystemToolParamsMap): SystemToolParamsMap {
  return Object.fromEntries(
    Object.entries(map).map(([toolName, params]) => [
      toolName,
      normalizeSystemToolParams(toolName, params),
    ])
  )
}

function getSystemToolsConfigError(
  enabledSystemTools: string[],
  systemToolParamsByName: SystemToolParamsMap
): string | null {
  for (const toolName of enabledSystemTools) {
    const params = normalizeSystemToolParams(toolName, systemToolParamsByName[toolName])
    const transfers = Array.isArray(params.transfers)
      ? params.transfers.filter(isRecord)
      : []

    if (params.system_tool_type === 'transfer_to_agent') {
      const hasValidAgentTransfer = transfers.some(
        (item) => typeof item.agent_id === 'string' && item.agent_id.trim().length > 0
      )
      if (!hasValidAgentTransfer) {
        return 'La herramienta "Transferir a un agente" requiere al menos un agent_id de destino.'
      }
    }

    if (params.system_tool_type === 'transfer_to_number') {
      const validTransfers = transfers.filter(
        (item) => typeof item.phone_number === 'string' && item.phone_number.trim().length > 0
      )

      if (!validTransfers.length) {
        return 'La herramienta "Transferir a un numero" requiere al menos un numero de destino.'
      }

      const hasInvalidPhone = validTransfers.some(
        (item) =>
          typeof item.phone_number === 'string' &&
          !E164_PHONE_PATTERN.test(item.phone_number.trim())
      )

      if (hasInvalidPhone) {
        return 'Los numeros de transferencia deben estar en formato E.164 (ej: +573001234567).'
      }
    }
  }

  return null
}

function buildUpdatePayload(
  currentAgent: AgentDetail,
  values: AgentFormValues,
  enabledSystemTools: string[],
  selectedToolIds: string[],
  systemToolParamsByName: SystemToolParamsMap
) {
  const currentPrompt = currentAgent.conversation_config.agent.prompt
  const currentRag = currentPrompt.rag
  const currentTools = (currentPrompt.tools ?? []) as Array<Record<string, unknown>>
  const currentBuiltInTools = (currentPrompt as Record<string, unknown>).built_in_tools
  const customTools = (currentPrompt.tools ?? []).filter(
    (tool: { type?: string }) => tool.type !== 'system'
  )

  const builtInTools = (() => {
    const enabledSet = new Set(enabledSystemTools)

    // Keep backward compatibility: only write built_in_tools when the agent
    // already uses that contract (object or array).
    if (Array.isArray(currentBuiltInTools)) {
      return [...enabledSet]
    }

    if (!isRecord(currentBuiltInTools)) {
      return undefined
    }

    const useBooleanValues = Object.values(currentBuiltInTools).every(
      (value) => typeof value === 'boolean'
    )

    if (useBooleanValues) {
      const next = { ...currentBuiltInTools } as Record<string, unknown>

      for (const toolName of Object.keys(SYSTEM_TOOL_TYPE_BY_NAME)) {
        next[toolName] = enabledSet.has(toolName)
      }

      return next
    }

    const next = { ...currentBuiltInTools } as Record<string, unknown>

    // Keep unknown built-in tools untouched. For known tools, ensure we always
    // send valid SystemToolConfig objects (name + params) expected by la plataforma.
    for (const toolName of Object.keys(SYSTEM_TOOL_TYPE_BY_NAME)) {
      if (!enabledSet.has(toolName)) {
        delete next[toolName]
        continue
      }

      const existing = next[toolName]
      const existingConfig = isRecord(existing)
        ? (existing as Record<string, unknown>)
        : undefined
      const existingParams = isRecord(existingConfig?.params)
        ? (existingConfig.params as Record<string, unknown>)
        : undefined
      const providedParams = isRecord(systemToolParamsByName[toolName])
        ? (systemToolParamsByName[toolName] as Record<string, unknown>)
        : undefined
      const params = normalizeSystemToolParams(toolName, providedParams ?? existingParams)

      next[toolName] = {
        ...(existingConfig ?? {}),
        type: 'system',
        name: toolName,
        description:
          typeof existingConfig?.description === 'string' ? existingConfig.description : '',
        params,
      }
    }

    return next
  })()

  const systemTools = enabledSystemTools.map((name) => {
    const existing = currentTools.find(
      (tool) => tool?.type === 'system' && tool?.name === name
    )

    const existingParams = isRecord(existing?.params)
      ? (existing.params as Record<string, unknown>)
      : undefined

    const providedParams = isRecord(systemToolParamsByName[name])
      ? (systemToolParamsByName[name] as Record<string, unknown>)
      : undefined

    const params = normalizeSystemToolParams(name, providedParams ?? existingParams)

    return {
      type: 'system' as const,
      name,
      description: typeof existing?.description === 'string' ? existing.description : '',
      params,
    }
  })

  const currentConversation = isRecord(
    (currentAgent.conversation_config as Record<string, unknown>).conversation
  )
    ? ((currentAgent.conversation_config as Record<string, unknown>).conversation as Record<
        string,
        unknown
      >)
    : {}

  const currentPlatformSettings = isRecord(currentAgent.platform_settings)
    ? (currentAgent.platform_settings as Record<string, unknown>)
    : {}

  const currentPrivacySettings = isRecord(currentPlatformSettings.privacy)
    ? (currentPlatformSettings.privacy as Record<string, unknown>)
    : {}

  return {
    name: values.name,
    conversation_config: {
      ...currentAgent.conversation_config,
      agent: {
        ...currentAgent.conversation_config.agent,
        prompt: {
          ...currentPrompt,
          prompt: values.prompt,
          llm: values.llm,
          temperature: values.llm_temperature,
          max_tokens: values.max_tokens,
          ignore_default_personality: values.ignore_default_personality,
          tools: [...customTools, ...systemTools],
          tool_ids: selectedToolIds,
          ...(builtInTools !== undefined ? { built_in_tools: builtInTools } : {}),
          // Preserve RAG as-is â€” managed exclusively by KnowledgeBaseTab
          rag: currentRag,
        },
        first_message: values.first_message,
        language: values.language,
      },
      tts: {
        ...(currentAgent.conversation_config.tts ?? {}),
        model_id: values.tts_model_id,
        voice_id: values.voice_id,
        // Send flat (la plataforma may use either structure)
        stability: values.stability,
        similarity_boost: values.similarity_boost,
        style: values.style,
        speed: values.speed,
        voice_settings: {
          stability: values.stability,
          similarity_boost: values.similarity_boost,
          style: values.style,
          speed: values.speed,
        },
      },
      turn: {
        ...(currentAgent.conversation_config.turn ?? {}),
        silence_end_timeout_ms: values.silence_end_timeout_ms,
      },
      conversation: {
        ...currentConversation,
        call_recording_enabled: values.call_recording_enabled,
      },
    },
    platform_settings: {
      ...currentPlatformSettings,
      call_recording_enabled: values.call_recording_enabled,
      privacy: {
        ...currentPrivacySettings,
        record_voice: values.call_recording_enabled,
      },
      ignore_default_personality: values.ignore_default_personality,
    },
  }
}

// Inner component: only mounts after agent data is available â†’ no flash
function VoiceAgentForm({ id, initialAgent }: { id: string; initialAgent: AgentDetail }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabId>('agent')
  const [editingName, setEditingName] = useState(false)
  const [enabledSystemTools, setEnabledSystemTools] = useState<string[]>(() =>
    buildSystemTools(initialAgent)
  )
  const [initialSystemTools, setInitialSystemTools] = useState<string[]>(() =>
    buildSystemTools(initialAgent)
  )
  const [systemToolParamsByName, setSystemToolParamsByName] = useState<SystemToolParamsMap>(() =>
    buildSystemToolParamsMap(initialAgent)
  )
  const [initialSystemToolParamsByName, setInitialSystemToolParamsByName] =
    useState<SystemToolParamsMap>(() => buildSystemToolParamsMap(initialAgent))
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>(() =>
    buildToolIds(initialAgent)
  )
  const [initialToolIds, setInitialToolIds] = useState<string[]>(() =>
    buildToolIds(initialAgent)
  )

  // Keep a ref to the latest agent for buildUpdatePayload (refreshed after background refetches)
  const agentRef = useRef<AgentDetail>(initialAgent)

  // Subscribe to query updates â€” agent might refetch in background
  const { data: agent } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => getAgent(id),
    initialData: initialAgent,
    staleTime: 0,
  })

  useEffect(() => {
    agentRef.current = agent
  }, [agent])

  const {
    register,
    handleSubmit,
    reset,
    watch,
    getValues,
    setValue,
    formState: { errors, isDirty },
  } = useForm<AgentFormValues>({
    shouldUnregister: false,
    defaultValues: buildDefaultValues(initialAgent),
  })

  const autoLanguageDetection = watch('auto_language_detection')

  // Keep Agent tab toggle in sync with the language_detection system tool.
  useEffect(() => {
    if (typeof autoLanguageDetection !== 'boolean') return

    const hasLanguageDetectionTool = enabledSystemTools.includes('language_detection')
    if (autoLanguageDetection === hasLanguageDetectionTool) return

    setEnabledSystemTools((prev) =>
      autoLanguageDetection
        ? prev.includes('language_detection')
          ? prev
          : [...prev, 'language_detection']
        : prev.filter((tool) => tool !== 'language_detection')
    )
  }, [autoLanguageDetection, enabledSystemTools])

  useEffect(() => {
    const hasLanguageDetectionTool = enabledSystemTools.includes('language_detection')
    const currentAutoDetection = getValues('auto_language_detection')

    if (currentAutoDetection !== hasLanguageDetectionTool) {
      setValue('auto_language_detection', hasLanguageDetectionTool, {
        shouldDirty: false,
      })
    }
  }, [enabledSystemTools, getValues, setValue])

  const hasSystemToolChanges =
    enabledSystemTools.length !== initialSystemTools.length ||
    enabledSystemTools.some((tool) => !initialSystemTools.includes(tool))

  const sharedSystemTools = enabledSystemTools.filter((tool) =>
    initialSystemTools.includes(tool)
  )

  const hasSystemToolConfigChanges = sharedSystemTools.some((toolName) => {
    const currentParams = normalizeSystemToolParams(
      toolName,
      systemToolParamsByName[toolName]
    )
    const initialParams = normalizeSystemToolParams(
      toolName,
      initialSystemToolParamsByName[toolName]
    )

    return stableStringify(currentParams) !== stableStringify(initialParams)
  })

  const hasWorkspaceToolChanges =
    selectedToolIds.length !== initialToolIds.length ||
    selectedToolIds.some((toolId) => !initialToolIds.includes(toolId))

  const hasPendingChanges =
    isDirty || hasSystemToolChanges || hasSystemToolConfigChanges || hasWorkspaceToolChanges

  const { mutate: save, mutateAsync: saveAsync, isPending: isSaving } = useMutation({
    mutationFn: (values: AgentFormValues) => {
      const configError = getSystemToolsConfigError(
        enabledSystemTools,
        systemToolParamsByName
      )
      if (configError) {
        throw new Error(configError)
      }

      return updateAgent(
        id,
        buildUpdatePayload(
          agentRef.current,
          values,
          enabledSystemTools,
          selectedToolIds,
          systemToolParamsByName
        )
      )
    },
    onSuccess: (updatedAgent, values) => {
      toast.success('Cambios guardados')

      const hasAgentShape =
        isRecord(updatedAgent) &&
        isRecord((updatedAgent as Record<string, unknown>).conversation_config) &&
        isRecord(
          ((updatedAgent as Record<string, unknown>).conversation_config as Record<
            string,
            unknown
          >).agent
        )

      if (hasAgentShape) {
        const nextAgent = updatedAgent as AgentDetail
        const nextDefaults = buildDefaultValues(nextAgent, values)
        const nextSystemTools = buildSystemTools(nextAgent)
        const nextSystemToolParams = buildSystemToolParamsMap(nextAgent)
        const nextToolIds = buildToolIds(nextAgent)

        agentRef.current = nextAgent
        queryClient.setQueryData(['agent', id], nextAgent)

        setEnabledSystemTools([...nextSystemTools])
        setInitialSystemTools([...nextSystemTools])
        setSystemToolParamsByName(nextSystemToolParams)
        setInitialSystemToolParamsByName(cloneSystemToolParamsMap(nextSystemToolParams))
        setSelectedToolIds([...nextToolIds])
        setInitialToolIds([...nextToolIds])
        reset(nextDefaults)
      } else {
        setInitialSystemTools([...enabledSystemTools])
        setInitialSystemToolParamsByName(cloneSystemToolParamsMap(systemToolParamsByName))
        setInitialToolIds([...selectedToolIds])
        reset(values)
      }

      queryClient.invalidateQueries({ queryKey: ['agent', id] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const handleSaveForPreview = async () => {
    const values = watch()
    await saveAsync(values)
  }

  const handleSystemToolToggle = (toolName: string, enabled: boolean) => {
    setEnabledSystemTools((prev) => {
      if (enabled) {
        return prev.includes(toolName) ? prev : [...prev, toolName]
      }
      return prev.filter((t) => t !== toolName)
    })

    if (enabled) {
      setSystemToolParamsByName((prev) => ({
        ...prev,
        [toolName]: normalizeSystemToolParams(toolName, prev[toolName]),
      }))
    }
  }

  const handleSystemToolParamsChange = (
    toolName: string,
    params: Record<string, unknown>
  ) => {
    setSystemToolParamsByName((prev) => ({
      ...prev,
      [toolName]: normalizeSystemToolParams(toolName, params),
    }))
  }

  const handleWorkspaceToolToggle = (toolId: string, enabled: boolean) => {
    setSelectedToolIds((prev) => {
      if (enabled) {
        return prev.includes(toolId) ? prev : [...prev, toolId]
      }
      return prev.filter((currentId) => currentId !== toolId)
    })
  }

  const watchedName = watch('name')
  const knowledgeBase: KnowledgeBaseItem[] =
    (agent?.conversation_config.agent.prompt.knowledge_base as KnowledgeBaseItem[]) ?? []

  return (
    <form
      onSubmit={handleSubmit((v) => save(v))}
      className="flex h-full min-h-0 w-full min-w-0 overflow-hidden"
    >
      {/* Left: Main content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <div className="px-8 py-4 border-b border-[#e4e0f5] bg-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate('/agentes_voz')}
              className="rounded-lg p-1.5 text-black/50 transition-colors hover:bg-[#f5f3ff] hover:text-[#271173]"
            >
              <ChevronLeftIcon className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2">
              {editingName ? (
                <input
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && setEditingName(false)}
                  className="bg-[#f5f3ff] border border-[#271173]/30 text-black rounded-xl px-3 py-1.5 text-sm font-semibold focus:outline-none focus:border-[#271173]"
                  {...register('name', {
                    required: true,
                    onBlur: () => setEditingName(false),
                  })}
                />
              ) : (
                <h1 className="text-black font-semibold text-lg">{watchedName || agent.name}</h1>
              )}
              <button
                type="button"
                onClick={() => setEditingName((p) => !p)}
                className="rounded p-1 text-black/40 transition-colors hover:text-black/70"
              >
                <PencilIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSaving || !hasPendingChanges}
            className={`flex items-center gap-2 bg-[#271173] hover:bg-[#1f0d5a] disabled:opacity-60 text-white px-4 py-2 rounded-xl text-sm font-semibold ${
              hasPendingChanges ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            style={{ transition: 'opacity 180ms ease, background-color 180ms ease' }}
          >
            {isSaving ? (
              <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <CheckIcon className="w-4 h-4" />
            )}
            {isSaving ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>

        {/* Tabs */}
        <div className="px-8 border-b border-[#e4e0f5] bg-white shrink-0">
          <div className="flex gap-0">
            {TABS.map((tab) => {
              const Icon = tab.icon
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  disabled={isSaving}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors disabled:cursor-not-allowed disabled:opacity-55 ${
                    active
                      ? 'border-[#271173] text-[#271173]'
                      : 'border-transparent text-black/50 hover:text-black/80'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {active && hasPendingChanges && (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  )}
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Tab content */}
        <div className="min-h-0 flex flex-1 items-stretch overflow-hidden px-8 py-6">
          {activeTab === 'agent' && (
            <div className="no-visible-scrollbar h-full min-h-0 w-full overflow-y-auto pr-2">
              <AgentTab
                register={register}
                watch={watch}
                setValue={setValue}
                errors={errors}
              />
            </div>
          )}
          {activeTab === 'knowledge' && (
            <div className="no-visible-scrollbar min-h-0 w-full overflow-y-auto pr-2">
              <KnowledgeBaseTab
                agentId={id}
                agent={agent}
                knowledgeBase={knowledgeBase}
                onUpdate={() => queryClient.invalidateQueries({ queryKey: ['agent', id] })}
              />
            </div>
          )}
          {activeTab === 'analysis' && (
            <div className="no-visible-scrollbar min-h-0 w-full overflow-y-auto pr-2">
              <AnalysisTab
                agentId={id}
                agent={agent}
                onUpdate={() => queryClient.invalidateQueries({ queryKey: ['agent', id] })}
              />
            </div>
          )}
          {activeTab === 'tools' && (
            <div className="no-visible-scrollbar min-h-0 w-full overflow-y-auto pr-2">
              <ToolsTab
                agent={agent}
                enabledSystemTools={enabledSystemTools}
                systemToolParamsByName={systemToolParamsByName}
                selectedToolIds={selectedToolIds}
                onSystemToolToggle={handleSystemToolToggle}
                onSystemToolParamsChange={handleSystemToolParamsChange}
                onWorkspaceToolToggle={handleWorkspaceToolToggle}
              />
            </div>
          )}
        </div>
      </div>

      {/* Right: Preview panel */}
      <AgentPreview
        agentId={id}
        agentName={watchedName || agent.name}
        isDirty={hasPendingChanges}
        onSave={handleSaveForPreview}
      />
    </form>
  )
}

// Outer component: handles loading/error, renders form only when data is ready
export default function VoiceAgentDetailView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: agent, isLoading, isError } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => getAgent(id!),
    enabled: !!id,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-black/60 gap-2.5">
        <div className="w-5 h-5 border-2 border-[#271173] border-t-transparent rounded-full animate-spin" />
        Cargando agente...
      </div>
    )
  }

  if (isError || !agent) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-black/60">No se pudo cargar el agente.</p>
        <button
          onClick={() => navigate('/agentes_voz')}
          className="text-[#271173] hover:text-[#1f0d5a] text-sm transition-colors"
        >
          â† Volver
        </button>
      </div>
    )
  }

  return <VoiceAgentForm id={id!} initialAgent={agent} />
}


