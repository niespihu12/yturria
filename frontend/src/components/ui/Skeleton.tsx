import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
  width?: string | number
  height?: string | number
  circle?: boolean
}

export default function Skeleton({
  className,
  width,
  height,
  circle = false,
}: SkeletonProps) {
  return (
    <div
      className={cn('skeleton', circle && 'rounded-full', className)}
      style={{
        width: width,
        height: height,
      }}
    />
  )
}

/* Pre-built skeleton layouts */
Skeleton.Card = function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('bg-surface rounded-2xl border border-border-default p-5 shadow-sm', className)}>
      <Skeleton width="40%" height={16} />
      <Skeleton className="mt-3" width="70%" height={28} />
      <Skeleton className="mt-4" width="100%" height={12} />
      <Skeleton className="mt-2" width="80%" height={12} />
    </div>
  )
}

Skeleton.TableRow = function SkeletonTableRow({
  columns = 4,
  className,
}: {
  columns?: number
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-4 py-4', className)}>
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton
          key={i}
          className="flex-1"
          height={16}
          width={i === 0 ? '60%' : i === columns - 1 ? '40%' : '80%'}
        />
      ))}
    </div>
  )
}

Skeleton.Kpi = function SkeletonKpi({ className }: { className?: string }) {
  return (
    <div className={cn('bg-surface rounded-2xl border border-border-default p-5 shadow-sm', className)}>
      <Skeleton width="50%" height={12} />
      <Skeleton className="mt-3" width="40%" height={36} />
      <Skeleton className="mt-2" width="60%" height={12} />
    </div>
  )
}
