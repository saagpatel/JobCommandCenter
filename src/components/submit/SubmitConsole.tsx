import { useState } from 'react'
import {
  Send,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
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
import { cn } from '@/lib/utils'
import type { Job, SidecarState } from '@/lib/tauri-bindings'
import { useJobs, useUpdateJob } from '@/services/jobs'
import { useProfile } from '@/services/profile'
import { useSidecarStatus } from '@/services/sidecar'

interface SubmissionResult {
  job_id: string
  company: string
  role: string
  adapter: string
  status: 'success' | 'failed' | 'dry_run' | 'manual_required'
  resume_uploaded: boolean
  cover_letter_uploaded: boolean
  fields_filled: string[]
  fields_skipped: string[]
  error: string | null
  duration_seconds: number
  timestamp: string
}

const STATUS_OPTIONS = [
  'saved',
  'applied',
  'interview',
  'offer',
  'rejected',
] as const

function sidecarBadgeClass(state: SidecarState): string {
  switch (state) {
    case 'Starting':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800'
    case 'Healthy':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800'
    case 'Unhealthy':
      return 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800'
    case 'Stopped':
    case 'Failed':
      return 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800'
  }
}

function ResultIcon({ status }: { status: SubmissionResult['status'] }) {
  switch (status) {
    case 'success':
    case 'dry_run':
      return <CheckCircle2 className="size-4 text-emerald-500" />
    case 'failed':
      return <XCircle className="size-4 text-red-500" />
    case 'manual_required':
      return <AlertTriangle className="size-4 text-yellow-500" />
  }
}

function parseCustomFields(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath
}

export function SubmitConsole() {
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState('saved')
  const [submissionResults, setSubmissionResults] = useState<
    Map<string, SubmissionResult>
  >(new Map())
  const [isSubmitting, setIsSubmitting] = useState(false)

  const { data: jobs = [] } = useJobs(statusFilter)
  const { data: profile } = useProfile()
  const { data: sidecarStatus } = useSidecarStatus()
  const updateJob = useUpdateJob()

  const sidecarState: SidecarState = sidecarStatus?.state ?? 'Stopped'
  const isHealthy = sidecarState === 'Healthy'

  const selectedJobs = jobs.filter(j => selectedJobIds.has(j.id))
  const selectedCount = selectedJobIds.size

  function toggleJob(id: string) {
    setSelectedJobIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function toggleAll() {
    if (selectedCount === jobs.length && jobs.length > 0) {
      setSelectedJobIds(new Set())
    } else {
      setSelectedJobIds(new Set(jobs.map(j => j.id)))
    }
  }

  const allSelected = jobs.length > 0 && selectedCount === jobs.length

  async function handleSubmit(dryRun: boolean) {
    if (!profile) return
    setIsSubmitting(true)
    setSubmissionResults(new Map())

    const body = {
      jobs: selectedJobs.map(j => ({
        company: j.company,
        role: j.role,
        ats: j.ats,
        apply_url: j.apply_url,
        job_posting_id: j.job_posting_id,
        board_token: j.board_token,
        resume_path: j.resume_path ?? '',
        cover_letter_path: j.cover_letter_path,
        custom_fields: j.custom_fields
          ? (parseCustomFields(j.custom_fields) ?? {})
          : {},
      })),
      profile: {
        first_name: profile.first_name,
        last_name: profile.last_name,
        email: profile.email,
        phone: profile.phone,
        linkedin_url: profile.linkedin_url,
        location: profile.location,
        authorized_to_work: profile.authorized_to_work,
        requires_sponsorship: profile.requires_sponsorship,
        base_resume_path: profile.base_resume_path,
      },
      dry_run: dryRun,
    }

    try {
      const response = await fetch('http://127.0.0.1:9876/submit/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (reader) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const result: SubmissionResult = JSON.parse(line.slice(6))
            setSubmissionResults(prev =>
              new Map(prev).set(result.job_id, result)
            )

            if (!dryRun && result.status === 'success') {
              const matchedJob = selectedJobs.find(
                j => j.company === result.company && j.role === result.role
              )
              if (matchedJob) {
                updateJob.mutate({
                  id: matchedJob.id,
                  input: {
                    company: null,
                    role: null,
                    ats: null,
                    apply_url: null,
                    status: 'applied',
                    tier: null,
                    job_posting_id: null,
                    board_token: null,
                    source: null,
                    resume_path: null,
                    cover_letter_path: null,
                    custom_fields: null,
                    notes: null,
                    applied_at: new Date().toISOString(),
                    follow_up_date: new Date(
                      Date.now() + 7 * 24 * 60 * 60 * 1000
                    ).toISOString(),
                    response_date: null,
                    salary_range: null,
                    location: null,
                    jd_url: null,
                  },
                })
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Batch submission failed:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const actionsDisabled = selectedCount === 0 || !isHealthy || isSubmitting

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <h1 className="text-2xl font-bold">Submit Console</h1>
        <Badge
          variant="outline"
          className={cn(sidecarBadgeClass(sidecarState))}
        >
          {sidecarState}
        </Badge>
      </div>

      {/* Content: split panels */}
      <div className="flex min-h-0 flex-1">
        {/* Left panel — Job Selector */}
        <div className="flex w-72 shrink-0 flex-col border-r">
          <div className="border-b px-4 py-3">
            <select
              value={statusFilter}
              onChange={e => {
                setStatusFilter(e.target.value)
                setSelectedJobIds(new Set())
              }}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-xs text-muted-foreground">
              {selectedCount} of {jobs.length} selected
            </span>
            <button
              onClick={toggleAll}
              className="text-xs text-primary underline-offset-2 hover:underline"
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-0.5 p-2">
              {jobs.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  No jobs with status &quot;{statusFilter}&quot;
                </p>
              ) : (
                jobs.map(job => (
                  <JobRow
                    key={job.id}
                    job={job}
                    checked={selectedJobIds.has(job.id)}
                    onToggle={() => toggleJob(job.id)}
                  />
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right panel — Submission Preview */}
        <div className="flex flex-1 flex-col">
          {selectedCount === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
              <Send className="size-10 opacity-30" />
              <p className="text-sm">Select jobs to preview submission</p>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="flex flex-col gap-4 p-4">
                {selectedJobs.map(job => (
                  <JobPreviewCard
                    key={job.id}
                    job={job}
                    result={submissionResults.get(job.id) ?? null}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-between border-t p-4">
        <span className="text-sm text-muted-foreground">
          {selectedCount === 0
            ? 'No jobs selected'
            : `${selectedCount} job${selectedCount === 1 ? '' : 's'} selected`}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={actionsDisabled}
            onClick={() => handleSubmit(true)}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="animate-spin" />
                Running…
              </>
            ) : (
              'Dry Run'
            )}
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={actionsDisabled}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Submitting…
                  </>
                ) : (
                  'Submit Selected'
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Submit {selectedCount} application
                  {selectedCount === 1 ? '' : 's'}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This will submit {selectedCount} job application
                  {selectedCount === 1 ? '' : 's'} for real. This action cannot
                  be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => handleSubmit(false)}>
                  Submit
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  )
}

function JobRow({
  job,
  checked,
  onToggle,
}: {
  job: Job
  checked: boolean
  onToggle: () => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-accent">
      <Checkbox
        checked={checked}
        onCheckedChange={() => onToggle()}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{job.company}</p>
        <p className="truncate text-xs text-muted-foreground">{job.role}</p>
      </div>
      <Badge variant="outline" className="shrink-0 text-[10px]">
        {job.ats}
      </Badge>
    </label>
  )
}

function JobPreviewCard({
  job,
  result,
}: {
  job: Job
  result: SubmissionResult | null
}) {
  const customFields = parseCustomFields(job.custom_fields)

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4 pb-0 pt-0">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm">
            {job.company} — {job.role}
          </CardTitle>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant="outline" className="text-[10px]">
              {job.ats}
            </Badge>
            {result && <ResultIcon status={result.status} />}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5 px-4 py-0 text-xs">
        {job.resume_path && (
          <div className="flex gap-1.5">
            <span className="text-muted-foreground">Resume:</span>
            <span className="truncate font-medium">
              {basename(job.resume_path)}
            </span>
          </div>
        )}
        {job.cover_letter_path && (
          <div className="flex gap-1.5">
            <span className="text-muted-foreground">Cover letter:</span>
            <span className="truncate font-medium">
              {basename(job.cover_letter_path)}
            </span>
          </div>
        )}
        {customFields && Object.keys(customFields).length > 0 && (
          <div className="mt-1">
            <p className="mb-1 text-muted-foreground">Custom fields:</p>
            <div className="flex flex-wrap gap-1">
              {Object.entries(customFields).map(([k, v]) => (
                <Badge key={k} variant="secondary" className="text-[10px]">
                  {k}: {String(v)}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {result?.error && (
          <p className="mt-1 text-xs text-red-500">{result.error}</p>
        )}
        {result && (
          <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            <span
              className={cn(
                'font-medium',
                result.status === 'success' || result.status === 'dry_run'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : result.status === 'failed'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-yellow-600 dark:text-yellow-400'
              )}
            >
              {result.status === 'dry_run'
                ? 'Dry run'
                : result.status.charAt(0).toUpperCase() +
                  result.status.slice(1)}
            </span>
            <span>·</span>
            <span>{result.duration_seconds.toFixed(1)}s</span>
            {result.fields_filled.length > 0 && (
              <>
                <span>·</span>
                <span>{result.fields_filled.length} fields filled</span>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
