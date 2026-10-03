# Notifications

Simple notification system supporting both in-app toasts (Sonner) and native system notifications (Tauri).

## Quick Start

### Basic Usage

```typescript
import { notify, notifications } from '@/lib/notifications'

// Simple info toast
notify('File saved', 'Successfully saved to disk')

// Specific notification types
notifications.success('Success!', 'Operation completed')
notifications.error('Error', 'Something went wrong')
notifications.warning('Warning', 'Please check your input')
notifications.info('Info', 'Here is some information')

// Native system notification
notify('Update Available', 'Click to install', { native: true })
```

### Available Functions

| Function                            | Description                          |
| ----------------------------------- | ------------------------------------ |
| `notify(title, message?, options?)` | Send notification (toast or native)  |
| `notifications.success()`           | Success toast or native notification |
| `notifications.error()`             | Error toast or native notification   |
| `notifications.info()`              | Info toast or native notification    |
| `notifications.warning()`           | Warning toast or native notification |

## Configuration

### Toast Notifications (Sonner)

- **In-app**: Appear in bottom-right corner
- **Themed**: Automatically adapt to light/dark theme
- **Auto-dismiss**: Default behavior (can be customized)
- **Positioned**: Always visible within app window

### Native System Notifications

- **macOS**: Appear in Notification Center
- **Platform-aware**: Handled by OS notification system
- **Permissions**: Automatically request permission when needed
- **Fallback**: Falls back to toast if native notification fails

## Options

```typescript
interface NotificationOptions {
  type?: 'success' | 'error' | 'info' | 'warning' // Notification type
  native?: boolean // Use native notification
  duration?: number // Toast duration (ms, 0 = no auto-dismiss)
}
```

## Examples

### React Component Usage

```typescript
import { notifications } from '@/lib/notifications'

function SaveButton() {
  const handleSave = async () => {
    try {
      await saveFile()
      notifications.success('Saved', 'File saved successfully')
    } catch (error) {
      notifications.error('Save Failed', error.message)
    }
  }

  return <button onClick={handleSave}>Save</button>
}
```

### Command Palette Integration

The notification system includes one test command accessible via the command palette (Cmd+K):

- **Test Toast** - Show a success toast (`notification.test-toast`)

### Advanced Usage

```typescript
// Custom duration (5 seconds)
notify('Long message', 'This will stay visible for 5 seconds', {
  duration: 5000,
})

// Persistent toast (no auto-dismiss)
notify('Important', 'This requires manual dismissal', {
  duration: 0,
})

// Native notification with fallback
// notify handles failures internally and falls back to a toast.
await notify('System Alert', 'Check this out', { native: true })
```

## Implementation Details

### Frontend (TypeScript)

- **Location**: `src/lib/notifications.ts`
- **Dependencies**: Sonner for toasts, Tauri API for native notifications
- **Error handling**: Automatic fallback from native to toast
- **Logging**: The logger utility emits notification logs in development

### Backend (Rust)

- **Command**: `send_native_notification`
- **Plugin**: `tauri-plugin-notification`
- **Platform support**: Desktop only (mobile shows error)
- **Logging**: Comprehensive logging of notification attempts

### Permissions

Native notifications require the `notification:default` permission in `src-tauri/capabilities/default.json`:

```json
{
  "permissions": ["notification:default"]
}
```

## Best Practices

1. **Choose the right type**: Use toast for in-app feedback, native for system-level alerts
2. **Keep messages concise**: Short titles and clear messages work best
3. **Use appropriate types**: Match notification type to the action result
4. **Handle errors**: The system includes automatic fallback handling
5. **Test both modes**: The command palette tests a success toast; native mode requires a separate `notify` call

## Troubleshooting

### Native Notifications Not Working

1. **Check permissions**: Ensure notification permissions are granted in macOS System Preferences
2. **Check console**: Look for permission request dialogs or error messages
3. **Test fallback**: Native notifications automatically fall back to toasts on failure
4. **Development mode**: Notifications work in both dev and production builds

### Toast Notifications Not Appearing

1. **Check Toaster component**: Ensure `<Toaster />` is rendered in MainWindow
2. **Check theme**: Toasts should adapt to current theme automatically
3. **Check positioning**: Default position is bottom-right

### Command Palette Tests

Use the built-in Test Toast command to verify success toasts:

1. Open command palette (Cmd+K)
2. Search for "notification" or "toast"
3. Run Test Toast to verify functionality
