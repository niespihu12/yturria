import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'react-toastify'
import { ChevronLeftIcon, CheckIcon, PencilIcon } from '@heroicons/react/24/outline'
import { getAgent, updateAgent } from '@/api/VoiceRuntimeAPI'
import type { AgentDetail, AgentFormValues, KnowledgeBaseItem } from '@/types/agent'
import AgentTab from '@/components/app/agent/tabs/AgentTab'
import KnowledgeBaseTab from '@/components/app/agent/tabs/KnowledgeBaseTab'
import AnalysisTab from '@/components/app/agent/tabs/AnalysisTab'
import ToolsTab from '@/components/app/agent/tabs/ToolsTab'
import AgentPreview from '@/components/app/agent/AgentPreview'
import { describeError } from '@/components/app/agent/agentUi'
import Button from '@/components/ui/Button'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { cn } from '@/lib/utils'

const TABS = [
  { id: 'agent', label: 'Agente' },
  { id: 'knowledge', label: 'Base de conocimiento' },
  { id: 'analysis', label: 'Análisis' },
  { id: 'tools', label: 'Herramientas' },
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

const CLIENT_ALLOWED_SYSTEM_TOOLS = [
  'end_call',
  'transfer_to_number',
  'voicemail_detection',
]

function normalizeClientEnabledSystemTools(tools: string[]): string[] {
  const next = tools.filter((tool) => CLIENT_ALLOWED_SYSTEM_TOOLS.includes(tool))
  for (const required of CLIENT_ALLOWED_SYSTEM_TOOLS) {
    if (!next.includes(required)) {
      next.push(required)
    }
  }
  return next
}

function filterClientSystemToolParams(
  paramsByName: SystemToolParamsMap
): SystemToolParamsMap {
  const next: SystemToolParamsMap = {}
  for (const toolName of CLIENT_ALLOWED_SYSTEM_TOOLS) {
    next[toolName] = normalizeSystemToolParams(toolName, paramsByName[toolName])
  }
  return next
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
        return 'Para guardar «Transferir a un agente», indique al menos un agente de destino en Herramientas.'
      }
    }

    if (params.system_tool_type === 'transfer_to_number') {
      const validTransfers = transfers.filter(
        (item) => typeof item.phone_number === 'string' && item.phone_number.trim().length > 0
      )

      if (!validTransfers.length) {
        return 'Para guardar «Transferir a un número», indique al menos un número de destino en Herramientas.'
      }

      const hasInvalidPhone = validTransfers.some(
        (item) =>
          typeof item.phone_number === 'string' &&
          !E164_PHONE_PATTERN.test(item.phone_number.trim())
      )

      if (hasInvalidPhone) {
        return 'Escriba los números de transferencia con el indicativo del país, por ejemplo +573001234567.'
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tools: _currentPromptTools, tool_ids: _currentPromptToolIds, ...promptWithoutToolLinks } =
    currentPrompt as Record<string, unknown>
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

  const useToolIdsMode = selectedToolIds.length > 0
  const promptToolConfig = useToolIdsMode
    ? { tool_ids: selectedToolIds }
    : { tools: [...customTools, ...systemTools] }

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
          ...promptWithoutToolLinks,
          prompt: values.prompt,
          llm: values.llm,
          temperature: values.llm_temperature,
          max_tokens: values.max_tokens,
          ignore_default_personality: values.ignore_default_personality,
          ...promptToolConfig,
          ...(builtInTools !== undefined ? { built_in_tools: builtInTools } : {}),
          // Preserve RAG as-is - managed exclusively by KnowledgeBaseTab
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

// Inner component: only mounts after agent data is available -> no flash
function VoiceAgentForm({ id, initialAgent }: { id: string; initialAgent: AgentDetail }) {
  const queryClient = useQueryClient()
  const { isClient } = useCurrentUser()
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

  // Subscribe to query updates - agent might refetch in background
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
    control,
    watch,
    getValues,
    setValue,
    formState: { errors, isDirty },
  } = useForm<AgentFormValues>({
    shouldUnregister: false,
    defaultValues: buildDefaultValues(initialAgent),
  })

  const autoLanguageDetection = useWatch({ control, name: 'auto_language_detection' })

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isClient) return

    setEnabledSystemTools((prev) => normalizeClientEnabledSystemTools(prev))
    setInitialSystemTools((prev) => normalizeClientEnabledSystemTools(prev))
    setSystemToolParamsByName((prev) => filterClientSystemToolParams(prev))
    setInitialSystemToolParamsByName((prev) => filterClientSystemToolParams(prev))
  }, [isClient])

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
  /* eslint-enable react-hooks/set-state-in-effect */

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
      const systemToolsForSave = isClient
        ? normalizeClientEnabledSystemTools(enabledSystemTools)
        : enabledSystemTools

      const configError = getSystemToolsConfigError(
        systemToolsForSave,
        systemToolParamsByName
      )
      if (configError) {
        throw new Error(configError)
      }

      const payload = buildUpdatePayload(
        agentRef.current,
        values,
        systemToolsForSave,
        selectedToolIds,
        systemToolParamsByName
      )

      if (isClient) {
        payload.conversation_config.agent.prompt.llm = 'gpt-4.1-mini'
        payload.conversation_config.tts.model_id = 'eleven_turbo_v2_5'
      }

      return updateAgent(id, payload)
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
        const nextSystemTools = isClient
          ? normalizeClientEnabledSystemTools(buildSystemTools(nextAgent))
          : buildSystemTools(nextAgent)
        const nextSystemToolParams = isClient
          ? filterClientSystemToolParams(buildSystemToolParamsMap(nextAgent))
          : buildSystemToolParamsMap(nextAgent)
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
    onError: (error: Error) =>
      toast.error(describeError(error, 'No pudimos guardar los cambios. Intente de nuevo.')),
  })

  const handleSaveForPreview = async () => {
    const values = getValues()
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

  const watchedName = useWatch({ control, name: 'name' })
  const knowledgeBase: KnowledgeBaseItem[] =
    (agent?.conversation_config.agent.prompt.knowledge_base as KnowledgeBaseItem[]) ?? []

  const tabsId = useId()
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({})

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = TABS.length - 1
    if (nextIndex === null) return

    event.preventDefault()
    const nextTab = TABS[nextIndex].id
    setActiveTab(nextTab)
    tabRefs.current[nextTab]?.focus()
  }

  const agentName = watchedName || agent.name

  return (
    <form
      onSubmit={handleSubmit((v) => save(v))}
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden"
    >
      <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
        <div className="sticky top-0 z-20 shrink-0 border-b border-border-default bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 sm:px-8">
            <div className="flex min-w-0 items-center gap-1.5">
              <Link
                to="/agentes_voz"
                aria-label="Volver a agentes de voz"
                className="-ml-1.5 shrink-0 rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-primary-50 hover:text-primary-700"
              >
                <ChevronLeftIcon className="h-5 w-5" aria-hidden="true" />
              </Link>

              {editingName ? (
                <input
                  autoFocus
                  aria-label="Nombre del agente"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      setEditingName(false)
                    }
                  }}
                  className="min-w-0 rounded-lg border border-primary-500 bg-surface px-3 py-1.5 text-base font-semibold text-text-primary"
                  {...register('name', {
                    required: true,
                    onBlur: () => setEditingName(false),
                  })}
                />
              ) : (
                <h1 className="min-w-0 truncate font-display text-xl leading-tight text-primary-800 sm:text-2xl">
                  {agentName}
                </h1>
              )}
              <button
                type="button"
                onClick={() => setEditingName((p) => !p)}
                aria-label={editingName ? 'Terminar de editar el nombre' : 'Cambiar el nombre del agente'}
                className="shrink-0 rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-neutral-100 hover:text-text-primary"
              >
                <PencilIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              {hasPendingChanges && !isSaving && (
                <span className="text-sm text-text-tertiary">Cambios sin guardar</span>
              )}
              <Button
                type="submit"
                isLoading={isSaving}
                disabled={!hasPendingChanges}
                leftIcon={<CheckIcon className="h-4 w-4" aria-hidden="true" />}
              >
                {isSaving ? 'Guardando…' : 'Guardar cambios'}
              </Button>
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Secciones del agente"
            className="no-visible-scrollbar mt-2 flex overflow-x-auto px-4 sm:px-8"
          >
            {TABS.map((tab, index) => {
              const active = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  ref={(node) => {
                    tabRefs.current[tab.id] = node
                  }}
                  id={`${tabsId}-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`${tabsId}-panel`}
                  tabIndex={active ? 0 : -1}
                  disabled={isSaving}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                  className={cn(
                    'shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors first:-ml-3 xl:px-4 xl:first:-ml-4',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500',
                    'disabled:cursor-not-allowed disabled:opacity-60',
                    active
                      ? 'border-primary-600 text-primary-700'
                      : 'border-transparent text-text-tertiary hover:text-text-primary',
                  )}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        <div
          id={`${tabsId}-panel`}
          role="tabpanel"
          aria-labelledby={`${tabsId}-tab-${activeTab}`}
          className="px-4 py-6 sm:px-8 sm:py-8 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
        >
          <div className="mx-auto w-full max-w-5xl">
            {activeTab === 'agent' && (
              <AgentTab
                agentId={id}
                register={register}
                watch={watch}
                setValue={setValue}
                errors={errors}
                isClient={isClient}
              />
            )}
            {activeTab === 'knowledge' && (
              <KnowledgeBaseTab
                agentId={id}
                agent={agent}
                knowledgeBase={knowledgeBase}
                onUpdate={() => queryClient.invalidateQueries({ queryKey: ['agent', id] })}
                isClient={isClient}
              />
            )}
            {activeTab === 'analysis' && (
              <AnalysisTab
                agentId={id}
                agent={agent}
                onUpdate={() => queryClient.invalidateQueries({ queryKey: ['agent', id] })}
                isClient={isClient}
              />
            )}
            {activeTab === 'tools' && (
              <ToolsTab
                agent={agent}
                enabledSystemTools={enabledSystemTools}
                systemToolParamsByName={systemToolParamsByName}
                selectedToolIds={selectedToolIds}
                onSystemToolToggle={handleSystemToolToggle}
                onSystemToolParamsChange={handleSystemToolParamsChange}
                onWorkspaceToolToggle={handleWorkspaceToolToggle}
                isClient={isClient}
              />
            )}
          </div>
        </div>
      </div>

      <AgentPreview
        agentId={id}
        agentName={agentName}
        isDirty={hasPendingChanges}
        onSave={handleSaveForPreview}
      />
    </form>
  )
}

// Inner form mounts only when the agent and the user role are known.
export default function VoiceAgentDetailView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: agent, isLoading, isError, error } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => getAgent(id!),
    enabled: !!id,
  })
  // The form trims admin-only system tools for clients on mount, so it must not
  // mount before the role is known (a super admin would otherwise lose them on save).
  const { user, isLoading: isUserLoading } = useCurrentUser()

  if (isLoading || isUserLoading) {
    return (
      <div role="status" className="flex h-full items-center justify-center gap-2.5 text-sm text-text-secondary">
        <span
          aria-hidden="true"
          className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent"
        />
        Cargando agente…
      </div>
    )
  }

  if (isError || !agent || !user) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-text-primary">No pudimos abrir este agente</h1>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            {describeError(error, 'Es posible que ya no exista o que no tenga acceso a él.')}
          </p>
          <Button
            variant="outline"
            className="mt-5"
            leftIcon={<ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />}
            onClick={() => navigate('/agentes_voz')}
          >
            Volver a agentes de voz
          </Button>
        </div>
      </div>
    )
  }

  return <VoiceAgentForm id={id!} initialAgent={agent} />
}
