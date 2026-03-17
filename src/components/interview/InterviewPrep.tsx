import { useState } from 'react'
import Markdown from 'react-markdown'
import { BookOpen, Loader2, RefreshCw, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { useJobs } from '@/services/jobs'
import { useNotesForJob, useUpdateNote } from '@/services/notes'
import { useGenerateInterviewPrep } from '@/services/interview'
import type { Job } from '@/lib/bindings'

function PrepCard({
  job,
  onSelect,
  isSelected,
}: {
  job: Job
  onSelect: () => void
  isSelected: boolean
}) {
  const { data: notes } = useNotesForJob(job.id)
  const prepNote = notes?.find(n => n.note_type === 'interview_prep')
  const hasBrief = prepNote && prepNote.content.length > 0

  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-lg border p-4 text-left transition-colors ${
        isSelected
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-primary/50'
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold">{job.company}</p>
          <p className="text-sm text-muted-foreground">{job.role}</p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            hasBrief
              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
          }`}
        >
          {hasBrief ? 'Prepared' : 'Needs Prep'}
        </span>
      </div>
    </button>
  )
}

function PrepDetail({ job }: { job: Job }) {
  const { data: notes } = useNotesForJob(job.id)
  const updateNote = useUpdateNote()
  const generatePrep = useGenerateInterviewPrep()
  const [personalNotes, setPersonalNotes] = useState('')

  const prepNote = notes?.find(n => n.note_type === 'interview_prep')
  const hasBrief = prepNote && prepNote.content.length > 0

  async function handleGenerate() {
    if (!prepNote) return

    const result = await generatePrep.mutateAsync({
      company: job.company,
      role: job.role,
      jd_url: job.jd_url ?? undefined,
      notes: job.notes ?? undefined,
    })

    const brief = [
      '## Company Overview',
      result.company_overview,
      '',
      '## Role Analysis',
      result.role_analysis,
      '',
      '## Potential Questions',
      result.potential_questions,
      '',
      '## Talking Points',
      result.talking_points,
      '',
      '## Research Links',
      result.research_links,
    ].join('\n')

    updateNote.mutate({
      id: prepNote.id,
      input: { title: null, content: brief },
    })
  }

  function handlePersonalNotesBlur() {
    if (!prepNote) return
    const personalSection = notes?.find(
      n => n.note_type === 'personal' && n.job_id === job.id
    )
    if (personalSection) {
      updateNote.mutate({
        id: personalSection.id,
        input: { title: null, content: personalNotes },
      })
    }
  }

  function handleOpenJd() {
    const url = job.jd_url ?? job.apply_url
    if (url) window.open(url, '_blank')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">{job.company}</h2>
          <p className="text-muted-foreground">{job.role}</p>
        </div>
        <div className="flex gap-2">
          {(job.jd_url ?? job.apply_url) && (
            <Button variant="outline" size="sm" onClick={handleOpenJd}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Open JD
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={generatePrep.isPending || !prepNote}
          >
            {generatePrep.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : hasBrief ? (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            ) : null}
            {hasBrief ? 'Regenerate Brief' : 'Generate Prep Brief'}
          </Button>
        </div>
      </div>

      {hasBrief ? (
        <Card>
          <CardContent className="prose prose-sm dark:prose-invert max-w-none pt-6">
            <Markdown>{prepNote.content}</Markdown>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12">
            <BookOpen className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Click &quot;Generate Prep Brief&quot; to create an AI-powered
              interview preparation guide.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Personal Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Add your personal notes, questions to ask, topics to review..."
            value={personalNotes}
            onChange={e => setPersonalNotes(e.target.value)}
            onBlur={handlePersonalNotesBlur}
            rows={4}
          />
        </CardContent>
      </Card>
    </div>
  )
}

export function InterviewPrep() {
  const { data: jobs, isLoading } = useJobs('interviewing')
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  const selectedJob = jobs?.find(j => j.id === selectedJobId) ?? null

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-bold tracking-tight">Interview Prep</h1>
          {jobs && jobs.length > 0 && (
            <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {jobs.length}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !jobs || jobs.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
            <BookOpen className="h-12 w-12 text-muted-foreground/40" />
            <h2 className="text-lg font-semibold text-muted-foreground">
              No jobs in Interview stage
            </h2>
            <p className="max-w-sm text-center text-sm text-muted-foreground">
              Move a job to Interviewing on the Tracker to start preparing.
              Interview prep notes are auto-created when the status changes.
            </p>
          </div>
        ) : (
          <>
            <div className="w-72 shrink-0 space-y-2 overflow-y-auto border-r p-4">
              {jobs.map(job => (
                <PrepCard
                  key={job.id}
                  job={job}
                  onSelect={() => setSelectedJobId(job.id)}
                  isSelected={job.id === selectedJobId}
                />
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {selectedJob ? (
                <PrepDetail job={selectedJob} />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Select a job to view prep details
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
