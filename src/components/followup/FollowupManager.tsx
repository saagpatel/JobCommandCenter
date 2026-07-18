import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { AlertTriangle, CalendarClock, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useFollowups, useUpdateFollowup } from '@/services/followups'
import { useJobs } from '@/services/jobs'
import { useGmailSend } from '@/services/gmail'
import { FollowupRow } from './FollowupRow'
import type { Followup, Job } from '@/lib/bindings'

type FilterTab = 'due_soon' | 'pending' | 'sent' | 'skipped'

function emptyFollowupUpdate() {
  return {
    draft_subject: null as string | null,
    draft_body: null as string | null,
    status: null as string | null,
    scheduled_date: null as string | null,
    sent_at: null as string | null,
    gmail_message_id: null as string | null,
    recipient_email: null as string | null,
    transition_reason: null as string | null,
  }
}

export function FollowupManager() {
  const [activeTab, setActiveTab] = useState<FilterTab>('due_soon')
  const {
    data: followups,
    isLoading,
    isError,
    isFetching,
    refetch: refetchFollowups,
  } = useFollowups()
  const {
    data: jobs,
    isLoading: jobsIsLoading,
    isError: jobsIsError,
    isFetching: jobsIsFetching,
    refetch: refetchJobs,
  } = useJobs()
  const gmailSend = useGmailSend()
  const updateFollowup = useUpdateFollowup()

  const jobMap = new Map<string, Job>()
  if (jobs) {
    for (const job of jobs) {
      jobMap.set(job.id, job)
    }
  }

  function getFilteredFollowups(): Followup[] {
    if (!followups) return []

    const now = new Date()
    const threeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)

    switch (activeTab) {
      case 'due_soon':
        return followups.filter(f => {
          if (f.status === 'sent' || f.status === 'skipped') return false
          if (f.status === 'send_unknown') return true
          const date = new Date(
            f.scheduled_date +
              (f.scheduled_date.includes('T') ? '' : 'T00:00:00')
          )
          return date <= threeDays
        })
      case 'pending':
        return followups.filter(
          f =>
            f.status === 'pending' ||
            f.status === 'draft_ready' ||
            f.status === 'send_unknown'
        )
      case 'sent':
        return followups.filter(f => f.status === 'sent')
      case 'skipped':
        return followups.filter(f => f.status === 'skipped')
    }
  }

  async function handleSend(followup: Followup) {
    if (
      !followup.recipient_email ||
      !followup.draft_subject ||
      !followup.draft_body
    ) {
      toast.error('Missing recipient, subject, or body')
      return
    }

    const sendIntent = emptyFollowupUpdate()
    sendIntent.draft_subject = followup.draft_subject
    sendIntent.draft_body = followup.draft_body
    sendIntent.recipient_email = followup.recipient_email
    sendIntent.status = 'send_unknown'
    sendIntent.transition_reason = 'send_attempted'

    try {
      await updateFollowup.mutateAsync({
        id: followup.id,
        input: sendIntent,
      })
    } catch {
      return
    }

    let result
    try {
      result = await gmailSend.mutateAsync({
        to: followup.recipient_email,
        subject: followup.draft_subject,
        body_html: `<div style="white-space: pre-wrap;">${followup.draft_body}</div>`,
      })
    } catch {
      return
    }

    const sentReceipt = emptyFollowupUpdate()
    sentReceipt.status = 'sent'
    sentReceipt.transition_reason = 'gmail_accepted'
    sentReceipt.sent_at = new Date().toISOString()
    sentReceipt.gmail_message_id = result.message_id

    try {
      await updateFollowup.mutateAsync({
        id: followup.id,
        input: sentReceipt,
      })
    } catch {
      toast.error('Email sent — do not resend', {
        description: `Gmail accepted message ${result.message_id}, but the tracker could not save that receipt. Verify Gmail, then resolve this follow-up.`,
      })
      return
    }

    toast.success('Email sent')
  }

  const filtered = getFilteredFollowups()
  const pendingCount =
    followups?.filter(
      followup =>
        followup.status === 'pending' || followup.status === 'draft_ready'
    ).length ?? 0
  const verifySendCount =
    followups?.filter(followup => followup.status === 'send_unknown').length ??
    0
  const activeWorkSummary = [
    pendingCount > 0 || verifySendCount === 0
      ? `${pendingCount} pending`
      : null,
    verifySendCount > 0
      ? `${verifySendCount} verify ${verifySendCount === 1 ? 'send' : 'sends'}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const orphanedFollowupCount =
    !jobsIsLoading && !jobsIsError && jobs
      ? filtered.filter(followup => !jobMap.has(followup.job_id)).length
      : 0

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-xl font-bold tracking-tight">Follow-ups</h1>
          </div>
          {followups && (
            <span className="text-sm text-muted-foreground">
              {activeWorkSummary}
            </span>
          )}
        </div>

        <Tabs
          value={activeTab}
          onValueChange={v => setActiveTab(v as FilterTab)}
          className="mt-4"
        >
          <TabsList>
            <TabsTrigger value="due_soon">Due Soon</TabsTrigger>
            <TabsTrigger value="pending">All Pending</TabsTrigger>
            <TabsTrigger value="sent">Sent</TabsTrigger>
            <TabsTrigger value="skipped">Skipped</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {!isLoading && !isError && jobsIsError && (
          <div
            role="alert"
            aria-labelledby="job-context-load-error-title"
            className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3"
          >
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
            <div className="min-w-0 flex-1">
              <p
                id="job-context-load-error-title"
                className="font-semibold text-amber-900 dark:text-amber-200"
              >
                Job details could not be loaded
              </p>
              <p className="text-sm text-muted-foreground">
                Follow-up state is still available, but company and role context
                may be missing.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={jobsIsFetching}
              onClick={() => void refetchJobs()}
            >
              {jobsIsFetching ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              Retry job details
            </Button>
          </div>
        )}
        {!isLoading && !isError && orphanedFollowupCount > 0 && (
          <div
            role="alert"
            aria-labelledby="orphaned-followup-title"
            className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3"
          >
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p id="orphaned-followup-title" className="font-semibold">
                {orphanedFollowupCount === 1
                  ? 'A follow-up references a missing job record'
                  : `${orphanedFollowupCount} follow-ups reference missing job records`}
              </p>
              <p className="text-sm text-muted-foreground">
                Lifecycle controls remain available, but company and role
                context and AI draft generation are unavailable.
              </p>
            </div>
          </div>
        )}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div
            role="alert"
            aria-labelledby="followup-load-error-title"
            className="flex flex-col items-center justify-center gap-3 py-16"
          >
            <AlertTriangle className="h-12 w-12 text-destructive/70" />
            <h2
              id="followup-load-error-title"
              className="text-lg font-semibold"
            >
              Follow-ups could not be loaded
            </h2>
            <p className="max-w-sm text-center text-sm text-muted-foreground">
              JCC could not read follow-up state. Retry after the database is
              available.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isFetching}
              onClick={() => void refetchFollowups()}
            >
              {isFetching ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              Retry
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <CalendarClock className="h-12 w-12 text-muted-foreground/40" />
            <h2 className="text-lg font-semibold text-muted-foreground">
              {activeTab === 'due_soon'
                ? 'No follow-ups due soon'
                : activeTab === 'sent'
                  ? 'No sent follow-ups'
                  : activeTab === 'skipped'
                    ? 'No skipped follow-ups'
                    : 'No follow-ups yet'}
            </h2>
            <p className="max-w-sm text-center text-sm text-muted-foreground">
              Follow-ups are auto-created when you mark jobs as Applied. You can
              also create them manually from the Job Detail panel.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(followup => {
              const job = jobMap.get(followup.job_id) ?? null
              return (
                <FollowupRow
                  key={followup.id}
                  followup={followup}
                  job={job}
                  jobContextState={
                    job
                      ? undefined
                      : jobsIsLoading
                        ? 'loading'
                        : jobsIsError
                          ? 'unavailable'
                          : 'missing'
                  }
                  onSend={handleSend}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
