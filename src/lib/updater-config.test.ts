import { describe, expect, it } from 'vitest'
import { updaterEnabledFor } from './updater-config'

describe('updater build opt-in', () => {
  it('fails closed unless the value is exactly true', () => {
    expect(updaterEnabledFor(undefined)).toBe(false)
    expect(updaterEnabledFor('')).toBe(false)
    expect(updaterEnabledFor('false')).toBe(false)
    expect(updaterEnabledFor('TRUE')).toBe(false)
    expect(updaterEnabledFor('true')).toBe(true)
  })
})
