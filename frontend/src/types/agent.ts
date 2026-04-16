import { z } from 'zod'

export const voiceSchema = z.object({
  voice_id: z.string(),
  name: z.string(),
  category: z.string().optional(),
  preview_url: z.string().optional(),
})

export const knowledgeBaseUsageModeSchema = z.enum(['auto', 'prompt'])

export const knowledgeBaseMetadataSchema = z.object({
  created_at_unix_secs: z.number().optional(),
  last_updated_at_unix_secs: z.number().optional(),
  size_bytes: z.number().optional(),
})

export const knowledgeBaseItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  usage_mode: knowledgeBaseUsageModeSchema.optional(),
  supported_usages: z.array(knowledgeBaseUsageModeSchema).optional(),
  metadata: knowledgeBaseMetadataSchema.optional(),
  created_at_unix_secs: z.number().optional(),
})

export const knowledgeBaseDocumentSchema = knowledgeBaseItemSchema.extend({
  url: z.string().optional(),
  extracted_inner_html: z.string().optional(),
  folder_parent_id: z.string().optional(),
})

export const ragIndexSchema = z.object({
  id: z.string(),
  model: z.string(),
  status: z.string(),
  progress_percentage: z.number().optional(),
  document_model_index_usage: z
    .object({
      used_bytes: z.number().optional(),
    })
    .optional(),
})

export const analysisCriterionSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  conversation_goal_prompt: z.string().optional(),
  use_knowledge_base: z.boolean().optional(),
  scope: z.string().optional(),
})

export const dataCollectionFieldSchema = z.object({
  type: z.string(),
  description: z.string().optional(),
})

export const conversationSchema = z.object({
  conversation_id: z.string(),
  agent_id: z.string(),
  start_time_unix_secs: z.number(),
  call_duration_secs: z.number().optional(),
  status: z.string(),
  transcript: z
    .array(
      z.object({
        role: z.string(),
        message: z.string(),
        time_in_call_secs: z.number().optional(),
      })
    )
    .optional(),
})

export const conversationsListSchema = z.object({
  conversations: z.array(conversationSchema),
  has_more: z.boolean().optional(),
  next_cursor: z.string().optional().nullable(),
  cursor: z.string().optional().nullable(),
})

export const conversationAnalysisSchema = z.object({
  evaluation_criteria_results: z
    .record(
      z.string(),
      z.object({
        criteria_id: z.string().optional(),
        result: z.string().optional(),
        rationale: z.string().optional(),
      })
    )
    .optional(),
  data_collection_results: z
    .record(
      z.string(),
      z.object({
        data_collection_id: z.string().optional(),
        value: z.any().optional(),
        rationale: z.string().optional(),
      })
    )
    .optional(),
  call_successful: z.string().optional(),
  transcript_summary: z.string().optional(),
})

export const conversationDetailSchema = z.object({
  agent_id: z.string(),
  conversation_id: z.string(),
  status: z.string(),
  has_audio: z.boolean().optional(),
  has_user_audio: z.boolean().optional(),
  has_response_audio: z.boolean().optional(),
  audio_url: z.string().optional(),
  recording_url: z.string().optional(),
  signed_audio_url: z.string().optional(),
  transcript: z
    .array(
      z.object({
        role: z.string(),
        message: z.string(),
        time_in_call_secs: z.number().optional(),
      })
    )
    .optional(),
  metadata: z
    .object({
      start_time_unix_secs: z.number().optional(),
      call_duration_secs: z.number().optional(),
      audio_url: z.string().optional(),
      recording_url: z.string().optional(),
      call_recording_url: z.string().optional(),
      signed_audio_url: z.string().optional(),
    })
    .optional(),
  analysis: conversationAnalysisSchema.optional().nullable(),
})

export const systemToolSchema = z.object({
  type: z.literal('system'),
  name: z.string(),
  description: z.string().optional(),
})

export const webhookToolSchema = z.object({
  type: z.literal('webhook'),
  id: z.string().optional(),
  name: z.string(),
  description: z.string(),
  api_schema: z
    .object({
      url: z.string(),
      method: z.string().optional(),
    })
    .optional(),
})

export const workspaceToolSchema = z.object({
  id: z.string(),
  tool_config: z.object({
    name: z.string(),
    description: z.string().optional(),
    type: z.string().optional(),
    api_schema: z
      .object({
        url: z.string().optional(),
        method: z.string().optional(),
      })
      .optional(),
  }),
  access_info: z
    .object({
      is_creator: z.boolean().optional(),
      creator_name: z.string().optional(),
      creator_email: z.string().optional(),
      role: z.string().optional(),
    })
    .optional(),
})

export const phoneNumberSchema = z.object({
  provider: z.string(),
  label: z.string(),
  phone_number: z.string(),
  phone_number_id: z.string(),
  supports_inbound: z.boolean().optional(),
  supports_outbound: z.boolean().optional(),
  assigned_agent: z
    .object({
      agent_id: z.string(),
      agent_name: z.string().optional(),
    })
    .optional()
    .nullable(),
  livekit_stack: z.string().optional(),
  inbound_trunk: z
    .object({
      allowed_addresses: z.array(z.string()).optional(),
      media_encryption: z.string().optional(),
      has_auth_credentials: z.boolean().optional(),
    })
    .optional(),
  outbound_trunk: z
    .object({
      address: z.string().optional(),
      transport: z.string().optional(),
      media_encryption: z.string().optional(),
      has_auth_credentials: z.boolean().optional(),
    })
    .optional(),
})

export const agentFormSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
  prompt: z.string(),
  first_message: z.string(),
  language: z.string(),
  llm: z.string(),
  voice_id: z.string(),
  tts_model_id: z.string(),
  stability: z.number(),
  similarity_boost: z.number(),
  style: z.number(),
  speed: z.number(),
  llm_temperature: z.number(),
  max_tokens: z.number(),
  silence_end_timeout_ms: z.number(),
  call_recording_enabled: z.boolean(),
  ignore_default_personality: z.boolean(),
  auto_language_detection: z.boolean(),
  system_tools: z.array(z.string()),
  rag_top_k: z.number().optional(),
  rag_enabled: z.boolean().optional(),
})

export const agentListItemSchema = z.object({
  agent_id: z.string(),
  name: z.string(),
  created_at_unix_secs: z.number(),
  access_info: z
    .object({
      creator_email: z.string().optional(),
      creator_name: z.string().optional(),
    })
    .optional(),
})

export const agentDetailSchema = z.object({
  agent_id: z.string(),
  name: z.string(),
  conversation_config: z.object({
    agent: z.object({
      prompt: z.object({
        prompt: z.string().default(''),
        llm: z.string().default('gemini-2.5-flash'),
        temperature: z.number().optional(),
        max_tokens: z.number().optional(),
        ignore_default_personality: z.boolean().nullable().optional(),
        tools: z.array(z.any()).optional(),
        tool_ids: z.array(z.string()).optional(),
        knowledge_base: z.array(knowledgeBaseItemSchema).optional(),
        built_in_tools: z.record(z.string(), z.any()).optional(),
        rag: z
          .object({
            enabled: z.boolean().optional(),
            embedding_model: z.string().optional(),
            max_vector_distance: z.number().optional(),
            max_documents_length: z.number().optional(),
            max_retrieved_rag_chunks_count: z.number().optional(),
            max_chunks_per_query: z.number().optional(),
          })
          .optional(),
      }),
      first_message: z.string().default(''),
      language: z.string().nullable().optional(),
    }),
    tts: z
      .object({
        voice_id: z.string(),
        model_id: z.string().optional(),
        // ElevenLabs may return voice settings flat at tts level
        stability: z.number().optional(),
        similarity_boost: z.number().optional(),
        style: z.number().optional(),
        speed: z.number().optional(),
        voice_settings: z
          .object({
            stability: z.number().optional(),
            similarity_boost: z.number().optional(),
            style: z.number().optional(),
            speed: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    turn: z
      .object({
        silence_end_timeout_ms: z.number().optional(),
        optimize_streaming_latency: z.number().optional(),
      })
      .optional(),
    conversation: z
      .object({
        call_recording_enabled: z.boolean().optional(),
        max_duration_seconds: z.number().optional(),
        client_events: z.array(z.string()).optional(),
      })
      .optional(),
  }),
  platform_settings: z
    .object({
      evaluation: z
        .object({
          criteria: z.array(analysisCriterionSchema).optional(),
        })
        .optional(),
      data_collection: z.record(z.string(), dataCollectionFieldSchema).optional(),
      data_collection_scopes: z.record(z.string(), z.string()).optional(),
      summary_language: z.string().optional(),
      privacy: z
        .object({
          record_voice: z.boolean().optional(),
          recordVoice: z.boolean().optional(),
        })
        .passthrough()
        .optional(),
      call_recording_enabled: z.boolean().optional(),
      ignore_default_personality: z.boolean().optional(),
    })
    .optional()
    .nullable(),
  phone_numbers: z.array(phoneNumberSchema).optional().nullable(),
  metadata: z
    .object({
      created_at_unix_secs: z.number().optional(),
    })
    .optional(),
})

export type Voice = z.infer<typeof voiceSchema>
export type KnowledgeBaseItem = z.infer<typeof knowledgeBaseItemSchema>
export type KnowledgeBaseDocument = z.infer<typeof knowledgeBaseDocumentSchema>
export type KnowledgeBaseUsageMode = z.infer<typeof knowledgeBaseUsageModeSchema>
export type RagIndex = z.infer<typeof ragIndexSchema>
export type AnalysisCriterion = z.infer<typeof analysisCriterionSchema>
export type DataCollectionField = z.infer<typeof dataCollectionFieldSchema>
export type Conversation = z.infer<typeof conversationSchema>
export type ConversationsList = z.infer<typeof conversationsListSchema>
export type ConversationAnalysis = z.infer<typeof conversationAnalysisSchema>
export type ConversationDetail = z.infer<typeof conversationDetailSchema>
export type WorkspaceTool = z.infer<typeof workspaceToolSchema>
export type PhoneNumber = z.infer<typeof phoneNumberSchema>
export type AgentListItem = z.infer<typeof agentListItemSchema>
export type AgentDetail = z.infer<typeof agentDetailSchema>
export type AgentFormValues = z.infer<typeof agentFormSchema>

export const SUPPORTED_LLMS = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
  { value: 'gpt-5-mini', label: 'GPT-5 Mini' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { value: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
  { value: 'gpt-oss-120b', label: 'ElevenLabs GPT-OSS 120B' },
]

export const RAG_EMBEDDING_MODELS = [
  { value: 'e5_mistral_7b_instruct', label: 'E5 Mistral 7B Instruct' },
  {
    value: 'multilingual_e5_large_instruct',
    label: 'Multilingual E5 Large Instruct',
  },
  { value: 'qwen3_embedding_4b', label: 'Qwen3 Embedding 4B' },
]

export const ANALYSIS_SCOPES = [
  { value: 'conversation', label: 'Conversacion completa' },
  { value: 'agent', label: 'Agente especifico' },
]

export const DATA_COLLECTION_TYPES = [
  { value: 'string', label: 'String' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'integer', label: 'Integer' },
  { value: 'number', label: 'Number' },
]

export const SUPPORTED_LANGUAGES = [
  { value: 'es', label: 'Espa\u00f1ol' },
  { value: 'en', label: 'English' },
  { value: 'pt', label: 'Portugu\u00eas' },
  { value: 'fr', label: 'Fran\u00e7ais' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
]

export const SYSTEM_TOOLS = [
  {
    name: 'end_call',
    label: 'Terminar conversaci\u00f3n',
    description: 'Permite al agente finalizar la llamada.',
  },
  {
    name: 'language_detection',
    label: 'Detectar idioma',
    description: 'Detecta el idioma del usuario.',
  },
  {
    name: 'skip_turn',
    label: 'Saltar turno',
    description: 'Permite al agente saltar su turno.',
  },
  {
    name: 'transfer_to_agent',
    label: 'Transferir a un agente',
    description: 'Transfiere la llamada a otro agente.',
  },
  {
    name: 'transfer_to_number',
    label: 'Transferir a un n\u00famero',
    description: 'Transfiere la llamada a un n\u00famero de tel\u00e9fono.',
  },
  {
    name: 'dtmf',
    label: 'Reproducir tono de teclado',
    description: 'Reproduce tonos DTMF.',
  },
  {
    name: 'voicemail_detection',
    label: 'Detecci\u00f3n de buz\u00f3n de voz',
    description: 'Detecta si se conect\u00f3 a un buz\u00f3n de voz.',
  },
]
