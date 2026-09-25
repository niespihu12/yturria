import { cn } from '@/lib/utils'
import { ESCALATION_STATUS_LABELS } from '@/lib/escalations'
import type { EscalationStatus } from '@/types/textAgent'

const STYLES: Record<EscalationStatus, string> = {
  pending: 'bg-warning-50 text-warning-700 ring-warning-500/30',
  in_progress: 'bg-info-50 text-info-700 ring-info-200',
  resolved: 'bg-success-50 text-success-700 ring-success-500/25',
}

export default function EscalationStatusBadge({
  status,
  className,
}: {
  status: EscalationStatus
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        STYLES[status] ?? STYLES.pending,
        className,
      )}
    >
      {ESCALATION_STATUS_LABELS[status] ?? ESCALATION_STATUS_LABELS.pending}
    </span>
  )
}
