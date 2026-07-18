import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { JobCard } from './JobCard'
import { cn } from '@/lib/utils'
import type { Job } from '@/lib/bindings'
import type { SubmissionRecoveryStatus } from '@/services/submissions'

const COLUMN_COLORS: Record<string, string> = {
  saved: 'bg-blue-500',
  applied: 'bg-yellow-500',
  interviewing: 'bg-purple-500',
  offer: 'bg-green-500',
  rejected: 'bg-red-500',
}

interface KanbanColumnProps {
  id: string
  label: string
  jobs: Job[]
  recoveryByJob: Partial<Record<string, SubmissionRecoveryStatus>>
}

export function KanbanColumn({
  id,
  label,
  jobs,
  recoveryByJob,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id })
  const blockedCount = jobs.filter(job => recoveryByJob[job.id]).length

  return (
    <div
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-lg border bg-muted/30',
        isOver && 'border-primary/50 bg-muted/60'
      )}
    >
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span className={cn('h-2.5 w-2.5 rounded-full', COLUMN_COLORS[id])} />
        <span className="text-sm font-semibold">{label}</span>
        <div className="ml-auto flex items-center gap-1">
          {blockedCount > 0 ? (
            <Badge
              variant="outline"
              className="border-amber-300 bg-amber-50 text-[10px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
            >
              {blockedCount} blocked
            </Badge>
          ) : null}
          <Badge variant="secondary" className="text-xs">
            {jobs.length}
          </Badge>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div ref={setNodeRef} className="flex min-h-[200px] flex-col gap-2 p-3">
          <SortableContext
            items={jobs.map(j => j.id)}
            strategy={verticalListSortingStrategy}
          >
            {jobs.map(job => (
              <JobCard
                key={job.id}
                job={job}
                recoveryStatus={recoveryByJob[job.id]}
              />
            ))}
          </SortableContext>

          {jobs.length === 0 && (
            <p className="py-8 text-center text-xs text-muted-foreground">
              Drop jobs here
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
