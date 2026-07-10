import { open } from '@tauri-apps/plugin-dialog'
import userEvent from '@testing-library/user-event'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useImportPacket } from '@/services/jobs'
import { usePreferences } from '@/services/preferences'
import { render, screen } from '@/test/test-utils'
import { ImportPacketModal } from './ImportPacketModal'

vi.mock('@/services/jobs', () => ({
  useImportPacket: vi.fn(),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: vi.fn(),
}))

describe('ImportPacketModal', () => {
  const mutate = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(useImportPacket as Mock).mockReturnValue({ mutate, isPending: false })
    ;(usePreferences as Mock).mockReturnValue({
      data: { applykit_public_key_id: 'trusted-key-id' },
    })
  })

  it('disables Verify & Import until a manifest and apply URL are provided', async () => {
    const user = userEvent.setup()
    render(<ImportPacketModal open onOpenChange={vi.fn()} />)

    const submit = screen.getByRole('button', { name: /verify & import/i })
    expect(submit).toBeDisabled()

    // URL alone is not enough — the manifest file is still missing.
    await user.type(
      screen.getByLabelText(/apply url/i),
      'https://jobs.example.com/apply/1'
    )
    expect(submit).toBeDisabled()
  })

  it('imports with the chosen manifest path and the configured trusted key', async () => {
    vi.mocked(open).mockResolvedValue(
      '/packets/Acme_Engineer/packet.manifest.json'
    )
    const user = userEvent.setup()
    render(<ImportPacketModal open onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /choose file/i }))
    await screen.findByText('/packets/Acme_Engineer/packet.manifest.json')

    await user.type(
      screen.getByLabelText(/apply url/i),
      'https://jobs.example.com/apply/1'
    )
    await user.click(screen.getByRole('button', { name: /verify & import/i }))

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith(
      {
        manifest_path: '/packets/Acme_Engineer/packet.manifest.json',
        apply_url: 'https://jobs.example.com/apply/1',
        ats: 'greenhouse',
        expected_public_key_id: 'trusted-key-id',
      },
      expect.anything()
    )
  })

  it('does not pin a key when no trusted key is configured', async () => {
    vi.mocked(open).mockResolvedValue(
      '/packets/Acme_Engineer/packet.manifest.json'
    )
    ;(usePreferences as Mock).mockReturnValue({
      data: { applykit_public_key_id: null },
    })
    const user = userEvent.setup()
    render(<ImportPacketModal open onOpenChange={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /choose file/i }))
    await user.type(
      screen.getByLabelText(/apply url/i),
      'https://jobs.example.com/apply/1'
    )
    await user.click(screen.getByRole('button', { name: /verify & import/i }))

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ expected_public_key_id: null }),
      expect.anything()
    )
  })
})
