import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { PlatformsTab } from './PlatformsTab'

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

interface SessionResponse {
  platform: string
  status: 'not_connected' | 'verification_required' | 'authenticated'
  message: string
}

const noSessions: [SessionResponse, SessionResponse] = [
  {
    platform: 'linkedin',
    status: 'not_connected',
    message: 'No saved LinkedIn session was found.',
  },
  {
    platform: 'indeed',
    status: 'not_connected',
    message: 'No saved Indeed session was found.',
  },
]

const browserReady = {
  status: 'ready',
  source: 'system_chrome',
  message: 'Google Chrome is ready and will use an isolated JCC profile.',
}

function mockFetchByRoute({
  sessions = noSessions,
  login,
}: {
  sessions?: SessionResponse[]
  login?: () => Promise<unknown>
} = {}) {
  return vi.fn().mockImplementation((input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/playwright/readiness')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(browserReady),
      })
    }
    if (url.endsWith('/playwright/sessions')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(sessions),
      })
    }
    if (url.includes('/playwright/sessions/') && url.endsWith('/login')) {
      return login?.() ?? Promise.reject(new Error('Unexpected login request'))
    }
    return Promise.reject(new Error(`Unexpected request: ${url}`))
  })
}

describe('PlatformsTab', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    global.fetch = mockFetchByRoute()
  })

  it('renders LinkedIn and Indeed cards', () => {
    render(<PlatformsTab />)
    expect(screen.getByText('LinkedIn')).toBeInTheDocument()
    expect(screen.getByText('Indeed')).toBeInTheDocument()
  })

  it('shows Not Connected by default', () => {
    render(<PlatformsTab />)
    const badges = screen.getAllByText('Not Connected')
    expect(badges).toHaveLength(2)
  })

  it('disables login and offers a retry when no supported browser is available', async () => {
    global.fetch = vi
      .fn()
      .mockImplementation((input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/playwright/readiness')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                status: 'unavailable',
                source: null,
                message:
                  'Browser automation is unavailable. Install Google Chrome, then check again.',
              }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([noSessions[0], noSessions[1]]),
        })
      })

    render(<PlatformsTab />)

    expect(
      await screen.findByText(/browser automation is unavailable/i)
    ).toBeInTheDocument()
    for (const button of screen.getAllByRole('button', { name: /login/i })) {
      expect(button).toBeDisabled()
    }
    expect(
      screen.getByRole('button', { name: /check again/i })
    ).toBeInTheDocument()
  })

  it('enables login after browser readiness becomes available', async () => {
    const user = userEvent.setup()
    let readinessChecks = 0
    global.fetch = vi
      .fn()
      .mockImplementation((input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/playwright/readiness')) {
          readinessChecks += 1
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve(
                readinessChecks === 1
                  ? {
                      status: 'unavailable',
                      source: null,
                      message: 'Browser automation is unavailable.',
                    }
                  : browserReady
              ),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(noSessions),
        })
      })

    render(<PlatformsTab />)

    await user.click(
      await screen.findByRole('button', { name: /check again/i })
    )

    await screen.findByText('Browser ready')
    for (const button of screen.getAllByRole('button', { name: /login/i })) {
      expect(button).toBeEnabled()
    }
  })

  it('shows Connected only for a session authenticated in this app run', async () => {
    global.fetch = mockFetchByRoute({
      sessions: [
        {
          platform: 'linkedin',
          status: 'authenticated',
          message: 'LinkedIn was verified during this app session.',
        },
        noSessions[1],
      ],
    })

    render(<PlatformsTab />)

    await waitFor(() => {
      // Both the badge and the button show "Connected" for the active platform
      expect(screen.getAllByText('Connected')).toHaveLength(2)
    })
    // Indeed card is still Not Connected
    expect(screen.getByText('Not Connected')).toBeInTheDocument()
  })

  it('requires verification for a saved profile after restart', async () => {
    global.fetch = mockFetchByRoute({
      sessions: [
        {
          platform: 'linkedin',
          status: 'verification_required',
          message:
            'A saved LinkedIn browser profile exists. Verify it before submitting.',
        },
        noSessions[1],
      ],
    })

    render(<PlatformsTab />)

    expect(await screen.findByText('Verification required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verify session' })).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Connected' })
    ).not.toBeInTheDocument()
  })

  it('triggers login POST to the correct endpoint on button click', async () => {
    const user = userEvent.setup()
    const fetchMock = mockFetchByRoute({
      login: () =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ platform: 'linkedin', status: 'logged_in' }),
        }),
    })
    global.fetch = fetchMock

    render(<PlatformsTab />)

    await screen.findByText('Browser ready')
    const loginButtons = await screen.findAllByRole('button', {
      name: /login/i,
    })
    await user.click(loginButtons[0] as HTMLElement)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:9876/playwright/sessions/linkedin/login',
        { method: 'POST' }
      )
    })
  })

  it('shows Logging in... state during an in-flight login request', async () => {
    const user = userEvent.setup()
    let resolveLogin!: (value: unknown) => void
    const loginPromise = new Promise(resolve => {
      resolveLogin = resolve
    })

    global.fetch = mockFetchByRoute({
      login: () => loginPromise,
    })

    render(<PlatformsTab />)

    await screen.findByText('Browser ready')
    const loginButtons = await screen.findAllByRole('button', {
      name: /login/i,
    })
    await user.click(loginButtons[0] as HTMLElement)

    await waitFor(() => {
      expect(screen.getByText('Logging in...')).toBeInTheDocument()
    })

    resolveLogin({
      ok: true,
      json: () =>
        Promise.resolve({ platform: 'linkedin', status: 'logged_in' }),
    })
  })

  it('shows Connected badge and disables button after successful login', async () => {
    const user = userEvent.setup()
    global.fetch = mockFetchByRoute({
      login: () =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ platform: 'linkedin', status: 'logged_in' }),
        }),
    })

    render(<PlatformsTab />)

    await screen.findByText('Browser ready')
    const loginButtons = await screen.findAllByRole('button', {
      name: /login/i,
    })
    await user.click(loginButtons[0] as HTMLElement)

    await waitFor(() => {
      expect(screen.getAllByText('Connected')).toHaveLength(2)
    })

    expect(screen.getByRole('button', { name: 'Connected' })).toBeDisabled()
  })

  it('shows Error badge when login returns a non-logged_in status', async () => {
    const user = userEvent.setup()
    global.fetch = mockFetchByRoute({
      login: () =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              platform: 'linkedin',
              status: 'error',
              message: 'Login timed out',
            }),
        }),
    })

    render(<PlatformsTab />)

    await screen.findByText('Browser ready')
    const loginButtons = await screen.findAllByRole('button', {
      name: /login/i,
    })
    await user.click(loginButtons[0] as HTMLElement)

    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument()
    })
  })
})
