import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
} from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CreateFollowupInput,
  Followup,
  UpdateFollowupInput,
} from '@/lib/bindings'
import { commands } from '@/lib/tauri-bindings'
import {
  useCreateFollowup,
  useDeleteFollowup,
  useUpdateFollowup,
} from '@/services/followups'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const FOLLOWUPS_KEY = ['followups', 'list', { status: undefined }] as const
const SIDEBAR_COUNTS_KEY = ['analytics', 'sidebarCounts'] as const
const PIPELINE_FUNNEL_KEY = ['analytics', 'pipelineFunnel'] as const

function makeFollowup(status = 'pending'): Followup {
  return {
    id: 'followup-1',
    job_id: 'job-1',
    draft_subject: null,
    draft_body: null,
    status,
    scheduled_date: '2026-07-18T00:00:00Z',
    sent_at: null,
    gmail_message_id: null,
    recipient_email: 'candidate@example.invalid',
    created_at: '2026-07-17T00:00:00Z',
  }
}

function createInput(): CreateFollowupInput {
  return {
    job_id: 'job-1',
    scheduled_date: '2026-07-18T00:00:00Z',
    recipient_email: 'candidate@example.invalid',
  }
}

function updateInput(): UpdateFollowupInput {
  return {
    draft_subject: null,
    draft_body: null,
    status: 'skipped',
    scheduled_date: null,
    sent_at: null,
    gmail_message_id: null,
    recipient_email: null,
    transition_reason: 'operator_skipped',
  }
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  for (const key of [FOLLOWUPS_KEY, SIDEBAR_COUNTS_KEY, PIPELINE_FUNNEL_KEY]) {
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

function expectFollowupViewsRefreshed(queryClient: QueryClient) {
  expectInvalidated(queryClient, FOLLOWUPS_KEY)
  expectInvalidated(queryClient, SIDEBAR_COUNTS_KEY)
  expectFresh(queryClient, PIPELINE_FUNNEL_KEY)
}

describe('follow-up sidebar count invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refreshes follow-up views and sidebar counts after creation', async () => {
    vi.mocked(commands.createFollowup).mockResolvedValue({
      status: 'ok',
      data: makeFollowup(),
    })
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useCreateFollowup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(createInput())
    })

    expectFollowupViewsRefreshed(queryClient)
  })

  it('refreshes follow-up views and sidebar counts after update', async () => {
    vi.mocked(commands.updateFollowup).mockResolvedValue({
      status: 'ok',
      data: makeFollowup('skipped'),
    })
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useUpdateFollowup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        id: 'followup-1',
        input: updateInput(),
      })
    })

    expectFollowupViewsRefreshed(queryClient)
  })

  it('refreshes follow-up views and sidebar counts after deletion', async () => {
    vi.mocked(commands.deleteFollowup).mockResolvedValue({
      status: 'ok',
      data: true,
    })
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useDeleteFollowup(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('followup-1')
    })

    expectFollowupViewsRefreshed(queryClient)
  })
})
