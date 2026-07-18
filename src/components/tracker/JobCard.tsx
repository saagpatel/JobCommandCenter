import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'
import type { Job } from '@/lib/bindings'
import type { SubmissionRecoveryStatus } from '@/services/submissions'

interface JobCardProps {
  job: Job
  isOverlay?: boolean
  recoveryStatus?: SubmissionRecoveryStatus
}

function daysAgo(dateStr: string): number {
  const then = new Date(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24))
}

export function JobCard({ job, isOverlay, recoveryStatus }: JobCardProps) {
  const setSelectedJobId = useUIStore(state => state.setSelectedJobId)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: job.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const appliedDays =
    job.status === 'applied' && job.applied_at ? daysAgo(job.applied_at) : null

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'cursor-grab select-none transition-shadow hover:shadow-md',
        isDragging && 'opacity-30',
        isOverlay && 'rotate-2 shadow-xl'
      )}
      onClick={() => {
        if (!isDragging) setSelectedJobId(job.id)
      }}
    >
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{job.company}</p>
            <p className="truncate text-xs text-muted-foreground">{job.role}</p>
          </div>
          <Badge
            variant={job.tier === 'tier1' ? 'default' : 'secondary'}
            className="shrink-0 text-[10px]"
          >
            {job.tier === 'tier1' ? 'T1' : 'T2'}
          </Badge>
        </div>

        {recoveryStatus ? (
          <div
            className={cn(
              'mt-2 flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-medium',
              recoveryStatus === 'manual_required'
                ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
                : 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-300'
            )}
          >
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span>
              {recoveryStatus === 'manual_required'
                ? 'Manual step required'
                : 'Outcome unknown'}
            </span>
          </div>
        ) : null}

        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] uppercase text-muted-foreground">
            {job.ats}
          </span>
          {appliedDays !== null && (
            <span
              className={cn(
                'ml-auto text-[10px] font-medium',
                appliedDays <= 7 && 'text-green-600 dark:text-green-400',
                appliedDays > 7 &&
                  appliedDays <= 14 &&
                  'text-yellow-600 dark:text-yellow-400',
                appliedDays > 14 && 'text-red-600 dark:text-red-400'
              )}
            >
              {appliedDays}d ago
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
