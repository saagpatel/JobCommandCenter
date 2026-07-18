import { render, screen } from '@/test/test-utils'
import { describe, expect, it } from 'vitest'
import { TitleBarTitle } from './TitleBarContent'

describe('TitleBarTitle', () => {
  it('uses the product name when no title is provided', () => {
    render(<TitleBarTitle />)

    expect(screen.getByText('Job Command Center')).toBeInTheDocument()
    expect(screen.queryByText('Tauri App')).not.toBeInTheDocument()
  })
})
