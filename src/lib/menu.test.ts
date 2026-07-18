import { beforeEach, describe, expect, it, vi } from 'vitest'

const menuMocks = vi.hoisted(() => ({
  menuItemNew: vi.fn(async (options: Record<string, unknown>) => options),
  predefinedNew: vi.fn(async (options: Record<string, unknown>) => options),
  submenuNew: vi.fn(async (options: Record<string, unknown>) => options),
  setAsAppMenu: vi.fn(async () => undefined),
  menuNew: vi.fn(),
}))

vi.mock('@tauri-apps/api/menu', () => ({
  MenuItem: { new: menuMocks.menuItemNew },
  PredefinedMenuItem: { new: menuMocks.predefinedNew },
  Submenu: { new: menuMocks.submenuNew },
  Menu: { new: menuMocks.menuNew },
}))

import { buildAppMenu } from './menu'

describe('application menu updater containment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    menuMocks.menuNew.mockResolvedValue({
      setAsAppMenu: menuMocks.setAsAppMenu,
    })
  })

  it('omits updater contact when the release build opt-in is disabled', async () => {
    await buildAppMenu(false)

    const itemIds = menuMocks.menuItemNew.mock.calls.map(
      ([options]) => options.id
    )
    expect(itemIds).not.toContain('check-updates')
    expect(menuMocks.submenuNew.mock.calls[0]?.[0]).toMatchObject({
      text: 'Job Command Center',
    })
  })

  it('offers manual update checks only for opted-in release builds', async () => {
    await buildAppMenu(true)

    const itemIds = menuMocks.menuItemNew.mock.calls.map(
      ([options]) => options.id
    )
    expect(itemIds).toContain('check-updates')
  })
})
