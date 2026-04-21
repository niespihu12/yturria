import api from '@/lib/axios'
import { isAxiosError } from 'axios'
import type {
  ProviderConfigListResponse,
  ProviderConfig,
  TextAgentDetail,
  TextAgentSummary,
  TextAgentTool,
  TextAgentWhatsApp,
  TextConversation,
  TextConversationDetail,
  TextKnowledgeBaseDocument,
  TextProvider,
  WhatsAppProvider,
  EscalatedConversation,
  EscalationStatus,
  UpcomingRenewal,
  TextAppointment,
  TextAppointmentStatus,
} from '@/types/textAgent'

type UserScopeOptions = {
  userId?: string
  user_id?: string
  [key: string]: unknown
}

function getError(error: unknown): string {
  if (isAxiosError(error) && error.response) {
    const detail = error.response.data?.detail
    if (typeof detail === 'string') return detail
    if (detail?.message) return detail.message
    return error.response.data?.error ?? 'Error al conectar'
  }
  return 'Error al conectar'
}

type SofiaConfigCarrier = {
  sofia_config_json?: unknown
  sofia_config?: unknown
  [key: string]: unknown
}

function normalizeSofiaConfigJson(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return '{}'
    try {
      const parsed = JSON.parse(trimmed)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? JSON.stringify(parsed)
        : '{}'
    } catch {
      return '{}'
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    try {
      return JSON.stringify(value)
    } catch {
      return '{}'
    }
  }

  return '{}'
}

function normalizeAgentSofiaConfig<T extends SofiaConfigCarrier>(agent: T): T {
  const configSource = agent.sofia_config_json ?? agent.sofia_config
  return {
    ...agent,
    sofia_config_json: normalizeSofiaConfigJson(configSource),
  }
}

// ── Agents ────────────────────────────────────────────────────────────────────

export async function getTextAgents(
  options?: UserScopeOptions
): Promise<{ agents: TextAgentSummary[] }> {
  const userId = options?.userId ?? options?.user_id
  try {
    const { data } = await api.get('/text-agents', {
      params: {
        user_id: userId || undefined,
      },
    })
    const agents = Array.isArray(data?.agents)
      ? data.agents.map((agent: SofiaConfigCarrier) => normalizeAgentSofiaConfig(agent))
      : []
    return { ...data, agents }
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function createTextAgent(payload: { name: string; provider: TextProvider; model?: string }) {
  try {
    const { data } = await api.post('/text-agents', payload)
    return data as TextAgentSummary
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function getTextAgent(agentId: string): Promise<TextAgentDetail> {
  try {
    const { data } = await api.get(`/text-agents/${agentId}`)
    return normalizeAgentSofiaConfig(data)
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function updateTextAgent(
  agentId: string,
  payload: Partial<{
    name: string
    model: string
    system_prompt: string
    welcome_message: string
    legal_notice: string
    language: string
    temperature: number
    max_tokens: number
    sofia_mode: boolean
    sofia_config_json: string
  }>
) {
  try {
    const requestPayload: Record<string, unknown> = { ...payload }

    if (payload.sofia_config_json !== undefined) {
      const normalizedSofiaConfigJson = normalizeSofiaConfigJson(payload.sofia_config_json)
      requestPayload.sofia_config_json = normalizedSofiaConfigJson
      requestPayload.sofia_config = JSON.parse(normalizedSofiaConfigJson)
    }

    const { data } = await api.patch(`/text-agents/${agentId}`, requestPayload)
    return normalizeAgentSofiaConfig(data) as TextAgentDetail
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function deleteTextAgent(agentId: string) {
  try {
    const { data } = await api.delete(`/text-agents/${agentId}`)
    return data as { deleted: boolean }
  } catch (error) {
    throw new Error(getError(error))
  }
}

// ── Provider configs ──────────────────────────────────────────────────────────

export async function listProviderConfigs(): Promise<ProviderConfigListResponse> {
  try {
    const { data } = await api.get('/text-agents/provider-configs')
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function saveProviderConfig(provider: TextProvider, apiKey: string) {
  try {
    const { data } = await api.put(`/text-agents/provider-configs/${provider}`, { api_key: apiKey })
    return data as ProviderConfig
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function deleteProviderConfig(provider: TextProvider) {
  try {
    const { data } = await api.delete(`/text-agents/provider-configs/${provider}`)
    return data as { deleted: boolean }
  } catch (error) {
    throw new Error(getError(error))
  }
}

// ── Tools ─────────────────────────────────────────────────────────────────────

export async function getTextAgentTools(agentId: string): Promise<{ tools: TextAgentTool[] }> {
  try {
    const { data } = await api.get(`/text-agents/${agentId}/tools`)
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function createTextAgentTool(
  agentId: string,
  payload: {
    name: string
    description?: string
    endpoint_url: string
    http_method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    headers?: Record<string, string>
    parameters_schema?: object
    response_mapping?: object
    enabled?: boolean
  }
) {
  try {
    const { data } = await api.post(`/text-agents/${agentId}/tools`, payload)
    return data as TextAgentTool
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function updateTextAgentTool(
  agentId: string,
  toolId: string,
  payload: Partial<{
    name: string
    description: string
    endpoint_url: string
    http_method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    headers: Record<string, string>
    parameters_schema: object
    response_mapping: object
    enabled: boolean
  }>
) {
  try {
    const { data } = await api.patch(`/text-agents/${agentId}/tools/${toolId}`, payload)
    return data as TextAgentTool
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function deleteTextAgentTool(agentId: string, toolId: string) {
  try {
    const { data } = await api.delete(`/text-agents/${agentId}/tools/${toolId}`)
    return data as { deleted: boolean }
  } catch (error) {
    throw new Error(getError(error))
  }
}

// ── Knowledge base ────────────────────────────────────────────────────────────

export async function listTextKnowledgeBaseDocuments(): Promise<{
  documents: TextKnowledgeBaseDocument[]
}> {
  try {
    const { data } = await api.get('/text-agents/knowledge-base')
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function createTextKnowledgeBaseDocumentFromFile(file: File, name?: string) {
  const formData = new FormData()
  formData.append('file', file)
  if (name) formData.append('name', name)

  try {
    const { data } = await api.post('/text-agents/knowledge-base/file', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data as TextKnowledgeBaseDocument
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function reindexKnowledgeBaseDocument(documentId: string) {
  try {
    const { data } = await api.post(`/text-agents/knowledge-base/${documentId}/reindex`)
    return data as TextKnowledgeBaseDocument
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function deleteTextKnowledgeBaseDocument(documentId: string) {
  try {
    const { data } = await api.delete(`/text-agents/knowledge-base/${documentId}`)
    return data as { deleted: boolean }
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function listAgentKnowledgeBase(agentId: string): Promise<{
  documents: TextKnowledgeBaseDocument[]
}> {
  try {
    const { data } = await api.get(`/text-agents/${agentId}/knowledge-base`)
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function attachKnowledgeBaseDocument(
  agentId: string,
  documentId: string,
  usageMode: 'auto' | 'prompt'
) {
  try {
    const { data } = await api.post(`/text-agents/${agentId}/knowledge-base/${documentId}`, {
      usage_mode: usageMode,
    })
    return data as { attached: boolean }
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function detachKnowledgeBaseDocument(agentId: string, documentId: string) {
  try {
    const { data } = await api.delete(`/text-agents/${agentId}/knowledge-base/${documentId}`)
    return data as { detached: boolean }
  } catch (error) {
    throw new Error(getError(error))
  }
}

// ── WhatsApp ──────────────────────────────────────────────────────────────────

export async function getWhatsAppConfig(agentId: string): Promise<{ config: TextAgentWhatsApp | null }> {
  try {
    const { data } = await api.get(`/text-agents/${agentId}/whatsapp`)
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function upsertWhatsAppConfig(
  agentId: string,
  payload: {
    provider: WhatsAppProvider
    phone_number?: string
    account_sid?: string
    auth_token?: string
    access_token?: string
    app_secret?: string
    phone_number_id?: string
    business_account_id?: string
    active?: boolean
  }
): Promise<{ config: TextAgentWhatsApp }> {
  try {
    const { data } = await api.put(`/text-agents/${agentId}/whatsapp`, payload)
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function deleteWhatsAppConfig(agentId: string) {
  try {
    const { data } = await api.delete(`/text-agents/${agentId}/whatsapp`)
    return data as { deleted: boolean }
  } catch (error) {
    throw new Error(getError(error))
  }
}

// ── Chat ──────────────────────────────────────────────────────────────────────

export async function chatWithTextAgent(
  agentId: string,
  payload: { message: string; conversation_id?: string }
) {
  try {
    const { data } = await api.post(`/text-agents/${agentId}/chat`, payload)
    return data as {
      conversation_id: string
      response: string
      provider: TextProvider
      model: string
      token_usage: number | null
    }
  } catch (error) {
    throw new Error(getError(error))
  }
}

// ── Conversations ─────────────────────────────────────────────────────────────

export async function getTextConversations(agentId: string): Promise<{ conversations: TextConversation[] }> {
  try {
    const { data } = await api.get(`/text-agents/${agentId}/conversations`)
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function getTextConversationDetail(conversationId: string): Promise<TextConversationDetail> {
  try {
    const { data } = await api.get(`/text-agents/conversations/${conversationId}`)
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function getUpcomingRenewals(
  days = 30,
  options?: UserScopeOptions
): Promise<{ renewals: UpcomingRenewal[] }> {
  const userId = options?.userId ?? options?.user_id
  try {
    const { data } = await api.get('/text-agents/renewals/upcoming', {
      params: {
        days,
        user_id: userId || undefined,
      },
    })
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function updateConversationRenewal(
  agentId: string,
  conversationId: string,
  payload: Partial<{
    renewal_date: string | number | null
    renewal_status:
      | 'none'
      | 'scheduled'
      | 'reminder_sent'
      | 'contacted'
      | 'renewed'
      | 'expired'
      | 'cancelled'
    renewal_note: string
    clear_reminder: boolean
  }>
) {
  try {
    const { data } = await api.patch(
      `/text-agents/${agentId}/conversations/${conversationId}/renewal`,
      payload
    )
    return data as {
      conversation_id: string
      renewal_date_unix_secs: number | null
      renewal_status:
        | 'none'
        | 'scheduled'
        | 'reminder_sent'
        | 'contacted'
        | 'renewed'
        | 'expired'
        | 'cancelled'
      renewal_note: string
      renewal_reminder_sent_at_unix_secs: number | null
      updated: boolean
    }
  } catch (error) {
    throw new Error(getError(error))
  }
}

// ── Appointments ─────────────────────────────────────────────────────────────

export async function getTextAgentAppointments(
  agentId: string,
  options?: {
    status?: TextAppointmentStatus
    from_unix?: number
    to_unix?: number
    limit?: number
  }
): Promise<{ appointments: TextAppointment[] }> {
  try {
    const safeLimit =
      typeof options?.limit === 'number'
        ? Math.max(1, Math.min(Math.trunc(options.limit), 200))
        : undefined

    const { data } = await api.get(`/text-agents/${agentId}/appointments`, {
      params: {
        status: options?.status,
        from_unix: options?.from_unix,
        to_unix: options?.to_unix,
        limit: safeLimit,
      },
    })
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function createTextAgentAppointment(
  agentId: string,
  payload: {
    appointment_date: string | number
    contact_name?: string
    contact_phone?: string
    contact_email?: string
    conversation_id?: string
    timezone?: string
    status?: TextAppointmentStatus
    source?: 'manual' | 'agent' | 'embed' | 'phone' | 'voice'
    notes?: string
  }
): Promise<TextAppointment> {
  try {
    const { data } = await api.post(`/text-agents/${agentId}/appointments`, payload)
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function updateTextAgentAppointment(
  agentId: string,
  appointmentId: string,
  payload: Partial<{
    appointment_date: string | number
    contact_name: string
    contact_phone: string
    contact_email: string
    conversation_id: string
    timezone: string
    status: TextAppointmentStatus
    notes: string
  }>
): Promise<TextAppointment> {
  try {
    const { data } = await api.patch(
      `/text-agents/${agentId}/appointments/${appointmentId}`,
      payload
    )
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function deleteTextAgentAppointment(agentId: string, appointmentId: string) {
  try {
    const { data } = await api.delete(`/text-agents/${agentId}/appointments/${appointmentId}`)
    return data as { deleted: boolean }
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function getTextAgentEmbedConfig(agentId: string): Promise<{
  agent_id: string
  agent_name: string
  embed_enabled: boolean
  iframe_url: string
  iframe_snippet: string
  script_snippet: string
  public_chat_endpoint: string
}> {
  try {
    const { data } = await api.get(`/text-agents/${agentId}/embed-config`)
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function getPublicTextAgentEmbedInfo(
  agentId: string,
  token: string
): Promise<{
  agent_id: string
  name: string
  welcome_message: string
  language: string
}> {
  try {
    const { data } = await api.get(`/text-agents/public/${agentId}/embed-info`, {
      params: { token },
    })
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function chatWithPublicTextAgentEmbed(
  agentId: string,
  payload: {
    token: string
    message: string
    conversation_id?: string
    session_id?: string
  }
): Promise<{
  conversation_id: string
  session_id: string
  response: string
  provider: string
  model: string
  token_usage: number | null
  escalated?: boolean
  intent?: string
}> {
  try {
    const { data } = await api.post(`/text-agents/public/${agentId}/chat`, payload)
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

// ── Escalations (Sofia) ───────────────────────────────────────────────────────

export async function getEscalations(
  agentId: string
): Promise<{ escalations: EscalatedConversation[] }> {
  try {
    const { data } = await api.get(`/text-agents/${agentId}/escalations`)
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function updateEscalation(
  agentId: string,
  conversationId: string,
  payload: { status: EscalationStatus }
): Promise<{ updated: boolean }> {
  try {
    const { data } = await api.patch(
      `/text-agents/${agentId}/escalations/${conversationId}`,
      payload
    )
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}
