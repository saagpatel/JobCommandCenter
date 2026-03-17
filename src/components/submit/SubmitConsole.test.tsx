import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { SubmitConsole } from './SubmitConsole'
import { useJobs, useUpdateJob } from '@/services/jobs'
import { useProfile } from '@/services/profile'
import { useSidecarStatus } from '@/services/sidecar'
import type { Job, SidecarStatus } from '@/lib/tauri-bindings'

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
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function setupDefaultMocks(jobs: Job[] = []) {
  ;(useJobs as Mock).mockReturnValue({ data: jobs })
  ;(useProfile as Mock).mockReturnValue({ data: mockProfile })
  ;(useSidecarStatus as Mock).mockReturnValue({ data: healthySidecar })
  ;(useUpdateJob as Mock).mockReturnValue({ mutate: vi.fn() })
}

describe('SubmitConsole', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
