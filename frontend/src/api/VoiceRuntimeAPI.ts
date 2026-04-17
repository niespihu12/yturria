import api from '@/lib/axios'
import { isAxiosError } from 'axios'
import type {
  AgentDetail,
  Conversation,
  ConversationDetail,
  ConversationsList,
  KnowledgeBaseDocument,
  KnowledgeBaseUsageMode,
  PhoneNumber,
  RagIndex,
  WorkspaceTool,
} from '@/types/agent'

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

export async function getAgents(options?: UserScopeOptions) {
  const userId = options?.userId ?? options?.user_id
  try {
    const { data } = await api.get('/agents', {
      params: {
        user_id: userId || undefined,
      },
    })
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function createAgent(payload: {
  name: string
  conversation_config: AgentDetail['conversation_config']
}) {
  try {
    const { data } = await api.post('/agents', payload)
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function deleteAgent(agentId: string) {
  try {
    const { data } = await api.delete(`/agents/${agentId}`)
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function getAgent(agentId: string): Promise<AgentDetail> {
  try {
    const { data } = await api.get(`/agents/${agentId}`)
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function getSignedUrl(agentId: string): Promise<string> {
  try {
    const { data } = await api.get(`/agents/${agentId}/signed-url`)
    const signedUrl = typeof data === 'string' ? data : data?.signed_url

    if (typeof signedUrl !== 'string' || !signedUrl) {
      throw new Error('signed_url no disponible')
    }

    return signedUrl
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function updateAgent(agentId: string, payload: Partial<AgentDetail>) {
  try {
    const { data } = await api.patch(`/agents/${agentId}`, payload)
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function getVoices() {
  try {
    const { data } = await api.get('/agents/voices')
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function getConversations(
  agentId: string,
  options?: { cursor?: string | null; page_size?: number }
): Promise<ConversationsList> {
  try {
    const { data } = await api.get(`/agents/${agentId}/conversations`, {
      params: {
        cursor: options?.cursor ?? undefined,
        page_size: options?.page_size ?? undefined,
      },
    })

    const conversations = Array.isArray(data?.conversations)
      ? (data.conversations as Conversation[])
      : []

    const nextCursor =
      typeof data?.next_cursor === 'string'
        ? data.next_cursor
        : typeof data?.cursor === 'string'
          ? data.cursor
          : null

    return {
      conversations,
      has_more: typeof data?.has_more === 'boolean' ? data.has_more : undefined,
      next_cursor: nextCursor,
      cursor: typeof data?.cursor === 'string' ? data.cursor : null,
    }
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function getConversationDetail(
  conversationId: string
): Promise<ConversationDetail> {
  try {
    const { data } = await api.get(`/agents/conversations/${conversationId}`)
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function getConversationAudioBlob(conversationId: string): Promise<Blob> {
  try {
    const { data } = await api.get(`/agents/conversations/${conversationId}/audio`, {
      responseType: 'blob',
    })
    return data as Blob
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function runConversationAnalysis(conversationId: string) {
  try {
    const { data } = await api.post(
      `/agents/conversations/${conversationId}/analysis/run`
    )
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function listKnowledgeBaseDocuments(): Promise<{
  documents: KnowledgeBaseDocument[]
}> {
  try {
    const { data } = await api.get('/agents/knowledge-base')
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function createKnowledgeBaseDocumentFromFile(file: File, name?: string) {
  const formData = new FormData()
  formData.append('file', file)
  if (name) formData.append('name', name)

  try {
    const { data } = await api.post('/agents/knowledge-base/file', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return data as Pick<KnowledgeBaseDocument, 'id' | 'name'>
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function createKnowledgeBaseDocumentFromText(text: string, name?: string) {
  try {
    const { data } = await api.post('/agents/knowledge-base/text', {
      text,
      ...(name ? { name } : {}),
    })
    return data as Pick<KnowledgeBaseDocument, 'id' | 'name'>
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function createKnowledgeBaseDocumentFromUrl(url: string, name?: string) {
  try {
    const { data } = await api.post('/agents/knowledge-base/url', {
      url,
      ...(name ? { name } : {}),
    })
    return data as Pick<KnowledgeBaseDocument, 'id' | 'name'>
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function deleteKnowledgeBaseDoc(documentationId: string) {
  try {
    const { data } = await api.delete(`/agents/knowledge-base/${documentationId}`)
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function updateKnowledgeBaseDoc(
  documentationId: string,
  payload: { name?: string; usage_mode?: KnowledgeBaseUsageMode }
) {
  try {
    const { data } = await api.patch(
      `/agents/knowledge-base/${documentationId}`,
      payload
    )
    return data as KnowledgeBaseDocument
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function getKnowledgeBaseRagIndexes(
  documentationId: string
): Promise<{ indexes: RagIndex[] }> {
  try {
    const { data } = await api.get(
      `/agents/knowledge-base/${documentationId}/rag-index`
    )
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function computeKnowledgeBaseRagIndex(
  documentationId: string,
  model: string
) {
  try {
    const { data } = await api.post(
      `/agents/knowledge-base/${documentationId}/rag-index`,
      { model }
    )
    return data as RagIndex
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function getTools(): Promise<{ tools: WorkspaceTool[] }> {
  try {
    const { data } = await api.get('/agents/tools')
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

type WebhookToolApiSchemaInput = {
  url: string
  method: string
  path_params_schema?: Record<string, unknown>
  query_params_schema?: Record<string, unknown> | null
  request_body_schema?: Record<string, unknown> | null
  request_headers?: Record<string, unknown>
  content_type?: 'application/json' | 'application/x-www-form-urlencoded'
  auth_connection?: Record<string, unknown> | null
}

type CreateWebhookToolPayload = {
  tool_config: {
    type: 'webhook'
    name: string
    description: string
    api_schema: WebhookToolApiSchemaInput
    response_timeout_secs?: number
    dynamic_variables?: { dynamic_variable_placeholders?: Record<string, unknown> }
    assignments?: Array<Record<string, unknown>>
    disable_interruptions?: boolean
    force_pre_tool_speech?: boolean
    tool_call_sound?: string | null
    tool_call_sound_behavior?: 'auto' | 'always'
    execution_mode?: 'immediate' | 'post_tool_speech' | 'async'
    tool_error_handling_mode?: 'auto' | 'summarized' | 'passthrough' | 'hide'
  }
  response_mocks?: Array<Record<string, unknown>>
}

export async function createTool(payload: CreateWebhookToolPayload): Promise<WorkspaceTool> {
  try {
    const { data } = await api.post('/agents/tools', payload)
    return data as WorkspaceTool
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function deleteTool(toolId: string): Promise<void> {
  try {
    await api.delete(`/agents/tools/${toolId}`)
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function getAgentWidget(agentId: string) {
  try {
    const { data } = await api.get(`/agents/${agentId}/widget`)
    return data
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function getPhoneNumbers(
  options?: UserScopeOptions
): Promise<PhoneNumber[]> {
  const userId = options?.userId ?? options?.user_id
  try {
    const { data } = await api.get('/agents/phone-numbers', {
      params: {
        user_id: userId || undefined,
      },
    })
    const numbers = data?.phone_numbers ?? data
    if (Array.isArray(numbers)) {
      return numbers as PhoneNumber[]
    }
    return []
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function createTwilioPhoneNumber(payload: {
  phone_number: string
  label: string
  sid: string
  token: string
}) {
  try {
    const { data } = await api.post('/agents/phone-numbers', payload)
    return data as { phone_number_id: string }
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function updatePhoneNumber(
  phoneNumberId: string,
  payload: {
    agent_id?: string | null
    label?: string | null
    livekit_stack?: 'standard' | 'static' | null
  }
) {
  try {
    const { data } = await api.patch(
      `/agents/phone-numbers/${phoneNumberId}`,
      payload
    )
    return data as PhoneNumber
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function createTwilioOutboundCall(payload: {
  agent_id: string
  agent_phone_number_id: string
  to_number: string
  conversation_initiation_client_data?: {
    user_id?: string
    dynamic_variables?: Record<string, string | number | boolean>
    source_info?: {
      source?: Record<string, string | number | boolean>
      version?: string
    }
    conversation_config_override?: Record<string, unknown>
    branch_id?: string
    environment?: string
    custom_llm_extra_body?: Record<string, unknown>
  }
  call_recording_enabled?: boolean
  telephony_call_config?: {
    ringing_timeout_secs?: number
  }
}) {
  try {
    const { data } = await api.post('/agents/twilio/outbound-call', payload)
    return data as {
      success?: boolean
      message?: string
      conversation_id?: string
      callSid?: string
      call_sid?: string
    }
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function getVoicePreview(
  voiceId: string
): Promise<{ preview_url: string }> {
  try {
    const { data } = await api.get(`/agents/voices/${voiceId}/preview`)
    return {
      preview_url: typeof data?.preview_url === 'string' ? data.preview_url : '',
    }
  } catch (error) {
    throw new Error(getError(error))
  }
}
