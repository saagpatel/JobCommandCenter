# Keyboard Shortcuts

Centralized keyboard shortcut management using native DOM event listeners.

## Current Shortcuts

| Shortcut             | Mac   | Windows/Linux | Action                |
| -------------------- | ----- | ------------- | --------------------- |
| Open Preferences     | Cmd+, | Ctrl+,        | Opens settings dialog |
| Command Palette      | Cmd+K | Ctrl+K        | Opens command search  |
| Toggle Left Sidebar  | Cmd+[ | Ctrl+[        | Show/hide left panel  |
| Toggle Right Sidebar | Cmd+] | Ctrl+]        | Show/hide right panel |

## Architecture

DOM preferences, view-switching (Cmd/Ctrl+1–6), and sidebar shortcuts are handled in `src/hooks/use-keyboard-shortcuts.ts`, composed by `src/hooks/useMainWindowEventListeners.ts`. Cmd/Ctrl+K is handled separately in `src/components/command-palette/CommandPalette.tsx`. Native menus still declare Cmd/Ctrl+1 and 2 for sidebar toggles in `src/lib/menu.ts`.

```typescript
export function useKeyboardShortcuts(commandContext: CommandContext) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        switch (e.key) {
          case ',': {
            e.preventDefault()
            commandContext.openPreferences()
            break
          }
          case '[': {
            e.preventDefault()
            const { leftSidebarVisible, setLeftSidebarVisible } =
              useUIStore.getState()
            setLeftSidebarVisible(!leftSidebarVisible)
            break
          }
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [commandContext])
}
```

**Critical**: Use `getState()` to access store data in event handlers to avoid render cascades. See [State Management](./state-management.md#the-getstate-pattern).

## Adding New Shortcuts

### 1. Add to event handler

```typescript
// src/hooks/use-keyboard-shortcuts.ts
case 'n': {
  e.preventDefault()
  commandContext.myNewAction()
  break
}
```

### 2. Add to native menu (if applicable)

```typescript
// src/lib/menu.ts
await MenuItem.new({
  id: 'my-action',
  text: t('menu.myAction'),
  accelerator: 'CmdOrCtrl+N',
  action: handleMyAction,
})
```

See [Menus](./menus.md) for full menu integration details.

## Modifier Keys

```typescript
// Cross-platform modifier (Cmd on Mac, Ctrl elsewhere)
if (e.metaKey || e.ctrlKey) {
}

// With Shift
if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
}

// Function keys (no modifier needed)
if (e.key === 'F1') {
}
```

**Always call `e.preventDefault()`** to prevent browser defaults (like Cmd+, opening browser settings).

## Why Native DOM Events

Native DOM event listeners are used instead of libraries like `react-hotkeys-hook` because they provide more reliable execution in the Tauri environment.

## Conventions

| Pattern         | Keys               |
| --------------- | ------------------ |
| Preferences     | Cmd/Ctrl + ,       |
| Search/Command  | Cmd/Ctrl + K       |
| Panel toggles   | Cmd/Ctrl + [,]     |
| File operations | Cmd/Ctrl + N,O,S   |
| Undo            | Cmd/Ctrl + Z       |
| Redo            | Cmd/Ctrl + Shift+Z |

## Troubleshooting

| Issue                             | Check                                                            |
| --------------------------------- | ---------------------------------------------------------------- |
| Shortcuts not firing              | `useKeyboardShortcuts` composed by `useMainWindowEventListeners` |
| Browser intercepts shortcut       | Add `e.preventDefault()`                                         |
| Different behavior Mac vs Windows | Test `e.metaKey \|\| e.ctrlKey`                                  |
