import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
} from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateNoteInput, Note, UpdateNoteInput } from '@/lib/bindings'
import { commands } from '@/lib/tauri-bindings'
import { useCreateNote, useDeleteNote, useUpdateNote } from '@/services/notes'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const NOTES_KEY = ['notes', 'forJob', 'job-1'] as const
const SIDEBAR_COUNTS_KEY = ['analytics', 'sidebarCounts'] as const
const PIPELINE_FUNNEL_KEY = ['analytics', 'pipelineFunnel'] as const

function makeNote(content = ''): Note {
  return {
    id: 'note-1',
    job_id: 'job-1',
    note_type: 'interview_prep',
    title: 'Interview Prep',
    content,
    created_at: '2026-07-17T00:00:00Z',
    updated_at: '2026-07-17T00:00:00Z',
  }
}

function createInput(): CreateNoteInput {
  return {
    job_id: 'job-1',
    note_type: 'interview_prep',
    title: 'Interview Prep',
    content: '',
  }
}

function updateInput(): UpdateNoteInput {
  return {
    title: null,
    content: 'Prepared',
  }
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  for (const key of [NOTES_KEY, SIDEBAR_COUNTS_KEY, PIPELINE_FUNNEL_KEY]) {
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

function expectNoteViewsRefreshed(queryClient: QueryClient) {
  expectInvalidated(queryClient, NOTES_KEY)
  expectInvalidated(queryClient, SIDEBAR_COUNTS_KEY)
  expectFresh(queryClient, PIPELINE_FUNNEL_KEY)
}

describe('interview-prep sidebar count invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refreshes note views and sidebar counts after creation', async () => {
    vi.mocked(commands.createNote).mockResolvedValue({
      status: 'ok',
      data: makeNote(),
    })
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useCreateNote(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync(createInput())
    })

    expectNoteViewsRefreshed(queryClient)
  })

  it('refreshes note views and sidebar counts after update', async () => {
    vi.mocked(commands.updateNote).mockResolvedValue({
      status: 'ok',
      data: makeNote('Prepared'),
    })
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useUpdateNote(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        id: 'note-1',
        input: updateInput(),
      })
    })

    expectNoteViewsRefreshed(queryClient)
  })

  it('refreshes note views and sidebar counts after deletion', async () => {
    vi.mocked(commands.deleteNote).mockResolvedValue({
      status: 'ok',
      data: true,
    })
    const { queryClient, wrapper } = setup()
    const { result } = renderHook(() => useDeleteNote(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('note-1')
    })

    expectNoteViewsRefreshed(queryClient)
  })
})
