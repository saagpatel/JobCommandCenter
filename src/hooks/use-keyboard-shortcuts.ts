import { useEffect } from 'react'
import { useUIStore } from '@/store/ui-store'
import type { CommandContext } from '@/lib/commands/types'

type ActiveView =
  | 'tracker'
  | 'submit'
  | 'followups'
  | 'interview'
  | 'analytics'
  | 'settings'

const VIEW_SHORTCUTS: Record<string, ActiveView> = {
  '1': 'tracker',
  '2': 'submit',
  '3': 'followups',
  '4': 'interview',
  '5': 'analytics',
  '6': 'settings',
}

/**
 * Handles global keyboard shortcuts for the application.
 *
 * - Cmd/Ctrl+, : Open preferences
 * - Cmd/Ctrl+1-6 : Switch views (tracker, submit, followups, interview, analytics, settings)
 * - Cmd/Ctrl+[ : Toggle left sidebar
 * - Cmd/Ctrl+] : Toggle right sidebar
 */
export function useKeyboardShortcuts(commandContext: CommandContext) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === ',') {
          e.preventDefault()
          commandContext.openPreferences()
          return
        }

        if (e.key === '[') {
          e.preventDefault()
          const { leftSidebarVisible, setLeftSidebarVisible } =
            useUIStore.getState()
          setLeftSidebarVisible(!leftSidebarVisible)
          return
        }

        if (e.key === ']') {
          e.preventDefault()
          const { rightSidebarVisible, setRightSidebarVisible } =
            useUIStore.getState()
          setRightSidebarVisible(!rightSidebarVisible)
          return
        }

        const view = VIEW_SHORTCUTS[e.key]
        if (view) {
          e.preventDefault()
          useUIStore.getState().setActiveView(view)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [commandContext])
}
