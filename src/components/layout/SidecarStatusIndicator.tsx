import { cn } from '@/lib/utils'
import {
  useSidecarStatus,
  useStartSidecar,
  useStopSidecar,
} from '@/services/sidecar'
import { useUIStore } from '@/store/ui-store'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import type { SidecarState } from '@/lib/tauri-bindings'

const stateConfig: Record<
  SidecarState,
  { color: string; label: string; pulse: boolean }
> = {
  Starting: {
    color: 'bg-yellow-500',
    label: 'Starting...',
    pulse: true,
  },
  Healthy: {
    color: 'bg-emerald-500',
    label: 'Engine running',
    pulse: false,
  },
  Unhealthy: {
    color: 'bg-orange-500',
    label: 'Engine unhealthy',
    pulse: true,
  },
  Stopped: {
    color: 'bg-red-500',
    label: 'Engine stopped',
    pulse: false,
  },
  Failed: {
    color: 'bg-red-600',
    label: 'Engine failed',
    pulse: false,
  },
}

export function SidecarStatusIndicator() {
  const zustandStatus = useUIStore(state => state.sidecarStatus)
  const { data: status } = useSidecarStatus()
  const startSidecar = useStartSidecar()
  const stopSidecar = useStopSidecar()

  const currentState = status?.state ?? zustandStatus
  const config = stateConfig[currentState]

  const canStart = currentState === 'Stopped' || currentState === 'Failed'
  const canStop = currentState === 'Healthy' || currentState === 'Unhealthy'

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground">
          <span className="relative flex h-2 w-2">
            {config.pulse && (
              <span
                className={cn(
                  'absolute inline-flex h-full w-full animate-ping rounded-full opacity-75',
                  config.color
                )}
              />
            )}
            <span
              className={cn(
                'relative inline-flex h-2 w-2 rounded-full',
                config.color
              )}
            />
          </span>
          {config.label}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-56">
        <div className="flex flex-col gap-3">
          <div className="text-sm font-medium">Submission Engine</div>

          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <div className="flex justify-between">
              <span>Status</span>
              <span className="font-medium text-foreground">
                {currentState}
              </span>
            </div>
            {status?.pid && (
              <div className="flex justify-between">
                <span>PID</span>
                <span className="font-medium text-foreground">
                  {status.pid}
                </span>
              </div>
            )}
            {status?.uptime_seconds != null && status.uptime_seconds > 0 && (
              <div className="flex justify-between">
                <span>Uptime</span>
                <span className="font-medium text-foreground">
                  {formatUptime(status.uptime_seconds)}
                </span>
              </div>
            )}
            {status?.restart_count != null && status.restart_count > 0 && (
              <div className="flex justify-between">
                <span>Restarts</span>
                <span className="font-medium text-foreground">
                  {status.restart_count}
                </span>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {canStart && (
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                onClick={() => startSidecar.mutate()}
                disabled={startSidecar.isPending}
              >
                {startSidecar.isPending ? 'Starting...' : 'Start'}
              </Button>
            )}
            {canStop && (
              <Button
                size="sm"
                variant="outline"
                className="flex-1 text-xs"
                onClick={() => stopSidecar.mutate()}
                disabled={stopSidecar.isPending}
              >
                {stopSidecar.isPending ? 'Stopping...' : 'Stop'}
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${mins}m`
}
