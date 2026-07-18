import '@testing-library/jest-dom'
import { vi } from 'vitest'

class MockStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value))
  }
}

Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: new MockStorage(),
})

// Mock ResizeObserver for components that use @radix-ui/react-scroll-area
class MockResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver

// Mock matchMedia for tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock Tauri APIs for tests
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {
    // Mock unlisten function
  }),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn().mockResolvedValue(null),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}))

// Mock typed Tauri bindings (tauri-specta generated)
vi.mock('@/lib/tauri-bindings', () => ({
  commands: {
    loadPreferences: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: { theme: 'system' } }),
    savePreferences: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    sendNativeNotification: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: null }),
    saveEmergencyData: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    loadEmergencyData: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    cleanupOldRecoveryFiles: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: 0 }),
    getSubmitToken: vi.fn().mockResolvedValue('test-submit-token'),
    listJobs: vi.fn().mockResolvedValue({ status: 'ok', data: [] }),
    getJob: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    createJob: vi.fn().mockResolvedValue({ status: 'ok', data: {} }),
    updateJob: vi.fn().mockResolvedValue({ status: 'ok', data: {} }),
    deleteJob: vi.fn().mockResolvedValue({ status: 'ok', data: true }),
    getProfile: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    upsertProfile: vi.fn().mockResolvedValue({ status: 'ok', data: {} }),
    startSidecar: vi.fn().mockResolvedValue({
      status: 'ok',
      data: {
        state: 'Stopped',
        pid: null,
        restart_count: 0,
        uptime_seconds: null,
      },
    }),
    stopSidecar: vi.fn().mockResolvedValue({
      status: 'ok',
      data: {
        state: 'Stopped',
        pid: null,
        restart_count: 0,
        uptime_seconds: null,
      },
    }),
    checkSidecarHealth: vi.fn().mockResolvedValue({
      status: 'ok',
      data: {
        state: 'Stopped',
        pid: null,
        restart_count: 0,
        uptime_seconds: null,
      },
    }),
    getSidecarStatus: vi.fn().mockResolvedValue({
      status: 'ok',
      data: {
        state: 'Stopped',
        pid: null,
        restart_count: 0,
        uptime_seconds: null,
      },
    }),
    storeCredential: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    getCredential: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    deleteCredential: vi.fn().mockResolvedValue({ status: 'ok', data: false }),
    validateFilePath: vi.fn().mockResolvedValue({ status: 'ok', data: true }),
    revealInFinder: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    listFollowups: vi.fn().mockResolvedValue({ status: 'ok', data: [] }),
    listFollowupsForJob: vi.fn().mockResolvedValue({ status: 'ok', data: [] }),
    createFollowup: vi.fn().mockResolvedValue({ status: 'ok', data: {} }),
    updateFollowup: vi.fn().mockResolvedValue({ status: 'ok', data: {} }),
    deleteFollowup: vi.fn().mockResolvedValue({ status: 'ok', data: true }),
    listNotesForJob: vi.fn().mockResolvedValue({ status: 'ok', data: [] }),
    getNote: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
    createNote: vi.fn().mockResolvedValue({ status: 'ok', data: {} }),
    updateNote: vi.fn().mockResolvedValue({ status: 'ok', data: {} }),
    deleteNote: vi.fn().mockResolvedValue({ status: 'ok', data: true }),
    getApplicationsByWeek: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: [] }),
    getPipelineFunnel: vi.fn().mockResolvedValue({
      status: 'ok',
      data: { saved: 0, applied: 0, interviewing: 0, offer: 0, rejected: 0 },
    }),
    getResponseRate: vi.fn().mockResolvedValue({ status: 'ok', data: 0 }),
    getAvgDaysToResponse: vi.fn().mockResolvedValue({ status: 'ok', data: 0 }),
    getSubmissionsByAdapter: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: [] }),
    recordSubmissionReceipt: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: {} }),
    listUnresolvedSubmissionReceipts: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: [] }),
    listSubmissionReceiptsForJob: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: [] }),
    resolveSubmissionReceipts: vi
      .fn()
      .mockResolvedValue({ status: 'ok', data: true }),
    getTierComparison: vi.fn().mockResolvedValue({
      status: 'ok',
      data: {
        tier1: { applied: 0, responded: 0, interviewing: 0, response_rate: 0 },
        tier2: { applied: 0, responded: 0, interviewing: 0, response_rate: 0 },
      },
    }),
    getSidebarCounts: vi.fn().mockResolvedValue({
      status: 'ok',
      data: { followups_due: 0, prep_needed: 0 },
    }),
  },
  unwrapResult: vi.fn((result: { status: string; data?: unknown }) => {
    if (result.status === 'ok') return result.data
    throw result
  }),
}))
