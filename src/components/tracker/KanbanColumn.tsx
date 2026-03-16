import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { JobCard } from './JobCard'
import { cn } from '@/lib/utils'
import type { Job } from '@/lib/bindings'

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
}

export function KanbanColumn({ id, label, jobs }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id })

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
        <Badge variant="secondary" className="ml-auto text-xs">
          {jobs.length}
        </Badge>
      </div>

      <ScrollArea className="flex-1">
        <div ref={setNodeRef} className="flex min-h-[200px] flex-col gap-2 p-3">
          <SortableContext
            items={jobs.map(j => j.id)}
            strategy={verticalListSortingStrategy}
          >
            {jobs.map(job => (
              <JobCard key={job.id} job={job} />
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
