import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  ChevronRight,
  Sparkles,
  Send,
  Clock,
  SkipForward,
  RefreshCw,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Followup, Job } from '@/lib/bindings'
import { useUpdateFollowup } from '@/services/followups'
import { useDraftFollowup } from '@/services/gmail'

interface FollowupRowProps {
  followup: Followup
  job: Job | null
  onSend: (followup: Followup) => void
}

function statusBadge(status: string) {
  switch (status) {
    case 'pending':
      return <Badge variant="outline">Pending</Badge>
    case 'draft_ready':
      return (
        <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20">
          Draft Ready
        </Badge>
      )
    case 'sent':
      return (
        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20">
          Sent
        </Badge>
      )
    case 'skipped':
      return <Badge variant="secondary">Skipped</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'))
  const now = new Date()
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

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

export function FollowupRow({ followup, job, onSend }: FollowupRowProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [subject, setSubject] = useState(followup.draft_subject ?? '')
  const [body, setBody] = useState(followup.draft_body ?? '')
  const [recipientEmail, setRecipientEmail] = useState(
    followup.recipient_email ?? ''
  )

  const updateFollowup = useUpdateFollowup()
  const draftFollowup = useDraftFollowup()

  const days = daysUntil(followup.scheduled_date)
  const isDone = followup.status === 'sent' || followup.status === 'skipped'

  async function handleGenerateDraft() {
    if (!job) return

    const result = await draftFollowup.mutateAsync({
      company: job.company,
      role: job.role,
      applied_date: job.applied_at ?? job.created_at,
      notes: job.notes ?? undefined,
    })

    setSubject(result.subject)
    setBody(result.body)

    const input = emptyFollowupUpdate()
    input.draft_subject = result.subject
    input.draft_body = result.body
    input.status = 'draft_ready'
    updateFollowup.mutate({ id: followup.id, input })
    toast.success('Draft generated')
  }

  function handleSaveDraft() {
    const input = emptyFollowupUpdate()
    input.draft_subject = subject || null
    input.draft_body = body || null
    if (recipientEmail) input.recipient_email = recipientEmail
    if (subject && body) input.status = 'draft_ready'
    updateFollowup.mutate({ id: followup.id, input })
    toast.success('Draft saved')
  }

  function handleSkip() {
    const input = emptyFollowupUpdate()
    input.status = 'skipped'
    updateFollowup.mutate({ id: followup.id, input })
  }

  function handleSnooze() {
    const newDate = new Date()
    newDate.setDate(newDate.getDate() + 3)
    const input = emptyFollowupUpdate()
    input.scheduled_date = newDate.toISOString().slice(0, 10)
    updateFollowup.mutate({ id: followup.id, input })
    toast.success('Snoozed +3 days')
  }

  function handleSend() {
    if (!recipientEmail) {
      toast.error('Recipient email required')
      return
    }
    // Save email to followup, then trigger send
    const input = emptyFollowupUpdate()
    input.recipient_email = recipientEmail
    if (subject) input.draft_subject = subject
    if (body) input.draft_body = body
    updateFollowup.mutate(
      { id: followup.id, input },
      {
        onSuccess: data => onSend(data),
      }
    )
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50">
          <ChevronRight
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">
                {job?.company ?? 'Unknown'}
              </span>
              <span className="truncate text-sm text-muted-foreground">
                {job?.role ?? ''}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{followup.scheduled_date.split('T')[0]}</span>
              {!isDone && (
                <span
                  className={
                    days <= 0
                      ? 'text-red-500 font-medium'
                      : days <= 3
                        ? 'text-amber-500 font-medium'
                        : ''
                  }
                >
                  {days <= 0
                    ? 'Overdue'
                    : days === 1
                      ? 'Tomorrow'
                      : `${days} days`}
                </span>
              )}
            </div>
          </div>
          {statusBadge(followup.status)}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-4 border-x border-b rounded-b-lg px-4 pb-4 pt-2">
          {followup.status === 'sent' ? (
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Sent {followup.sent_at?.split('T')[0] ?? ''}
              </p>
              {followup.gmail_message_id && (
                <p className="text-xs text-muted-foreground">
                  Gmail ID: {followup.gmail_message_id}
                </p>
              )}
              {followup.draft_subject && (
                <p className="font-medium">{followup.draft_subject}</p>
              )}
              {followup.draft_body && (
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {followup.draft_body}
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Recipient Email</Label>
                <Input
                  value={recipientEmail}
                  onChange={e => setRecipientEmail(e.target.value)}
                  placeholder="recruiter@company.com"
                  type="email"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Subject</Label>
                <Input
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  placeholder="Following up on..."
                />
              </div>

              <div className="space-y-1.5">
                <Label>Body</Label>
                <Textarea
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  placeholder="Email body..."
                  rows={6}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {!subject && !body ? (
                  <Button
                    size="sm"
                    onClick={handleGenerateDraft}
                    disabled={draftFollowup.isPending || !job}
                  >
                    {draftFollowup.isPending ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Generate Draft
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleGenerateDraft}
                      disabled={draftFollowup.isPending}
                    >
                      {draftFollowup.isPending ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Regenerate
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleSaveDraft}
                      disabled={updateFollowup.isPending}
                    >
                      Save Draft
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSend}
                      disabled={!subject || !body || !recipientEmail}
                    >
                      <Send className="mr-1.5 h-3.5 w-3.5" />
                      Send
                    </Button>
                  </>
                )}

                <div className="ml-auto flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleSnooze}
                    disabled={updateFollowup.isPending}
                  >
                    <Clock className="mr-1.5 h-3.5 w-3.5" />
                    +3 days
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleSkip}
                    disabled={updateFollowup.isPending}
                  >
                    <SkipForward className="mr-1.5 h-3.5 w-3.5" />
                    Skip
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
