import { useRef } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  ExternalLink,
  Trash2,
  FolderOpen,
  Eye,
  CalendarClock,
  Plus,
} from 'lucide-react'
import { open } from '@tauri-apps/plugin-dialog'
import { toast } from 'sonner'
import { useUIStore } from '@/store/ui-store'
import { useJob, useUpdateJob, useDeleteJob } from '@/services/jobs'
import { useFollowupsForJob, useCreateFollowup } from '@/services/followups'
import { openUrl } from '@tauri-apps/plugin-opener'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import type { UpdateJobInput } from '@/lib/bindings'

const STATUS_OPTIONS = [
  'saved',
  'applied',
  'interviewing',
  'offer',
  'rejected',
] as const

const ATS_OPTIONS = [
  'ashby',
  'greenhouse',
  'gem',
  'workday',
  'linkedin',
  'indeed',
  'lever',
  'other',
] as const

function emptyUpdate(): UpdateJobInput {
  return {
    company: null,
    role: null,
    ats: null,
    apply_url: null,
    status: null,
    tier: null,
    job_posting_id: null,
    board_token: null,
    source: null,
    resume_path: null,
    cover_letter_path: null,
    custom_fields: null,
    notes: null,
    applied_at: null,
    follow_up_date: null,
    response_date: null,
    salary_range: null,
    location: null,
    jd_url: null,
  }
}

export function JobDetailPanel() {
  const selectedJobId = useUIStore(state => state.selectedJobId)
  const setSelectedJobId = useUIStore(state => state.setSelectedJobId)
  const { data: job } = useJob(selectedJobId)
  const updateJob = useUpdateJob()
  const deleteJob = useDeleteJob()

  const notesRef = useRef<HTMLTextAreaElement>(null)

  if (!selectedJobId) return null

  function handleFieldBlur(field: keyof UpdateJobInput, value: string) {
    if (!job) return
    const current = job[field as keyof typeof job]
    if (value === (current ?? '')) return

    const input = emptyUpdate()
    input[field] = value || null
    updateJob.mutate({ id: job.id, input })
  }

  function handleStatusChange(status: string) {
    if (!job || status === job.status) return
    const input = emptyUpdate()
    input.status = status
    if (status === 'applied' && !job.applied_at) {
      input.applied_at = new Date().toISOString()
    }
    updateJob.mutate({ id: job.id, input })
  }

  function handleNotesBlur() {
    if (!job || !notesRef.current) return
    const value = notesRef.current.value
    if (value === (job.notes ?? '')) return
    const input = emptyUpdate()
    input.notes = value || null
    updateJob.mutate({ id: job.id, input })
  }

  function handleDelete() {
    if (!job) return
    deleteJob.mutate(job.id, {
      onSuccess: () => setSelectedJobId(null),
    })
  }

  return (
    <Sheet
      open={!!selectedJobId}
      onOpenChange={open => {
        if (!open) setSelectedJobId(null)
      }}
    >
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        {job ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className="truncate">{job.company}</span>
                <Badge
                  variant={job.tier === 'tier1' ? 'default' : 'secondary'}
                  className="shrink-0 text-xs"
                >
                  {job.tier === 'tier1' ? 'T1' : 'T2'}
                </Badge>
              </SheetTitle>
              <p className="text-sm text-muted-foreground">{job.role}</p>
            </SheetHeader>

            <div className="mt-4 flex-1 space-y-4">
              <div className="flex gap-3">
                <div className="flex-1 space-y-1.5">
                  <Label>Status</Label>
                  <Select value={job.status} onValueChange={handleStatusChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map(s => (
                        <SelectItem key={s} value={s}>
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 space-y-1.5">
                  <Label>ATS</Label>
                  <Select
                    value={job.ats}
                    onValueChange={v => {
                      const input = emptyUpdate()
                      input.ats = v
                      updateJob.mutate({ id: job.id, input })
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ATS_OPTIONS.map(a => (
                        <SelectItem key={a} value={a}>
                          {a.charAt(0).toUpperCase() + a.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Company</Label>
                <Input
                  defaultValue={job.company}
                  onBlur={e => handleFieldBlur('company', e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Role</Label>
                <Input
                  defaultValue={job.role}
                  onBlur={e => handleFieldBlur('role', e.target.value)}
                />
              </div>

              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label>Apply URL</Label>
                  <Input
                    defaultValue={job.apply_url}
                    onBlur={e => handleFieldBlur('apply_url', e.target.value)}
                  />
                </div>
                {job.apply_url && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => openUrl(job.apply_url)}
                    title="Open in browser"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Location</Label>
                  <Input
                    defaultValue={job.location ?? ''}
                    onBlur={e => handleFieldBlur('location', e.target.value)}
                    placeholder="San Francisco, CA"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Salary Range</Label>
                  <Input
                    defaultValue={job.salary_range ?? ''}
                    onBlur={e =>
                      handleFieldBlur('salary_range', e.target.value)
                    }
                    placeholder="$150k - $200k"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Source</Label>
                  <Input
                    defaultValue={job.source ?? ''}
                    onBlur={e => handleFieldBlur('source', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>JD URL</Label>
                  <Input
                    defaultValue={job.jd_url ?? ''}
                    onBlur={e => handleFieldBlur('jd_url', e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Resume</Label>
                <div className="flex items-center gap-2">
                  <Input
                    defaultValue={job.resume_path ?? ''}
                    onBlur={e => handleFieldBlur('resume_path', e.target.value)}
                    placeholder="/path/to/resume.pdf"
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={async () => {
                      const selected = await open({
                        multiple: false,
                        filters: [{ name: 'PDF', extensions: ['pdf'] }],
                      })
                      if (selected) {
                        const input = emptyUpdate()
                        input.resume_path = selected
                        updateJob.mutate({ id: job.id, input })
                      }
                    }}
                    title="Browse for file"
                  >
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                  {job.resume_path && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={async () => {
                        const resumePath = job.resume_path
                        if (!resumePath) return
                        const result = await commands.revealInFinder(resumePath)
                        if (result.status === 'error') {
                          logger.error('Failed to reveal resume in Finder', {
                            error: result.error,
                          })
                          toast.error('Could not open Finder', {
                            description: result.error,
                          })
                        }
                      }}
                      title="Reveal in Finder"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Cover Letter</Label>
                <div className="flex items-center gap-2">
                  <Input
                    defaultValue={job.cover_letter_path ?? ''}
                    onBlur={e =>
                      handleFieldBlur('cover_letter_path', e.target.value)
                    }
                    placeholder="/path/to/cover-letter.pdf"
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={async () => {
                      const selected = await open({
                        multiple: false,
                        filters: [{ name: 'PDF', extensions: ['pdf'] }],
                      })
                      if (selected) {
                        const input = emptyUpdate()
                        input.cover_letter_path = selected
                        updateJob.mutate({ id: job.id, input })
                      }
                    }}
                    title="Browse for file"
                  >
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                  {job.cover_letter_path && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={async () => {
                        const coverLetterPath = job.cover_letter_path
                        if (!coverLetterPath) return
                        const result =
                          await commands.revealInFinder(coverLetterPath)
                        if (result.status === 'error') {
                          logger.error(
                            'Failed to reveal cover letter in Finder',
                            { error: result.error }
                          )
                          toast.error('Could not open Finder', {
                            description: result.error,
                          })
                        }
                      }}
                      title="Reveal in Finder"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              <Separator />

              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea
                  key={job.id}
                  ref={notesRef}
                  defaultValue={job.notes ?? ''}
                  onBlur={handleNotesBlur}
                  placeholder="Any notes about this role..."
                  rows={5}
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <Label className="text-muted-foreground">Submissions</Label>
                <p className="text-sm text-muted-foreground">
                  No submissions yet.
                </p>
              </div>

              <Separator />

              <FollowupsSection jobId={job.id} />

              <Separator />

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" className="w-full">
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    Delete Job
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this job?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete {job.company} &mdash;{' '}
                      {job.role}. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground">Loading...</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function FollowupsSection({ jobId }: { jobId: string }) {
  const { data: followups } = useFollowupsForJob(jobId)
  const createFollowup = useCreateFollowup()
  const setActiveView = useUIStore(state => state.setActiveView)

  const activeFollowups = followups?.filter(f => f.status !== 'skipped')

  function handleCreate() {
    const scheduledDate = new Date()
    scheduledDate.setDate(scheduledDate.getDate() + 7)
    createFollowup.mutate({
      job_id: jobId,
      scheduled_date: scheduledDate.toISOString().slice(0, 10),
      recipient_email: null,
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5 text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5" />
          Follow-ups
        </Label>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={handleCreate}
          disabled={createFollowup.isPending}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add
        </Button>
      </div>
      {!activeFollowups || activeFollowups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No follow-ups yet.</p>
      ) : (
        <div className="space-y-1.5">
          {activeFollowups.map(f => (
            <button
              key={f.id}
              onClick={() => setActiveView('followups')}
              className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
            >
              <span className="text-muted-foreground">
                {f.scheduled_date.split('T')[0]}
              </span>
              <Badge
                variant={f.status === 'sent' ? 'default' : 'outline'}
                className="text-xs"
              >
                {f.status === 'draft_ready' ? 'Draft' : f.status}
              </Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
