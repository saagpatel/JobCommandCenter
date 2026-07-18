import userEvent from '@testing-library/user-event'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import type { Job, SidecarStatus } from '@/lib/tauri-bindings'
import { useJobs, useUpdateJob } from '@/services/jobs'
import { useProfile } from '@/services/profile'
import { useSidecarStatus } from '@/services/sidecar'
import { render, screen, waitFor } from '@/test/test-utils'
import { SubmitConsole } from './SubmitConsole'

vi.mock('@/services/jobs', () => ({
  useJobs: vi.fn(),
  useUpdateJob: vi.fn(),
}))
vi.mock('@/services/profile', () => ({
  useProfile: vi.fn(),
}))
vi.mock('@/services/sidecar', () => ({
  useSidecarStatus: vi.fn(),
}))

const healthySidecar: SidecarStatus = {
  state: 'Healthy',
  pid: 123,
  restart_count: 0,
  uptime_seconds: 60,
}

const mockProfile = {
  id: 1,
  first_name: 'Jane',
  last_name: 'Doe',
  email: 'jane@example.com',
  phone: '555-0100',
  linkedin_url: 'https://linkedin.com/in/janedoe',
  location: 'San Francisco, CA',
  authorized_to_work: true,
  requires_sponsorship: false,
  preferred_name: null,
  base_resume_path: null,
  updated_at: '2026-01-01T00:00:00Z',
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    company: 'Acme Corp',
    role: 'Software Engineer',
    ats: 'ashby',
    apply_url: 'https://jobs.ashbyhq.com/acme/123',
    job_posting_id: null,
    board_token: null,
    status: 'saved',
    tier: 'A',
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
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function setupDefaultMocks(jobs: Job[] = []) {
  ;(useJobs as Mock).mockReturnValue({ data: jobs })
  ;(useProfile as Mock).mockReturnValue({ data: mockProfile })
  ;(useSidecarStatus as Mock).mockReturnValue({ data: healthySidecar })
  const updateJob = {
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
  }
  ;(useUpdateJob as Mock).mockReturnValue(updateJob)
  return updateJob
}

describe('SubmitConsole', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    vi.mocked(commands.listUnresolvedSubmissionReceipts).mockResolvedValue({
      status: 'ok',
      data: [],
    })
    vi.mocked(commands.recordSubmissionReceipt).mockResolvedValue({
      status: 'ok',
      data: {} as never,
    })
    vi.mocked(commands.resolveSubmissionReceipts).mockResolvedValue({
      status: 'ok',
      data: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders with empty state when no jobs', () => {
    setupDefaultMocks([])
    render(<SubmitConsole />)

    expect(screen.getByText('Submit Console')).toBeInTheDocument()
    expect(
      screen.getByText('Select jobs to preview submission')
    ).toBeInTheDocument()
  })

  it('shows job list filtered by status', () => {
    const jobs = [
      makeJob({ id: 'j1', company: 'Acme', role: 'Engineer' }),
      makeJob({ id: 'j2', company: 'Globex', role: 'Designer' }),
      makeJob({ id: 'j3', company: 'Initech', role: 'PM' }),
    ]
    setupDefaultMocks(jobs)
    render(<SubmitConsole />)

    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.getByText('Globex')).toBeInTheDocument()
    expect(screen.getByText('Initech')).toBeInTheDocument()
  })

  it('selecting a job updates count', async () => {
    const user = userEvent.setup()
    const jobs = [
      makeJob({ id: 'j1', company: 'Acme', role: 'Engineer' }),
      makeJob({ id: 'j2', company: 'Globex', role: 'Designer' }),
      makeJob({ id: 'j3', company: 'Initech', role: 'PM' }),
    ]
    setupDefaultMocks(jobs)
    render(<SubmitConsole />)

    expect(screen.getByText('0 of 3 selected')).toBeInTheDocument()

    // Click the first checkbox (inside the label wrapping Acme's row)
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0] as HTMLElement)

    expect(screen.getByText('1 of 3 selected')).toBeInTheDocument()
  })

  it('Dry Run button is disabled when no jobs selected', () => {
    setupDefaultMocks([makeJob({ id: 'j1' })])
    render(<SubmitConsole />)

    const dryRunBtn = screen.getByRole('button', { name: /dry run/i })
    expect(dryRunBtn).toBeDisabled()
  })

  it('Submit button shows confirmation dialog when job is selected', async () => {
    const user = userEvent.setup()
    const jobs = [makeJob({ id: 'j1', company: 'Acme', role: 'Engineer' })]
    setupDefaultMocks(jobs)
    render(<SubmitConsole />)

    // Select the job
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0] as HTMLElement)

    // Click Submit Selected — should open the AlertDialog
    const submitBtn = screen.getByRole('button', { name: /submit selected/i })
    await user.click(submitBtn)

    expect(screen.getByText(/submit 1 application/i)).toBeInTheDocument()
    expect(
      screen.getByText(/this action cannot be undone/i)
    ).toBeInTheDocument()
  })

  it('shows API badge for API adapter jobs in preview', async () => {
    const user = userEvent.setup()
    const jobs = [
      makeJob({ id: 'j1', company: 'Acme', role: 'Engineer', ats: 'ashby' }),
    ]
    setupDefaultMocks(jobs)
    render(<SubmitConsole />)

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0] as HTMLElement)

    expect(screen.getByText('API')).toBeInTheDocument()
  })

  it('shows Browser badge for browser adapter jobs in preview', async () => {
    const user = userEvent.setup()
    const jobs = [
      makeJob({
        id: 'j1',
        company: 'Acme',
        role: 'Engineer',
        ats: 'linkedin',
        apply_url: 'https://linkedin.com/jobs/view/123',
      }),
    ]
    setupDefaultMocks(jobs)
    render(<SubmitConsole />)

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0] as HTMLElement)

    expect(screen.getByText('Browser')).toBeInTheDocument()
  })

  it('shows browser notice when browser adapter job is selected', async () => {
    const user = userEvent.setup()
    const jobs = [
      makeJob({
        id: 'j1',
        company: 'Acme',
        role: 'Engineer',
        ats: 'linkedin',
        apply_url: 'https://linkedin.com/jobs/view/123',
      }),
    ]
    setupDefaultMocks(jobs)
    render(<SubmitConsole />)

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0] as HTMLElement)

    expect(
      screen.getByText(/browser window will open for/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/Linkedin/)).toBeInTheDocument()
  })

  it('blocks retry for a durable unknown outcome until the operator resolves it', async () => {
    const user = userEvent.setup()
    const job = makeJob({ id: 'j1', company: 'Acme', role: 'Engineer' })
    window.localStorage.setItem(
      'jcc-unknown-submission-job-ids',
      JSON.stringify([job.id])
    )
    setupDefaultMocks([job])
    render(<SubmitConsole />)

    await user.click(screen.getByRole('checkbox'))

    expect(
      screen.getByText(/submission outcome is unknown/i)
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dry run/i })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /submit selected/i })
    ).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /i checked the ats/i }))

    await waitFor(() =>
      expect(commands.resolveSubmissionReceipts).toHaveBeenCalledWith(job.id)
    )
    expect(
      screen.queryByText(/submission outcome is unknown/i)
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dry run/i })).toBeEnabled()
    expect(window.localStorage.getItem('jcc-unknown-submission-job-ids')).toBe(
      '[]'
    )
  })

  it('restores a durable manual handoff after an app relaunch and blocks blind retry', async () => {
    const user = userEvent.setup()
    const job = makeJob({ id: 'manual-job-id', ats: 'linkedin' })
    setupDefaultMocks([job])
    const recoveryCommands = commands as typeof commands & {
      listUnresolvedSubmissionReceipts: Mock
    }
    recoveryCommands.listUnresolvedSubmissionReceipts = vi
      .fn()
      .mockResolvedValue({
        status: 'ok',
        data: [
          {
            id: 'receipt-1',
            job_id: job.id,
            adapter: job.ats,
            status: 'manual_required',
            resume_uploaded: false,
            cover_letter_uploaded: false,
            fields_filled: '[]',
            fields_skipped: '[]',
            error:
              'Continue manually at https://external.example/apply; the URL was sanitized.',
            duration_seconds: 1,
            created_at: '2026-07-17T00:00:00Z',
            resolved_at: null,
          },
        ],
      })

    render(<SubmitConsole />)
    await waitFor(() =>
      expect(
        recoveryCommands.listUnresolvedSubmissionReceipts
      ).toHaveBeenCalledOnce()
    )
    await user.click(screen.getByRole('checkbox'))

    expect(
      await screen.findByText(
        /continue manually at https:\/\/external\.example/i
      )
    ).toBeInTheDocument()
    expect(screen.getByText(/manual required/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dry run/i })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /submit selected/i })
    ).toBeDisabled()
  })

  it('fails closed when durable recovery state cannot be read', async () => {
    const user = userEvent.setup()
    const job = makeJob({ id: 'job-with-unknown-recovery-state' })
    setupDefaultMocks([job])
    vi.mocked(commands.listUnresolvedSubmissionReceipts).mockResolvedValue({
      status: 'error',
      error: 'database unavailable',
    })

    render(<SubmitConsole />)
    await user.click(screen.getByRole('checkbox'))

    expect(
      await screen.findByText(/recovery state could not be verified/i)
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dry run/i })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /submit selected/i })
    ).toBeDisabled()
  })

  it('persists a live manual handoff before reporting it as safely recoverable', async () => {
    const user = userEvent.setup()
    const job = makeJob({ id: 'manual-job-id', ats: 'linkedin' })
    setupDefaultMocks([job])
    const result = {
      job_id: job.id,
      company: job.company,
      role: job.role,
      adapter: job.ats,
      status: 'manual_required',
      resume_uploaded: false,
      cover_letter_uploaded: false,
      fields_filled: ['Email'],
      fields_skipped: [],
      error: 'Continue manually at https://external.example/apply',
      duration_seconds: 1,
      timestamp: '2026-07-17T00:00:00Z',
    }
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(`data: ${JSON.stringify(result)}\n`),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => reader },
      })
    )

    render(<SubmitConsole />)
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /submit selected/i }))
    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() =>
      expect(commands.recordSubmissionReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          job_id: job.id,
          status: 'manual_required',
          error: result.error,
        })
      )
    )
    expect(
      screen.getByRole('button', {
        name: /i completed or abandoned this step/i,
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /submit selected/i })
    ).toBeDisabled()
  })

  it('turns live-submit transport loss into a durable non-retriable unknown outcome', async () => {
    const user = userEvent.setup()
    const job = makeJob({ id: 'exact-job-id' })
    setupDefaultMocks([job])
    vi.spyOn(commands, 'getSubmitToken').mockResolvedValue('test-token')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('stream lost')))
    render(<SubmitConsole />)

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /submit selected/i }))
    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() =>
      expect(
        screen.getByText(/submission outcome is unknown/i)
      ).toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: /dry run/i })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /submit selected/i })
    ).toBeDisabled()
    expect(
      JSON.parse(
        window.localStorage.getItem('jcc-unknown-submission-job-ids') ?? '[]'
      )
    ).toEqual([job.id])
  })

  it('persists an unterminated final success receipt before allowing another action', async () => {
    const user = userEvent.setup()
    const job = makeJob({ id: 'exact-job-id' })
    const updateJob = setupDefaultMocks([job])
    const result = {
      job_id: job.id,
      company: job.company,
      role: job.role,
      adapter: job.ats,
      status: 'success',
      resume_uploaded: true,
      cover_letter_uploaded: false,
      fields_filled: [],
      fields_skipped: [],
      error: null,
      duration_seconds: 1,
      timestamp: '2026-07-17T00:00:00Z',
    }
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(`data: ${JSON.stringify(result)}`),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => reader },
      })
    )
    render(<SubmitConsole />)

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /submit selected/i }))
    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => expect(updateJob.mutateAsync).toHaveBeenCalledOnce())
    expect(updateJob.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: job.id })
    )
    expect(
      window.localStorage.getItem('jcc-unknown-submission-job-ids')
    ).toBeNull()
  })

  it('marks external success unknown when the exact-job tracker receipt cannot persist', async () => {
    const user = userEvent.setup()
    const job = makeJob({ id: 'exact-job-id' })
    const updateJob = setupDefaultMocks([job])
    updateJob.mutateAsync.mockRejectedValue(new Error('database unavailable'))
    const result = {
      job_id: job.id,
      company: job.company,
      role: job.role,
      adapter: job.ats,
      status: 'success',
      resume_uploaded: true,
      cover_letter_uploaded: false,
      fields_filled: [],
      fields_skipped: [],
      error: null,
      duration_seconds: 1,
      timestamp: '2026-07-17T00:00:00Z',
    }
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode(`data: ${JSON.stringify(result)}\n`),
        })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => reader },
      })
    )
    render(<SubmitConsole />)

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /submit selected/i }))
    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() =>
      expect(
        screen.getByText(/submission outcome is unknown/i)
      ).toBeInTheDocument()
    )
    expect(
      JSON.parse(
        window.localStorage.getItem('jcc-unknown-submission-job-ids') ?? '[]'
      )
    ).toEqual([job.id])
  })
})
