import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { FollowupManager } from './FollowupManager'
import type * as TauriBindings from '@/lib/tauri-bindings'
import type { Followup } from '@/lib/bindings'

const mockCommands = vi.hoisted(() => ({
  listFollowups: vi.fn(),
  listFollowupEvents: vi.fn(),
  listJobs: vi.fn(),
  updateFollowup: vi.fn(),
}))

const mockToast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock('@/lib/tauri-bindings', async importOriginal => {
  const original = await importOriginal<typeof TauriBindings>()
  return {
    ...original,
    commands: {
      ...original.commands,
      listFollowups: mockCommands.listFollowups,
      listFollowupEvents: mockCommands.listFollowupEvents,
      listJobs: mockCommands.listJobs,
      updateFollowup: mockCommands.updateFollowup,
    },
  }
})

vi.mock('sonner', () => ({
  toast: mockToast,
}))

describe('FollowupManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCommands.listFollowupEvents.mockResolvedValue({
      status: 'ok',
      data: [],
    })
    global.fetch = vi.fn().mockRejectedValue(new Error('sidecar not running'))
  })

  it('renders empty state when no followups exist', async () => {
    mockCommands.listFollowups.mockResolvedValue({
      status: 'ok',
      data: [],
    })
    mockCommands.listJobs.mockResolvedValue({ status: 'ok', data: [] })

    render(<FollowupManager />)

    expect(
      await screen.findByText(/no follow-ups due soon/i)
    ).toBeInTheDocument()
  })

  it('shows a truthful storage failure and recovers on retry', async () => {
    mockCommands.listFollowups
      .mockResolvedValueOnce({
        status: 'error',
        error: 'database unavailable',
      })
      .mockResolvedValueOnce({
        status: 'ok',
        data: [],
      })
    mockCommands.listJobs.mockResolvedValue({ status: 'ok', data: [] })

    render(<FollowupManager />)
    const user = userEvent.setup()

    expect(
      await screen.findByRole('alert', {
        name: /follow-ups could not be loaded/i,
      })
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/no follow-ups due soon/i)
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^retry$/i }))

    expect(
      await screen.findByText(/no follow-ups due soon/i)
    ).toBeInTheDocument()
    expect(mockCommands.listFollowups).toHaveBeenCalledTimes(2)
  })

  it('keeps followups visible when job context fails and recovers on retry', async () => {
    const now = new Date().toISOString()
    mockCommands.listFollowups.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'f1',
          job_id: 'j1',
          draft_subject: null,
          draft_body: null,
          status: 'pending',
          scheduled_date: now.slice(0, 10),
          sent_at: null,
          gmail_message_id: null,
          recipient_email: null,
          created_at: now,
        },
      ],
    })
    mockCommands.listJobs
      .mockResolvedValueOnce({
        status: 'error',
        error: 'database unavailable',
      })
      .mockResolvedValueOnce({
        status: 'ok',
        data: [
          {
            id: 'j1',
            company: 'Acme Corp',
            role: 'Software Engineer',
            ats: 'ashby',
            apply_url: 'https://example.com',
            status: 'applied',
            tier: 'tier1',
            created_at: now,
            updated_at: now,
          },
        ],
      })

    render(<FollowupManager />)
    const user = userEvent.setup()

    expect(
      await screen.findByRole('alert', {
        name: /job details could not be loaded/i,
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /job details unavailable.*pending/i,
      })
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /^retry job details$/i })
    )

    expect(await screen.findByText('Acme Corp')).toBeInTheDocument()
    expect(
      screen.queryByRole('alert', {
        name: /job details could not be loaded/i,
      })
    ).not.toBeInTheDocument()
    expect(mockCommands.listJobs).toHaveBeenCalledTimes(2)
  })

  it('labels job context as loading until the matching job arrives', async () => {
    const now = new Date().toISOString()
    mockCommands.listFollowups.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'f1',
          job_id: 'j1',
          draft_subject: null,
          draft_body: null,
          status: 'pending',
          scheduled_date: now.slice(0, 10),
          sent_at: null,
          gmail_message_id: null,
          recipient_email: null,
          created_at: now,
        },
      ],
    })
    let resolveJobs:
      | ((value: {
          status: 'ok'
          data: {
            id: string
            company: string
            role: string
            ats: string
            apply_url: string
            status: string
            tier: string
            created_at: string
            updated_at: string
          }[]
        }) => void)
      | undefined
    mockCommands.listJobs.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveJobs = resolve
        })
    )

    render(<FollowupManager />)

    expect(
      await screen.findByRole('button', {
        name: /loading job details.*pending/i,
      })
    ).toBeInTheDocument()
    expect(screen.queryByText(/^unknown$/i)).not.toBeInTheDocument()

    resolveJobs?.({
      status: 'ok',
      data: [
        {
          id: 'j1',
          company: 'Acme Corp',
          role: 'Software Engineer',
          ats: 'ashby',
          apply_url: 'https://example.com',
          status: 'applied',
          tier: 'tier1',
          created_at: now,
          updated_at: now,
        },
      ],
    })

    expect(await screen.findByText('Acme Corp')).toBeInTheDocument()
  })

  it('identifies an orphaned followup without hiding its lifecycle controls', async () => {
    const now = new Date().toISOString()
    mockCommands.listFollowups.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'f1',
          job_id: 'missing-job',
          draft_subject: null,
          draft_body: null,
          status: 'pending',
          scheduled_date: now.slice(0, 10),
          sent_at: null,
          gmail_message_id: null,
          recipient_email: null,
          created_at: now,
        },
      ],
    })
    mockCommands.listJobs.mockResolvedValue({ status: 'ok', data: [] })

    render(<FollowupManager />)
    const user = userEvent.setup()

    expect(
      await screen.findByRole('alert', {
        name: /follow-up references a missing job record/i,
      })
    ).toBeInTheDocument()
    const row = screen.getByRole('button', {
      name: /job record missing.*pending/i,
    })
    expect(row).toBeInTheDocument()
    expect(screen.queryByText(/^unknown$/i)).not.toBeInTheDocument()

    await user.click(row)

    expect(
      screen.getByRole('button', { name: /^generate draft$/i })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: /^\+3 days$/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^skip$/i })).toBeEnabled()
  })

  it('shows followup list with job info', async () => {
    const now = new Date()
    const threeDaysLater = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000)

    mockCommands.listFollowups.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'f1',
          job_id: 'j1',
          draft_subject: null,
          draft_body: null,
          status: 'pending',
          scheduled_date: threeDaysLater.toISOString().split('T')[0],
          sent_at: null,
          gmail_message_id: null,
          recipient_email: null,
          created_at: now.toISOString(),
        },
      ],
    })
    mockCommands.listJobs.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'j1',
          company: 'Acme Corp',
          role: 'Software Engineer',
          ats: 'ashby',
          apply_url: 'https://example.com',
          status: 'applied',
          tier: 'tier1',
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        },
      ],
    })

    render(<FollowupManager />)

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    })

    expect(screen.getByText('Software Engineer')).toBeInTheDocument()
    expect(screen.getByText('1 pending')).toBeInTheDocument()
  })

  it('renders filter tabs', async () => {
    mockCommands.listFollowups.mockResolvedValue({
      status: 'ok',
      data: [],
    })
    mockCommands.listJobs.mockResolvedValue({ status: 'ok', data: [] })

    render(<FollowupManager />)

    await waitFor(() => {
      expect(screen.getByText('Due Soon')).toBeInTheDocument()
    })

    expect(screen.getByText('All Pending')).toBeInTheDocument()
    expect(screen.getByText('Sent')).toBeInTheDocument()
    expect(screen.getByText('Skipped')).toBeInTheDocument()
  })

  it('filters sent followups when Sent tab is active', async () => {
    const now = new Date()

    mockCommands.listFollowups.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'f1',
          job_id: 'j1',
          draft_subject: 'Following up',
          draft_body: 'Hello',
          status: 'sent',
          scheduled_date: now.toISOString().split('T')[0],
          sent_at: now.toISOString(),
          gmail_message_id: 'msg-123',
          recipient_email: 'hr@acme.com',
          created_at: now.toISOString(),
        },
        {
          id: 'f2',
          job_id: 'j2',
          draft_subject: null,
          draft_body: null,
          status: 'pending',
          scheduled_date: now.toISOString().split('T')[0],
          sent_at: null,
          gmail_message_id: null,
          recipient_email: null,
          created_at: now.toISOString(),
        },
      ],
    })
    mockCommands.listJobs.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'j1',
          company: 'Acme Corp',
          role: 'Engineer',
          ats: 'ashby',
          apply_url: 'https://example.com',
          status: 'applied',
          tier: 'tier1',
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        },
        {
          id: 'j2',
          company: 'Beta Inc',
          role: 'Developer',
          ats: 'greenhouse',
          apply_url: 'https://example2.com',
          status: 'applied',
          tier: 'tier1',
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        },
      ],
    })

    render(<FollowupManager />)
    const user = userEvent.setup()

    await waitFor(() => {
      expect(screen.getByText('1 pending')).toBeInTheDocument()
    })

    // Click the Sent tab
    await user.click(screen.getByText('Sent'))

    // Should show only the sent followup
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    })
  })

  it('waits for generated draft persistence before reporting success', async () => {
    const now = new Date().toISOString()
    const followup: Followup = {
      id: 'f1',
      job_id: 'j1',
      draft_subject: null,
      draft_body: null,
      status: 'pending',
      scheduled_date: now.slice(0, 10),
      sent_at: null,
      gmail_message_id: null,
      recipient_email: null,
      created_at: now,
    }
    mockCommands.listFollowups.mockResolvedValue({
      status: 'ok',
      data: [followup],
    })
    mockCommands.listJobs.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'j1',
          company: 'Acme Corp',
          role: 'Engineer',
          ats: 'ashby',
          apply_url: 'https://example.com',
          status: 'applied',
          tier: 'tier1',
          created_at: now,
          updated_at: now,
        },
      ],
    })
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          subject: 'Following up',
          body: 'Hello from the generated draft',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )
    let resolvePersistence:
      | ((value: { status: 'ok'; data: Followup }) => void)
      | undefined
    mockCommands.updateFollowup.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolvePersistence = resolve
        })
    )

    render(<FollowupManager />)
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: /Acme Corp.*Pending/i })
    )
    await user.click(screen.getByRole('button', { name: /^Generate Draft$/i }))

    await waitFor(() => {
      expect(mockCommands.updateFollowup).toHaveBeenCalledTimes(1)
    })
    expect(mockToast.success).not.toHaveBeenCalledWith('Draft generated')

    resolvePersistence?.({
      status: 'ok',
      data: {
        ...followup,
        draft_subject: 'Following up',
        draft_body: 'Hello from the generated draft',
        status: 'draft_ready',
      },
    })

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('Draft generated')
    })
  })

  it('waits for draft persistence before reporting a save', async () => {
    const now = new Date().toISOString()
    const followup: Followup = {
      id: 'f1',
      job_id: 'j1',
      draft_subject: 'Following up',
      draft_body: 'Hello',
      status: 'draft_ready',
      scheduled_date: now.slice(0, 10),
      sent_at: null,
      gmail_message_id: null,
      recipient_email: 'hr@acme.com',
      created_at: now,
    }
    mockCommands.listFollowups.mockResolvedValue({
      status: 'ok',
      data: [followup],
    })
    mockCommands.listJobs.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'j1',
          company: 'Acme Corp',
          role: 'Engineer',
          ats: 'ashby',
          apply_url: 'https://example.com',
          status: 'applied',
          tier: 'tier1',
          created_at: now,
          updated_at: now,
        },
      ],
    })
    let resolvePersistence:
      | ((value: { status: 'ok'; data: Followup }) => void)
      | undefined
    mockCommands.updateFollowup.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolvePersistence = resolve
        })
    )

    render(<FollowupManager />)
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: /Acme Corp.*Draft Ready/i })
    )
    await user.click(screen.getByRole('button', { name: /^Save Draft$/i }))

    await waitFor(() => {
      expect(mockCommands.updateFollowup).toHaveBeenCalledTimes(1)
    })
    expect(mockToast.success).not.toHaveBeenCalledWith('Draft saved')

    resolvePersistence?.({ status: 'ok', data: followup })

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('Draft saved')
    })
  })

  it('waits for schedule persistence before reporting a snooze', async () => {
    const now = new Date().toISOString()
    const followup: Followup = {
      id: 'f1',
      job_id: 'j1',
      draft_subject: null,
      draft_body: null,
      status: 'pending',
      scheduled_date: now.slice(0, 10),
      sent_at: null,
      gmail_message_id: null,
      recipient_email: null,
      created_at: now,
    }
    mockCommands.listFollowups.mockResolvedValue({
      status: 'ok',
      data: [followup],
    })
    mockCommands.listJobs.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'j1',
          company: 'Acme Corp',
          role: 'Engineer',
          ats: 'ashby',
          apply_url: 'https://example.com',
          status: 'applied',
          tier: 'tier1',
          created_at: now,
          updated_at: now,
        },
      ],
    })
    let resolvePersistence:
      | ((value: { status: 'ok'; data: Followup }) => void)
      | undefined
    mockCommands.updateFollowup.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolvePersistence = resolve
        })
    )

    render(<FollowupManager />)
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: /Acme Corp.*Pending/i })
    )
    await user.click(screen.getByRole('button', { name: /^\+3 days$/i }))

    await waitFor(() => {
      expect(mockCommands.updateFollowup).toHaveBeenCalledTimes(1)
    })
    expect(mockToast.success).not.toHaveBeenCalledWith('Snoozed +3 days')

    resolvePersistence?.({
      status: 'ok',
      data: {
        ...followup,
        scheduled_date: '2026-07-20',
      },
    })

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('Snoozed +3 days')
    })
  })

  it('records an unknown send outcome before Gmail and waits for sent persistence before success', async () => {
    const now = new Date().toISOString()
    const followup: Followup = {
      id: 'f1',
      job_id: 'j1',
      draft_subject: 'Following up',
      draft_body: 'Hello',
      status: 'draft_ready',
      scheduled_date: now.slice(0, 10),
      sent_at: null,
      gmail_message_id: null,
      recipient_email: 'hr@acme.com',
      created_at: now,
    }
    mockCommands.listFollowups.mockResolvedValue({
      status: 'ok',
      data: [followup],
    })
    mockCommands.listJobs.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'j1',
          company: 'Acme Corp',
          role: 'Engineer',
          ats: 'ashby',
          apply_url: 'https://example.com',
          status: 'applied',
          tier: 'tier1',
          created_at: now,
          updated_at: now,
        },
      ],
    })

    let resolveSentPersistence:
      | ((value: { status: 'ok'; data: typeof followup }) => void)
      | undefined
    mockCommands.updateFollowup
      .mockResolvedValueOnce({
        status: 'ok',
        data: { ...followup, status: 'send_unknown' },
      })
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveSentPersistence = resolve
          })
      )
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message_id: 'msg-123', thread_id: 'thread-1' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )

    render(<FollowupManager />)
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: /Acme Corp.*Draft Ready/i })
    )
    await user.click(screen.getByRole('button', { name: /^Send$/i }))

    await waitFor(() => {
      expect(mockCommands.updateFollowup).toHaveBeenCalledTimes(2)
    })
    expect(mockCommands.updateFollowup.mock.calls[0]?.[1]).toMatchObject({
      status: 'send_unknown',
      transition_reason: 'send_attempted',
    })
    expect(mockCommands.updateFollowup.mock.calls[1]?.[1]).toMatchObject({
      status: 'sent',
      transition_reason: 'gmail_accepted',
    })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(mockToast.success).not.toHaveBeenCalledWith('Email sent')

    resolveSentPersistence?.({
      status: 'ok',
      data: {
        ...followup,
        status: 'sent',
        sent_at: now,
        gmail_message_id: 'msg-123',
      },
    })

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('Email sent')
    })
  })

  it('blocks retry and warns when Gmail succeeds but sent persistence fails', async () => {
    const now = new Date().toISOString()
    const followup = {
      id: 'f1',
      job_id: 'j1',
      draft_subject: 'Following up',
      draft_body: 'Hello',
      status: 'draft_ready',
      scheduled_date: now.split('T')[0],
      sent_at: null,
      gmail_message_id: null,
      recipient_email: 'hr@acme.com',
      created_at: now,
    }
    mockCommands.listFollowups.mockResolvedValue({
      status: 'ok',
      data: [followup],
    })
    mockCommands.listJobs.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'j1',
          company: 'Acme Corp',
          role: 'Engineer',
          ats: 'ashby',
          apply_url: 'https://example.com',
          status: 'applied',
          tier: 'tier1',
          created_at: now,
          updated_at: now,
        },
      ],
    })
    mockCommands.updateFollowup
      .mockResolvedValueOnce({
        status: 'ok',
        data: { ...followup, status: 'send_unknown' },
      })
      .mockRejectedValueOnce(new Error('database unavailable'))
    global.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message_id: 'msg-123', thread_id: 'thread-1' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )

    render(<FollowupManager />)
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: /Acme Corp.*Draft Ready/i })
    )
    await user.click(screen.getByRole('button', { name: /^Send$/i }))

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringMatching(/do not resend/i),
        expect.any(Object)
      )
    })
    expect(mockToast.success).not.toHaveBeenCalledWith('Email sent')
  })

  it('keeps the unknown marker when Gmail cannot confirm the send outcome', async () => {
    const now = new Date().toISOString()
    const followup = {
      id: 'f1',
      job_id: 'j1',
      draft_subject: 'Following up',
      draft_body: 'Hello',
      status: 'draft_ready',
      scheduled_date: now.split('T')[0],
      sent_at: null,
      gmail_message_id: null,
      recipient_email: 'hr@acme.com',
      created_at: now,
    }
    mockCommands.listFollowups.mockResolvedValue({
      status: 'ok',
      data: [followup],
    })
    mockCommands.listJobs.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'j1',
          company: 'Acme Corp',
          role: 'Engineer',
          ats: 'ashby',
          apply_url: 'https://example.com',
          status: 'applied',
          tier: 'tier1',
          created_at: now,
          updated_at: now,
        },
      ],
    })
    mockCommands.updateFollowup.mockResolvedValueOnce({
      status: 'ok',
      data: { ...followup, status: 'send_unknown' },
    })
    global.fetch = vi.fn().mockRejectedValue(new Error('connection reset'))

    render(<FollowupManager />)
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', { name: /Acme Corp.*Draft Ready/i })
    )
    await user.click(screen.getByRole('button', { name: /^Send$/i }))

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringMatching(/unconfirmed.*do not resend/i),
        expect.any(Object)
      )
    })
    expect(mockCommands.updateFollowup).toHaveBeenCalledTimes(1)
    expect(mockCommands.updateFollowup.mock.calls[0]?.[1]).toMatchObject({
      status: 'send_unknown',
      transition_reason: 'send_attempted',
    })
    expect(mockToast.success).not.toHaveBeenCalledWith('Email sent')
  })

  it('requires confirmation before skipping and preserves the obligation on failure', async () => {
    const now = new Date().toISOString()
    mockCommands.listFollowups.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'f1',
          job_id: 'j1',
          draft_subject: null,
          draft_body: null,
          status: 'pending',
          scheduled_date: now.slice(0, 10),
          sent_at: null,
          gmail_message_id: null,
          recipient_email: null,
          created_at: now,
        },
      ],
    })
    mockCommands.listJobs.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'j1',
          company: 'Acme Corp',
          role: 'Engineer',
          ats: 'ashby',
          apply_url: 'https://example.com',
          status: 'applied',
          tier: 'tier1',
          created_at: now,
          updated_at: now,
        },
      ],
    })
    mockCommands.updateFollowup.mockRejectedValue(
      new Error('database unavailable')
    )

    render(<FollowupManager />)
    const user = userEvent.setup()
    const row = await screen.findByRole('button', {
      name: /Acme Corp.*Pending/i,
    })
    await user.click(row)
    await user.click(screen.getByRole('button', { name: /^skip$/i }))

    expect(
      screen.getByRole('alertdialog', { name: /skip this follow-up/i })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(mockCommands.updateFollowup).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /^skip$/i }))
    await user.click(screen.getByRole('button', { name: /^skip follow-up$/i }))

    await waitFor(() => {
      expect(mockCommands.updateFollowup).toHaveBeenCalledTimes(1)
    })
    expect(mockCommands.updateFollowup.mock.calls[0]?.[1]).toMatchObject({
      status: 'skipped',
      transition_reason: 'operator_skipped',
    })
    expect(
      screen.getByRole('button', { name: /Acme Corp.*Pending/i })
    ).toBeInTheDocument()
    expect(mockToast.error).toHaveBeenCalledWith(
      'Failed to update follow-up',
      expect.any(Object)
    )
  })

  it('requires confirmation and persistence before marking an unknown send as sent', async () => {
    const now = new Date().toISOString()
    const followup: Followup = {
      id: 'f1',
      job_id: 'j1',
      draft_subject: 'Following up',
      draft_body: 'Hello',
      status: 'send_unknown',
      scheduled_date: now.slice(0, 10),
      sent_at: null,
      gmail_message_id: null,
      recipient_email: 'hr@acme.com',
      created_at: now,
    }
    mockCommands.listFollowups.mockResolvedValue({
      status: 'ok',
      data: [followup],
    })
    mockCommands.listJobs.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'j1',
          company: 'Acme Corp',
          role: 'Engineer',
          ats: 'ashby',
          apply_url: 'https://example.com',
          status: 'applied',
          tier: 'tier1',
          created_at: now,
          updated_at: now,
        },
      ],
    })
    let resolvePersistence:
      | ((value: { status: 'ok'; data: Followup }) => void)
      | undefined
    mockCommands.updateFollowup.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolvePersistence = resolve
        })
    )

    render(<FollowupManager />)
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', {
        name: /Acme Corp.*Verify Send/i,
      })
    )
    await user.click(
      screen.getByRole('button', { name: /I verified it was sent/i })
    )

    expect(
      screen.getByRole('alertdialog', {
        name: /mark this follow-up as sent/i,
      })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(mockCommands.updateFollowup).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', { name: /I verified it was sent/i })
    )
    await user.click(screen.getByRole('button', { name: /^mark sent$/i }))

    await waitFor(() => {
      expect(mockCommands.updateFollowup).toHaveBeenCalledTimes(1)
    })
    expect(mockCommands.updateFollowup.mock.calls[0]?.[1]).toMatchObject({
      status: 'sent',
      transition_reason: 'operator_verified_sent',
    })
    expect(mockToast.success).not.toHaveBeenCalledWith('Follow-up marked sent')
    expect(screen.getByText('Verify Send')).toBeInTheDocument()

    resolvePersistence?.({
      status: 'ok',
      data: {
        ...followup,
        status: 'sent',
        sent_at: now,
      },
    })

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('Follow-up marked sent')
    })
  })

  it('requires confirmation and persistence before an unknown send can be retried', async () => {
    const now = new Date().toISOString()
    const followup: Followup = {
      id: 'f1',
      job_id: 'j1',
      draft_subject: 'Following up',
      draft_body: 'Hello',
      status: 'send_unknown',
      scheduled_date: now.slice(0, 10),
      sent_at: null,
      gmail_message_id: null,
      recipient_email: 'hr@acme.com',
      created_at: now,
    }
    mockCommands.listFollowups
      .mockResolvedValueOnce({
        status: 'ok',
        data: [followup],
      })
      .mockResolvedValue({
        status: 'ok',
        data: [{ ...followup, status: 'draft_ready' }],
      })
    mockCommands.listJobs.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'j1',
          company: 'Acme Corp',
          role: 'Engineer',
          ats: 'ashby',
          apply_url: 'https://example.com',
          status: 'applied',
          tier: 'tier1',
          created_at: now,
          updated_at: now,
        },
      ],
    })
    let resolvePersistence:
      | ((value: { status: 'ok'; data: Followup }) => void)
      | undefined
    mockCommands.updateFollowup.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolvePersistence = resolve
        })
    )

    render(<FollowupManager />)
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', {
        name: /Acme Corp.*Verify Send/i,
      })
    )
    await user.click(
      screen.getByRole('button', { name: /I verified it was not sent/i })
    )

    expect(
      screen.getByRole('alertdialog', {
        name: /confirm this message was not sent/i,
      })
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(mockCommands.updateFollowup).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', { name: /I verified it was not sent/i })
    )
    await user.click(screen.getByRole('button', { name: /^allow retry$/i }))

    await waitFor(() => {
      expect(mockCommands.updateFollowup).toHaveBeenCalledTimes(1)
    })
    expect(mockCommands.updateFollowup.mock.calls[0]?.[1]).toMatchObject({
      status: 'draft_ready',
      transition_reason: 'operator_verified_not_sent',
    })
    expect(mockToast.success).not.toHaveBeenCalledWith(
      'Follow-up returned to draft'
    )
    expect(screen.getByText('Verify Send')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^Send$/i })
    ).not.toBeInTheDocument()

    resolvePersistence?.({
      status: 'ok',
      data: { ...followup, status: 'draft_ready' },
    })

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        'Follow-up returned to draft'
      )
    })
    expect(
      await screen.findByRole('button', { name: /^Send$/i })
    ).toBeInTheDocument()
  })

  it('keeps retry blocked when the not-sent recovery cannot be persisted', async () => {
    const now = new Date().toISOString()
    mockCommands.listFollowups.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'f1',
          job_id: 'j1',
          draft_subject: 'Following up',
          draft_body: 'Hello',
          status: 'send_unknown',
          scheduled_date: now.slice(0, 10),
          sent_at: null,
          gmail_message_id: null,
          recipient_email: 'hr@acme.com',
          created_at: now,
        },
      ],
    })
    mockCommands.listJobs.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'j1',
          company: 'Acme Corp',
          role: 'Engineer',
          ats: 'ashby',
          apply_url: 'https://example.com',
          status: 'applied',
          tier: 'tier1',
          created_at: now,
          updated_at: now,
        },
      ],
    })
    mockCommands.updateFollowup.mockRejectedValue(
      new Error('database unavailable')
    )

    render(<FollowupManager />)
    const user = userEvent.setup()
    await user.click(
      await screen.findByRole('button', {
        name: /Acme Corp.*Verify Send/i,
      })
    )
    await user.click(
      screen.getByRole('button', { name: /I verified it was not sent/i })
    )
    await user.click(screen.getByRole('button', { name: /^allow retry$/i }))

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        'Failed to update follow-up',
        expect.any(Object)
      )
    })
    expect(mockToast.success).not.toHaveBeenCalledWith(
      'Follow-up returned to draft'
    )
    expect(screen.getByText('Verify Send')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^Send$/i })
    ).not.toBeInTheDocument()
  })

  it('counts unresolved sends as active work and keeps them in All Pending', async () => {
    const now = new Date().toISOString()
    const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)
    mockCommands.listFollowups.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'f1',
          job_id: 'j1',
          draft_subject: 'Following up',
          draft_body: 'Hello',
          status: 'send_unknown',
          scheduled_date: futureDate,
          sent_at: null,
          gmail_message_id: null,
          recipient_email: 'hr@acme.com',
          created_at: now,
        },
        {
          id: 'f2',
          job_id: 'j2',
          draft_subject: null,
          draft_body: null,
          status: 'pending',
          scheduled_date: futureDate,
          sent_at: null,
          gmail_message_id: null,
          recipient_email: null,
          created_at: now,
        },
      ],
    })
    mockCommands.listJobs.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'j1',
          company: 'Acme Corp',
          role: 'Engineer',
          ats: 'ashby',
          apply_url: 'https://example.com',
          status: 'applied',
          tier: 'tier1',
          created_at: now,
          updated_at: now,
        },
        {
          id: 'j2',
          company: 'Beta Inc',
          role: 'Developer',
          ats: 'greenhouse',
          apply_url: 'https://example2.com',
          status: 'applied',
          tier: 'tier1',
          created_at: now,
          updated_at: now,
        },
      ],
    })

    render(<FollowupManager />)
    const user = userEvent.setup()

    expect(
      await screen.findByText(/1 pending.*1 verify send/i)
    ).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /all pending/i }))

    expect(
      screen.getByRole('button', { name: /Acme Corp.*Verify Send/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Beta Inc.*Pending/i })
    ).toBeInTheDocument()
  })

  it('requires explicit verification before an unknown send can be retried', async () => {
    const now = new Date().toISOString()
    mockCommands.listFollowups.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'f1',
          job_id: 'j1',
          draft_subject: 'Following up',
          draft_body: 'Hello',
          status: 'send_unknown',
          scheduled_date: now.split('T')[0],
          sent_at: null,
          gmail_message_id: null,
          recipient_email: 'hr@acme.com',
          created_at: now,
        },
      ],
    })
    mockCommands.listJobs.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'j1',
          company: 'Acme Corp',
          role: 'Engineer',
          ats: 'ashby',
          apply_url: 'https://example.com',
          status: 'applied',
          tier: 'tier1',
          created_at: now,
          updated_at: now,
        },
      ],
    })
    mockCommands.listFollowupEvents.mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'event-1',
          followup_id: 'f1',
          from_status: 'draft_ready',
          to_status: 'send_unknown',
          reason: 'send_attempted',
          occurred_at: '2026-07-17T12:00:00Z',
        },
      ],
    })

    render(<FollowupManager />)
    const user = userEvent.setup()

    expect(await screen.findByText('Verify Send')).toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: /Acme Corp.*Verify Send/i })
    )

    expect(
      screen.getByText(/check Gmail before choosing either action/i)
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^Send$/i })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /I verified it was sent/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /I verified it was not sent/i })
    ).toBeInTheDocument()
    expect(await screen.findByText('Send attempted')).toBeInTheDocument()
    expect(screen.getByText('2026-07-17 12:00:00 UTC')).toBeInTheDocument()
  })
})
