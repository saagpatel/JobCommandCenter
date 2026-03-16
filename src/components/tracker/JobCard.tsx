import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'
import type { Job } from '@/lib/bindings'

interface JobCardProps {
  job: Job
  isOverlay?: boolean
}

function daysAgo(dateStr: string): number {
  const then = new Date(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24))
}

export function JobCard({ job, isOverlay }: JobCardProps) {
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
