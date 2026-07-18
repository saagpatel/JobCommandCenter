import { check } from '@tauri-apps/plugin-updater'
import { render } from '@/test/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

// Tauri bindings are mocked globally in src/test/setup.ts

describe('App', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders without crashing', () => {
    const { container } = render(<App />)
    expect(container).toBeTruthy()
  })

  it('does not contact the updater without the release build opt-in', async () => {
    vi.useFakeTimers()

    render(<App />)
    await vi.advanceTimersByTimeAsync(6_000)

    expect(check).not.toHaveBeenCalled()
  })
})
