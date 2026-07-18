import { open } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Eye,
  FolderOpen,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useRef } from 'react'
import { toast } from 'sonner'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import type { UpdateJobInput } from '@/lib/bindings'
import {
  followupHistoryLabel,
  followupHistoryTime,
} from '@/lib/followup-history'
import { logger } from '@/lib/logger'
import { commands } from '@/lib/tauri-bindings'
import { cn } from '@/lib/utils'
import {
  useCreateFollowup,
  useFollowupEventsForJob,
  useFollowupsForJob,
} from '@/services/followups'
import { useDeleteJob, useJob, useUpdateJob } from '@/services/jobs'
import {
  useResolveSubmissionReceipts,
  useSubmissionReceiptsForJob,
} from '@/services/submissions'
import { useUIStore } from '@/store/ui-store'

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

// VAP truth status from packet import: provenance of the application materials,
// never permission to submit (the Submit Console confirmation still gates that).
function truthBadgeClass(status: string): string {
  switch (status) {
    case 'verified':
      return 'border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
    case 'stale':
      return 'border-yellow-200 bg-yellow-100 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
    default:
      return 'border-red-200 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400'
  }
}

function truthBadgeTitle(status: string): string {
  switch (status) {
    case 'verified':
      return 'Packet signature valid, artifacts intact, truth gate passed'
    case 'stale':
      return 'Packet files were edited after generation — re-run ApplyKit to restore'
    default:
      return 'Packet signature missing or invalid'
  }
}

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
                {job.truth_status ? (
                  <Badge
                    variant="outline"
                    className={cn(
                      'shrink-0 text-xs uppercase',
                      truthBadgeClass(job.truth_status)
                    )}
                    title={truthBadgeTitle(job.truth_status)}
                  >
                    {job.truth_status}
                  </Badge>
                ) : null}
              </SheetTitle>
              <SheetDescription>{job.role}</SheetDescription>
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

              <SubmissionHistorySection jobId={job.id} />

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

function submissionStatusLabel(status: string): string {
  switch (status) {
    case 'manual_required':
      return 'Manual required'
    case 'unknown_outcome':
      return 'Unknown outcome'
    case 'dry_run':
      return 'Dry run'
    default:
      return status.charAt(0).toUpperCase() + status.slice(1)
  }
}

function submissionStatusClass(status: string): string {
  switch (status) {
    case 'success':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
    case 'failed':
      return 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300'
    default:
      return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300'
  }
}

function SubmissionStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-500" />
    default:
      return <AlertTriangle className="h-4 w-4 text-amber-500" />
  }
}

function parseReceiptFieldCount(raw: string): number {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

function formatReceiptTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function SubmissionHistorySection({ jobId }: { jobId: string }) {
  const {
    data: receipts,
    isPending,
    isError,
  } = useSubmissionReceiptsForJob(jobId)
  const resolveReceipts = useResolveSubmissionReceipts()
  const unresolved = receipts?.find(
    receipt =>
      !receipt.resolved_at &&
      (receipt.status === 'manual_required' ||
        receipt.status === 'unknown_outcome')
  )

  return (
    <section className="space-y-2" aria-labelledby="submission-history-heading">
      <div className="flex items-center justify-between">
        <Label
          id="submission-history-heading"
          className="text-muted-foreground"
        >
          Submissions
        </Label>
        {receipts && receipts.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            {receipts.length} receipt{receipts.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      {isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading submission history…
        </p>
      ) : isError ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Submission history could not be loaded. Retry after the database is
          available.
        </p>
      ) : !receipts || receipts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No submissions yet.</p>
      ) : (
        <>
          {unresolved ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
              <p className="font-medium">Recovery action required</p>
              <p className="mt-1 text-xs">
                {unresolved.status === 'manual_required'
                  ? 'Complete or abandon the manual application step before allowing another automated attempt.'
                  : 'Verify the ATS or tracker before allowing another automated attempt.'}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 h-7"
                disabled={resolveReceipts.isPending}
                onClick={() => resolveReceipts.mutate(jobId)}
              >
                {unresolved.status === 'manual_required'
                  ? 'Mark manual step resolved'
                  : 'Mark externally verified'}
              </Button>
            </div>
          ) : null}

          <ol className="space-y-2" aria-label="Submission receipt history">
            {receipts.map(receipt => {
              const fieldCount = parseReceiptFieldCount(receipt.fields_filled)
              const isResolved =
                receipt.resolved_at &&
                (receipt.status === 'manual_required' ||
                  receipt.status === 'unknown_outcome')
              return (
                <li
                  key={receipt.id}
                  className="rounded-md border bg-muted/20 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <SubmissionStatusIcon status={receipt.status} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {submissionStatusLabel(receipt.status)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {receipt.adapter} ·{' '}
                          {formatReceiptTimestamp(receipt.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {isResolved ? (
                        <Badge variant="outline" className="text-[10px]">
                          Resolved
                        </Badge>
                      ) : null}
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px]',
                          submissionStatusClass(receipt.status)
                        )}
                      >
                        {receipt.duration_seconds.toFixed(1)}s
                      </Badge>
                    </div>
                  </div>
                  {receipt.error ? (
                    <p className="mt-2 break-words text-xs text-muted-foreground">
                      {receipt.error}
                    </p>
                  ) : null}
                  {fieldCount > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {fieldCount} field{fieldCount === 1 ? '' : 's'} filled
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ol>
        </>
      )}
    </section>
  )
}

function followupStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return 'Pending'
    case 'draft_ready':
      return 'Draft Ready'
    case 'send_unknown':
      return 'Verify Send'
    case 'sent':
      return 'Sent'
    default:
      return status
  }
}

function FollowupsSection({ jobId }: { jobId: string }) {
  const { data: followups, isPending, isError } = useFollowupsForJob(jobId)
  const {
    data: followupEvents,
    isPending: eventsArePending,
    isError: eventsAreError,
  } = useFollowupEventsForJob(jobId)
  const createFollowup = useCreateFollowup()
  const setActiveView = useUIStore(state => state.setActiveView)

  const activeFollowups = followups?.filter(f => f.status !== 'skipped')
  const hasOpenFollowup = followups?.some(f =>
    ['pending', 'draft_ready', 'send_unknown'].includes(f.status)
  )
  const canCreateFollowup =
    followups !== undefined && !isPending && !isError && !hasOpenFollowup

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
        {canCreateFollowup ? (
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
        ) : null}
      </div>
      {isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading follow-ups…
        </p>
      ) : isError ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Follow-ups could not be loaded. Retry after the database is available.
        </p>
      ) : !activeFollowups || activeFollowups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No follow-ups yet.</p>
      ) : (
        <div className="space-y-1.5">
          {activeFollowups.map(f => {
            const needsSendVerification = f.status === 'send_unknown'
            return (
              <button
                key={f.id}
                onClick={() => setActiveView('followups')}
                aria-label={
                  needsSendVerification
                    ? 'Verify Send. Check Gmail before sending again. Open Follow-up Manager.'
                    : undefined
                }
                className={cn(
                  'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50',
                  needsSendVerification &&
                    'border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/15'
                )}
              >
                <span className="min-w-0">
                  <span className="block text-muted-foreground">
                    {f.scheduled_date.split('T')[0]}
                  </span>
                  {needsSendVerification ? (
                    <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                      <AlertTriangle
                        aria-hidden="true"
                        className="h-3 w-3 shrink-0"
                      />
                      Check Gmail before sending again.
                    </span>
                  ) : null}
                </span>
                <Badge
                  variant={f.status === 'sent' ? 'default' : 'outline'}
                  className={cn(
                    'shrink-0 text-xs',
                    needsSendVerification &&
                      'border-amber-500/30 text-amber-700 dark:text-amber-400'
                  )}
                >
                  {followupStatusLabel(f.status)}
                </Badge>
              </button>
            )
          })}
        </div>
      )}
      <div className="border-t pt-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Activity history
        </p>
        {eventsArePending ? (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            Loading follow-up activity…
          </p>
        ) : eventsAreError ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            Follow-up activity could not be loaded. Retry after the database is
            available.
          </p>
        ) : followupEvents?.length ? (
          <ol className="mt-2 space-y-2">
            {followupEvents.map(event => (
              <li key={event.id} className="text-xs">
                <p className="font-medium">{followupHistoryLabel(event)}</p>
                <p className="text-muted-foreground">
                  {followupHistoryTime(event)}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            No follow-up activity recorded yet.
          </p>
        )}
      </div>
    </div>
  )
}
