export type TextProvider = 'openai' | 'gemini'

export type ProviderConfig = {
  provider: TextProvider
  has_api_key: boolean
  api_key_masked: string
  updated_at_unix_secs: number | null
  source: 'env' | 'user' | 'none'
  editable: boolean
}

export type ProviderConfigListResponse = {
  providers: ProviderConfig[]
  requires_user_keys: boolean
}

export type TextAgentSummary = {
  agent_id: string
  name: string
  provider: TextProvider
  model: string
  system_prompt: string
  welcome_message: string
  language: string
  temperature: number
  max_tokens: number
  created_at_unix_secs: number
  updated_at_unix_secs: number
  owner_user_id?: string
  owner_name?: string
  owner_email?: string
  owner_role?: string
}

export type ParametersSchema = {
  type?: string
  properties?: Record<string, { type: string; description?: string; default?: unknown }>
  required?: string[]
  [key: string]: unknown
}

export type ResponseMapping = {
  result_path?: string
  display_template?: string
  [key: string]: unknown
}

export type TextAgentTool = {
  id: string
  name: string
  description: string
  endpoint_url: string
  http_method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers: Record<string, string>
  parameters_schema: ParametersSchema
  response_mapping: ResponseMapping
  enabled: boolean
  created_at_unix_secs: number
  updated_at_unix_secs: number
}

export type TextKnowledgeBaseDocument = {
  id: string
  name: string
  source_type: 'text' | 'url' | 'file'
  source_value: string
  content_preview: string
  index_status: 'indexing' | 'indexed' | 'failed'
  chunk_count: number
  usage_mode?: 'auto' | 'prompt'
  created_at_unix_secs: number
  updated_at_unix_secs: number
}

export type TextConversation = {
  conversation_id: string
  agent_id: string
  status: string
  channel: 'web' | 'whatsapp'
  start_time_unix_secs: number
  updated_at_unix_secs: number
  message_count: number
  last_message_preview: string
}

export type TextConversationDetail = {
  conversation_id: string
  agent_id: string
  status: string
  channel?: string
  transcript: Array<{
    role: string
    message: string
    time_in_call_secs: number | null
  }>
  metadata?: {
    start_time_unix_secs?: number
    message_count?: number
  }
  analysis?: {
    transcript_summary?: string
    call_successful?: string
  }
}

export type WhatsAppProvider = 'meta' | 'twilio'

export type TextAgentWhatsApp = {
  id: string
  text_agent_id: string
  provider: WhatsAppProvider
  phone_number: string
  account_sid: string
  phone_number_id: string
  business_account_id: string
  webhook_verify_token: string
  has_credentials: boolean
  active: boolean
  created_at_unix_secs: number
  updated_at_unix_secs: number
}

export type TextAgentFormValues = {
  name: string
  model: string
  system_prompt: string
  welcome_message: string
  temperature: number
  max_tokens: number
}

export type TextAgentDetail = TextAgentSummary & {
  tools: TextAgentTool[]
  knowledge_base: TextKnowledgeBaseDocument[]
}

export const TEXT_PROVIDER_OPTIONS: Array<{ value: TextProvider; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Google Gemini' },
]

export const TEXT_PROVIDER_MODELS: Record<TextProvider, Array<{ value: string; label: string }>> = {
  openai: [
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { value: 'gpt-4.1', label: 'GPT-4.1' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  ],
  gemini: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  ],
}

export const WHATSAPP_PROVIDER_OPTIONS: Array<{ value: WhatsAppProvider; label: string; description: string }> = [
  {
    value: 'meta',
    label: 'Meta Cloud API',
    description: 'API oficial de WhatsApp Business. Requiere cuenta verificada de Meta Business.',
  },
  {
    value: 'twilio',
    label: 'Twilio',
    description: 'Integración via Twilio. Ideal para desarrollo y producción con sandbox incluido.',
  },
]
