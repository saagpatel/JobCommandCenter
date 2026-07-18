import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
} from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateJobInput, Job, UpdateJobInput } from '@/lib/bindings'
import { commands } from '@/lib/tauri-bindings'
import { useCreateJob, useDeleteJob, useUpdateJob } from '@/services/jobs'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const JOBS_KEY = ['jobs', 'list', { status: undefined }] as const
const FOLLOWUPS_KEY = ['followups', 'list', { status: undefined }] as const
const NOTES_KEY = ['notes', 'forJob', 'job-1'] as const
const ANALYTICS_KEY = ['analytics', 'sidebarCounts'] as const
const SUBMISSIONS_KEY = ['submission-receipts', 'unresolved'] as const

function makeJob(status = 'saved'): Job {
  return {
    id: 'job-1',
    company: 'Example Corp',
    role: 'Engineer',
    ats: 'generic',
    apply_url: 'https://example.invalid',
    job_posting_id: null,
    board_token: null,
    status,
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
}

function createInput(): CreateJobInput {
  return {
    company: 'Example Corp',
    role: 'Engineer',
    ats: 'generic',
    apply_url: 'https://example.invalid',
    status: null,
    tier: null,
    job_posting_id: null,
    board_token: null,
    source: null,
    resume_path: null,
    cover_letter_path: null,
    custom_fields: null,
    notes: null,
    salary_range: null,
    location: null,
    jd_url: null,
  }
}

function updateInput(): UpdateJobInput {
  return {
    company: null,
    role: null,
    ats: null,
    apply_url: null,
    status: 'applied',
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

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  for (const key of [
    JOBS_KEY,
    FOLLOWUPS_KEY,
    NOTES_KEY,
    ANALYTICS_KEY,
    SUBMISSIONS_KEY,
  ]) {
    queryClient.setQueryData(key, [])
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, wrapper }
}

function expectInvalidated(queryClient: QueryClient, key: QueryKey) {
  expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
}

function expectFresh(queryClient: QueryClient, key: QueryKey) {
  expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
}

describe('job lifecycle cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invalidates every dependent lifecycle view after job creation', async () => {
    vi.mocked(commands.createJob).mockResolvedValue({
      status: 'ok',
      data: makeJob(),
    })
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useCreateJob(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(createInput())
    })

    expectInvalidated(queryClient, JOBS_KEY)
    expectInvalidated(queryClient, FOLLOWUPS_KEY)
    expectInvalidated(queryClient, NOTES_KEY)
    expectInvalidated(queryClient, ANALYTICS_KEY)
    expectFresh(queryClient, SUBMISSIONS_KEY)
  })

  it('invalidates every dependent lifecycle view after a job update', async () => {
    vi.mocked(commands.updateJob).mockResolvedValue({
      status: 'ok',
      data: makeJob('applied'),
    })
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useUpdateJob(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        id: 'job-1',
        input: updateInput(),
      })
    })

    expectInvalidated(queryClient, JOBS_KEY)
    expectInvalidated(queryClient, FOLLOWUPS_KEY)
    expectInvalidated(queryClient, NOTES_KEY)
    expectInvalidated(queryClient, ANALYTICS_KEY)
    expectFresh(queryClient, SUBMISSIONS_KEY)
  })

  it('also invalidates submission receipts after deleting a job', async () => {
    vi.mocked(commands.deleteJob).mockResolvedValue({
      status: 'ok',
      data: true,
    })
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useDeleteJob(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('job-1')
    })

    expectInvalidated(queryClient, JOBS_KEY)
    expectInvalidated(queryClient, FOLLOWUPS_KEY)
    expectInvalidated(queryClient, NOTES_KEY)
    expectInvalidated(queryClient, ANALYTICS_KEY)
    expectInvalidated(queryClient, SUBMISSIONS_KEY)
  })
})
