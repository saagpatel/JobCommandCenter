import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import { Analytics } from './Analytics'
import { commands } from '@/lib/tauri-bindings'

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  )
}

describe('Analytics', () => {
  it('renders stat cards with zero data', async () => {
    vi.mocked(commands.getResponseRate).mockResolvedValue({
      status: 'ok',
      data: 0,
    })
    vi.mocked(commands.getAvgDaysToResponse).mockResolvedValue({
      status: 'ok',
      data: 0,
    })
    vi.mocked(commands.getPipelineFunnel).mockResolvedValue({
      status: 'ok',
      data: { saved: 0, applied: 0, interviewing: 0, offer: 0, rejected: 0 },
    })
    vi.mocked(commands.getApplicationsByWeek).mockResolvedValue({
      status: 'ok',
      data: [],
    })
    vi.mocked(commands.getSubmissionsByAdapter).mockResolvedValue({
      status: 'ok',
      data: [],
    })
    vi.mocked(commands.getTierComparison).mockResolvedValue({
      status: 'ok',
      data: {
        tier1: { applied: 0, responded: 0, interviewing: 0, response_rate: 0 },
        tier2: { applied: 0, responded: 0, interviewing: 0, response_rate: 0 },
      },
    })

    renderWithProviders(<Analytics />)

    expect(await screen.findByText('Analytics')).toBeInTheDocument()
    expect(screen.getByText('Avg Days to Response')).toBeInTheDocument()
    expect(screen.getAllByText('0%').length).toBeGreaterThan(0)
    expect(screen.getByText('0.0')).toBeInTheDocument()
  })

  it('renders pipeline funnel with data', async () => {
    vi.mocked(commands.getResponseRate).mockResolvedValue({
      status: 'ok',
      data: 0.25,
    })
    vi.mocked(commands.getAvgDaysToResponse).mockResolvedValue({
      status: 'ok',
      data: 5.5,
    })
    vi.mocked(commands.getPipelineFunnel).mockResolvedValue({
      status: 'ok',
      data: {
        saved: 10,
        applied: 8,
        interviewing: 3,
        offer: 1,
        rejected: 2,
      },
    })
    vi.mocked(commands.getApplicationsByWeek).mockResolvedValue({
      status: 'ok',
      data: [],
    })
    vi.mocked(commands.getSubmissionsByAdapter).mockResolvedValue({
      status: 'ok',
      data: [],
    })
    vi.mocked(commands.getTierComparison).mockResolvedValue({
      status: 'ok',
      data: {
        tier1: {
          applied: 5,
          responded: 2,
          interviewing: 1,
          response_rate: 0.4,
        },
        tier2: {
          applied: 3,
          responded: 1,
          interviewing: 0,
          response_rate: 0.33,
        },
      },
    })

    renderWithProviders(<Analytics />)

    expect(await screen.findByText('25%')).toBeInTheDocument()
    expect(screen.getByText('5.5')).toBeInTheDocument()
    expect(screen.getByText('Pipeline Funnel')).toBeInTheDocument()
  })

  it('handles empty adapter data gracefully', async () => {
    vi.mocked(commands.getResponseRate).mockResolvedValue({
      status: 'ok',
      data: 0,
    })
    vi.mocked(commands.getAvgDaysToResponse).mockResolvedValue({
      status: 'ok',
      data: 0,
    })
    vi.mocked(commands.getPipelineFunnel).mockResolvedValue({
      status: 'ok',
      data: { saved: 0, applied: 0, interviewing: 0, offer: 0, rejected: 0 },
    })
    vi.mocked(commands.getApplicationsByWeek).mockResolvedValue({
      status: 'ok',
      data: [],
    })
    vi.mocked(commands.getSubmissionsByAdapter).mockResolvedValue({
      status: 'ok',
      data: [],
    })
    vi.mocked(commands.getTierComparison).mockResolvedValue({
      status: 'ok',
      data: {
        tier1: { applied: 0, responded: 0, interviewing: 0, response_rate: 0 },
        tier2: { applied: 0, responded: 0, interviewing: 0, response_rate: 0 },
      },
    })

    renderWithProviders(<Analytics />)

    expect(await screen.findByText('No submissions yet')).toBeInTheDocument()
  })
})
