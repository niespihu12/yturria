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
    return data
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
    return data
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
    language: string
    temperature: number
    max_tokens: number
    sofia_mode: boolean
    sofia_config_json: string
  }>
) {
  try {
    const { data } = await api.patch(`/text-agents/${agentId}`, payload)
    return data as TextAgentDetail
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
