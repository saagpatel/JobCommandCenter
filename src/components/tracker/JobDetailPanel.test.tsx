import userEvent from '@testing-library/user-event'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import {
  useCreateFollowup,
  useFollowupEventsForJob,
  useFollowupsForJob,
} from '@/services/followups'
import { useDeleteJob, useJob, useUpdateJob } from '@/services/jobs'
import { useUIStore } from '@/store/ui-store'
import { render, screen } from '@/test/test-utils'
import { JobDetailPanel } from './JobDetailPanel'

vi.mock('@/services/jobs', () => ({
  useJob: vi.fn(),
  useUpdateJob: vi.fn(),
  useDeleteJob: vi.fn(),
}))

vi.mock('@/services/followups', () => ({
  useFollowupsForJob: vi.fn(),
  useFollowupEventsForJob: vi.fn(),
  useCreateFollowup: vi.fn(),
}))

const job = {
  id: 'job-1',
  company: 'Acme Corp',
  role: 'Software Engineer',
  ats: 'linkedin',
  apply_url: 'https://linkedin.com/jobs/view/1',
  job_posting_id: null,
  board_token: null,
  status: 'saved',
  tier: 'tier1',
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
  source_packet_id: null,
  source_packet_version: null,
  truth_status: null,
  created_at: '2026-07-17T00:00:00Z',
  updated_at: '2026-07-17T00:00:00Z',
}

describe('JobDetailPanel submission history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    useUIStore.getState().setSelectedJobId(job.id)
    ;(useJob as Mock).mockReturnValue({ data: job })
    ;(useUpdateJob as Mock).mockReturnValue({ mutate: vi.fn() })
    ;(useDeleteJob as Mock).mockReturnValue({ mutate: vi.fn() })
    ;(useFollowupsForJob as Mock).mockReturnValue({ data: [] })
    ;(useFollowupEventsForJob as Mock).mockReturnValue({
      data: [],
      isPending: false,
      isError: false,
    })
    ;(useCreateFollowup as Mock).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    })
    vi.mocked(commands.listSubmissionReceiptsForJob).mockResolvedValue({
      status: 'ok',
      data: [],
    })
    vi.mocked(commands.resolveSubmissionReceipts).mockResolvedValue({
      status: 'ok',
      data: true,
    })
  })

  it('shows durable receipts and distinguishes unresolved lifecycle states', async () => {
    vi.mocked(commands.listSubmissionReceiptsForJob).mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'manual-receipt',
          job_id: job.id,
          adapter: 'linkedin',
          status: 'manual_required',
          resume_uploaded: true,
          cover_letter_uploaded: false,
          fields_filled: '["Email","Resume"]',
          fields_skipped: '[]',
          error: 'Continue manually at https://external.example/apply',
          duration_seconds: 2.5,
          created_at: '2026-07-17T12:00:00Z',
          resolved_at: null,
        },
        {
          id: 'success-receipt',
          job_id: job.id,
          adapter: 'greenhouse',
          status: 'success',
          resume_uploaded: true,
          cover_letter_uploaded: true,
          fields_filled: '[]',
          fields_skipped: '[]',
          error: null,
          duration_seconds: 1.2,
          created_at: '2026-07-16T12:00:00Z',
          resolved_at: null,
        },
      ],
    })

    render(<JobDetailPanel />)

    expect(await screen.findByText('Manual required')).toBeInTheDocument()
    expect(screen.getByText('Success')).toBeInTheDocument()
    expect(screen.getByText(/continue manually at/i)).toBeInTheDocument()
    expect(screen.getByText(/2 fields filled/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /mark manual step resolved/i })
    ).toBeInTheDocument()
  })

  it('resolves a receipt durably and clears the legacy local retry block', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(
      'jcc-unknown-submission-job-ids',
      JSON.stringify([job.id, 'other-job'])
    )
    vi.mocked(commands.listSubmissionReceiptsForJob).mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'unknown-receipt',
          job_id: job.id,
          adapter: 'linkedin',
          status: 'unknown_outcome',
          resume_uploaded: false,
          cover_letter_uploaded: false,
          fields_filled: '[]',
          fields_skipped: '[]',
          error: 'Verify the ATS before retrying.',
          duration_seconds: 0,
          created_at: '2026-07-17T12:00:00Z',
          resolved_at: null,
        },
      ],
    })

    render(<JobDetailPanel />)
    await user.click(
      await screen.findByRole('button', {
        name: /mark externally verified/i,
      })
    )

    expect(commands.resolveSubmissionReceipts).toHaveBeenCalledWith(job.id)
    expect(
      JSON.parse(
        window.localStorage.getItem('jcc-unknown-submission-job-ids') ?? '[]'
      )
    ).toEqual(['other-job'])
  })

  it('shows a truthful read failure instead of an empty history', async () => {
    vi.mocked(commands.listSubmissionReceiptsForJob).mockResolvedValue({
      status: 'error',
      error: 'database unavailable',
    })

    render(<JobDetailPanel />)

    expect(
      await screen.findByText(/submission history could not be loaded/i)
    ).toBeInTheDocument()
    expect(screen.queryByText('No submissions yet.')).not.toBeInTheDocument()
  })

  it('surfaces an ambiguous follow-up as Verify Send and routes to recovery', async () => {
    const user = userEvent.setup()
    ;(useFollowupsForJob as Mock).mockReturnValue({
      data: [
        {
          id: 'followup-1',
          job_id: job.id,
          draft_subject: 'Following up',
          draft_body: 'Hello',
          status: 'send_unknown',
          scheduled_date: '2026-07-18',
          sent_at: null,
          gmail_message_id: null,
          recipient_email: 'recruiter@example.com',
          created_at: '2026-07-17T00:00:00Z',
        },
      ],
    })

    render(<JobDetailPanel />)

    expect(screen.getByText('Verify Send')).toBeInTheDocument()
    expect(
      screen.getByText(/check Gmail before sending again/i)
    ).toBeInTheDocument()
    expect(screen.queryByText('send_unknown')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^Add$/i })
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /Verify Send.*Check Gmail/i })
    )
    expect(useUIStore.getState().activeView).toBe('followups')
  })

  it('does not offer Add when follow-up state cannot be loaded', () => {
    ;(useFollowupsForJob as Mock).mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    })

    render(<JobDetailPanel />)

    expect(
      screen.getByText(/follow-ups could not be loaded/i)
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^Add$/i })
    ).not.toBeInTheDocument()
    expect(screen.queryByText('No follow-ups yet.')).not.toBeInTheDocument()
  })

  it('shows ordered job activity including events from skipped follow-ups', () => {
    ;(useFollowupEventsForJob as Mock).mockReturnValue({
      data: [
        {
          id: 'event-1',
          followup_id: 'followup-1',
          from_status: 'draft_ready',
          to_status: 'send_unknown',
          reason: 'send_attempted',
          occurred_at: '2026-07-17T11:00:00Z',
        },
        {
          id: 'event-2',
          followup_id: 'followup-skipped',
          from_status: 'pending',
          to_status: 'skipped',
          reason: 'operator_skipped',
          occurred_at: '2026-07-17T12:00:00Z',
        },
      ],
      isPending: false,
      isError: false,
    })

    render(<JobDetailPanel />)

    expect(useFollowupEventsForJob).toHaveBeenCalledTimes(1)
    expect(useFollowupEventsForJob).toHaveBeenCalledWith(job.id)
    expect(screen.getByText('Send attempted')).toBeInTheDocument()
    expect(screen.getByText('Skipped')).toBeInTheDocument()
    expect(screen.getByText('2026-07-17 11:00:00 UTC')).toBeInTheDocument()
    expect(screen.getByText('2026-07-17 12:00:00 UTC')).toBeInTheDocument()
  })

  it('shows a truthful follow-up activity read failure', () => {
    ;(useFollowupEventsForJob as Mock).mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    })

    render(<JobDetailPanel />)

    expect(
      screen.getByText(/follow-up activity could not be loaded/i)
    ).toBeInTheDocument()
    expect(
      screen.queryByText('No follow-up activity recorded yet.')
    ).not.toBeInTheDocument()
  })
})
