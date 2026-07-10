import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { Plus, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import type { Job } from '@/lib/bindings'
import { useJobs, useUpdateJob } from '@/services/jobs'
import { AddJobModal } from './AddJobModal'
import { ImportPacketModal } from './ImportPacketModal'
import { JobCard } from './JobCard'
import { JobDetailPanel } from './JobDetailPanel'
import { KanbanColumn } from './KanbanColumn'

const COLUMNS = [
  { id: 'saved', label: 'Saved' },
  { id: 'applied', label: 'Applied' },
  { id: 'interviewing', label: 'Interviewing' },
  { id: 'offer', label: 'Offer' },
  { id: 'rejected', label: 'Rejected' },
] as const

export function KanbanBoard() {
  const { data: jobs = [], isLoading } = useJobs()
  const updateJob = useUpdateJob()
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [activeJob, setActiveJob] = useState<Job | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  function handleDragStart(event: DragStartEvent) {
    const job = jobs.find(j => j.id === event.active.id)
    if (job) setActiveJob(job)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveJob(null)
    const { active, over } = event
    if (!over) return

    const jobId = active.id as string
    const newStatus = over.id as string
    const job = jobs.find(j => j.id === jobId)

    if (!job || job.status === newStatus) return

    const appliedAt =
      newStatus === 'applied' && !job.applied_at
        ? new Date().toISOString()
        : null

    updateJob.mutate({
      id: jobId,
      input: {
        company: null,
        role: null,
        ats: null,
        apply_url: null,
        status: newStatus,
        tier: null,
        job_posting_id: null,
        board_token: null,
        source: null,
        resume_path: null,
        cover_letter_path: null,
        custom_fields: null,
        notes: null,
        applied_at: appliedAt,
        follow_up_date: null,
        response_date: null,
        salary_range: null,
        location: null,
        jd_url: null,
      },
    })
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading jobs...</p>
      </div>
    )
  }

  const jobsByStatus = COLUMNS.map(col => ({
    ...col,
    jobs: jobs.filter(j => j.status === col.id),
  }))

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <h1 className="text-2xl font-bold tracking-tight">Tracker</h1>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setImportModalOpen(true)}
          >
            <ShieldCheck className="mr-1.5 h-4 w-4" />
            Import Packet
          </Button>
          <Button size="sm" onClick={() => setAddModalOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add Job
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 p-6" style={{ minWidth: 'max-content' }}>
            {jobsByStatus.map(col => (
              <KanbanColumn
                key={col.id}
                id={col.id}
                label={col.label}
                jobs={col.jobs}
              />
            ))}
          </div>

          <DragOverlay>
            {activeJob ? <JobCard job={activeJob} isOverlay /> : null}
          </DragOverlay>
        </DndContext>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      <AddJobModal open={addModalOpen} onOpenChange={setAddModalOpen} />
      <ImportPacketModal
        open={importModalOpen}
        onOpenChange={setImportModalOpen}
      />
      <JobDetailPanel />
    </div>
  )
}
