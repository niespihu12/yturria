import type { TextAgentTemplateKey } from '@/types/textAgent'

type TemplateCopy = { label: string; summary: string }

/** Textos de negocio para las plantillas (el backend entrega nombres técnicos). */
const TEMPLATE_COPY: Record<TextAgentTemplateKey, TemplateCopy> = {
  sofia: {
    label: 'Sofía',
    summary:
      'Atiende clientes de seguros, resuelve dudas y pasa la conversación a un asesor cuando hace falta.',
  },
  recepcionista: {
    label: 'Recepcionista',
    summary: 'Agenda citas, toma mensajes y responde las preguntas del día a día.',
  },
  faq_bot: {
    label: 'Preguntas frecuentes',
    summary: 'Responde solo con la información de sus documentos, sin inventar respuestas.',
  },
  custom: {
    label: 'Personalizado',
    summary: 'Empieza en blanco para configurar el asistente a su medida.',
  },
}

export function getTemplateCopy(
  key: TextAgentTemplateKey | string | undefined,
  fallback?: { label?: string; summary?: string },
): TemplateCopy {
  const known = key ? TEMPLATE_COPY[key as TextAgentTemplateKey] : undefined
  return {
    label: known?.label ?? fallback?.label ?? 'Personalizado',
    summary: known?.summary ?? fallback?.summary ?? '',
  }
}

export const KNOWLEDGE_ACCEPT = '.pdf,.txt,.md,.csv,.json,.html,.htm,.xml'
export const KNOWLEDGE_ACCEPT_LABEL = 'PDF, TXT, MD, CSV, JSON, HTML o XML · máximo 5 MB'

/** Traduce los errores de carga del backend a un mensaje sereno y en usted. */
export function friendlyUploadError(raw: unknown): string {
  const message = raw instanceof Error ? raw.message : String(raw ?? '')
  const text = message.toLowerCase()

  if (text.includes('protegido con contrase'))
    return 'El PDF está protegido con contraseña. Suba una versión sin protección.'
  if (text.includes('texto extraible') || text.includes('escaneado'))
    return 'El PDF no tiene texto seleccionable (puede ser un documento escaneado). Suba una versión con texto.'
  if (text.includes('leer el pdf'))
    return 'No pudimos leer el PDF. Verifique que el archivo abra correctamente.'
  if (text.includes('formato de archivo no soportado'))
    return 'Este formato no se admite. Suba un PDF o un archivo de texto; los documentos de Word deben guardarse antes como PDF.'
  if (text.includes('excede el maximo')) {
    const size = message.match(/(\d+)\s*MB/i)?.[1] ?? '5'
    return `El archivo supera el tamaño máximo de ${size} MB.`
  }
  if (text.includes('texto plano')) return 'El archivo no contiene texto legible.'
  if (text.includes('vacio') || text.includes('vacío')) return 'El archivo está vacío.'
  return 'No pudimos cargar el archivo. Intente de nuevo en unos minutos.'
}
