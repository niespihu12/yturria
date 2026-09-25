import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { ChatBubbleLeftRightIcon, PhoneIcon } from '@heroicons/react/24/outline'
import {
  getTextAgentAppointments,
  getTextConversationDetail,
  updateEscalation,
} from '@/api/TextAgentsAPI'
import type { EscalationStatus } from '@/types/textAgent'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Skeleton from '@/components/ui/Skeleton'
import EscalationStatusBadge from '@/components/app/escalations/EscalationStatusBadge'
import { cn } from '@/lib/utils'
import {
  channelLabel,
  customerLabel,
  describeEscalationReason,
  formatDateTime,
  formatPhone,
  normalizePhone,
  phoneFromTitle,
  phoneFromTranscript,
  telHref,
  timeAgo,
  useNow,
  whatsappHref,
  type EscalationRow,
} from '@/lib/escalations'

type Props = {
  agentId: string
  conversationId: string
  /** Fila de la bandeja; puede llegar después si la conversación se abrió desde un enlace. */
  escalation?: EscalationRow
  onClose: () => void
}

const LINK_BUTTON =
  'inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2'
const LINK_PRIMARY = 'bg-primary-600 text-text-inverse shadow-sm hover:bg-primary-700'
const LINK_OUTLINE = 'border border-border-strong text-text-primary hover:bg-neutral-50'

function UndoToast({ message, onUndo }: { message: string; onUndo: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-text-primary">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="shrink-0 rounded-md px-2 py-1 text-sm font-semibold text-text-link underline-offset-2 hover:underline"
      >
        Deshacer
      </button>
    </div>
  )
}

export default function EscalationDetailModal({ agentId, conversationId, escalation, onClose }: Props) {
  const queryClient = useQueryClient()
  const now = useNow()

  const { data: detail, isLoading, isError } = useQuery({
    queryKey: ['text-conversation-detail', conversationId],
    queryFn: () => getTextConversationDetail(conversationId),
  })

  // Si el agente agendó una cita en esta conversación, la cita tiene nombre y teléfono del cliente.
  const { data: appointmentsData } = useQuery({
    queryKey: ['escalation-contact-appointments', agentId],
    queryFn: () => getTextAgentAppointments(agentId, { limit: 200 }),
    staleTime: 60_000,
  })

  const transcript = (detail?.transcript ?? []).filter((entry) => entry.role !== 'system')
  const appointment = appointmentsData?.appointments.find(
    (item) => item.conversation_id === conversationId,
  )
  const titlePhone = phoneFromTitle(escalation?.title)
  const appointmentPhone = normalizePhone(appointment?.contact_phone)
  const chatPhone = phoneFromTranscript(transcript)
  const phone = titlePhone ?? appointmentPhone ?? chatPhone
  const phoneSource = titlePhone
    ? 'Número desde el que escribió por WhatsApp'
    : appointmentPhone
      ? 'Dato de la cita que agendó'
      : 'Número que el cliente escribió en la conversación'
  const customerName = appointment?.contact_name?.trim() || null

  const channel = escalation?.channel ?? detail?.channel
  const status: EscalationStatus = escalation?.escalation_status ?? 'pending'
  const isResolved = status === 'resolved'
  const isWhatsApp = channel === 'whatsapp'

  const title = customerName ?? customerLabel(channel, phone)
  const description = [
    describeEscalationReason(escalation?.escalation_reason),
    channelLabel(channel),
    escalation?.escalated_at_unix_secs ? timeAgo(escalation.escalated_at_unix_secs, now) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const refreshLists = () => {
    queryClient.invalidateQueries({ queryKey: ['escalations', agentId] })
    queryClient.invalidateQueries({ queryKey: ['dashboard-real-data'] })
  }

  const restore = async (previous: EscalationStatus) => {
    try {
      await updateEscalation(agentId, conversationId, { status: previous })
      refreshLists()
      toast.info('La conversación volvió a pendientes.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo deshacer. Intente de nuevo.')
    }
  }

  const { mutate: changeStatus, isPending } = useMutation({
    mutationFn: (next: EscalationStatus) => updateEscalation(agentId, conversationId, { status: next }),
    onSuccess: (_result, next) => {
      refreshLists()
      if (next === 'resolved') {
        const previous: EscalationStatus = status === 'resolved' ? 'pending' : status
        toast.success(
          ({ closeToast }) => (
            <UndoToast
              message="Conversación marcada como resuelta."
              onUndo={() => {
                closeToast()
                void restore(previous)
              }}
            />
          ),
          { autoClose: 8000 },
        )
        onClose()
      } else {
        toast.info('La conversación volvió a pendientes.')
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'No se pudo actualizar la conversación. Intente de nuevo.')
    },
  })

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>
        Cerrar
      </Button>
      {isResolved ? (
        <Button variant="outline" onClick={() => changeStatus('pending')} isLoading={isPending}>
          Volver a pendientes
        </Button>
      ) : (
        <Button
          variant={phone ? 'secondary' : 'primary'}
          onClick={() => changeStatus('resolved')}
          isLoading={isPending}
          disabled={isLoading}
        >
          Marcar como resuelta
        </Button>
      )}
    </>
  )

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="tabular-nums">{title}</span>
          <EscalationStatusBadge status={status} />
        </span>
      }
      description={description}
      footer={footer}
    >
      <section aria-labelledby="escalation-contact" className="rounded-xl bg-surface-muted px-4 py-4">
        <h3 id="escalation-contact" className="text-sm font-semibold text-text-primary">
          Contacto
        </h3>
        {phone ? (
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-base font-medium tabular-nums text-text-primary">
                {customerName ? `${customerName} · ` : ''}
                {formatPhone(phone)}
              </p>
              <p className="mt-0.5 text-xs text-text-tertiary">{phoneSource}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href={whatsappHref(phone)}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(LINK_BUTTON, isWhatsApp ? LINK_PRIMARY : LINK_OUTLINE)}
              >
                <ChatBubbleLeftRightIcon className="h-4 w-4" aria-hidden="true" />
                Escribir por WhatsApp
              </a>
              <a href={telHref(phone)} className={cn(LINK_BUTTON, isWhatsApp ? LINK_OUTLINE : LINK_PRIMARY)}>
                <PhoneIcon className="h-4 w-4" aria-hidden="true" />
                Llamar
              </a>
            </div>
          </div>
        ) : (
          <p className="mt-1 max-w-[65ch] text-sm text-text-secondary">
            No hay un teléfono registrado para este cliente. Revise la conversación por si dejó otro
            dato de contacto.
          </p>
        )}
      </section>

      <section aria-labelledby="escalation-transcript" className="mt-6">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="escalation-transcript" className="text-sm font-semibold text-text-primary">
            Conversación
          </h3>
          {escalation?.escalated_at_unix_secs ? (
            <p className="text-xs text-text-tertiary">
              Pasó a una persona el {formatDateTime(escalation.escalated_at_unix_secs)}
            </p>
          ) : null}
        </div>

        {isLoading ? (
          <div className="mt-3 space-y-3" aria-label="Cargando conversación">
            <Skeleton height={48} width="70%" />
            <Skeleton height={48} width="60%" className="ml-auto" />
            <Skeleton height={48} width="65%" />
          </div>
        ) : isError ? (
          <p className="mt-3 text-sm text-danger-700">
            No se pudo cargar la conversación. Cierre y vuelva a abrirla para intentarlo de nuevo.
          </p>
        ) : transcript.length === 0 ? (
          <p className="mt-3 text-sm text-text-secondary">Esta conversación no tiene mensajes.</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {transcript.map((entry, index) => {
              const isCustomer = entry.role === 'user'
              return (
                <li key={index} className={cn('flex', isCustomer ? 'justify-start' : 'justify-end')}>
                  <div
                    className={cn(
                      'max-w-[85%] rounded-xl border px-4 py-2.5 text-sm leading-relaxed sm:max-w-[75%]',
                      isCustomer
                        ? 'border-border-default bg-surface text-text-primary'
                        : 'border-primary-100 bg-primary-50 text-text-primary',
                    )}
                  >
                    <span className="mb-0.5 block text-xs font-medium text-text-tertiary">
                      {isCustomer ? 'Cliente' : 'Agente'}
                    </span>
                    <p className="whitespace-pre-wrap">{entry.message}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </Modal>
  )
}
