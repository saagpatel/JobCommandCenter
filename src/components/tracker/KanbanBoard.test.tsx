import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useJobs, useUpdateJob } from '@/services/jobs'
import { act, render, screen, waitFor } from '@/test/test-utils'
import { KanbanBoard } from './KanbanBoard'

type DragEndHandler = (event: {
  active: { id: string }
  over: { id: string } | null
}) => void

let dragEndHandler: DragEndHandler | undefined
let updateJobMutation: ReturnType<typeof vi.fn>

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: ReactNode
    onDragEnd: DragEndHandler
  }) => {
    dragEndHandler = onDragEnd
    return children
  },
  DragOverlay: ({ children }: { children: ReactNode }) => children,
  PointerSensor: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
  useDroppable: vi.fn(() => ({ setNodeRef: vi.fn(), isOver: false })),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: ReactNode }) => children,
  verticalListSortingStrategy: {},
  useSortable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  })),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: vi.fn(() => undefined) } },
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/services/jobs', () => ({
  useJobs: vi.fn(),
  useUpdateJob: vi.fn(),
}))

vi.mock('./AddJobModal', () => ({
  AddJobModal: () => null,
}))

vi.mock('./ImportPacketModal', () => ({
  ImportPacketModal: () => null,
}))

vi.mock('./JobDetailPanel', () => ({
  JobDetailPanel: () => null,
}))

function makeJob(id: string, status: string) {
  return {
    id,
    company: id === 'manual-job' ? 'Manual Corp' : 'Unknown Corp',
    role: 'Engineer',
    ats: 'linkedin',
    apply_url: 'https://linkedin.com/jobs/view/1',
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

describe('KanbanBoard recovery visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dragEndHandler = undefined
    updateJobMutation = vi.fn()
    window.localStorage.clear()
    vi.mocked(useJobs).mockReturnValue({
      data: [makeJob('manual-job', 'saved'), makeJob('unknown-job', 'applied')],
      isLoading: false,
    } as ReturnType<typeof useJobs>)
    vi.mocked(useUpdateJob).mockReturnValue({
      mutate: updateJobMutation,
    } as unknown as ReturnType<typeof useUpdateJob>)
    vi.mocked(commands.listUnresolvedSubmissionReceipts).mockResolvedValue({
      status: 'ok',
      data: [],
    })
  })

  it('surfaces manual and unknown recovery on cards and column headers', async () => {
    vi.mocked(commands.listUnresolvedSubmissionReceipts).mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'manual-receipt',
          job_id: 'manual-job',
          adapter: 'linkedin',
          status: 'manual_required',
          resume_uploaded: false,
          cover_letter_uploaded: false,
          fields_filled: '[]',
          fields_skipped: '[]',
          error: 'Continue manually',
          duration_seconds: 1,
          created_at: '2026-07-17T12:00:00Z',
          resolved_at: null,
        },
        {
          id: 'unknown-receipt',
          job_id: 'unknown-job',
          adapter: 'linkedin',
          status: 'unknown_outcome',
          resume_uploaded: false,
          cover_letter_uploaded: false,
          fields_filled: '[]',
          fields_skipped: '[]',
          error: 'Verify externally',
          duration_seconds: 0,
          created_at: '2026-07-17T12:01:00Z',
          resolved_at: null,
        },
      ],
    })

    render(<KanbanBoard />)

    expect(await screen.findByText('Manual step required')).toBeInTheDocument()
    expect(screen.getByText('Outcome unknown')).toBeInTheDocument()
    expect(screen.getAllByText('1 blocked')).toHaveLength(2)
  })

  it('includes a legacy local unknown block without overwriting richer database truth', async () => {
    window.localStorage.setItem(
      'jcc-unknown-submission-job-ids',
      JSON.stringify(['manual-job', 'unknown-job'])
    )
    vi.mocked(commands.listUnresolvedSubmissionReceipts).mockResolvedValue({
      status: 'ok',
      data: [
        {
          id: 'manual-receipt',
          job_id: 'manual-job',
          adapter: 'linkedin',
          status: 'manual_required',
          resume_uploaded: false,
          cover_letter_uploaded: false,
          fields_filled: '[]',
          fields_skipped: '[]',
          error: 'Continue manually',
          duration_seconds: 1,
          created_at: '2026-07-17T12:00:00Z',
          resolved_at: null,
        },
      ],
    })

    render(<KanbanBoard />)

    expect(await screen.findByText('Manual step required')).toBeInTheDocument()
    expect(screen.getByText('Outcome unknown')).toBeInTheDocument()
  })

  it('reports unavailable recovery indicators instead of silently showing none', async () => {
    vi.mocked(commands.listUnresolvedSubmissionReceipts).mockResolvedValue({
      status: 'error',
      error: 'database unavailable',
    })

    render(<KanbanBoard />)

    expect(
      await screen.findByText(/recovery indicators unavailable/i)
    ).toBeInTheDocument()
  })

  it.each([
    ['manual_required', 'Manual step required'],
    ['unknown_outcome', 'Outcome unknown'],
  ] as const)(
    'blocks a tracker move while %s recovery is unresolved',
    async (status, visibleStatus) => {
      const jobId = status === 'manual_required' ? 'manual-job' : 'unknown-job'
      vi.mocked(commands.listUnresolvedSubmissionReceipts).mockResolvedValue({
        status: 'ok',
        data: [
          {
            id: `${jobId}-receipt`,
            job_id: jobId,
            adapter: 'linkedin',
            status,
            resume_uploaded: false,
            cover_letter_uploaded: false,
            fields_filled: '[]',
            fields_skipped: '[]',
            error: 'Recovery required',
            duration_seconds: 1,
            created_at: '2026-07-17T12:00:00Z',
            resolved_at: null,
          },
        ],
      })

      render(<KanbanBoard />)
      expect(await screen.findByText(visibleStatus)).toBeInTheDocument()

      act(() => {
        dragEndHandler?.({
          active: { id: jobId },
          over: { id: 'interviewing' },
        })
      })

      expect(updateJobMutation).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledWith(
        'Resolve submission recovery before moving this job',
        expect.objectContaining({
          description: expect.stringMatching(
            /lifecycle status was not changed/i
          ),
        })
      )
    }
  )

  it('fails closed while recovery state is still loading', () => {
    vi.mocked(commands.listUnresolvedSubmissionReceipts).mockReturnValue(
      new Promise(() => undefined)
    )

    render(<KanbanBoard />)
    expect(
      screen.getByText(/checking submission recovery/i)
    ).toBeInTheDocument()

    act(() => {
      dragEndHandler?.({
        active: { id: 'manual-job' },
        over: { id: 'applied' },
      })
    })

    expect(updateJobMutation).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      'Tracker move blocked',
      expect.objectContaining({
        description: expect.stringMatching(/still being verified/i),
      })
    )
  })

  it('fails closed when recovery state is unavailable', async () => {
    vi.mocked(commands.listUnresolvedSubmissionReceipts).mockResolvedValue({
      status: 'error',
      error: 'database unavailable',
    })

    render(<KanbanBoard />)
    expect(
      await screen.findByText(/recovery indicators unavailable/i)
    ).toBeInTheDocument()

    act(() => {
      dragEndHandler?.({
        active: { id: 'manual-job' },
        over: { id: 'applied' },
      })
    })

    expect(updateJobMutation).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith(
      'Tracker move blocked',
      expect.objectContaining({
        description: expect.stringMatching(/could not be verified/i),
      })
    )
  })

  it('preserves normal tracker moves after recovery state is verified clear', async () => {
    render(<KanbanBoard />)
    await waitFor(() =>
      expect(
        screen.queryByText(/checking submission recovery/i)
      ).not.toBeInTheDocument()
    )

    act(() => {
      dragEndHandler?.({
        active: { id: 'manual-job' },
        over: { id: 'applied' },
      })
    })

    expect(updateJobMutation).toHaveBeenCalledOnce()
    expect(updateJobMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'manual-job',
        input: expect.objectContaining({
          status: 'applied',
          applied_at: expect.any(String),
        }),
      })
    )
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('uses the target card column as the destination instead of its job id', async () => {
    render(<KanbanBoard />)
    await waitFor(() =>
      expect(
        screen.queryByText(/checking submission recovery/i)
      ).not.toBeInTheDocument()
    )

    act(() => {
      dragEndHandler?.({
        active: { id: 'manual-job' },
        over: { id: 'unknown-job' },
      })
    })

    expect(updateJobMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'manual-job',
        input: expect.objectContaining({
          status: 'applied',
        }),
      })
    )
  })
})
