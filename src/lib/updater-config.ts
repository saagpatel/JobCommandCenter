export function updaterEnabledFor(value: string | undefined): boolean {
  return value === 'true'
}

export const updaterEnabled = updaterEnabledFor(
  import.meta.env.VITE_UPDATER_ACTIVE
)
