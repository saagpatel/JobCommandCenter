import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CalendarClock, Loader2 } from 'lucide-react'
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
  }
}

export function FollowupManager() {
  const [activeTab, setActiveTab] = useState<FilterTab>('due_soon')
  const { data: followups, isLoading } = useFollowups()
  const { data: jobs } = useJobs()
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
          const date = new Date(
            f.scheduled_date +
              (f.scheduled_date.includes('T') ? '' : 'T00:00:00')
          )
          return date <= threeDays
        })
      case 'pending':
        return followups.filter(
          f => f.status === 'pending' || f.status === 'draft_ready'
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

    try {
      const result = await gmailSend.mutateAsync({
        to: followup.recipient_email,
        subject: followup.draft_subject,
        body_html: `<div style="white-space: pre-wrap;">${followup.draft_body}</div>`,
      })

      const input = emptyFollowupUpdate()
      input.status = 'sent'
      input.sent_at = new Date().toISOString()
      input.gmail_message_id = result.message_id
      updateFollowup.mutate({ id: followup.id, input })
      toast.success('Email sent')
    } catch {
      // Error toast handled by useGmailSend
    }
  }

  const filtered = getFilteredFollowups()

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
              {
                followups.filter(
                  f => f.status === 'pending' || f.status === 'draft_ready'
                ).length
              }{' '}
              pending
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
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
            {filtered.map(followup => (
              <FollowupRow
                key={followup.id}
                followup={followup}
                job={jobMap.get(followup.job_id) ?? null}
                onSend={handleSend}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
