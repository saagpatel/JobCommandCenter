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
import { ExternalLink, Trash2 } from 'lucide-react'
import { useUIStore } from '@/store/ui-store'
import { useJob, useUpdateJob, useDeleteJob } from '@/services/jobs'
import { openUrl } from '@tauri-apps/plugin-opener'
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
