import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { PlatformsTab } from './PlatformsTab'

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

describe('PlatformsTab', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Default: sidecar returns no active sessions
    global.fetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve([
          { platform: 'linkedin', has_session: false },
          { platform: 'indeed', has_session: false },
        ]),
    })
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

  it('shows Connected when session exists for a platform', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve([
          { platform: 'linkedin', has_session: true },
          { platform: 'indeed', has_session: false },
        ]),
    })

    render(<PlatformsTab />)

    await waitFor(() => {
      // Both the badge and the button show "Connected" for the active platform
      expect(screen.getAllByText('Connected')).toHaveLength(2)
    })
    // Indeed card is still Not Connected
    expect(screen.getByText('Not Connected')).toBeInTheDocument()
  })

  it('triggers login POST to the correct endpoint on button click', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      // Two session-check calls (one per card)
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            { platform: 'linkedin', has_session: false },
            { platform: 'indeed', has_session: false },
          ]),
      })
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            { platform: 'linkedin', has_session: false },
            { platform: 'indeed', has_session: false },
          ]),
      })
      // LinkedIn login call
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({ platform: 'linkedin', status: 'logged_in' }),
      })
    global.fetch = fetchMock

    render(<PlatformsTab />)

    const loginButtons = screen.getAllByRole('button', { name: /login/i })
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

    global.fetch = vi
      .fn()
      // Two session-check calls
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            { platform: 'linkedin', has_session: false },
            { platform: 'indeed', has_session: false },
          ]),
      })
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            { platform: 'linkedin', has_session: false },
            { platform: 'indeed', has_session: false },
          ]),
      })
      // Login call — stays pending until we resolve
      .mockReturnValueOnce(loginPromise)

    render(<PlatformsTab />)

    const loginButtons = screen.getAllByRole('button', { name: /login/i })
    await user.click(loginButtons[0] as HTMLElement)

    await waitFor(() => {
      expect(screen.getByText('Logging in...')).toBeInTheDocument()
    })

    // Resolve the login so the component can clean up after the test
    resolveLogin({
      json: () =>
        Promise.resolve({ platform: 'linkedin', status: 'logged_in' }),
    })
  })

  it('shows Connected badge and disables button after successful login', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            { platform: 'linkedin', has_session: false },
            { platform: 'indeed', has_session: false },
          ]),
      })
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            { platform: 'linkedin', has_session: false },
            { platform: 'indeed', has_session: false },
          ]),
      })
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({ platform: 'linkedin', status: 'logged_in' }),
      })
    global.fetch = fetchMock

    render(<PlatformsTab />)

    const loginButtons = screen.getAllByRole('button', { name: /login/i })
    await user.click(loginButtons[0] as HTMLElement)

    await waitFor(() => {
      // Badge + button both render "Connected" when active
      expect(screen.getAllByText('Connected')).toHaveLength(2)
    })

    // The LinkedIn button should be disabled
    expect(screen.getByRole('button', { name: 'Connected' })).toBeDisabled()
  })

  it('shows Error badge when login returns a non-logged_in status', async () => {
    const user = userEvent.setup()
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            { platform: 'linkedin', has_session: false },
            { platform: 'indeed', has_session: false },
          ]),
      })
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            { platform: 'linkedin', has_session: false },
            { platform: 'indeed', has_session: false },
          ]),
      })
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            platform: 'linkedin',
            status: 'error',
            message: 'Login timed out',
          }),
      })

    render(<PlatformsTab />)

    const loginButtons = screen.getAllByRole('button', { name: /login/i })
    await user.click(loginButtons[0] as HTMLElement)

    await waitFor(() => {
      expect(screen.getByText('Error')).toBeInTheDocument()
    })
  })
})
