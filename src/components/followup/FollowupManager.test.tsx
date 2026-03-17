import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { FollowupManager } from './FollowupManager'

const mockCommands = vi.hoisted(() => ({
  listFollowups: vi.fn(),
  listJobs: vi.fn(),
}))

vi.mock('@/lib/tauri-bindings', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/tauri-bindings')>()
  return {
    ...original,
    commands: {
      ...original.commands,
      listFollowups: mockCommands.listFollowups,
      listJobs: mockCommands.listJobs,
    },
  }
})

// Mock sidecar fetch for gmail status
global.fetch = vi.fn().mockRejectedValue(new Error('sidecar not running'))

describe('FollowupManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
